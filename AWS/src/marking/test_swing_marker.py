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
  - fail closed: garbage input yields failures and zero markings; a low-confidence Hough
    shaft fit withholds the plane line (never a ball->body fallback)
  - plane-line angle equals the DETECTED SHAFT angle, and matches the eval-measured
    visible shaft angle per DTL fixture
  - plane-line endpoints stay within the clamped bounds (just past the ball -> just
    above head height, inside the frame) and clear of the head circle
  - head circle contains every confident face keypoint with margin
  - head-circle radius proportional to detected head size, never fixed pixels
  - view classification on the real fixture sessions
  - determinism: same input twice -> byte-identical geometry JSON
"""

import glob
import json
import math
import os
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw

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

# Visible shaft angle at address (deg from horizontal), measured against the actual
# shaft pixels during the 2026-08 strict eval. The rendered plane line must track these.
FIXTURE_SHAFT_ANGLES = {
    "1760076117023-e7ofx7": 54.0,
    "1771739449202-rcj3uo": 46.0,
    "1780460609209-q55bgd": 62.0,
}
SHAFT_ANGLE_TOL_DEG = 6.0


def _line_angle_deg(m, w, h):
    """Angle from horizontal (deg, positive) of a line marking in pixel space."""
    return math.degrees(math.atan2(abs(m["y2"] - m["y1"]) * h, abs(m["x2"] - m["x1"]) * w))


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
            self.assertEqual(withheld,
                             {"head_circle", "spine_line", "shoulder_line", "plane_line"})
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
        # Scale BOTH axes: the radius is fitted to the head's actual extent, so a head
        # that only widens is not "twice as large" and must not be expected to double it.
        ear_half = 0.03 * head_scale
        eye_rise = 0.01 * head_scale      # nose->eye vertical offset scales too
        cy = 0.20
        kps = {n: pt(0.5, 0.5) for n in sm.KEYPOINT_NAMES}
        kps.update({
            "nose": pt(0.50, cy),
            "left_eye": pt(0.50 + ear_half * 0.5, cy - eye_rise),
            "right_eye": pt(0.50 - ear_half * 0.5, cy - eye_rise),
            "left_ear": pt(0.50 + ear_half, cy),
            "right_ear": pt(0.50 - ear_half, cy),
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

    def test_radius_is_fitted_within_the_factor_upper_bound(self):
        """The keypoint-factor radius reliably CONTAINS the head but overshoots real
        heads by ~1.5x (clip-art). It is now an upper bound: the shipped radius is
        fitted to actual head extent and may be smaller, never larger."""
        kps = self._kps(1.0)
        head, _ = sm._head_circle(kps, "face_on", self.W, self.H)
        inter_ear_px = abs(kps["left_ear"]["x"] - kps["right_ear"]["x"]) * self.W
        upper = sm.HEAD_RADIUS_FACTOR_FACE_ON * inter_ear_px
        self.assertLessEqual(head["r"] * self.W, upper + 1e-6,
                             "fitted radius must never exceed the factor upper bound")
        self.assertGreater(head["r"] * self.W, 0.4 * upper,
                           "fitted radius collapsed — the head would not be enclosed")

    def test_fitted_ring_still_encloses_every_head_keypoint(self):
        """Tightening the ring must not clip the head: the accuracy gate outranks the
        design one."""
        import math as _m
        kps = self._kps(1.0)
        head, _ = sm._head_circle(kps, "face_on", self.W, self.H)
        cx, cy, r = head["cx"] * self.W, head["cy"] * self.H, head["r"] * self.W
        for n in ("nose", "left_eye", "right_eye", "left_ear", "right_ear"):
            d = _m.hypot(kps[n]["x"] * self.W - cx, kps[n]["y"] * self.H - cy)
            self.assertLess(d, r, f"{n} fell outside the fitted head circle")

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
    def test_face_on_withholds_the_plane_line_only(self):
        """The plane line is built from a DETECTED SHAFT, which a face-on camera
        foreshortens into the body — it stays withheld. The spine and the shoulder line
        are not shaft-derived and are standard face-on setup reads, so a face-on frame
        must NOT come back carrying a lone head ring."""
        checked = 0
        for name, frames in SESSIONS.items():
            if FIXTURE_VIEWS.get(name) != "face_on":
                continue
            geo = sm.analyze_setup(frames[0])
            self.assertNotIn("plane_line", geo.markings)
            self.assertIn("plane_line", {f["marking"] for f in geo.failures})
            self.assertIn("spine_line", geo.markings,
                          f"{name}: face-on spine withheld — {geo.failures}")
            self.assertIn("shoulder_line", geo.markings,
                          f"{name}: face-on shoulder line withheld — {geo.failures}")
            self.assertGreaterEqual(len(geo.markings), 3,
                                    f"{name}: a face-on frame must carry more than a ring")
            checked += 1
        self.assertGreater(checked, 0)

    @needs_fixtures
    def test_dtl_withholds_the_shoulder_line(self):
        """Down the line the two acromions project onto each other; a shoulder line there
        would be a few pixels of noise."""
        for name, frames in SESSIONS.items():
            if FIXTURE_VIEWS.get(name) != "dtl":
                continue
            geo = sm.analyze_setup(frames[0])
            self.assertNotIn("shoulder_line", geo.markings)
            self.assertIn("shoulder_line", {f["marking"] for f in geo.failures})


class TestPlaneLineAccuracy(unittest.TestCase):
    """The plane line must BE the detected shaft's direction anchored at the ball —
    the eval failed the old ball->shoulder construction at 13-16 deg off the shaft."""

    @classmethod
    def setUpClass(cls):
        cls.geos = {name: sm.analyze_setup(frames[0]) for name, frames in SESSIONS.items()
                    if FIXTURE_VIEWS.get(name) == "dtl"}

    @needs_fixtures
    def test_plane_angle_equals_detected_shaft_angle(self):
        checked = 0
        for name, geo in self.geos.items():
            plane = geo.markings.get("plane_line")
            if not plane:
                continue  # a withheld plane line is legal (fail closed); accuracy is tested when drawn
            self.assertIsNotNone(geo.shaft, f"{name}: plane line rendered without a detected shaft")
            w, h = geo.frame_width, geo.frame_height
            self.assertAlmostEqual(
                _line_angle_deg(plane, w, h), _line_angle_deg(geo.shaft, w, h), delta=0.75,
                msg=f"{name}: plane line does not carry the detected shaft's angle")
            checked += 1
        self.assertGreater(checked, 0, "no DTL fixture rendered a plane line — nothing verified")

    @needs_fixtures
    def test_plane_angle_matches_visible_shaft_ground_truth(self):
        for name, geo in self.geos.items():
            plane = geo.markings.get("plane_line")
            expected = FIXTURE_SHAFT_ANGLES.get(name)
            if not plane or expected is None:
                continue
            got = _line_angle_deg(plane, geo.frame_width, geo.frame_height)
            self.assertAlmostEqual(
                got, expected, delta=SHAFT_ANGLE_TOL_DEG,
                msg=f"{name}: plane line at {got:.1f} deg vs visible shaft {expected:.1f} deg")

    @needs_fixtures
    def test_plane_line_anchored_at_ball(self):
        for name, geo in self.geos.items():
            plane = geo.markings.get("plane_line")
            if not plane:
                continue
            w, h = geo.frame_width, geo.frame_height
            bx, by = geo.ball["x"] * w, geo.ball["y"] * h
            x1, y1 = plane["x1"] * w, plane["y1"] * h
            x2, y2 = plane["x2"] * w, plane["y2"] * h
            ux, uy = x2 - x1, y2 - y1
            seg = math.hypot(ux, uy)
            perp = abs((bx - x1) * uy / seg - (by - y1) * ux / seg)
            self.assertLess(perp, 1.5, f"{name}: plane line does not pass through the detected ball")

    @needs_fixtures
    def test_low_confidence_shaft_fails_closed_no_fallback(self):
        """An untrusted Hough fit must withhold the plane line — never ball->body."""
        name, frames = _dtl_session()
        real_detect = sm._detect_shaft

        def low_conf_detect(gray, kps, facing, w, h):
            shaft, why = real_detect(gray, kps, facing, w, h)
            if shaft:
                shaft = dict(shaft, confidence=sm.SHAFT_MIN_CONFIDENCE - 0.05)
            return shaft, why

        sm._detect_shaft = low_conf_detect
        try:
            geo = sm.analyze_setup(frames[0])
        finally:
            sm._detect_shaft = real_detect
        self.assertNotIn("plane_line", geo.markings,
                         f"{name}: plane line rendered from a low-confidence shaft fit")
        reasons = [f["reason"] for f in geo.failures if f["marking"] == "plane_line"]
        self.assertTrue(reasons and "low-confidence" in reasons[0],
                        f"{name}: expected a recorded low-confidence-shaft failure, got {geo.failures}")


class TestPlaneLineClampedBounds(unittest.TestCase):
    """Rendered plane-line endpoints must stay within the clamped extent: bottom at/just
    past the ball (not into the mat), top just above head height (not into sky/roof)."""

    @needs_fixtures
    def test_endpoints_within_clamped_bounds(self):
        checked = 0
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            plane = geo.markings.get("plane_line")
            if not plane:
                continue
            w, h = geo.frame_width, geo.frame_height
            # Inside the frame (with the edge margin, plus float slack).
            for x, y in ((plane["x1"], plane["y1"]), (plane["x2"], plane["y2"])):
                self.assertGreaterEqual(x, sm.PLANE_EDGE_MARGIN - 1e-4, name)
                self.assertLessEqual(x, 1 - sm.PLANE_EDGE_MARGIN + 1e-4, name)
                self.assertGreaterEqual(y, sm.PLANE_EDGE_MARGIN - 1e-4, name)
                self.assertLessEqual(y, 1 - sm.PLANE_EDGE_MARGIN + 1e-4, name)
            # Bottom end: just past the ball, never further.
            max_over = max(sm.PLANE_BOTTOM_OVERSHOOT * geo.ball["r"] * w, sm.PLANE_BOTTOM_MIN_PX * h)
            d_ball = math.hypot((plane["x1"] - geo.ball["x"]) * w, (plane["y1"] - geo.ball["y"]) * h)
            self.assertLessEqual(d_ball, max_over + 0.5,
                                 f"{name}: bottom end {d_ball:.1f}px from the ball (max {max_over:.1f})")
            self.assertGreaterEqual(plane["y1"], geo.ball["y"] - 1e-6,
                                    f"{name}: bottom end sits above the ball")
            # Top end: at/above the head circle's top region — never below the shoulders,
            # and (unless clamped at a frame edge) not more than ~2 head radii above the ring.
            hc = geo.markings.get("head_circle")
            if hc:
                head_top_y = hc["cy"] - hc["r"] * w / h
                at_edge = plane["x2"] <= sm.PLANE_EDGE_MARGIN + 1e-4 or plane["y2"] <= sm.PLANE_EDGE_MARGIN + 1e-4
                if not at_edge:
                    self.assertLessEqual(plane["y2"], head_top_y + 1e-3,
                                         f"{name}: top end below head height")
                    self.assertGreaterEqual(plane["y2"], head_top_y - 2.0 * hc["r"] * w / h,
                                            f"{name}: top end far above the head (sky/roof)")
            checked += 1
        self.assertGreater(checked, 0)

    @needs_fixtures
    def test_plane_line_does_not_cross_head_circle(self):
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            plane, hc = geo.markings.get("plane_line"), geo.markings.get("head_circle")
            if not plane or not hc:
                continue
            w, h = geo.frame_width, geo.frame_height
            x1, y1, x2, y2 = plane["x1"] * w, plane["y1"] * h, plane["x2"] * w, plane["y2"] * h
            cx, cy, r = hc["cx"] * w, hc["cy"] * h, hc["r"] * w
            dx, dy = x2 - x1, y2 - y1
            t = max(0.0, min(1.0, ((cx - x1) * dx + (cy - y1) * dy) / (dx * dx + dy * dy)))
            d = math.hypot(x1 + t * dx - cx, y1 + t * dy - cy)
            self.assertGreater(d, r, f"{name}: plane line crosses the head circle (d {d:.0f} <= r {r:.0f})")


class TestHeadCircleContainsFaceKeypoints(unittest.TestCase):
    """The circle must enclose the whole head: every confident face keypoint sits
    inside the ring with margin, on every fixture that renders a head circle."""

    @needs_fixtures
    def test_face_keypoints_inside_ring_with_margin(self):
        checked = 0
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            hc = geo.markings.get("head_circle")
            if not hc:
                continue
            w, h = geo.frame_width, geo.frame_height
            r_px = hc["r"] * w
            for n in ("nose", "left_eye", "right_eye", "left_ear", "right_ear"):
                kp = geo.keypoints[n]
                if kp["score"] < sm.KP_MIN_SCORE:
                    continue
                d = math.hypot((kp["x"] - hc["cx"]) * w, (kp["y"] - hc["cy"]) * h)
                self.assertLessEqual(
                    d, sm.HEAD_KP_MAX_DIST * r_px,
                    f"{name}: {n} at {d / r_px:.2f}r — head circle does not enclose the face with margin")
            checked += 1
        self.assertGreaterEqual(checked, 2)


class TestHeadRingFit(unittest.TestCase):
    """The ring is re-centred on the head's own silhouette and only then fitted.

    This is the test that would have caught v4's bad reasoning. v4 was accepted as
    "already tangent to the hair" on the strength of near-zero margins measured at
    bearings that point down the NECK. Every bearing in the 90-degree sector aimed at the
    shoulder midpoint is therefore discarded here, and what remains — the crown, the
    occiput and the face side — is where v4 carried 21-42px of empty background.
    """

    @classmethod
    def setUpClass(cls):
        cls.geos = {n: sm.analyze_setup(f[0]) for n, f in SESSIONS.items()}

    def _silhouette(self, name, frames, geo):
        """Ground truth measured from the keypoint anchor, i.e. independent of the fit."""
        from PIL import ImageOps as _IO
        rgb = np.asarray(_IO.exif_transpose(Image.open(frames[0])).convert("RGB"))
        w, h = geo.frame_width, geo.frame_height
        ref, why = sm._head_circle(geo.keypoints, geo.view["label"], w, h, None)
        self.assertIsNotNone(ref, f"{name}: no keypoint reference circle ({why})")
        return sm._segment_head_silhouette(rgb, geo.keypoints, w, h,
                                           ref["cx"] * w, ref["cy"] * h, ref["r"] * w)

    @needs_fixtures
    def test_ring_margins_off_the_neck_sector(self):
        checked = 0
        for name, frames in SESSIONS.items():
            geo = self.geos[name]
            hc = geo.markings.get("head_circle")
            if not hc or hc.get("fit") != "silhouette":
                continue
            seg, why = self._silhouette(name, frames, geo)
            if seg is None:
                continue
            w, h = geo.frame_width, geo.frame_height
            cx, cy, r = hc["cx"] * w, hc["cy"] * h, hc["r"] * w
            rows = sm.head_ring_margins(seg, geo.keypoints, w, h, cx, cy, r)
            self.assertGreaterEqual(len(rows), 8,
                                    f"{name}: too few measurable bearings ({len(rows)})")
            margins = [m for _, m in rows]
            lo, hi = min(margins), max(margins)
            # (1) never clips the head, and (2) never carries more slack than the fit or
            # face containment requires.
            far_kp = max(math.hypot(geo.keypoints[n]["x"] * w - cx,
                                    geo.keypoints[n]["y"] * h - cy)
                         for n in ("nose", "left_eye", "right_eye", "left_ear", "right_ear")
                         if geo.keypoints[n]["score"] >= sm.KP_MIN_SCORE)
            allowed = max(sm.HEAD_RING_SLACK_MARGIN, r - far_kp)
            self.assertGreaterEqual(lo, sm.HEAD_RING_MIN_MARGIN,
                                    f"{name}: ring clips the head (min margin {lo:+.1f}px)")
            self.assertLessEqual(lo, allowed,
                                 f"{name}: ring is loose everywhere (min margin {lo:+.1f}px "
                                 f"> {allowed:.1f}px)")
            if r >= sm.HEAD_RING_MEASURABLE_R:
                self.assertLessEqual(
                    hi, sm.HEAD_RING_MAX_SLACK * r,
                    f"{name}: {hi:.1f}px ({hi / r:.2f}r) of empty background inside the "
                    f"ring at its worst bearing")
            checked += 1
        self.assertGreaterEqual(checked, 2, "the ring fit was verified on nothing")

    @needs_fixtures
    def test_ring_is_recentred_and_tighter_than_the_keypoint_ring(self):
        checked = 0
        for name, frames in SESSIONS.items():
            geo = self.geos[name]
            hc = geo.markings.get("head_circle")
            if not hc or hc.get("fit") != "silhouette":
                continue
            w, h = geo.frame_width, geo.frame_height
            ref, _ = sm._head_circle(geo.keypoints, geo.view["label"], w, h, None)
            self.assertLess(hc["r"], ref["r"],
                            f"{name}: silhouette fit did not tighten the keypoint radius")
            moved = math.hypot((hc["cx"] - ref["cx"]) * w, (hc["cy"] - ref["cy"]) * h)
            self.assertGreaterEqual(moved, 0.0)
            self.assertLess(moved, ref["r"] * w,
                            f"{name}: re-centred {moved:.0f}px — implausibly far")
            self.assertIn("head_w", hc)
            checked += 1
        self.assertGreaterEqual(checked, 2)

    @needs_fixtures
    def test_segmentation_failure_falls_back_to_the_keypoint_ring(self):
        """Fail soft: a ring that rendered before must still render."""
        name, frames = _dtl_session()
        real = sm._segment_head_silhouette
        sm._segment_head_silhouette = lambda *a, **k: (None, "forced failure")
        try:
            geo = sm.analyze_setup(frames[0])
        finally:
            sm._segment_head_silhouette = real
        hc = geo.markings.get("head_circle")
        self.assertIsNotNone(hc, f"{name}: ring withheld when segmentation failed")
        self.assertEqual(hc.get("fit"), "keypoints")
        self.assertNotIn("head_w", hc)
        # ...and the renderer falls back to the frame-relative stroke without crashing.
        ov = sm.render_overlay((geo.frame_width, geo.frame_height), geo)
        self.assertGreater(int((np.asarray(ov)[:, :, 3] > 0).sum()), 0)


class TestSpineLineClearsHead(unittest.TestCase):
    @needs_fixtures
    def test_spine_top_end_stops_short_of_head_circle(self):
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            spine, hc = geo.markings.get("spine_line"), geo.markings.get("head_circle")
            if not spine or not hc:
                continue
            w, h = geo.frame_width, geo.frame_height
            d = math.hypot((spine["x2"] - hc["cx"]) * w, (spine["y2"] - hc["cy"]) * h)
            self.assertGreaterEqual(d, hc["r"] * w,
                                    f"{name}: spine tip intrudes into the head circle")


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


class TestMarkingSubsets(unittest.TestCase):
    """The user-facing render shows only the markings relevant to the question, and
    visual weight is RELATIVE to that set — never fixed per marking type."""

    def _all_marks_session(self):
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            if len(geo.markings) >= 2:
                return name, frames, geo
        return None, None, None

    # The spine and the shoulder line share the teal hue on purpose — they are one
    # "body posture" system and the palette is a deliberate three-hue triad — so a subset
    # probe cannot be colour-only. Every probe below is colour AND path constrained.
    @staticmethod
    def _distance_map(geo, marking):
        """Per-pixel distance (px) to a marking's own path."""
        w, h = geo.frame_width, geo.frame_height
        m = geo.markings[marking]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
        if marking == "head_circle":
            d = np.hypot(xx - m["cx"] * w, yy - m["cy"] * h)
            return np.abs(d - m["r"] * w)
        x1, y1 = m["x1"] * w, m["y1"] * h
        x2, y2 = m["x2"] * w, m["y2"] * h
        dx, dy = x2 - x1, y2 - y1
        L2 = max(1e-9, dx * dx + dy * dy)
        t = np.clip(((xx - x1) * dx + (yy - y1) * dy) / L2, 0.0, 1.0)
        return np.hypot(xx - (x1 + t * dx), yy - (y1 + t * dy))

    @classmethod
    def _corridor(cls, geo, marking):
        """Everything a marking is allowed to paint: its path plus endpoint furniture
        (anchor node at the ball, spine cross-tick, acromion dots) plus the halo."""
        w, h = geo.frame_width, geo.frame_height
        pad = max(24.0, 0.035 * max(w, h))
        d = cls._distance_map(geo, marking)
        if marking == "plane_line" and geo.ball:
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
            d = np.minimum(d, np.hypot(xx - geo.ball["x"] * w, yy - geo.ball["y"] * h))
        return d <= pad

    @classmethod
    def _body_pixels(cls, overlay, marking, geo=None, style=None):
        """Pixels painted with a marking's own colour, ON that marking's own path."""
        style = style or sm.DEFAULT_STYLE
        colors = {"plane_line": style.plane_color, "spine_line": style.spine_color,
                  "shoulder_line": style.spine_color, "head_circle": style.head_color}
        arr = np.asarray(overlay).astype(np.int32)
        rgb, a = arr[:, :, :3], arr[:, :, 3]
        body = np.array(colors[marking])
        core = np.array(sm._mix_rgb(colors[marking], (255, 255, 255), style.core_mix))
        near = (np.abs(rgb - body).sum(-1) <= 60) | (np.abs(rgb - core).sum(-1) <= 60)
        hit = (a >= 150) & near
        if geo is not None:
            hit &= cls._corridor(geo, marking)
        return int(hit.sum())

    @needs_fixtures
    def test_subset_draws_only_the_requested_markings(self):
        name, frames, geo = self._all_marks_session()
        self.assertIsNotNone(geo, "need a session with >= 2 markings")
        size = (geo.frame_width, geo.frame_height)
        for keep in geo.markings:
            ov = sm.render_overlay(size, geo, only=[keep])
            self.assertGreater(self._body_pixels(ov, keep, geo), 0, f"{keep}: nothing drawn")
            # Nothing at all was painted away from the requested marking's own path.
            painted = np.asarray(ov)[:, :, 3] >= 150
            stray = int((painted & ~self._corridor(geo, keep)).sum())
            self.assertEqual(stray, 0,
                             f"{keep}-only render painted {stray}px away from {keep}")

    @needs_fixtures
    def test_lone_marking_renders_at_primary_weight(self):
        """A marking shown alone is the whole message: it must be drawn at the weight it
        gets as the primary of a bigger set, and heavier than as a supporting marking."""
        name, frames, geo = self._all_marks_session()
        size = (geo.frame_width, geo.frame_height)
        support = next(m for m in geo.markings if m != sm.resolve_primary(list(geo.markings)))
        alone = self._body_pixels(sm.render_overlay(size, geo, only=[support]), support, geo)
        promoted = self._body_pixels(
            sm.render_overlay(size, geo, primary=support), support, geo)
        supporting = self._body_pixels(sm.render_overlay(size, geo), support, geo)
        self.assertGreater(alone, supporting,
                           f"{support} alone is not heavier than as a supporting marking")
        self.assertGreater(promoted, supporting,
                           f"explicit primary={support} did not promote it")

    @needs_fixtures
    def test_subset_overlay_is_pixel_stable_across_frames(self):
        name, frames = _dtl_session()
        geo = sm.analyze_setup(frames[0])
        size = (geo.frame_width, geo.frame_height)
        for only in ([m] for m in geo.markings):
            overlays = [sm.render_overlay(size, geo, only=only).tobytes() for _ in frames]
            self.assertEqual(len(set(overlays)), 1,
                             f"{only}: subset overlay differs between frames")

    @needs_fixtures
    def test_empty_subset_writes_nothing(self):
        name, frames = _dtl_session()
        geo = sm.analyze_setup(frames[0])
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "m.png")
            self.assertFalse(sm.render_markings(frames[0], geo, out, only=[]))
            self.assertFalse(os.path.exists(out))
            # A marking withheld by the gates stays withheld even if requested.
            withheld = {f["marking"] for f in geo.failures} - set(geo.markings)
            if withheld:
                self.assertFalse(sm.render_markings(frames[0], geo, out,
                                                    only=sorted(withheld)))

    def test_resolve_primary_prefers_explicit_then_priority(self):
        self.assertEqual(sm.resolve_primary(["spine_line", "head_circle"]), "spine_line")
        self.assertEqual(sm.resolve_primary(["head_circle"]), "head_circle")
        self.assertEqual(
            sm.resolve_primary(["plane_line", "head_circle"], primary="head_circle"),
            "head_circle")
        # An explicit choice that is not in the render set falls back to priority.
        self.assertEqual(sm.resolve_primary(["spine_line"], primary="plane_line"),
                         "spine_line")
        self.assertIsNone(sm.resolve_primary([]))


