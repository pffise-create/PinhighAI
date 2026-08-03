"""Frame extractor - event-anchored (bake-off winner, 2026-08-01).

Finds the swing (audio-onset primary, ffmpeg scene-score motion fallback),
then extracts frames relative to the impact anchor:
    dense   [t-0.50s, t+0.30s]  native fps (capped 60)
    phase   [t-2.50s, t-0.50s]  5 fps
    finish  [t+0.30s, t+1.50s]  2 fps
and selects 10 (4 phase / 5 dense / 1 finish, redistributed when windows
clip). Only the 10 selected frames are uploaded; the AI processor's
selectFramesForAnalysis passes <=10 straight through.

Falls back to the legacy uniform 4fps + evenly-spaced-10 selection when no
confident anchor is found (flagged in analysis_results.extraction).

Multi-swing clips: every audio onset comparable to the strongest is counted
as a candidate swing; the strongest is analyzed ("clearest swing wins") and
the count is stored for product use.

Bake-off evidence: docs/frame-bakeoff-2026-08-01.md (challenger won 22-0).

Swing markings (Mode 1, docs/backlog/swing-marking-tool.md): when
SWING_MARKING_ENABLED is truthy, marked variants of the selected frames are
generated with marking/swing_marker.py and uploaded alongside the plain frames
under .../frames/<analysis_id>/marked/<same name>.jpg. The outcome is recorded
in analysis_results.marking. Marking is an ENHANCEMENT: every failure path
leaves marking.generated false with a reason and the swing analysis proceeds
on the plain frames exactly as before.
"""

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from array import array
from datetime import datetime
from decimal import Decimal

import boto3

s3_client = boto3.client('s3')
lambda_client = boto3.client('lambda')
dynamodb = boto3.resource('dynamodb')

