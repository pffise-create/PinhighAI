#!/usr/bin/env python3
"""Frame-extraction bake-off: champion (uniform 4fps) vs challenger (event-anchored).

Champion faithfully reproduces production behavior:
  - ffmpeg fps=4 extraction (frame_extractor_optimized.py)
  - evenly-spaced selection of 10 frames (selectFramesForAnalysis in
    ai-analysis-processor.js, gpt-5 modelFrameLimit=10)

Challenger (event-anchored, proposed):
  - Pass 1: locate impact via audio onset (primary) and motion energy
    (fallback / cross-check). No ML.
  - Pass 2: extract relative to the impact anchor:
      dense   [t-0.50s, t+0.30s]  native fps (capped 60)
      phase   [t-2.50s, t-0.50s]  5 fps
      finish  [t+0.30s, t+1.50s]  2 fps
  - Select 10: 4 phase + 5 dense + 1 finish (redistribute if windows clip).
  - If no confident anchor: fall back to champion behavior (flagged).

Outputs per video: selected frames for each arm, one blinded contact-sheet
montage per arm (A/B assignment randomized per video, mapping kept in a
separate unblinding file), and a metadata record.

Usage:
  python frame_bakeoff.py run-all --videos-dir DIR --out DIR [--limit N]
"""

import argparse
import json
import math
import os
import random
import shutil
import struct
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

MODEL_FRAME_LIMIT = 10
CHAMPION_FPS = 4.0

DENSE_PRE_S = 0.50
DENSE_POST_S = 0.30
PHASE_PRE_S = 2.50
FINISH_POST_S = 1.50
PHASE_FPS = 5.0
FINISH_FPS = 2.0
DENSE_FPS_CAP = 60.0

AUDIO_SR = 8000
AUDIO_WIN_S = 0.010  # 10ms RMS windows
MOTION_WIDTH = 160
MOTION_FPS_CAP = 30.0
EDGE_EXCLUDE_S = 0.25  # ignore anchors in the first/last quarter second
MIN_PROMINENCE = 4.0   # peak / median ratio to trust a signal
AGREE_S = 0.30         # audio & motion agreement tolerance


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def probe(video):
    out = run([
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', video,
    ]).stdout
    info = json.loads(out)
    duration = float(info['format'].get('duration', 0) or 0)
    fps = None
    has_audio = False
    for s in info.get('streams', []):
        if s.get('codec_type') == 'video' and fps is None:
            num, _, den = (s.get('avg_frame_rate') or '0/1').partition('/')
            try:
                fps = float(num) / float(den or 1)
            except ZeroDivisionError:
                fps = None
        if s.get('codec_type') == 'audio':
            has_audio = True
    if not fps or fps <= 0 or math.isnan(fps):
        fps = 30.0
    return duration, min(fps, 240.0), has_audio


# ── Pass 1: anchor detection ────────────────────────────────────────────────

def audio_onset(video, duration):
    """Return (t, prominence) of the sharpest audio onset, or None."""
    try:
        pcm = run([
            'ffmpeg', '-v', 'quiet', '-i', video, '-vn',
            '-ac', '1', '-ar', str(AUDIO_SR), '-f', 's16le', '-',
        ]).stdout
    except subprocess.CalledProcessError:
        return None
    if len(pcm) < AUDIO_SR:  # < 0.5s of audio
        return None
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
    win = max(1, int(AUDIO_SR * AUDIO_WIN_S))
    n = len(samples) // win
    if n < 20:
        return None
    rms = np.sqrt(np.mean(samples[: n * win].reshape(n, win) ** 2, axis=1))
    onset = np.diff(rms)
    onset[onset < 0] = 0
    lo = int(EDGE_EXCLUDE_S / AUDIO_WIN_S)
    hi = len(onset) - lo
    if hi <= lo:
        return None
    window = onset[lo:hi]
    peak_idx = int(np.argmax(window)) + lo
    med = float(np.median(onset[onset > 0])) if np.any(onset > 0) else 0.0
    if med <= 0:
        return None
    prominence = float(onset[peak_idx]) / med
    t = (peak_idx + 1) * AUDIO_WIN_S
    return (t, prominence)


