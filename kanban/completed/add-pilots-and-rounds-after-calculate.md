# Story — Add pilots and change rounds after Calculate

**Status:** Completed (client-side) · **Raised:** 2026-09-23 (user feedback) ·
**Landed:** 2026-09-23

## What

After the first **Calculate**, the sheet accepts overtype-and-recalculate of
captured values (amends work), but refuses two things the organiser expects to
do freely: **adding a pilot** and **changing the number of rounds**. The
orchestrator should absorb both the way it absorbs corrections: re-running the
idempotent sequence with a new pilot row registers/registers-competitors and
captures their cells; a larger round count draws the extra task-rounds.

Feedback verbatim:

> "Another wee bit is that if I enter a competitor and click calculate, then
> it will not accept additional input."

> "I see now that I can amend scores that are already submitted. I just cannot
> add pilots or change the number of rounds once I click Calculate"

**Recorded alternative** (its own feedback item; per decision 2026-09-23 this
is *noted*, not pursued — it would sit in tension with law 4's batch model):

> "An alternate is to have scores being shown when entered, and only submitted
> after the submitter approves the calculated scores."

## What the investigation found (2026-09-23)

Both refusals reproduce as described. Exact failure points:

1. **Adding a pilot** — API refusal. The wire refuses `register-competitor`
   with `competition.field.frozen` once the draw is accepted
   (`Competition.cs` `ValidateFieldNotFrozen` — "The field is frozen: the draw
   has been accepted."). The first Calculate draws **and accepts**
   immediately, so every later Calculate is past the freeze. The client's
   adopt-set (`calculate.ts`) did not know the code, so the whole run aborted
   with "Registering the field failed" — even amends of already-captured
   cells died. That is the reported "will not accept additional input".
   (The unit-test fake never mirrored the freeze, so tests asserted an
   impossible 3-competitor outcome; the fake now mirrors the service.)
2. **Changing the round count** — client refusal. No wire verb extends or
   trims a drawn fold (`draw-phase` again → `drawPhase.alreadyDrawn`;
   `reject-draw` — the only reopen path — is refused once entries exist,
   `rejectDraw.entriesExist`). `calculate.ts` stopped the run at the draw
   step with a fatal "the sheet disagrees with the drawn schedule".

Both capabilities are Soarscore-side gaps (late registration onto an accepted
draw; fold extension by drawing more rounds) — **not added to the Soarscore
backlog from this repo; raise there when scheduled.**

## What landed (client-side absorption, the way corrections are absorbed)

- **Frozen field absorbed, not fatal** (`src/sheet/calculate.ts`): a
  `competition.field.frozen` refusal during competitor registration now
  warns per pilot ("<name> not registered — the field froze when the draw
  was accepted"), and the run continues: existing pilots' amends,
  reopen-and-amend, completion and scoring all still process. The unregistered
  pilot's typed cells are counted (`skippedNotRegistered`) and warned per
  round ("not registered — cells skipped") — never silently dropped; the text
  stays uncommitted sheet text, so it captures if the capability lands.
- **Round-count difference absorbed, not fatal**: the drawn fold stays the
  truth, but a mismatch now warns loudly and keeps going. Growth names the
  gap ("Round(s) N–M are not drawn — extending a drawn fold needs a Soarscore
  capability that does not exist yet; their cells are skipped"); shrink
  states the rule ("the extra drawn round(s) are skipped, never annulled").
  Per-round task disagreement with the drawn fold stays **fatal** — the cell
  semantics would change, so refusing is correct.
- `fake-soarscore.ts` mirrors the real freeze; unit tests cover the
  added-pilot absorption (person registers, competitor does not, run completes,
  later overtype still amends), growth, and shrink.

Residual: with the freeze absorbed, a late pilot still cannot fly — that needs
Soarscore support for both late registration **and** re-forming groups of an
accepted draw (F3K min group size 5). Same for round extension. Both raise
on the Soarscore board when scheduled.

## Why it matters

Evening reality: a competitor arrives late or the organiser adds a round after
the first calculate. Today that dead-ends into creating a second competition
or hand-editing around the lock. The xlsm illusion (type anywhere, one
button) should not end the moment the button is pressed once. The client now
does everything the wire permits and says so precisely when it cannot.

## Verification

`npm test` (157 passed), `npm run lint`, `npm run build` green. The live-API
scripted pass from `single-sheet-calculate.md` covers the same flows; the
absorbed refusals are unit-covered against the wire-faithful fake.
