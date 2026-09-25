# Story — Unticking a More option undoes the captured exception (deselected compliance amends back to the assumption)

**Status:** Completed (NdcScore-side; no Soarscore change needed) ·
**Raised:** 2026-09-25 (user feedback) · **Landed:** 2026-09-25

## What

The round's **More** column (the flat multi-select of the class's declared
penalties plus every optional metric — the ones whose blank resolves to a
`whenNotRecorded` assumption) sticks: an accidental tick survives its own
untick, and the zero score it produced never goes away.

Feedback verbatim:

> "If I accidentally click on the over 75 m and calculate, I cannot undo the
> zero score by unclicking the over 75 m check mark. The 'More' buttons are
> sticky. That is, you can click on one and then unclick (even before initial
> calculation) and the result is assuming that the click was still there."

Two reported symptoms: (a) even before any Calculate, a tick→untick left the
calculate behaving as if the option were still selected; (b) after a
Calculate, unticking never moved the displayed (zero) score.

## What the investigation found (2026-09-25, traced end to end)

One root cause, both symptoms. The "over 75 m" option is `landedWithin75m` —
a Flag compliance metric declared with `whenNotRecorded: true` (assumed
landed within 75 m). The More checkbox writes the *exception* (`n` = flag
false) onto every flight row of the round; unticking clears those cells to
blank. What happens next:

1. **The capture diff skips blank cells** — `src/sheet/calculate.ts` per-cell
   loop, `if (!text.trim()) continue`. A blank cell is "the assumption
   applies", but when a value was **already captured** from the tick, nothing
   ever reconciles it: recalc reported `unchanged`, `amended: 0`, and the
   recorded `flag: false` stayed on the entry — the zero score, forever
   (symptom (b), reproduced in a unit repro: select → Calculate → deselect →
   recalc leaves the captured flag untouched).
2. **The engine cannot un-record** — SoarScore2
   `Soarscore.Domain/Scoring/FlightMetricResolution.cs` (read-only): Tier-1
   assumption insertion triggers "on absence alone… a recorded value (or
   amendment) always wins". There is no un-capture verb on the wire; the
   only way back is an **amend to the assumed value** — exactly what the
   stopwatch split already does for a corrected-away overfly ("a previously
   captured overfly that the corrected reading erases is amended to the
   assumed value"), but ordinary assumed metrics never got that treatment.
3. **Symptom (a) as literally described** is the same cause seen through the
   first Calculate: select → deselect → first Calculate captures nothing and
   scores normally (locked by a new regression test), so the sticky state the
   tester saw was the already-calculated competition from the opening
   sentence — every later Calculate kept the recorded exception because of
   (1).

## What landed (client-side)

`src/sheet/calculate.ts` only — no UI change, no wire change, no Soarscore
change:

- **Deselected-compliance reconciliation** in the capture step, per group,
  after the sheet-driven cell loop: walk the **committed cells the event log
  shows** (not the sheet's visible rows, so a deselected option comes back
  even when its flight row collapsed with it — F3K task D's dynamic rows),
  and for every committed non-stopwatch metric with a declared
  `whenNotRecorded` whose sheet cell is now blank:
  - committed value already equals the assumption → count `unchanged`
    (blank agrees with the store; idempotent reruns);
  - committed value differs → queue the amend chain to the **assumed value**
    under the auto reason (`Corrected from scoresheet` — the organiser is
    never asked for one), reopening a completed round first, exactly like
    any other correction.
  The stopwatch pair stays owned by the split (`stopwatchRole` excluded on
  both sides — a cleared reading is not an undo). Penalties stay additive
  events with their existing loud warning (no un-record service-side).
- A competitor↔row reverse map (`rowByCompetitor`) so committed wire keys
  can be addressed back to sheet cells.
- Law-clean by construction: the amendment targets the class-definition-
  declared assumption (law 3), is capture orchestration not arithmetic
  (law 2), and derives from sheet text plus the event-log truth — the sheet
  text remains the only client state (law 4).
- Tests:
  `src/sheet/calculate.test.ts` — select→deselect before any Calculate
  captures nothing; unticking after Calculate amends the flag back to the
  assumption (reopen + re-complete on a completed round); a rerun after the
  amend is a no-op (`unchanged`, no second amend); unticking restores every
  flight the tick covered (two fixed rows); a cleared assumed *value* amends
  back to its assumption too (Number branch); blank on a required
  (non-assumed) metric is **not** an undo (the recorded value stays — the
  sheet cannot express "no flight time").
  `src/sheet/SheetPage.test.tsx` — unticking a compliance option before
  Calculate leaves no trace (cells blank, badge back to `…`); after
  Calculate, unticking re-scores on its own: the debounced live re-score
  sends the amend carrying the assumed value, and a follow-up run adds
  nothing (stateful stub that records captures/amends and serves them back
  through the event log).

## Why it matters

First real-use feedback: the accidental tick is the exact mistake the More
column makes easy, and the sheet offered no way back — the organiser's only
recourse was the Soarscore UI directly, against the product's whole premise.
With the reconciliation, overtype-and-recalculate now covers the More
column too: tick, untick, and the scores follow.

## Verification

`npm test` (195 passed), `npm run lint`, `npm run build` green. The engine
trace was read-only against SoarScore2 source (`FlightMetricResolution.cs`
Tier-1 semantics, `AmendMeasurement.cs` — no round-state gate, reason
mandatory) and the fixture definitions (`81-nz-m-ndc.json`,
`85c-nz-f5j-ndc.json`); no Soarscore file was touched (law 5), and no
`ss_` ticket was needed — the wire already supports the whole fix.