def _resolve_binary(name):
    """Locate an ffmpeg-family binary in the Lambda layer.

    golf-ffmpeg-layer:3 was zipped with its entries under a redundant "opt/"
    prefix, so the binaries land at /opt/opt/bin/ffmpeg — NOT the documented
    /opt/bin/ffmpeg. (The hardcoded /opt/bin path in this file's history was
    therefore stale relative to what was actually deployed.) Probe the known
    layouts, then fall back to walking /opt so a future layer rebuild can
    move them without breaking extraction. Stage an executable copy under
    /tmp if the layer file lacks the exec bit.
    """
    override = os.environ.get(f'{name.upper()}_PATH')
    candidates = [override] if override else []
    candidates += [
        f'/opt/bin/{name}',
        f'/opt/{name}',
        f'/opt/opt\\bin\\{name}',
        f'/opt/ffmpeg/{name}',
        f'/opt/python/bin/{name}',
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return _ensure_executable(path, name)

    for root, _dirs, files in os.walk('/opt'):
        for fname in files:
            # Matches both "ffmpeg" and the backslash-mangled "opt\bin\ffmpeg"
            if fname == name or fname.endswith(f'\\{name}'):
                return _ensure_executable(os.path.join(root, fname), name)

    raise Exception(f'{name} binary not found in layer (searched /opt)')


def _ensure_executable(path, name):
    if os.access(path, os.X_OK):
        return path
    staged = f'/tmp/bin/{name}'
    if not os.path.exists(staged):
        os.makedirs('/tmp/bin', exist_ok=True)
        shutil.copy2(path, staged)
        os.chmod(staged, 0o755)
    print(f'Staged non-executable {name} from {path} -> {staged}')
    return staged


_BIN_CACHE = {}


def _bin(name):
    if name not in _BIN_CACHE:
        resolved = _resolve_binary(name)
        print(f'Resolved {name} -> {resolved}')
        _BIN_CACHE[name] = resolved
    return _BIN_CACHE[name]

EXTRACTOR_VERSION = 'event-anchored-v1'
MODEL_FRAME_LIMIT = 10
LEGACY_FPS = 4.0

DENSE_PRE_S = 0.50
DENSE_POST_S = 0.30
PHASE_PRE_S = 2.50
FINISH_POST_S = 1.50
PHASE_FPS = 5.0
FINISH_FPS = 2.0
DENSE_FPS_CAP = 60.0

MARKED_FRAME_DIR = 'marked'

AUDIO_SR = 8000
AUDIO_WIN_S = 0.010
MOTION_FPS = 15.0
EDGE_EXCLUDE_S = 0.25
MIN_PROMINENCE = 4.0
AGREE_S = 0.30
CANDIDATE_MIN_GAP_S = 2.5
CANDIDATE_REL_STRENGTH = 0.5


def lambda_handler(event, context):
    temp_video_path = None
    temp_dir = None

    try:
        if 'Records' in event:
            bucket_name = event['Records'][0]['s3']['bucket']['name']
            video_key = event['Records'][0]['s3']['object']['key']
            analysis_id = extract_analysis_id_from_key(video_key) or str(uuid.uuid4())
            user_id = extract_user_id_from_key(video_key)
        else:
            bucket_name = event['s3_bucket']
            video_key = event['s3_key']
            analysis_id = event['analysis_id']
            user_id = event['user_id']

        print(f"Event-anchored frame extraction: {analysis_id}")
        print(f"Processing: {bucket_name}/{video_key}")

        table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE', 'golf-coach-analyses'))
        update_analysis_status(table, analysis_id, user_id, "PROCESSING", "Frame extraction starting...")

        temp_video_path = download_video_from_s3(bucket_name, video_key)
        temp_dir = tempfile.mkdtemp()

        extracted_frames, extraction_meta = extract_frames_event_anchored(
            temp_video_path, analysis_id, temp_dir)

        if not extracted_frames:
            raise Exception("No frames were extracted from the video")

        print(f"Selected {len(extracted_frames)} frames "
              f"(anchor={extraction_meta.get('anchor_time')}, method={extraction_meta.get('anchor_method')})")

        # Markings are generated BEFORE the upload step, which deletes the local
        # frame files. Never allowed to raise (see generate_marked_frames).
        marked_files, marking_meta = generate_marked_frames(extracted_frames, temp_dir)

        frame_analysis = upload_frames_to_s3(extracted_frames, bucket_name, analysis_id, user_id)
        frame_analysis['extraction'] = extraction_meta
        frame_analysis['marking'] = attach_marked_frames(
            frame_analysis, marked_files, marking_meta, bucket_name, analysis_id, user_id)

        update_analysis_status(
            table, analysis_id, user_id, "COMPLETED",
            f"Frame extraction completed. Extracted {len(extracted_frames)} frames for analysis.",
            frame_analysis
        )

        trigger_ai_analysis(analysis_id, user_id)

        return {
            'statusCode': 200,
            'body': json.dumps({
                'analysis_id': analysis_id,
                'status': 'completed',
                'frames_extracted': len(extracted_frames),
                'extraction': extraction_meta,
            })
        }

    except Exception as e:
        error_msg = f"Frame extraction error: {str(e)}"
        print(error_msg)
        if 'analysis_id' in locals() and 'table' in locals():
            try:
                update_analysis_status(table, analysis_id, user_id, "FAILED", error_msg)
            except Exception:
                pass
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}

    finally:
        if temp_video_path and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


def extract_user_id_from_key(video_key):
    parts = video_key.split('/')
    if len(parts) >= 2 and parts[0] == 'golf-swings':
        return parts[1]
    return 'unknown-user'


def extract_analysis_id_from_key(video_key):
    parts = video_key.split('/')
    if len(parts) >= 3:
        filename = parts[2]
        for ext in ['.mov', '.mp4', '.avi', '.m4v']:
            filename = filename.replace(ext, '')
        return filename
    return None


def download_video_from_s3(bucket_name, video_key):
    temp_video = tempfile.NamedTemporaryFile(delete=False, suffix='.mov')
    temp_video_path = temp_video.name
    temp_video.close()
    s3_client.download_file(bucket_name, video_key, temp_video_path)
    print(f"Downloaded {os.path.getsize(temp_video_path)} bytes")
    return temp_video_path


# ── Probing ────────────────────────────────────────────────────────────────