def motion_peak(video, duration, fps):
    """Return (t, prominence) of the global motion-energy peak, or None."""
    sample_fps = min(fps, MOTION_FPS_CAP)
    try:
        raw = run([
            'ffmpeg', '-v', 'quiet', '-i', video,
            '-vf', f'fps={sample_fps},scale={MOTION_WIDTH}:-2,format=gray',
            '-f', 'rawvideo', '-',
        ]).stdout
    except subprocess.CalledProcessError:
        return None
    # infer frame size: width known, height from stream shape
    if not raw:
        return None
    n_pixels_per_row = MOTION_WIDTH
    est_frames = max(1, int(round(duration * sample_fps)))
    frame_bytes = len(raw) // est_frames if est_frames else 0
    if frame_bytes < n_pixels_per_row:
        return None
    height = frame_bytes // n_pixels_per_row
    frame_bytes = n_pixels_per_row * height
    count = len(raw) // frame_bytes
    if count < 5:
        return None
    frames = np.frombuffer(raw[: count * frame_bytes], dtype=np.uint8)
    frames = frames.reshape(count, height, n_pixels_per_row).astype(np.int16)
    energy = np.mean(np.abs(np.diff(frames, axis=0)), axis=(1, 2))
    if len(energy) < 5:
        return None
    kernel = np.ones(3) / 3
    smooth = np.convolve(energy, kernel, mode='same')
    lo = int(EDGE_EXCLUDE_S * sample_fps)
    hi = len(smooth) - lo
    if hi <= lo:
        lo, hi = 0, len(smooth)
    window = smooth[lo:hi]
    peak_idx = int(np.argmax(window)) + lo
    med = float(np.median(smooth))
    if med <= 0:
        return None
    prominence = float(smooth[peak_idx]) / med
    t = (peak_idx + 1) / sample_fps
    return (t, prominence)


def find_anchor(video, duration, fps, has_audio):
    """Fuse audio + motion into an impact anchor. Returns (t, method) or None."""
    audio = audio_onset(video, duration) if has_audio else None
    motion = motion_peak(video, duration, fps)

    if audio and motion and abs(audio[0] - motion[0]) <= AGREE_S:
        return (audio[0], 'audio+motion')
    if audio and audio[1] >= MIN_PROMINENCE and motion and motion[1] >= MIN_PROMINENCE:
        # Both confident but disagree: motion tracks the swing itself; audio
        # can be fooled by speech/wind. Prefer motion, note the conflict.
        return (motion[0], 'motion(conflict)')
    if audio and audio[1] >= MIN_PROMINENCE:
        return (audio[0], 'audio')
    if motion and motion[1] >= MIN_PROMINENCE:
        return (motion[0], 'motion')
    return None


# ── Extraction ──────────────────────────────────────────────────────────────

def extract_window(video, start, end, fps, outdir, prefix):
    """Extract frames from [start, end] at fps. Returns [(path, timestamp)]."""
    start = max(0.0, start)
    if end <= start:
        return []
    os.makedirs(outdir, exist_ok=True)
    pattern = os.path.join(outdir, f'{prefix}_%04d.jpg')
    run([
        'ffmpeg', '-v', 'quiet', '-ss', f'{start:.3f}', '-to', f'{end:.3f}',
        '-i', video, '-vf', f'fps={fps},scale=720:-2', '-q:v', '3', pattern,
    ])
    frames = []
    i = 1
    while True:
        p = os.path.join(outdir, f'{prefix}_{i:04d}.jpg')
        if not os.path.exists(p):
            break
        frames.append((p, start + (i - 1) / fps))
        i += 1
    return frames


def select_evenly(frames, max_frames):
    """Faithful port of selectFramesForAnalysis (ai-analysis-processor.js)."""
    if len(frames) <= max_frames:
        return list(frames)
    selected, used = [], set()
    denominator = max(max_frames - 1, 1)
    for i in range(max_frames):
        raw = round((i * (len(frames) - 1)) / denominator)
        idx = min(max(raw, 0), len(frames) - 1)
        while idx in used and idx < len(frames) - 1:
            idx += 1
        if idx not in used:
            used.add(idx)
            selected.append(frames[idx])
    return selected


def champion_extract(video, workdir):
    frames = extract_window(video, 0.0, 10 ** 6, CHAMPION_FPS, workdir, 'champ')
    return select_evenly(frames, MODEL_FRAME_LIMIT), len(frames)


def challenger_extract(video, duration, fps, has_audio, workdir):
    anchor = find_anchor(video, duration, fps, has_audio)
    if anchor is None:
        selected, total = champion_extract(video, os.path.join(workdir, 'fb'))
        return selected, {'anchor': None, 'method': 'fallback-uniform', 'total_extracted': total}

    t, method = anchor
    dense_fps = min(fps, DENSE_FPS_CAP)
    dense = extract_window(video, t - DENSE_PRE_S, t + DENSE_POST_S, dense_fps, workdir, 'dense')
    phase = extract_window(video, t - PHASE_PRE_S, t - DENSE_PRE_S, PHASE_FPS, workdir, 'phase')
    finish = extract_window(video, t + DENSE_POST_S, t + FINISH_POST_S, FINISH_FPS, workdir, 'finish')

    quota = {'phase': 4, 'dense': 5, 'finish': 1}
    pools = {'phase': phase, 'dense': dense, 'finish': finish}
    # Redistribute unmet quota (clipped windows) into the dense pool first.
    short = sum(max(0, quota[k] - len(pools[k])) for k in quota)
    for k in quota:
        quota[k] = min(quota[k], len(pools[k]))
    for k in ('dense', 'phase', 'finish'):
        while short > 0 and quota[k] < len(pools[k]):
            quota[k] += 1
            short -= 1

    selected = []
    for k in ('phase', 'dense', 'finish'):
        selected.extend(select_evenly(pools[k], quota[k]))
    selected.sort(key=lambda f: f[1])
    meta = {
        'anchor': round(t, 3), 'method': method,
        'total_extracted': len(dense) + len(phase) + len(finish),
        'window_counts': {k: len(v) for k, v in pools.items()},
    }
    return selected[:MODEL_FRAME_LIMIT], meta


