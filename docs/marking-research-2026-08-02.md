# Swing Marking Tool — Research & Feasibility

**Phase:** research only, no implementation. Requirement: `docs/backlog/swing-marking-tool.md`.
**Date:** 2026-08-02.

Stack constraints honored throughout: Python 3.9 Lambda (Amazon Linux 2, glibc 2.26), 2048 MB, 300 s, ffmpeg layer, container-image Lambda available, no GPU; 720 px JPEG frames, 10 frames/swing event-anchored on impact (`anchor_time`); one extra OpenAI vision call per swing affordable (~$0.02), one per frame not; **static geometry derived once per swing from the address frame and held fixed**.

---

## 1. Marking catalog

Source: V1 Sports, "12 Analysis Lines You Can Use On Your Swing Today" (Brendon Elliott, Dec 21 2023, https://v1sports.com/12-drawing-tools-of-swing-analysis/ — full text retrieved 2026-08-02), plus standard coaching practice (tush line, clubhead trace, target/ball-position lines).

Legend: **Static** = derived once per swing (address frame) and held fixed on every frame — the default under our hard rule. **Per-frame** = genuinely moving element, recomputed with smoothing. **Per-position** = drawn from a single non-address event frame (top, impact); still computed once per swing, displayed on that frame.

| # | Marking | Diagnoses | Geometric inputs | View | Static / per-frame |
|---|---|---|---|---|---|
| V1-1 | **Head circle** | Lateral head sway back/through ("rotate around the head and spine") | Head center at address (nose + eyes/ears keypoints); radius from detected head size (see §2.1, §3) | Face-on per article; also useful DTL | **Static** — drawn at address, held; head leaving the circle is the signal |
| V1-2 | Line on top of head | Vertical head dip/lift | Head-top y at address (eyes/ears + offset, or head bbox top) | Face-on | **Static** horizontal line |
| V1-3 | **Spine line** | Loss/maintenance of spine angle (early extension, standing up) | Hip midpoint + shoulder midpoint (≈ neck) at address; DTL classification | DTL | **Static** — drawn at address posture, compared frame-by-frame |
| V1-4 | Trail-leg line | Sway (lateral drift off the ball) vs rotation in backswing | Trail ankle + trail hip at address; handedness (which side is trail) | Face-on | **Static** |
| V1-5 | Lead-leg line | Slide vs rotation/clearing through impact | Outside of lead foot up to lead shoulder at address | Face-on | **Static** |
| V1-6 | Core box | Torso stability | Hip L/R + shoulder L/R at address (box: hips bottom, shoulders top) | Face-on | **Static** |
| V1-7 | Waist-to-toes box | Lower-body motion isolation | Hips + ankles/toes at address | Face-on | **Static** |
| V1-8 | **Plane lines ("the V")** | Swing plane — club traveling back/down inside the V; over-the-top, too flat/steep | Bottom line: hosel (shaft base at clubhead — at address ≈ ball position) → through mid-back; top line: same origin → through trail shoulder. Needs hosel/ball point, trail shoulder, mid-back point, DTL classification | DTL | **Static** — the canonical once-per-swing geometry |
| V1-9 | Trail-foot box | Foot roll vs toe-lift; forward extension → over-the-top | Trail-foot extent at address (ankle, heel, toe keypoints) | DTL | **Static** box; foot movement judged against it |
| V1-10 | Lead-wrist line at top | Flat vs cupped/bowed lead wrist → clubface control | Lead wrist + lead forearm orientation **at the top frame**; effectively needs hand pose, not just a wrist point | Both (article implies DTL/top) | **Per-position** (top frame) |
| V1-11 | Alignment lines | Aim of feet/hips/shoulders vs target line | Ball position + toe line + shoulder line at address; DTL classification | DTL | **Static** |
| V1-12 | Impact hands/shaft-lean line | Hands leading clubhead at impact (compression) | Clubhead + hands **at the impact frame** (shaft line) | Face-on | **Per-position** (impact frame) |
| C-1 | Tush line (coaching practice) | Early extension — glutes leaving the line | Vertical line tangent to glutes/hip at address | DTL | **Static** |
| C-2 | Clubhead trace / shaft tracking | Full path vs plane; casting, over-the-top | Clubhead (or shaft line) **in every frame** | DTL mainly | **Per-frame** — the only truly per-frame marking, needs its own smoothing |
| C-3 | Ball-position line | Ball forward/back in stance | Ball point + stance extent (ankles) at address | Face-on | **Static** |

**Catalog size:** 15 distinct markings (12 from V1 + 3 from coaching practice). 11 are static-per-swing; 2 are per-position (single non-address frame); 1 is genuinely per-frame (clubhead trace); V1-11/C-3 static. This confirms the requirement's premise: almost everything is a property of setup + camera, computed once.

**Distinct input primitives across the catalog:**
1. Human pose keypoints on the **address frame** (all leg/torso/head markings) and on the **top frame** (V1-10 only).
2. **Ball position** at address (plane line origin, alignment, ball-position line).
3. **Club shaft/head** location (plane-line hosel origin at address; shaft-lean at impact; clubhead trace per frame).
4. **Camera-view classification** (DTL vs face-on) — gates which markings are legal to draw.
5. Handedness / target direction (derivable from pose + view).

---

## 2. Input feasibility survey

### 2.1 Human pose keypoints

| Option | License | Keypoints | Python 3.9 / AL2 Lambda packaging | CPU speed | Notes |
|---|---|---|---|---|---|
| **MediaPipe Pose Landmarker (BlazePose)** | Apache 2.0 | 33 landmarks incl. eyes, **ears**, heels, foot_index — richest set for head circle + trail-foot box | cp39 wheels up to **0.10.18** are `manylinux2014` (glibc 2.17) → compatible with the AL2 python3.9 runtime; wheel is ~36 MB **but pulls opencv-contrib-python + protobuf etc.**, so a zip layer flirts with the 250 MB unzipped limit — container image is the safe packaging. Verified from PyPI metadata: ≥0.10.20 wheels are `manylinux_2_28` and will NOT load on AL2 python3.9 (glibc 2.26); they require a container image on a newer base. | BlazePose runs real-time on phone CPUs (7–13 ms/frame on desktop per Google); expect ~50–200 ms/frame on a 2048 MB Lambda (~1.1 vCPU). Sources: https://research.google/blog/on-device-real-time-body-pose-tracking-with-mediapipe-blazepose/, https://blog.tensorflow.org/2021/05/high-fidelity-pose-tracking-with-mediapipe-blazepose-and-tfjs.html | Golf-specific caveats are real and documented: shoulder keypoints mislocated at top-of-backswing due to occlusion (https://github.com/google/mediapipe/issues/3434), keypoint jitter and blur-induced hand errors in swing video (https://www.mdpi.com/2076-3417/13/20/11227 — GolfMate built a refinement network specifically because raw MediaPipe was too noisy), failures in bent-over postures with hidden head (https://arxiv.org/pdf/2505.12854). Crucially, **our use is the address frame — static, unoccluded, unblurred — where these models are at their best.** |
| **MoveNet Thunder (TF Lite)** | Apache 2.0 | 17 COCO keypoints (nose, eyes, **ears**, shoulders, elbows, wrists, hips, knees, ankles). No heels/toes → trail-foot box degraded; no mid-spine (interpolate shoulders↔hips) | **Cleanest packaging of all options:** `tflite_runtime` 2.14.0 cp39 `manylinux2014_x86_64` wheel is **2.4 MB** (verified on PyPI) + Thunder int8/f16 model ~7–12 MB → trivially fits a zip layer on the existing python3.9 Lambda. | "Faster than real time (30+ FPS) on most modern desktops" (https://blog.tensorflow.org/2021/05/next-generation-pose-detection-with-movenet-and-tensorflowjs.html); Thunder input is 256×256 → expect ~100–300 ms/frame on Lambda CPU. Docs: https://www.tensorflow.org/hub/tutorials/movenet | Marketed for "fitness" accuracy; single-person; accuracy on bent-over golf address is untested publicly — needs a 20-frame bench on our own frames before commitment. |
| **YOLOv8/YOLO11-pose (Ultralytics)** | **AGPL-3.0** — commercial use requires paid Enterprise license (https://www.ultralytics.com/license, https://docs.ultralytics.com/models/yolo11) | 17 COCO keypoints | pip `ultralytics` drags torch (~700 MB+) → container image only | Fast on CPU at nano/small sizes | A comparative golf study found YOLO-pose lower mean accuracy than MediaPipe but **lower variance/more consistent** (https://www.scirp.org/journal/paperinformation?paperid=148105). **Excluded on license grounds** for a commercial app unless we buy the license — not worth it when Apache-2.0 options suffice. |
| RTMPose (mmpose) | Apache 2.0 | 17–133 kpts, strong accuracy | Needs onnxruntime; current ORT cp39 wheels are `manylinux_2_27/2_28` (verified on PyPI) → **not loadable on AL2 python3.9**; container image required | Good CPU speed at 256×192 | Viable container-image upgrade path if MediaPipe/MoveNet accuracy disappoints; more moving parts. |

**Head circle specifics (scope addition):** both MediaPipe (eyes + ears explicitly) and MoveNet (nose, eyes, ears) supply head keypoints on the address frame. At face-on both ears are usually visible → center ≈ midpoint(ears) or centroid(nose, eyes, ears); at DTL one ear is occluded → use visible ear + eye + nose centroid. **Radius must be proportional to detected head size** (e.g. r ≈ 0.7–0.8 × inter-ear distance face-on, or ≈ 1.4 × eye-to-ear distance DTL), not a fixed pixel value: subject distance varies wildly across bays/range, so a fixed radius is either swallowing (hides sway) or clipping (false alarms) — the proportional choice is both an accuracy and a visual-quality requirement. At 720 px width the head is typically 40–80 px across; keypoint noise of ±2–3 px is small relative to that, so the circle is one of the most robust markings available. Caveat: caps/visors occasionally displace ear/eye keypoints; a sanity check (nose inside circle, circle diameter within anatomical ratio of shoulder width) should gate emission.

### 2.2 Club shaft / clubhead detection

**There is no production-grade, publicly available club shaft or clubhead detection model. Stated plainly, as the requirement asks.**

- **GolfDB / SwingNet** (https://openaccess.thecvf.com/content_CVPRW_2019/papers/CVSports/McNally_GolfDB_A_Video_Database_for_Golf_Swing_Sequencing_CVPRW_2019_paper.pdf, https://github.com/wmcnally/golfdb): 1,400 videos labeled with **swing events, player bbox, and view type — no club annotations**. SwingNet does event sequencing (76.1% PCE), not detection. Useful to us for view-classifier validation data, not for club geometry.
- **Roboflow Universe** hosts hobbyist datasets ("Golf Club Detection" ~8.6k images by Pronisi, "Golf club segmentation batch 10" ~9.2k images, "Golf-club-head" ~300 images — https://universe.roboflow.com/pronisi/golf-club-detection-1hgid, https://universe.roboflow.com/fp-cdzly/golf-club-segmentation-batch-10/dataset/1): small, unvetted annotation quality, mixed/unclear licenses, no published accuracy on phone video. These are fine-tuning **seed data**, not deployable models.
- Commercial trackers (V1, Sportsbox, launch monitors) do not expose models or APIs for this.

**Partial classical-CV escape hatch, address frame only:** at address the club is stationary (no motion blur) and the shaft is a straight, high-contrast line segment running from the hands region down to the ball. `cv2.HoughLinesP`/LSD in a pose-derived ROI (from wrist midpoint, downward toward the ball side determined by handedness) can recover the shaft line and, extended to the ground, the hosel point — exactly the plane-line origin. This is a heuristic, must be confidence-gated (line length, angle plausibility 30–70° from horizontal, endpoint near ground), and must **fail closed**: no line ⇒ no plane marking for that swing (per the "wrong line is worse than no line" rule). It does not generalize to moving frames — clubhead trace and impact shaft-lean remain infeasible (motion blur at 30–60 fps phone capture destroys the shaft edge; see failings §4).

### 2.3 Ball position at address

- **Hough circle in a pose-derived ROI:** at 720 px width the ball is roughly 8–18 px in diameter depending on distance. Generic Hough on the full frame is hopeless (OpenCV Q&A on small circles: https://answers.opencv.org/question/185048/how-to-detect-small-circle-using-hough-circle-transform/), but constrained to a small ROI below the hands / at the end of the detected shaft line, with brightness prior (ball is near-white), it is workable indoors on mats and decent outdoors on clean lies. This is the standard classical approach and costs ~10 ms.
- **YOLO COCO "sports ball" class:** off-the-shelf COCO detectors are weak on 10-px objects; golf-specific literature confirms small-fast-ball detection needs custom training (YOLOv3-tiny fine-tuned reached 0.78 mAP in Zhang et al., https://arxiv.org/pdf/2012.09393 — trained specifically on golf balls, GPU benchmark). Off-the-shelf: unreliable; fine-tuned: possible later.
- **Vision-model point query:** unreliable for coordinates (see 2.5).
- **Best available composite:** shaft-line endpoint (2.2) ∩ Hough-circle candidate, mutually confirming; if they disagree beyond tolerance, plane line is withheld for that swing. A capture-time "tap the ball" UX would make this exact, but that is a product change (listed as unblocker, §4).

### 2.4 Camera-view classification (DTL vs face-on)

Simplest reliable method: **pose-derived heuristic from the address frame — no extra model, no extra cost.**
- Face-on: shoulder keypoints widely separated in x (|xL−xR| ≳ 0.5 × torso height), both ears/eyes detected, hips similarly wide.
- DTL: shoulders nearly collinear in x (small |xL−xR|), one ear/eye low-confidence (occluded), face keypoints all offset to one side.

This uses keypoint geometry + confidence scores already computed for the markings and is a few lines of arithmetic. GolfDB's per-video **view-type labels** (face-on/DTL/other) give a free labeled validation set (https://github.com/wmcnally/golfdb). Fallback/tiebreaker: fold a "is this down-the-line or face-on?" question into the one affordable per-swing vision call — view classification is a coarse semantic judgment, exactly what VLMs are good at (unlike coordinates). A tiny trained classifier is unnecessary complexity for a binary decision with strong geometric signal.

### 2.5 The "one vision-model call per swing" option — coordinates from the OpenAI vision model

Question: can we ask our existing OpenAI vision model for pixel coordinates of ball/hosel/hands/shoulders on the address frame? **Evidence says no — not to the precision a drawn line demands.**

- GPT-4o and peers "consistently struggle to determine exactly where" objects are; a practitioner test found **5 of 200 (x,y) coordinate queries accurate** (https://medium.com/@muhammad.3216awan/visual-grounding-and-self-checking-enhancing-gpt-4os-localization-ability-7a21f1a15428).
- Mechanistic explanation: images are tiled into 512×512 patches → ~170 tokens each; fine positional information degrades through the transformer — "semantic meaning survives compression better than exact coordinates do" (https://medium.com/@silverskytechnology/why-gpt-vision-struggles-with-bounding-boxes-and-how-we-fixed-it-1b5d3db5914b).
- Academic benchmarking (VRSBench, "How well does GPT-4o understand vision?") repeatedly shows near-floor localization/bounding-box performance for GPT-4o-class models vs specialized detectors (https://arxiv.org/pdf/2406.12384, https://openreview.net/pdf/47b8a07a85c2778415d74d6e2cf70b8fcb2195d8.pdf).
- Models **trained with explicit pointing supervision** are a different story — Ai2's Molmo/MolmoPoint lead PointBench at ~70% (https://allenai.org/blog/molmopoint, https://arxiv.org/html/2505.09990) — but they are not OpenAI models, would need self-hosting (no GPU in our stack), and 70% on a benchmark is still not "anchor a coach-credibility line on it."
- Inverse direction works: VLMs are good at **verifying visual marks** ("is the drawn circle around the head?") — visual indicators outperform text coordinates (SAM+GPT-4o cascade write-up: https://www.edge-ai-vision.com/2025/02/sam-2-gpt-4o-cascading-foundation-models-via-visual-prompting-part-2/).

**Conclusion:** spend the one affordable call on what VLMs are actually good at — semantic/verification tasks: view classification tiebreak, handedness, "is a ball visible on the ground," and **QA of the rendered marking** (present the marked address frame, ask "does the circle enclose the head, does the plane line originate at the club?"). Never use its raw coordinates as geometry.

---

## 3. Recommendation: first markings + pipeline

**Build first: plane line (DTL) + spine line (DTL) + head circle (face-on & DTL).** The backlog's suggestion (plane + spine) is confirmed; the product owner's addition of the head circle is endorsed — it is arguably the *cheapest* high-value marking (pure pose, largest tolerance, works in both views) and gives face-on swings a marking on day one, which plane+spine alone would not (both are DTL-only). All three are static-per-swing, satisfying the hard rule by construction: geometry is computed once from the address frame and the identical coordinates are drawn on all 10 frames — the acceptance test (pixel-identical endpoints across the sequence) is trivially satisfiable.

**Per-view coverage:** DTL swing → plane line + spine line (+ head circle optional); face-on swing → head circle (spine/plane are wrong for that view and must be suppressed — view gate is mandatory).

**Concrete pipeline (runs once per swing, inside or beside the existing extraction Lambda, after frames exist):**

1. **Address frame selection** — first extracted frame (event-anchored extractor already clusters at setup).
2. **Pose on address frame only** — MoveNet Thunder via `tflite_runtime` 2.14.0 (cp39 manylinux2014, 2.4 MB wheel + ~12 MB model → plain zip layer on the existing python3.9 Lambda; Apache 2.0). ~0.1–0.3 s. *Alternative if richer landmarks or better bent-posture accuracy is needed after benching: MediaPipe Pose Landmarker ≤0.10.18 (last AL2-compatible cp39 wheel) or ≥0.10.20 in a container image.* Decision gate: bench both on ~30 of our own address frames (indoor bay + outdoor, DTL + face-on) before committing.
3. **View classification** — pose heuristic (§2.4), validated against GolfDB labels. Free.
4. **If DTL:** shaft line via HoughLinesP in wrist-anchored ROI → hosel/ball point (∩ Hough-circle confirmation, §2.2–2.3). Confidence-gated; on failure, plane line is omitted (spine + head circle still emitted). ~50 ms.
5. **Geometry construction** (pure math, once): plane V (hosel → trail shoulder; hosel → mid-back = midpoint of shoulder-mid and hip-mid), spine line (hip-mid → shoulder-mid), head circle (head-keypoint centroid, radius proportional to detected head size per §2.1). Persist geometry JSON alongside `analysis_results` — deterministic and reproducible.
6. **Render** markings onto all 10 frames (Pillow/OpenCV, already available). ~0.2 s total.
7. **Optional single vision call (~$0.02)** — QA the marked address frame + view/handedness tiebreak (§2.5). Recommended during rollout; can be sampled down later.

**Cost/latency per swing:** local compute ~0.5–1.5 s added to a 300 s-budget Lambda (negligible); $0.00 mandatory, ~$0.02 optional QA call. No per-frame model calls anywhere.

**Deferred and why:** leg lines/boxes and tush line (V1-4/5/6/7/9, C-1 — same pose inputs, easy follow-ons once the pose bench is trusted; deferred only to keep the eval surface small); alignment + ball-position lines (V1-11, C-3 — depend on ball point reliability stats from step 4 telemetry); lead-wrist line, impact shaft-lean, clubhead trace (V1-10/12, C-2 — inputs not obtainable, see §4).

## 4. Failings list — inputs not reliably obtainable today

1. **Club shaft/head through the moving swing** (kills clubhead trace C-2, impact shaft-lean V1-12, and any "club vs plane at delivery" check). No public production model exists (§2.2). Unblock: fine-tune a small detector (seed: Roboflow sets + frames we label ourselves; motion blur remains a physics problem at phone fps — high-shutter capture guidance would help), or license commercial tech.
2. **Hosel/ball at address on cluttered outdoor lies** — classical CV degrades on range turf/debris; the pipeline fails closed there, so some swings get no plane line. Unblock: capture-time "tap the ball" UX (exact, cheap, also fixes ball-position line), or a fine-tuned tiny ball detector (golf-ball literature shows it works when trained: https://arxiv.org/pdf/2012.09393).
3. **Lead-wrist flatness at the top** (V1-10) — needs 3D hand/forearm orientation; 2D keypoints at 720 px cannot distinguish flat vs cupped. Unblock: hand-landmark model on a cropped top-frame region (unproven at this resolution) or 3D pose lift; low priority.
4. **Accurate pixel coordinates from the OpenAI vision model** — demonstrated unreliable (§2.5); do not anchor geometry on them. Unblock: pointing-supervised models (Molmo-class) maturing/becoming hosted, or OpenAI shipping grounding-supervised outputs.
5. **Cross-session camera normalization** (requirement's own top Mode-2 risk) — no obtainable input gives camera pose from a single uncontrolled phone frame to comparable precision. Side-by-side plane comparisons must be restricted to similar-framing sessions (compare pose-derived scale/positions between sessions as a gate). Unblock: capture-time framing guidance, or homography from multiple stable scene points (not reliably present in bays/range).
6. **Legacy frames** — no anchor, impact present ~27%; pose at address still works, but impact-relative claims on old sessions stay weak until re-extraction (per `docs/memory-architecture-decision-2026-08-02.md`).

---

### Source index
- V1 article (full text retrieved): https://v1sports.com/12-drawing-tools-of-swing-analysis/
- BlazePose/MediaPipe: https://research.google/blog/on-device-real-time-body-pose-tracking-with-mediapipe-blazepose/ · https://blog.tensorflow.org/2021/05/high-fidelity-pose-tracking-with-mediapipe-blazepose-and-tfjs.html · https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python · https://github.com/google/mediapipe/issues/3434 · https://www.it-jim.com/blog/mediapipe-for-sports-apps/
- Wheel compatibility (verified directly from PyPI JSON metadata, 2026-08-02): mediapipe cp39 manylinux2014 ≤0.10.18 / manylinux_2_28 ≥0.10.20; tflite_runtime 2.14.0 cp39 manylinux2014 2.4 MB; onnxruntime cp39 ≥1.18 manylinux_2_27+
- MoveNet: https://blog.tensorflow.org/2021/05/next-generation-pose-detection-with-movenet-and-tensorflowjs.html · https://www.tensorflow.org/hub/tutorials/movenet
- YOLO licensing: https://www.ultralytics.com/license · https://docs.ultralytics.com/models/yolo11
- Golf pose accuracy studies: https://www.scirp.org/journal/paperinformation?paperid=148105 · https://www.mdpi.com/2076-3417/13/20/11227
- GolfDB/SwingNet: https://openaccess.thecvf.com/content_CVPRW_2019/papers/CVSports/McNally_GolfDB_A_Video_Database_for_Golf_Swing_Sequencing_CVPRW_2019_paper.pdf · https://github.com/wmcnally/golfdb
- Club datasets (non-production): https://universe.roboflow.com/pronisi/golf-club-detection-1hgid · https://universe.roboflow.com/fp-cdzly/golf-club-segmentation-batch-10/dataset/1
- Ball detection: https://arxiv.org/pdf/2012.09393 · https://answers.opencv.org/question/185048/how-to-detect-small-circle-using-hough-circle-transform/
- VLM coordinate accuracy: https://medium.com/@muhammad.3216awan/visual-grounding-and-self-checking-enhancing-gpt-4os-localization-ability-7a21f1a15428 · https://medium.com/@silverskytechnology/why-gpt-vision-struggles-with-bounding-boxes-and-how-we-fixed-it-1b5d3db5914b · https://arxiv.org/pdf/2406.12384 · https://openreview.net/pdf/47b8a07a85c2778415d74d6e2cf70b8fcb2195d8.pdf · https://allenai.org/blog/molmopoint · https://arxiv.org/html/2505.09990 · https://www.edge-ai-vision.com/2025/02/sam-2-gpt-4o-cascading-foundation-models-via-visual-prompting-part-2/