def probe_video(video_path):
    result = subprocess.run(
        [_bin("ffprobe"), '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', video_path],
        capture_output=True, timeout=30)
    if result.returncode != 0:
        raise Exception(f"ffprobe failed: {result.stderr[:300]}")
    info = json.loads(result.stdout)
    duration = float(info['format'].get('duration', 0) or 0)
    fps = None
    has_audio = False
    for s in info.get('streams', []):
        if s.get('codec_type') == 'video' and fps is None:
            num, _, den = (s.get('avg_frame_rate') or '0/1').partition('/')
            try:
                fps = float(num) / float(den or 1)
            except (ValueError, ZeroDivisionError):
                fps = None
        if s.get('codec_type') == 'audio':
            has_audio = True
    if not fps or fps <= 0 or math.isnan(fps):
        fps = 30.0
    return duration, min(fps, 240.0), has_audio


# ── Pass 1: anchor detection (pure python + ffmpeg, no numpy) ──────────────

def audio_onset_series(video_path):
    """Return (onset list, window seconds) from 10ms RMS windows, or None."""
    result = subprocess.run(
        [_bin("ffmpeg"), '-v', 'quiet', '-i', video_path, '-vn',
         '-ac', '1', '-ar', str(AUDIO_SR), '-f', 's16le', '-'],
        capture_output=True, timeout=60)
    if result.returncode != 0 or len(result.stdout) < AUDIO_SR:
        return None
    samples = array('h')
    samples.frombytes(result.stdout[: len(result.stdout) - (len(result.stdout) % 2)])
    win = int(AUDIO_SR * AUDIO_WIN_S)
    n = len(samples) // win
    if n < 20:
        return None
    rms = []
    for i in range(n):
        seg = samples[i * win:(i + 1) * win]
        acc = 0
        for v in seg:
            acc += v * v
        rms.append(math.sqrt(acc / win))
    onset = [max(0.0, rms[i + 1] - rms[i]) for i in range(len(rms) - 1)]
    return onset, AUDIO_WIN_S


