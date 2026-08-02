# Mode 1 ship gate: coaching quality with vs without markings

**Date:** 2026-08-02 · **Method:** same 4 real swings, same production system prompt + response contract, same question ("Analyze my swing and tell me the one thing to work on"). Only difference: marked vs unmarked frames, plus a Mode 1 instruction on the marked arm to use the reference geometry and **never mention it to the player**. Replies blinded (labels shuffled per session), scored, then unblinded.

## Result: markings win 4 of 4 sessions, 77 vs 63

| Arm | Geometric precision | Specificity | Diagnostic | Actionability | Trust | **Total** | Plane claims | Head claims |
|---|---|---|---|---|---|---|---|---|
| **Marked** | **16** | 14 | 16 | 16 | 15 | **77** | **3** | **2** |
| Plain | 6 | 13 | 15 | 14 | 15 | 63 | 0 | 1 |

**The entire margin is geometric precision (16 vs 6).** Specificity, diagnostic commitment, actionability and trust are near-identical — markings did not make the coaching wordier or more confident, they made it *checkable*.

## What that looks like (same swing, backlit driver session)

**Plain** — coached ball position, no plane or head claim, and hedged:
> "at address, the ball appears well ahead of your lead foot… The backlighting and angle limit the precision a bit."

**Marked** — two claims that are only possible against fixed reference geometry:
> "at the top your hands and club get quite high and upright **relative to where the shaft started**… your head **stays nicely centered** through the backswing."

Oblique session, marked arm: *"the shaft well above the angle it started on"* — an explicit address-plane comparison. The plain arm on the same swing talked about lead-arm radius and never referenced plane.

## Contamination: zero

No reply in either arm mentioned a line, circle, color, overlay, or reference geometry. Scanned for magenta/violet/teal/overlay/drawn-line terms across all 8 replies: none. **Mode 1's silence requirement holds.**

## Verdict: Mode 1 PASSES its ship gate
Markings measurably improve coaching quality, the improvement is concentrated exactly where the feature was designed to help, and the geometry stays invisible to the player.

## Caveats (material)
- **n=4 swings, single run.** Directional, not statistically strong.
- **Judged by the orchestrating assistant, not an independent agent** — the subagent evaluating this ran out of usage credits mid-task. Blindness was preserved procedurally (blinded replies read and scored before the unblinding key was opened), but this is weaker independence than the strict marking evaluation, which was fully independent.
- Two of four fixtures are low-resolution; the model can see little in either arm there, which compresses the difference. The two full-resolution DTL sessions show the largest gaps (+6 and +3).
- Harness note: terra's reasoning tokens consumed a 600-token completion budget entirely, returning 8 empty replies on the first run. Raised to 1600. **The production chat loop caps `max_completion_tokens` at 450** — worth checking that reasoning-heavy models can't starve real replies there.
