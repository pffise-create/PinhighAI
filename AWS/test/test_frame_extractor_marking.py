"""Fail-soft tests for the frame extractor's swing-marking hook.

Run with plain stdlib python (no AWS SDK, no CV stack needed):

    python3 -m unittest discover -s AWS/test -p 'test_*.py'

boto3 and the marking module's native dependencies are stubbed, because the
whole point of these tests is that the extractor keeps working when they are
missing.
"""

import json
import os
import sys
import types
import unittest
from unittest import mock

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXTRACTOR_DIR = os.path.join(REPO_ROOT, "AWS", "production")


def _install_boto3_stub():
    if "boto3" in sys.modules:
        return
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda *a, **k: mock.MagicMock()
    boto3.resource = lambda *a, **k: mock.MagicMock()
    sys.modules["boto3"] = boto3


_install_boto3_stub()
sys.path.insert(0, EXTRACTOR_DIR)
import lambda_function  # noqa: E402


GEOMETRY = {
    "marker_version": "2.1.0",
    "frame_width": 1080,
    "frame_height": 1920,
    "keypoints": {"nose": {"x": 0.42, "y": 0.32, "score": 0.45}},
    "view": {"label": "dtl", "confidence": 0.91, "spread_ratio": 0.03},
    "facing": "right",
    "ball": {"x": 0.18, "y": 0.64, "r": 0.01, "confidence": 0.72},
    "shaft": {"x1": 0.4, "y1": 0.4, "x2": 0.2, "y2": 0.6, "confidence": 0.66},
    "markings": {
        "plane_line": {"x1": 0.2, "y1": 0.6, "x2": 0.5, "y2": 0.2, "confidence": 0.66},
        "head_circle": {"cx": 0.5, "cy": 0.2, "r": 0.06, "confidence": 0.71},
    },
    "failures": [{"marking": "spine_line", "reason": "shoulder/hip confidence 0.31 < 0.4"}],
}


def make_frames(tmpdir, count=3):
    frames = []
    for i in range(count):
        path = os.path.join(tmpdir, "frame_%03d.jpg" % i)
        with open(path, "wb") as fh:
            fh.write(b"jpeg")
        frames.append({
            "path": path,
            "phase": "frame_%03d" % i,
            "timestamp": round(i * 0.1, 2),
            "description": "",
            "frame_number": i,
        })
    return frames


def install_fake_marker(mark_swing, version="2.1.0"):
    """Put a stand-in swing_marker on sys.modules the way the Lambda zip would."""
    module = types.ModuleType("swing_marker")
    module.MARKER_VERSION = version
    module.mark_swing = mark_swing
    package = types.ModuleType("marking")
    package.swing_marker = module
    sys.modules["marking"] = package
    sys.modules["marking.swing_marker"] = module
    sys.modules["swing_marker"] = module
    return module


class MarkingHookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.join(REPO_ROOT, ".marking-test-tmp")
        os.makedirs(self.tmp, exist_ok=True)
        for name in ("marking", "marking.swing_marker", "swing_marker"):
            sys.modules.pop(name, None)
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        for name in ("marking", "marking.swing_marker", "swing_marker"):
            sys.modules.pop(name, None)
        for root, _dirs, files in os.walk(self.tmp, topdown=False):
            for f in files:
                os.remove(os.path.join(root, f))
            os.rmdir(root)

    # -- the gate ----------------------------------------------------------
    def test_marking_is_off_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SWING_MARKING_ENABLED", None)
            marked, record = lambda_function.generate_marked_frames(make_frames(self.tmp), self.tmp)
        self.assertEqual(marked, [])
        self.assertFalse(record["generated"])
        self.assertIn("SWING_MARKING_ENABLED", record["reason"])

    def test_flag_accepts_only_explicit_truthy_values(self):
        for value, expected in (("true", True), ("1", True), ("on", True),
                                ("false", False), ("", False), ("no", False)):
            with mock.patch.dict(os.environ, {"SWING_MARKING_ENABLED": value}):
                self.assertEqual(lambda_function._flag_enabled("SWING_MARKING_ENABLED"), expected, value)

    # -- fail soft ---------------------------------------------------------
    def test_missing_marking_module_fails_soft(self):
        """The model/native deps are not in the zip: mark nothing, break nothing."""
        # sys.modules[name] = None makes any import of `name` raise ImportError,
        # which is exactly what a zip without the marking module (or a Lambda
        # without the tflite/opencv layer) does.
        blocked = {"marking": None, "marking.swing_marker": None, "swing_marker": None}
        with mock.patch.dict(sys.modules, blocked), \
                mock.patch.dict(os.environ, {"SWING_MARKING_ENABLED": "true"}):
            frames = make_frames(self.tmp)
            marked, record = lambda_function.generate_marked_frames(frames, self.tmp)
        self.assertEqual(marked, [])
        self.assertFalse(record["generated"])
        self.assertIn("swing_marker unavailable", record["reason"])
        # the plain frames are untouched and still on disk for the upload step
        self.assertTrue(all(os.path.exists(f["path"]) for f in frames))

    def test_marker_exception_fails_soft(self):
        def boom(paths, out_dir):
            raise RuntimeError("tflite interpreter died")

        install_fake_marker(boom)
        with mock.patch.dict(os.environ, {"SWING_MARKING_ENABLED": "true"}):
            marked, record = lambda_function.generate_marked_frames(make_frames(self.tmp), self.tmp)
        self.assertEqual(marked, [])
        self.assertFalse(record["generated"])
        self.assertIn("marking failed", record["reason"])
        self.assertIn("tflite interpreter died", record["reason"])

    def test_no_frames_fails_soft(self):
        with mock.patch.dict(os.environ, {"SWING_MARKING_ENABLED": "true"}):
            marked, record = lambda_function.generate_marked_frames([], self.tmp)
        self.assertEqual(marked, [])
        self.assertFalse(record["generated"])

    def test_marker_that_withholds_everything_records_not_generated(self):
        """Fail-closed geometry (no markings passed the gates) is not 'generated'."""
        out_dir = os.path.join(self.tmp, lambda_function.MARKED_FRAME_DIR)

        def withhold(paths, out_dir_arg):
            os.makedirs(out_dir_arg, exist_ok=True)
            geo = dict(GEOMETRY, markings={},
                       failures=[{"marking": "plane_line", "reason": "no ball confirmed"}])
            geo_path = os.path.join(out_dir_arg, "geometry.json")
            with open(geo_path, "w") as fh:
                json.dump(geo, fh)
            return {"geometry_json": geo_path, "marked_paths": [],
                    "skipped": [{"frame": p, "reason": "fail closed"} for p in paths]}

        install_fake_marker(withhold)
        with mock.patch.dict(os.environ, {"SWING_MARKING_ENABLED": "true"}):
            marked, record = lambda_function.generate_marked_frames(make_frames(self.tmp), self.tmp)
        self.assertEqual(marked, [])
        self.assertFalse(record["generated"])
        self.assertEqual(record["markings_rendered"], [])
        self.assertEqual(len(record["failures"]), 1)
        self.assertEqual(record["version"], "2.1.0")
        self.assertTrue(os.path.isdir(out_dir))

    # -- the happy path ----------------------------------------------------
    def _install_successful_marker(self):
        def succeed(paths, out_dir_arg):
            os.makedirs(out_dir_arg, exist_ok=True)
            geo_path = os.path.join(out_dir_arg, "geometry.json")
            with open(geo_path, "w") as fh:
                json.dump(GEOMETRY, fh)
            marked_paths = []
            for p in paths:
                out = os.path.join(out_dir_arg, "marked_" + os.path.basename(p))
                with open(out, "wb") as fh:
                    fh.write(b"marked-jpeg")
                marked_paths.append(out)
            return {"geometry_json": geo_path, "marked_paths": marked_paths, "skipped": []}

        install_fake_marker(succeed)

    def test_successful_marking_records_geometry_and_paths(self):
        self._install_successful_marker()
        with mock.patch.dict(os.environ, {"SWING_MARKING_ENABLED": "true"}):
            frames = make_frames(self.tmp)
            marked, record = lambda_function.generate_marked_frames(frames, self.tmp)

        self.assertEqual(len(marked), 3)
        self.assertEqual([m["phase"] for m in marked], ["frame_000", "frame_001", "frame_002"])
        self.assertTrue(record["generated"])
        self.assertEqual(record["version"], "2.1.0")
        self.assertEqual(record["markings_rendered"], ["head_circle", "plane_line"])
        self.assertEqual(record["failures"][0]["marking"], "spine_line")
        self.assertEqual(record["frames_marked"], 3)
        # geometry is stored for downstream display decisions, minus raw keypoints
        self.assertEqual(record["geometry"]["view"]["label"], "dtl")
        self.assertIn("markings", record["geometry"])
        self.assertNotIn("keypoints", record["geometry"])

    def test_attach_uploads_to_marked_subdirectory_and_cross_links(self):
        self._install_successful_marker()
        with mock.patch.dict(os.environ, {"SWING_MARKING_ENABLED": "true"}):
            frames = make_frames(self.tmp)
            marked, record = lambda_function.generate_marked_frames(frames, self.tmp)

        frame_analysis = {
            "frames": [{
                "phase": f["phase"],
                "url": ("https://bucket.s3.amazonaws.com/golf-swings/u1/a1/frames/a1/"
                        "%s_Frame_at_%.2fs.jpg" % (f["phase"], f["timestamp"])),
                "timestamp": f["timestamp"],
            } for f in frames],
        }

        uploads = []
        with mock.patch.object(lambda_function.s3_client, "upload_file",
                               side_effect=lambda p, b, k: uploads.append((p, b, k))):
            out = lambda_function.attach_marked_frames(
                frame_analysis, marked, record, "bucket", "a1", "u1")

        self.assertTrue(out["generated"])
        self.assertEqual(out["frames_marked"], 3)
        self.assertEqual(len(uploads), 3)
        self.assertEqual(
            uploads[0][2],
            "golf-swings/u1/a1/frames/a1/marked/frame_000_Frame_at_0.00s.jpg")
        self.assertEqual(frame_analysis["frames"][0]["marked_key"], uploads[0][2])
        self.assertTrue(frame_analysis["frames"][0]["marked_url"].endswith(uploads[0][2]))
        self.assertEqual(out["frames"][0]["phase"], "frame_000")
        # the plain frame records are otherwise unchanged
        self.assertTrue(frame_analysis["frames"][0]["url"].endswith("frames/a1/frame_000_Frame_at_0.00s.jpg"))

    def test_attach_fails_soft_when_every_upload_fails(self):
        self._install_successful_marker()
        with mock.patch.dict(os.environ, {"SWING_MARKING_ENABLED": "true"}):
            frames = make_frames(self.tmp)
            marked, record = lambda_function.generate_marked_frames(frames, self.tmp)

        frame_analysis = {
            "frames": [{"phase": f["phase"],
                        "url": "https://bucket.s3.amazonaws.com/golf-swings/u1/a1/frames/a1/%s.jpg" % f["phase"]}
                       for f in frames],
        }
        with mock.patch.object(lambda_function.s3_client, "upload_file",
                               side_effect=RuntimeError("access denied")):
            out = lambda_function.attach_marked_frames(
                frame_analysis, marked, record, "bucket", "a1", "u1")

        self.assertFalse(out["generated"])
        self.assertIn("could not be uploaded", out["reason"])
        self.assertNotIn("marked_url", frame_analysis["frames"][0])

    def test_attach_is_a_noop_when_marking_was_not_generated(self):
        record = lambda_function._marking_record(False, "disabled")
        frame_analysis = {"frames": [{"phase": "frame_000", "url": "https://b.s3.amazonaws.com/k.jpg"}]}
        out = lambda_function.attach_marked_frames(frame_analysis, [], record, "bucket", "a1", "u1")
        self.assertIs(out, record)
        self.assertNotIn("marked_url", frame_analysis["frames"][0])

    def test_attach_never_raises_on_garbage_input(self):
        out = lambda_function.attach_marked_frames(None, [{"phase": "x", "path": "/nope"}],
                                                   {"generated": True}, "bucket", "a1", "u1")
        self.assertFalse(out["generated"])


if __name__ == "__main__":
    unittest.main()