def peak_with_prominence(series, step_s, edge_exclude_s):
    lo = int(edge_exclude_s / step_s)
    hi = len(series) - lo
    if hi <= lo:
        lo, hi = 0, len(series)
    peak_idx, peak_val = lo, series[lo]
    for i in range(lo, hi):
        if series[i] > peak_val:
            peak_idx, peak_val = i, series[i]
    positive = sorted(v for v in series if v > 0)
    med = positive[len(positive) // 2] if positive else 0.0
    if med <= 0:
        return None
    return ((peak_idx + 1) * step_s, peak_val / med)


def count_candidate_swings(onset, step_s):
    """Count distinct strong onsets (candidate swings) separated in time."""
    if not onset:
        return 0
    peak = max(onset)
    if peak <= 0:
        return 0
    threshold = peak * CANDIDATE_REL_STRENGTH
    candidates = []
    for i, v in enumerate(onset):
        if v >= threshold:
            t = (i + 1) * step_s
            if not candidates or t - candidates[-1] >= CANDIDATE_MIN_GAP_S:
                candidates.append(t)
    return len(candidates)


def motion_series(video_path):
    """Per-frame scene-change scores via ffmpeg (computed in C, no numpy)."""
    meta_path = tempfile.mktemp(suffix='.txt')
    try:
        result = subprocess.run(
            [_bin("ffmpeg"), '-v', 'quiet', '-i', video_path,
             '-vf', f"fps={MOTION_FPS},scale=160:-2,select='gte(scene,0)',metadata=print:file={meta_path}",
             '-f', 'null', '-'],
            capture_output=True, timeout=90)
        if result.returncode != 0 or not os.path.exists(meta_path):
            return None
        scores = []
        with open(meta_path) as f:
            for line in f:
                m = re.search(r'lavfi\.scene_score=([0-9.eE+-]+)', line)
                if m:
                    scores.append(float(m.group(1)))
        if len(scores) < 5:
            return None
        smooth = [
            (scores[max(0, i - 1)] + scores[i] + scores[min(len(scores) - 1, i + 1)]) / 3
            for i in range(len(scores))
        ]
        return smooth, 1.0 / MOTION_FPS
    finally:
        if os.path.exists(meta_path):
            os.remove(meta_path)


def find_anchor(video_path, has_audio):
    """Returns (anchor_t, method, candidate_swings) or (None, reason, 0)."""
    audio = motion = None
    candidates = 0
    if has_audio:
        series = audio_onset_series(video_path)
        if series:
            onset, step = series
            audio = peak_with_prominence(onset, step, EDGE_EXCLUDE_S)
            candidates = count_candidate_swings(onset, step)
    m = motion_series(video_path)
    if m:
        motion = peak_with_prominence(m[0], m[1], EDGE_EXCLUDE_S)

    if audio and motion and abs(audio[0] - motion[0]) <= AGREE_S:
        return audio[0], 'audio+motion', max(candidates, 1)
    if audio and audio[1] >= MIN_PROMINENCE and motion and motion[1] >= MIN_PROMINENCE:
        return motion[0], 'motion(conflict)', max(candidates, 1)
    if audio and audio[1] >= MIN_PROMINENCE:
        return audio[0], 'audio', max(candidates, 1)
    if motion and motion[1] >= MIN_PROMINENCE:
        return motion[0], 'motion', max(candidates, 1)
    return None, 'no-confident-anchor', candidates


# ── Pass 2: extraction ─────────────────────────────────────────────────────

def extract_window(video_path, start, end, fps, outdir, prefix):
    start = max(0.0, start)
    if end <= start:
        return []
    pattern = os.path.join(outdir, f'{prefix}_%04d.jpg')
    result = subprocess.run(
        [_bin("ffmpeg"), '-v', 'quiet', '-ss', f'{start:.3f}', '-to', f'{end:.3f}',
         '-i', video_path, '-vf', f'fps={fps},scale=720:-2', '-q:v', '3', '-y', pattern],
        capture_output=True, timeout=90)
    if result.returncode != 0:
        return []
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
    """Port of selectFramesForAnalysis (ai-analysis-processor.js)."""
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


def extract_frames_event_anchored(video_path, analysis_id, temp_dir):
    duration, fps, has_audio = probe_video(video_path)
    print(f"Video: {duration:.2f}s @ {fps:.1f}fps, audio={has_audio}")

    anchor_t, method, candidates = find_anchor(video_path, has_audio)

    if anchor_t is None:
        print(f"No confident anchor ({method}); using legacy uniform extraction")
        frames = extract_window(video_path, 0.0, duration + 1, LEGACY_FPS, temp_dir, 'uni')
        selected = select_evenly(frames, MODEL_FRAME_LIMIT)
        meta = {
            'version': EXTRACTOR_VERSION, 'mode': 'fallback-uniform',
            'anchor_time': None, 'anchor_method': method,
            'candidate_swings': candidates,
        }
    else:
        dense_fps = min(fps, DENSE_FPS_CAP)
        dense = extract_window(video_path, anchor_t - DENSE_PRE_S, anchor_t + DENSE_POST_S,
                               dense_fps, temp_dir, 'dense')
        phase = extract_window(video_path, anchor_t - PHASE_PRE_S, anchor_t - DENSE_PRE_S,
                               PHASE_FPS, temp_dir, 'phase')
        finish = extract_window(video_path, anchor_t + DENSE_POST_S, anchor_t + FINISH_POST_S,
                                FINISH_FPS, temp_dir, 'finish')

        quota = {'phase': 4, 'dense': 5, 'finish': 1}
        pools = {'phase': phase, 'dense': dense, 'finish': finish}
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
        selected = selected[:MODEL_FRAME_LIMIT]
        meta = {
            'version': EXTRACTOR_VERSION, 'mode': 'event-anchored',
            'anchor_time': str(round(anchor_t, 3)), 'anchor_method': method,
            'candidate_swings': candidates,
        }

    frame_files = []
    for i, (path, ts) in enumerate(selected):
        frame_files.append({
            'path': path,
            'phase': f'frame_{i:03d}',
            'timestamp': round(ts, 2),
            'description': f'Frame at {ts:.2f}s',
            'frame_number': i,
        })
    return frame_files, meta


# ── Swing markings (Mode 1 grounding) ──────────────────────────────────────
#
# Fail-soft contract: nothing in this section may raise into the extraction
# path, and nothing in it may change the plain frames. The worst case is
# analysis_results.marking = {generated: false, reason: "..."} and a swing
# analysed on unmarked frames, exactly as before this feature existed.


def _flag_enabled(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')


def _marking_record(generated, reason=None, **extra):
    record = {
        'version': None,
        'generated': bool(generated),
        'markings_rendered': [],
        'failures': [],
        'geometry': None,
        'frames_marked': 0,
    }
    if reason:
        record['reason'] = reason
    record.update(extra)
    return record


def _import_swing_marker():
    """Import the marking module however it was packaged into the zip."""
    try:
        from marking import swing_marker  # packaged as marking/swing_marker.py
        return swing_marker
    except ImportError:
        import swing_marker  # flat zip layout
        return swing_marker


def _compact_geometry(geometry):
    """Keep the geometry that downstream consumers use; drop the 17 raw keypoints.

    The keypoints are ~50 floats of pose detail no consumer reads, and this
    record is written into a DynamoDB item that already carries the frame list.
    """
    if not isinstance(geometry, dict):
        return None
    keep = ('marker_version', 'frame_width', 'frame_height', 'view', 'facing',
            'ball', 'shaft', 'markings')
    return {k: geometry[k] for k in keep if k in geometry}


def generate_marked_frames(frame_files, temp_dir):
    """Render markings for the selected frames. Returns (marked_files, record).

    marked_files entries are {'phase': ..., 'path': ...}. NEVER raises.
    """
    if not _flag_enabled('SWING_MARKING_ENABLED'):
        return [], _marking_record(False, 'disabled: SWING_MARKING_ENABLED is not enabled')
    if not frame_files:
        return [], _marking_record(False, 'no frames to mark')

    try:
        swing_marker = _import_swing_marker()
    except Exception as e:  # module, native deps or model layer missing
        print(f"Marking skipped: swing_marker unavailable ({e})")
        return [], _marking_record(False, f'swing_marker unavailable: {e}')

    version = getattr(swing_marker, 'MARKER_VERSION', None)
    out_dir = os.path.join(temp_dir, MARKED_FRAME_DIR)
    try:
        ordered = sorted(frame_files, key=lambda f: f.get('frame_number', 0))
        result = swing_marker.mark_swing([f['path'] for f in ordered], out_dir)
        with open(result['geometry_json']) as fh:
            geometry = json.load(fh)
    except Exception as e:
        print(f"Marking failed: {e}")
        return [], _marking_record(False, f'marking failed: {e}', version=version)

    rendered = sorted((geometry.get('markings') or {}).keys())
    failures = geometry.get('failures') or []
    marked_set = set(result.get('marked_paths') or [])

    marked_files = []
    for frame_info in ordered:
        candidate = os.path.join(out_dir, 'marked_' + os.path.basename(frame_info['path']))
        if candidate in marked_set and os.path.exists(candidate):
            marked_files.append({'phase': frame_info['phase'], 'path': candidate})

    record = _marking_record(
        bool(marked_files),
        None if marked_files else 'no frame could be marked (fail closed)',
        version=version,
        markings_rendered=rendered,
        failures=failures,
        geometry=_compact_geometry(geometry),
        frames_marked=len(marked_files),
        frames_skipped=result.get('skipped') or [],
    )
    print(f"Marking: {len(marked_files)}/{len(ordered)} frames marked, "
          f"rendered={rendered}, failures={len(failures)}")
    return marked_files, record


def attach_marked_frames(frame_analysis, marked_files, marking_meta, bucket_name, analysis_id, user_id):
    """Upload the marked variants and cross-link them onto the frame records.

    Returns the marking record to store. NEVER raises.
    """
    try:
        if not marked_files or not marking_meta.get('generated'):
            return marking_meta

        frames_by_phase = {f.get('phase'): f for f in frame_analysis.get('frames', [])}
        uploaded = []
        for marked in marked_files:
            frame_record = frames_by_phase.get(marked['phase'])
            if not frame_record:
                continue
            plain_key = _key_from_url(frame_record.get('url'))
            if not plain_key:
                continue
            head, _, name = plain_key.rpartition('/')
            s3_key = f"{head}/{MARKED_FRAME_DIR}/{name}"
            try:
                s3_client.upload_file(marked['path'], bucket_name, s3_key)
            except Exception as e:
                print(f"Marked frame upload failed ({s3_key}): {e}")
                continue
            url = f"https://{bucket_name}.s3.amazonaws.com/{s3_key}"
            frame_record['marked_url'] = url
            frame_record['marked_key'] = s3_key
            uploaded.append({'phase': marked['phase'], 'key': s3_key, 'url': url})
            try:
                os.remove(marked['path'])
            except OSError:
                pass

        if not uploaded:
            return _marking_record(
                False, 'marked frames could not be uploaded',
                version=marking_meta.get('version'),
                markings_rendered=marking_meta.get('markings_rendered', []),
                failures=marking_meta.get('failures', []),
                geometry=marking_meta.get('geometry'),
            )

        marking_meta['frames_marked'] = len(uploaded)
        marking_meta['frames'] = uploaded
        return marking_meta
    except Exception as e:
        print(f"Marking attach failed: {e}")
        return _marking_record(False, f'marking attach failed: {e}')


def _key_from_url(url):
    if not isinstance(url, str) or '.amazonaws.com/' not in url:
        return None
    return url.split('.amazonaws.com/', 1)[1]


# ── Upload / status / trigger (unchanged contracts) ────────────────────────

def _to_dynamo(value):
    """DynamoDB resource rejects floats; convert recursively to Decimal."""
    if isinstance(value, float):
        return Decimal(str(round(value, 4)))
    if isinstance(value, dict):
        return {k: _to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_dynamo(v) for v in value]
    return value


def upload_frames_to_s3(frame_files, bucket_name, analysis_id, user_id):
    print(f"Uploading {len(frame_files)} frames to S3...")
    frame_data = []
    video_duration = 0
    for frame_info in frame_files:
        s3_key = (f"golf-swings/{user_id}/{analysis_id}/frames/{analysis_id}/"
                  f"{frame_info['phase']}_Frame_at_{frame_info['timestamp']:.2f}s.jpg")
        s3_client.upload_file(frame_info['path'], bucket_name, s3_key)
        frame_data.append({
            'phase': frame_info['phase'],
            'url': f"https://{bucket_name}.s3.amazonaws.com/{s3_key}",
            'timestamp': frame_info['timestamp'],
            'description': frame_info['description'],
            'frame_number': frame_info['frame_number'],
        })
        video_duration = max(video_duration, frame_info['timestamp'])
        try:
            os.remove(frame_info['path'])
        except OSError:
            pass

    return {
        'frames': frame_data,
        'frames_extracted': len(frame_data),
        'video_duration': video_duration + 0.25,
        'swing_detected': True,
        'total_frames': len(frame_data),
    }


def update_analysis_status(table, analysis_id, user_id, status, message, analysis_results=None):
    try:
        update_expression = "SET #status = :status, progress_message = :message, updated_at = :timestamp"
        expression_values = {
            ':status': status,
            ':message': message,
            ':timestamp': datetime.now().isoformat(),
        }
        expression_names = {'#status': 'status'}
        if analysis_results:
            update_expression += ", analysis_results = :results"
            expression_values[':results'] = _to_dynamo(analysis_results)
        table.update_item(
            Key={'analysis_id': analysis_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values,
        )
        print(f"Updated analysis {analysis_id}: {status} - {message}")
    except Exception as e:
        print(f"Error updating DynamoDB: {str(e)}")


def trigger_ai_analysis(analysis_id, user_id):
    try:
        ai_function_name = os.environ.get('AI_ANALYSIS_PROCESSOR_FUNCTION_NAME', 'golf-ai-analysis-processor')
        response = lambda_client.invoke(
            FunctionName=ai_function_name,
            InvocationType='Event',
            Payload=json.dumps({'analysis_id': analysis_id, 'user_id': user_id, 'status': 'COMPLETED'}),
        )
        print(f"Triggered AI analysis for {analysis_id}: {response.get('StatusCode')}")
    except Exception as e:
        print(f"Error triggering AI analysis: {str(e)}")