# ── Montage ─────────────────────────────────────────────────────────────────

def montage(frames, out_path, tile_w=384):
    cols, rows = 5, 2
    tiles = []
    for path, ts in frames[:MODEL_FRAME_LIMIT]:
        img = Image.open(path)
        h = int(img.height * tile_w / img.width)
        tiles.append((img.resize((tile_w, h)), ts))
    if not tiles:
        return False
    tile_h = max(t[0].height for t in tiles) + 22
    sheet = Image.new('RGB', (cols * tile_w, rows * tile_h), (16, 16, 16))
    draw = ImageDraw.Draw(sheet)
    for i, (img, ts) in enumerate(tiles):
        x, y = (i % cols) * tile_w, (i // cols) * tile_h
        sheet.paste(img, (x, y))
        draw.text((x + 6, y + tile_h - 18), f't={ts:.2f}s', fill=(255, 255, 80))
    sheet.save(out_path, quality=82)
    return True


# ── Runner ──────────────────────────────────────────────────────────────────

def process_video(video, out_root, vid_id, rng):
    duration, fps, has_audio = probe(video)
    if duration < 1.0:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        champ, champ_total = champion_extract(video, os.path.join(tmp, 'c'))
        chall, chall_meta = challenger_extract(
            video, duration, fps, has_audio, os.path.join(tmp, 'x'))
        if not champ or not chall:
            return None

        # Blind A/B assignment
        champ_is_a = rng.random() < 0.5
        arms = {'A': champ if champ_is_a else chall,
                'B': chall if champ_is_a else champ}
        os.makedirs(os.path.join(out_root, 'montages'), exist_ok=True)
        for arm, frames in arms.items():
            ok = montage(frames, os.path.join(out_root, 'montages', f'{vid_id}_{arm}.jpg'))
            if not ok:
                return None

    return {
        'video_id': vid_id,
        'duration': round(duration, 2),
        'fps': round(fps, 2),
        'has_audio': has_audio,
        'champion': {'selected': len(champ), 'total_extracted': champ_total},
        'challenger': chall_meta | {'selected': len(chall)},
        'assignment': {'A': 'champion' if champ_is_a else 'challenger',
                       'B': 'challenger' if champ_is_a else 'champion'},
    }


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    ra = sub.add_parser('run-all')
    ra.add_argument('--videos-dir', required=True)
    ra.add_argument('--out', required=True)
    ra.add_argument('--limit', type=int, default=0)
    ra.add_argument('--seed', type=int, default=17)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    videos = []
    for root, _, files in os.walk(args.videos_dir):
        for f in sorted(files):
            if f.lower().endswith(('.mov', '.mp4', '.m4v')):
                videos.append(os.path.join(root, f))
    if args.limit:
        videos = videos[: args.limit]

    os.makedirs(args.out, exist_ok=True)
    meta_path = os.path.join(args.out, 'bakeoff-metadata.jsonl')
    unblind_path = os.path.join(args.out, 'UNBLINDING-do-not-read-before-judging.jsonl')
    done = failed = 0
    with open(meta_path, 'a') as meta_f, open(unblind_path, 'a') as ub_f:
        for i, video in enumerate(videos):
            vid_id = os.path.splitext(os.path.basename(video))[0][:60]
            # Resume support: skip videos whose montages already exist
            if os.path.exists(os.path.join(args.out, 'montages', f'v{i:03d}_B.jpg')):
                rng.random()  # keep the A/B assignment stream aligned
                continue
            try:
                rec = process_video(video, args.out, f'v{i:03d}', rng)
            except Exception as e:  # noqa: BLE001 — log and continue the corpus
                print(f'[{i}] FAILED {vid_id}: {e}', flush=True)
                failed += 1
                continue
            if rec is None:
                failed += 1
                continue
            rec['source'] = vid_id
            assignment = rec.pop('assignment')
            meta_f.write(json.dumps(rec) + '\n')
            ub_f.write(json.dumps({'video_id': rec['video_id'], **assignment}) + '\n')
            done += 1
            if done % 20 == 0:
                print(f'processed {done}/{len(videos)}', flush=True)
    print(f'DONE ok={done} failed={failed}')


if __name__ == '__main__':
    main()
