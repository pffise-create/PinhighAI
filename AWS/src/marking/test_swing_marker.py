"""Tests for swing_marker — runnable directly with the dev venv python:

    SWING_MARKER_MODEL_PATH=/path/to/movenet_singlepose_thunder_f16.tflite \
    SWING_MARKER_FIXTURES=/path/to/fixtures \
    python AWS/src/marking/test_swing_marker.py

Env vars:
  SWING_MARKER_MODEL_PATH  — MoveNet Thunder .tflite (required; see swing_marker docstring
                             for download provenance). Falls back to the module's default
                             search path.
  SWING_MARKER_FIXTURES    — directory of fixture sessions (<session>/<frame>.jpg). The
                             fixture-dependent tests are skipped if unset/missing.

Covers the acceptance criteria from docs/backlog/swing-marking-tool.md:
  - pixel stability: identical geometry rendered on every frame, pixel-identical overlay
  - fail closed: garbage input yields failures and zero markings
  - head-circle radius proportional to detected head size, never fixed pixels
  - view classification on the real fixture sessions
  - determinism: same input twice -> byte-identical geometry JSON
"""

import glob
import json
import os
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swing_marker as sm  # noqa: E402

FIXTURES = os.environ.get("SWING_MARKER_FIXTURES", "")

# Ground-truth view labels for the fixture sessions (verified by eye, 2026-08-02).
FIXTURE_VIEWS = {
    "1758343894968-ae95vp": "face_on",
    "1760076117023-e7ofx7": "dtl",
    "1771739449202-rcj3uo": "dtl",
    "1780460609209-q55bgd": "dtl",
}


def _fixture_sessions():
    if not FIXTURES or not os.path.isdir(FIXTURES):
        return {}
    out = {}
    for d in sorted(glob.glob(os.path.join(FIXTURES, "*/"))):
        frames = sorted(glob.glob(os.path.join(d, "*.jpg")))
        if frames:
            out[os.path.basename(d.rstrip("/"))] = frames
    return out


SESSIONS = _fixture_sessions()
needs_fixtures = unittest.skipUnless(SESSIONS, "SWING_MARKER_FIXTURES not set or empty")


def _dtl_session():
    for name, frames in SESSIONS.items():
        if FIXTURE_VIEWS.get(name) == "dtl":
            return name, frames
    return None, None


def _noise_image_path(tmpdir, size=(640, 1136)):
    rng = np.random.default_rng(42)  # fixed seed: deterministic test input
    arr = rng.integers(0, 256, (size[1], size[0], 3), dtype=np.uint8)
    p = os.path.join(tmpdir, "noise.png")
    Image.fromarray(arr).save(p)
    return p


class TestPixelStability(unittest.TestCase):
    """HARD RULE: static geometry computed once, rendered identically on every frame."""

    @needs_fixtures
    def test_overlay_identical_across_frames(self):
        name, frames = _dtl_session()
        self.assertIsNotNone(frames, "need at least one DTL fixture session")
        geo = sm.analyze_setup(frames[0])
        self.assertTrue(geo.markings, f"expected markings on {name}")
        size = (geo.frame_width, geo.frame_height)
        overlays = [sm.render_overlay(size, geo) for _ in frames]
        ref = overlays[0].tobytes()
        for i, ov in enumerate(overlays[1:], start=2):
            self.assertEqual(ref, ov.tobytes(),
                             f"overlay for frame {i} differs from frame 1 at pixel level")

    @needs_fixtures
    def test_marked_frames_carry_the_same_overlay(self):
        """Every written marked frame must equal original composited with the ONE overlay
        (lossless PNG output so the comparison is exact)."""
        name, frames = _dtl_session()
        geo = sm.analyze_setup(frames[0])
        overlay = sm.render_overlay((geo.frame_width, geo.frame_height), geo)
        with tempfile.TemporaryDirectory() as td:
            for i, fp in enumerate(frames):
                out = os.path.join(td, f"m{i}.png")
                self.assertTrue(sm.render_markings(fp, geo, out))
                marked = Image.open(out).convert("RGB")
                orig = Image.open(fp).convert("RGB")
                expected = Image.alpha_composite(orig.convert("RGBA"), overlay).convert("RGB")
                self.assertEqual(marked.tobytes(), expected.tobytes(),
                                 f"frame {i} was not rendered with the single per-swing overlay")

    @needs_fixtures
    def test_mark_swing_uses_single_geometry(self):
        name, frames = _dtl_session()
        with tempfile.TemporaryDirectory() as td:
            result = sm.mark_swing(frames, td)
            with open(result["geometry_json"]) as f:
                stored = f.read()
            # The stored geometry is exactly the address-frame analysis — nothing per-frame.
            self.assertEqual(stored, sm.analyze_setup(frames[0]).to_json())
            self.assertEqual(len(result["marked_paths"]), len(frames))
            self.assertEqual(result["skipped"], [])