class TestStrokeScalesWithTheSubject(unittest.TestCase):
    """Stroke weight keyed to frame width made a 320px render 2.4x proportionally fatter
    than a 1080px one, so the two did not read as one graphics package."""

    @needs_fixtures
    def test_stroke_tracks_head_size_not_frame_width(self):
        ratios = {}
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            hc = geo.markings.get("head_circle")
            if not hc or "head_w" not in hc:
                continue
            w = geo.frame_width
            head_px = max(hc["head_w"], hc["head_h"]) * w
            style = sm.DEFAULT_STYLE
            stroke = min(style.stroke_max_px,
                         max(style.stroke_min_px, style.stroke_head_ratio * head_px))
            ratios[name] = stroke / head_px
        self.assertGreaterEqual(len(ratios), 2)
        unclamped = {k: v for k, v in ratios.items()
                     if abs(v - sm.DEFAULT_STYLE.stroke_head_ratio) < 1e-9}
        self.assertGreaterEqual(len(unclamped), 2,
                                f"every fixture hit a clamp — nothing verified: {ratios}")
        vals = sorted(unclamped.values())
        self.assertLess(vals[-1] / vals[0], 1.02,
                        f"stroke/head ratio is not constant across resolutions: {ratios}")


class TestNodeAndEndpointCraft(unittest.TestCase):
    @needs_fixtures
    def test_node_sits_on_the_detected_ball(self):
        checked = 0
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            if "plane_line" not in geo.markings or not geo.ball:
                continue
            w, h = geo.frame_width, geo.frame_height
            ov = sm.render_overlay((w, h), geo, only=["plane_line"])
            arr = np.asarray(ov).astype(np.int32)
            solid = arr[:, :, 3] >= 200
            bx, by = geo.ball["x"] * w, geo.ball["y"] * h
            yy, xx = np.mgrid[0:h, 0:w]
            # the node is a filled disc, so the ball centre itself must be opaque
            self.assertTrue(bool(solid[int(round(by)), int(round(bx))]),
                            f"{name}: the anchor node is not ON the detected ball")
            near = solid & (np.hypot(xx - bx, yy - by) <= 2.0)
            self.assertGreaterEqual(int(near.sum()), 4, name)
            # ...and it is the NODE, not merely the line passing by: the node disc is
            # wider than the stroke, so a perpendicular probe at the ball must be opaque
            # well beyond half a stroke width.
            p = geo.markings["plane_line"]
            ux, uy = (p["x2"] - p["x1"]) * w, (p["y2"] - p["y1"]) * h
            L = math.hypot(ux, uy)
            nx, ny = -uy / L, ux / L
            probe = int(round(sm.DEFAULT_STYLE.node_min_px * 0.8))
            self.assertTrue(bool(solid[int(round(by + ny * probe)), int(round(bx + nx * probe))]),
                            f"{name}: no anchor node at the ball, only the line")
            checked += 1
        self.assertGreater(checked, 0)

    @needs_fixtures
    def test_small_node_has_no_white_pupil(self):
        """At a ~4.75px node radius the 0.38x pupil quantises to a literal 2x2 white
        square on the golf ball — a rendering bug, not a style."""
        checked = 0
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            if "plane_line" not in geo.markings or not geo.ball:
                continue
            w, h = geo.frame_width, geo.frame_height
            ov = sm.render_overlay((w, h), geo, only=["plane_line"])
            arr = np.asarray(ov).astype(np.int32)
            pupil = np.array(sm._mix_rgb(sm.DEFAULT_STYLE.plane_color, (255, 255, 255), 0.80))
            hit = (np.abs(arr[:, :, :3] - pupil).sum(-1) <= 30) & (arr[:, :, 3] >= 200)
            style = sm.DEFAULT_STYLE
            hc = geo.markings.get("head_circle") or {}
            head_px = max(hc.get("head_w", 0.0), hc.get("head_h", 0.0)) * w
            sw = min(style.stroke_max_px, max(style.stroke_min_px,
                                              style.stroke_head_ratio * head_px if head_px
                                              else style.stroke_ratio * w))
            node_r = max(style.node_min_px, sw * style.node_scale,
                         geo.ball["r"] * w * style.node_ball_scale)
            if node_r < style.node_pupil_min_px:
                self.assertEqual(int(hit.sum()), 0,
                                 f"{name}: node radius {node_r:.1f}px still drew a pupil")
                checked += 1
        self.assertGreater(checked, 0, "no fixture exercised the small-node pupil gate")

    @needs_fixtures
    def test_spine_has_end_anchors(self):
        """A cross-tick at C7 and a filled dot at the pelvis: a measurement has ends."""
        checked = 0
        for name, frames in SESSIONS.items():
            geo = sm.analyze_setup(frames[0])
            spine = geo.markings.get("spine_line")
            if not spine:
                continue
            w, h = geo.frame_width, geo.frame_height
            ov = sm.render_overlay((w, h), geo, only=["spine_line"])
            arr = np.asarray(ov).astype(np.int32)
            teal = np.array(sm.DEFAULT_STYLE.spine_color)
            solid = (np.abs(arr[:, :, :3] - teal).sum(-1) <= 60) & (arr[:, :, 3] >= 150)
            x1, y1 = spine["x1"] * w, spine["y1"] * h
            x2, y2 = spine["x2"] * w, spine["y2"] * h
            ux, uy = x2 - x1, y2 - y1
            L = math.hypot(ux, uy)
            ux, uy = ux / L, uy / L
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
            # C7 tick: the tip must be painted WIDER than the stroke itself, otherwise it
            # is just the line's own cap rather than a cross-tick.
            hc = geo.markings.get("head_circle") or {}
            head_px = max(hc.get("head_w", 0.0), hc.get("head_h", 0.0)) * w
            st = sm.DEFAULT_STYLE
            sw = min(st.stroke_max_px, max(st.stroke_min_px,
                                           st.stroke_head_ratio * head_px if head_px
                                           else st.stroke_ratio * w))
            perp = np.abs((xx - x2) * -uy + (yy - y2) * ux)
            along = np.abs((xx - x2) * ux + (yy - y2) * uy)
            tick = solid & (along <= 1.0) & (perp >= sw * 0.5 + 1.0)
            self.assertGreater(int(tick.sum()), 0, f"{name}: no cross-tick at the C7 end")
            # pelvis dot: solid coverage right at the tip
            dot = solid & (np.hypot(xx - x1, yy - y1) <= 1.5)
            self.assertGreater(int(dot.sum()), 3, f"{name}: no filled dot at the pelvis end")
            checked += 1
        self.assertGreater(checked, 0)


