"""Dedicated marking Lambda.

Lives apart from the frame extractor because opencv+numpy+tflite (~229MB
unzipped) plus the ffmpeg layer (~160MB) exceeds Lambda's 250MB ceiling.
Also serves on-demand renders for Mode 2 subset display.

Event: {bucket, frame_keys[], out_prefix, only?, primary?}
Returns: {generated, markings_rendered, failures, geometry, marked_keys[]}
"""
import json, os, tempfile, traceback
import boto3

s3 = boto3.client("s3")
os.environ.setdefault("SWING_MARKER_MODEL_PATH", "/opt/models/movenet_singlepose_thunder_f16.tflite")

def lambda_handler(event, context):
    try:
        import swing_marker as sm
    except Exception as e:
        return {"generated": False, "reason": f"marking module unavailable: {e}"}

    bucket = event["bucket"]; keys = event.get("frame_keys") or []
    out_prefix = event["out_prefix"]
    only = event.get("only"); primary = event.get("primary")
    if not keys:
        return {"generated": False, "reason": "no frames supplied"}

    tmp = tempfile.mkdtemp()
    local = []
    for k in keys:
        p = os.path.join(tmp, os.path.basename(k))
        s3.download_file(bucket, k, p)
        local.append(p)

    out_dir = os.path.join(tmp, "marked")
    try:
        result = sm.mark_swing(local, out_dir, only=only, primary=primary) \
            if "only" in sm.mark_swing.__code__.co_varnames else sm.mark_swing(local, out_dir)
    except Exception as e:
        return {"generated": False, "reason": f"marker raised: {e}",
                "trace": traceback.format_exc()[-600:]}

    geometry = result.get("geometry") or {}
    if isinstance(result.get("geometry_json"), str) and os.path.exists(result["geometry_json"]):
        geometry = json.load(open(result["geometry_json"]))

    marked_keys = []
    for p in result.get("marked_paths", []):
        key = f"{out_prefix.rstrip('/')}/{os.path.basename(p)}"
        s3.upload_file(p, bucket, key, ExtraArgs={"ContentType": "image/jpeg"})
        marked_keys.append(key)

    marks = (geometry or {}).get("markings", {})
    return {
        "generated": bool(marked_keys),
        "markings_rendered": sorted(marks) if marks else [],
        "failures": (geometry or {}).get("failures", []),
        "geometry": {k: v for k, v in (geometry or {}).items() if k != "keypoints"},
        "marked_keys": marked_keys,
        "marker_version": getattr(sm, "MARKER_VERSION", None),
    }
