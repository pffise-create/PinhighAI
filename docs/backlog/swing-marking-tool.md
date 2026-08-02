# Backlog: Swing Marking Tool (drawn lines / circles on frames)

**Status:** `IN PROGRESS — research phase` · **Filed:** 2026-08-02 · **Started:** 2026-08-02

## Why

Human golf coaches draw on video — swing plane lines, spine angle, shaft angle, head-position circles — to diagnose faults and to make the fault legible to the student. Our pipeline sends the model bare frames. This is a critical missing piece on both sides of the product:

- **Diagnosis.** A plane line converts "the club looks a bit steep" into a checkable geometric relationship. Reference: [V1 Sports — 12 drawing tools of swing analysis](https://v1sports.com/12-drawing-tools-of-swing-analysis/).
- **Explanation.** A user who *sees* the club above the plane line understands the fault. Text alone rarely lands.

## Two modes (both required)

| Mode | Description | Consumer |
|---|---|---|
| **1. Silent** | Markings are generated and passed to the vision model to ground its analysis. The user never sees them and the coach never mentions them. | AI only |
| **2. Displayed** | The marked frame is surfaced in chat as visual evidence ("here you are over plane"). | User |

Mode 1 must work on its own — it should improve coaching quality even if we never ship the UI. Mode 2 is gated on Mode 1 proving out **and** on the visual quality bar below.

## The hard problem: temporal consistency

**A plane line drawn on frame 1 must be in the identical position on every other frame of that swing.**

Per-frame inference (a distillation/vision model computing the line independently on each frame) fails twice:
1. **Cost** — an inference pass per frame, per swing.
2. **Accuracy** — independently computed lines jitter frame to frame. A plane line that wanders is worse than no line: it makes a stable swing look unstable and destroys trust in every other marking.

The reference geometry (plane, target line, ball position, camera-relative ground) is a property of the **setup and the camera**, not of each frame. It should be established **once per swing** — most likely from the address frame — then held fixed across the sequence. Only genuinely moving elements (clubhead trace, head circle) should be recomputed per frame, and those need their own smoothing/consistency treatment.

Solving this is the core of the work item. Do not accept an implementation that recomputes static geometry per frame.

## Scope of work

1. **Research** which markings actually matter and what each requires as input. Enumerate the drawing tools from the reference above and from coaching practice; for each, specify the geometry needed (e.g. plane line needs ball position + hands/hosel at address + camera view classification).
2. **Assess input availability.** Determine what can be derived from what we already have or from publicly available models/datasets (pose estimation, club detection, ball detection, camera-view classification). **Where a required input is not obtainable, document that as an explicit failing rather than approximating it.** A marking we cannot place accurately must not ship in either mode.
3. **Build the tool.** Generates marked variants of extracted frames. Must be deterministic and reproducible for a given swing.
4. **Strict marking evaluation** (dedicated agent, held to a hard standard) on two axes:
   - **Accuracy & consistency** — is the plane line geometrically defensible, and is it in the *same place* on every frame of the swing? This is pass/fail, not a score.
   - **Visual quality** — line weight, color, opacity, contrast against grass/sky/indoor bays, legibility on a phone screen. The bar is AAA; a correct line that looks amateurish fails Mode 2.
5. **Coaching-quality evaluation** (separate agent, blind) — judge coaching output **with markings vs without**, on the same swings. This is the decision gate for Mode 1. If marked frames do not measurably improve the coaching, the tool does not ship.
6. **Display logic.** Propose and implement when a marking is shown to the user. The coaching agent must decide, not show them by default. Example worth supporting explicitly: **side-by-side impact frames relative to the plane line, current swing vs an older swing.**
7. **Wire into the chat app**, including the side-by-side presentation.

## Acceptance criteria

- [ ] Static geometry (plane, target line, ground) computed **once per swing**, provably identical across frames — verified by a test asserting pixel-level line-endpoint stability across a sequence.
- [ ] Every marking type either has a documented, obtainable input source **or** is explicitly listed as not-yet-supportable.
- [ ] Strict evaluator passes both accuracy/consistency and visual quality.
- [ ] Blind coaching evaluation shows measurable improvement with markings vs without.
- [ ] Coach decides when to display; markings are not shown unconditionally.
- [ ] Side-by-side cross-session comparison against a plane line works end to end.

## Dependencies and connections to existing work

- **Event-anchored extractor** (`AWS/production/lambda_function.py`) writes `analysis_results.extraction.anchor_time`, so the impact frame is already identifiable — exactly the frame where plane-relative position matters most. Legacy records have no anchor and capture impact only ~27% of the time.
- **swingMemory** (`claude/memory-swingmemory`) already produces `planVisualComparison` with prior/current frame sets. The marking tool should plug into that rather than inventing a second comparison path.
- **Coaching AI evaluation** (`docs/ai-eval-2026-08-01.md`) found impact visibility to be the single biggest ceiling on diagnostic quality. Markings target that ceiling directly.

## Risks

- **Cross-session camera variance is the biggest threat to Mode 2.** In head-to-head testing the model observed that between two sessions "the camera position and distance differ." A plane line is only comparable across swings if camera geometry is comparable. Side-by-side marked comparisons may require camera-pose normalization, or must be restricted to sessions filmed similarly — otherwise we will show users two lines that are not measuring the same thing.
- **Down-the-line vs face-on require different markings.** View classification must come before marking selection; drawing a plane line on a face-on view is wrong, not merely unhelpful.
- **A wrong line is worse than no line** in both modes: it misleads the model silently in Mode 1, and destroys credibility in Mode 2.
- **Legacy frames** were extracted uniformly and often lack impact; marked comparisons over old sessions may be weak or impossible. Consider re-extraction (frames are a version-gated cache — see `docs/memory-architecture-decision-2026-08-02.md`).

## Open questions (product decisions needed before build)

- ~~Which markings ship first?~~ **Decided 2026-08-02: plane line + spine angle + head circle** (head circle added by product owner — static circle at address, head movement out of it becomes visible; cheapest input requirement of the three).
- Is Mode 2 a paid-tier differentiator?
- Do we re-extract and re-mark historical swings, or only mark going forward?