class TestFailClosed(unittest.TestCase):
    def test_garbage_image_yields_failures_and_no_markings(self):
        with tempfile.TemporaryDirectory() as td:
            p = _noise_image_path(td)
            geo = sm.analyze_setup(p)
            self.assertEqual(geo.markings, {})
            self.assertTrue(geo.failures)
            withheld = {f["marking"] for f in geo.failures}
            self.assertEqual(withheld, {"head_circle", "spine_line", "plane_line"})
            for f in geo.failures:
                self.assertTrue(f["reason"])

    def test_mark_swing_on_garbage_renders_nothing(self):
        with tempfile.TemporaryDirectory() as td:
            p = _noise_image_path(td)
            out = os.path.join(td, "out")
            result = sm.mark_swing([p, p, p], out)
            self.assertEqual(result["marked_paths"], [])
            self.assertEqual(len(result["skipped"]), 3)
            self.assertTrue(all("fail closed" in s["reason"] for s in result["skipped"]))

    def test_render_markings_refuses_empty_geometry(self):
        with tempfile.TemporaryDirectory() as td:
            p = _noise_image_path(td)
            geo = sm.analyze_setup(p)
            out = os.path.join(td, "marked.png")
            self.assertFalse(sm.render_markings(p, geo, out))
            self.assertFalse(os.path.exists(out))


class TestHeadCircleProportionality(unittest.TestCase):
    """Radius must derive from detected head size — never a fixed pixel value."""

    W, H = 1000, 1000

    def _kps(self, head_scale: float):
        """Synthetic upright pose whose head size scales by `head_scale`."""
        def pt(x, y, s=0.9):
            return {"x": x, "y": y, "score": s}
        ear_half = 0.03 * head_scale
        kps = {n: pt(0.5, 0.5) for n in sm.KEYPOINT_NAMES}
        kps.update({
            "nose": pt(0.50, 0.20),
            "left_eye": pt(0.50 + ear_half * 0.5, 0.19),
            "right_eye": pt(0.50 - ear_half * 0.5, 0.19),
            "left_ear": pt(0.50 + ear_half, 0.20),
            "right_ear": pt(0.50 - ear_half, 0.20),
            "left_shoulder": pt(0.58, 0.30), "right_shoulder": pt(0.42, 0.30),
            "left_hip": pt(0.55, 0.55), "right_hip": pt(0.45, 0.55),
        })
        return kps

    def test_radius_scales_with_head_size(self):
        small, why_s = sm._head_circle(self._kps(1.0), "face_on", self.W, self.H)
        large, why_l = sm._head_circle(self._kps(2.0), "face_on", self.W, self.H)
        self.assertIsNotNone(small, why_s)
        self.assertIsNotNone(large, why_l)
        self.assertAlmostEqual(large["r"] / small["r"], 2.0, places=5,
                               msg="doubling detected head size must double the circle radius")

    def test_radius_formula_face_on(self):
        kps = self._kps(1.0)
        head, _ = sm._head_circle(kps, "face_on", self.W, self.H)
        inter_ear_px = abs(kps["left_ear"]["x"] - kps["right_ear"]["x"]) * self.W
        self.assertAlmostEqual(head["r"] * self.W,
                               sm.HEAD_RADIUS_FACTOR_FACE_ON * inter_ear_px, places=4)

    @needs_fixtures
    def test_fixture_radii_track_head_size_not_fixed_pixels(self):
        radii_px = {}
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            hc = geo.markings.get("head_circle")
            if hc:
                radii_px[name] = hc["r"] * geo.frame_width
        self.assertGreaterEqual(len(radii_px), 2)
        values = sorted(radii_px.values())
        # Subject scale varies strongly across the fixture sessions; a fixed-pixel radius
        # would make these (near-)equal.
        self.assertGreater(values[-1] / values[0], 1.5,
                           f"head-circle radii {radii_px} look like a fixed pixel value")


class TestViewClassification(unittest.TestCase):
    @needs_fixtures
    def test_fixture_sessions(self):
        for name, frames in SESSIONS.items():
            expected = FIXTURE_VIEWS.get(name)
            if not expected:
                continue
            geo = sm.analyze_setup(frames[0])
            self.assertEqual(geo.view["label"], expected,
                             f"{name}: expected {expected}, got {geo.view}")
            self.assertGreaterEqual(geo.view["confidence"], sm.VIEW_MIN_CONFIDENCE,
                                    f"{name}: view confidence below gate: {geo.view}")

    @needs_fixtures
    def test_face_on_withholds_dtl_only_markings(self):
        for name, frames in SESSIONS.items():
            if FIXTURE_VIEWS.get(name) != "face_on":
                continue
            geo = sm.analyze_setup(frames[0])
            self.assertNotIn("spine_line", geo.markings)
            self.assertNotIn("plane_line", geo.markings)
            withheld = {f["marking"] for f in geo.failures}
            self.assertIn("spine_line", withheld)
            self.assertIn("plane_line", withheld)


class TestDeterminism(unittest.TestCase):
    @needs_fixtures
    def test_same_input_twice_byte_identical_geometry_json(self):
        for name, frames in SESSIONS.items():
            a = sm.analyze_setup(frames[0]).to_json()
            b = sm.analyze_setup(frames[0]).to_json()
            self.assertEqual(a, b, f"{name}: geometry JSON not deterministic")

    @needs_fixtures
    def test_geometry_json_roundtrip_and_version(self):
        name, frames = _dtl_session()
        geo = sm.analyze_setup(frames[0])
        text = geo.to_json()
        parsed = json.loads(text)
        self.assertEqual(parsed["marker_version"], sm.MARKER_VERSION)
        restored = sm.SetupGeometry.from_json(text)
        self.assertEqual(restored.to_json(), text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