class TestRingAlphaFloor(unittest.TestCase):
    """The support demotion and the ring falloff must not simply multiply: the raw
    product put a demoted ring's vertical arcs at 0.34 and the closed curve broke."""

    def _arc_alpha(self, demotion):
        style = sm.DEFAULT_STYLE
        img = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
        sm._ring_pass(ImageDraw.Draw(img), (100, 100), 70, 6, style.head_color,
                      255, style, 0.0, demotion)
        arr = np.asarray(img)[:, :, 3].astype(np.int32)
        return int(arr.max()), int(arr[arr > 0].min())

    def test_demoted_ring_never_drops_below_the_floor(self):
        style = sm.DEFAULT_STYLE
        top_p, _ = self._arc_alpha(1.0)
        _, low_s = self._arc_alpha(style.secondary_alpha_scale)
        raw = style.secondary_alpha_scale * style.ring_alpha_min
        self.assertLess(raw, style.ring_alpha_floor,
                        "test is vacuous unless the raw product is below the floor")
        self.assertGreaterEqual(low_s / 255.0, style.ring_alpha_floor - 0.02,
                                "demoted ring arcs fell below the alpha floor")

    def test_primary_ring_keeps_the_specified_falloff(self):
        """The 1.0 -> 0.55 falloff itself is verified broadcast-correct: unchanged."""
        style = sm.DEFAULT_STYLE
        hi, lo = self._arc_alpha(1.0)
        self.assertAlmostEqual(lo / float(hi), style.ring_alpha_min, delta=0.03)


if __name__ == "__main__":
    unittest.main(verbosity=2)
