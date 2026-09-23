# Story — Live re-scoring on edit (after the first Calculate)

**Status:** Completed · **Raised:** 2026-09-23 (user feedback) — shipped same
day as a trigger-and-scheduling change on the existing orchestrator.

## What

Once a competition has been calculated, subsequent edits to the sheet should
re-run the orchestrator **automatically (debounced)** so the results block
updates in real time, instead of waiting for the next **Calculate** press.
The user first believed this already worked, then corrected themselves — the
request stands:

> "I like that the results after calculation change in real time when editing
> input scores."
>
> "Addendum: incorrect. The input values change, the score does not change
> until you click calculate"
>
> "I would be nice that after calculate, edits to the sheet are automatically
> reflected in the results in real-time."

## Why it matters

The evening loop is type-look-type; a second button press per correction is
friction the spreadsheet never had. The orchestrator already exists, is
idempotent and amend-aware — this is a *trigger and scheduling* story, not a
new calculation path.

## Law note (candidate amendment to law 4)

Batch-on-Calculate stays the commit model for the **first** run: nothing is
submitted until a competition exists. This story proposes auto-re-run only
*after* that first successful run. When taken up, record the refinement in
`kanban/deferred-decisions.md` alongside the write-through retirement entry.

## Before starting

- `single-sheet-calculate.md` WI-2: the orchestrator is safe to re-run; the
  work is debounce scheduling, progress UI that does not fight the typing
  organiser, and error surfacing without alarm fatigue.
- Tech-debt item "Calculate runs without a cancellation or offline queue… no
  background retry while the organiser keeps typing" changes trade with
  auto-recalc — revisit that item alongside this story.
- Decide behaviour when an edit does not parse or a step refuses: keep showing
  the last good results plus a warning, or blank them? (Parse failures today
  refuse the *whole* run — unacceptable to re-surface on every keystroke.)
- Interaction with `add-pilots-and-rounds-after-calculate.md`: auto-recalc
  must not silently run the currently-refused steps repeatedly.

## Open questions

- Debounce window and whether only *amend-class* edits trigger (cell overtypes)
  or header edits (rounds, tasks) do too.
- Should the Calculate button remain as an explicit force-run/first-run affordance?

## How it landed (2026-09-23)

`SheetPage.tsx` only — no change to `calculate.ts`, the wire, or Soarscore:

- **Arm on first success.** A Calculate that ends `ok` with a competitionId
  sets `autoArmed`; a **Reset** disarms and clears the timer. The debounce is
  armed *only* by a successful run, so `add-pilots-and-rounds-after-calculate`
  refusals are never re-fired on a loop — each auto-run refuses them the same
  way a manual press would, and shows the same warnings.
- **Debounce 1200 ms** behind *every* sheet edit (cells, header, pilots —
  anything that changes `state`). A run in flight is not interrupted: the
  edit sets a dirty flag and the re-run follows the in-flight one, so nothing
  typed during a run stays un-reflected.
- **A refused auto-run never blanks results.** The results block shows the
  last good report; the new run's problems/cell errors surface in the
  calculate bar as before. The next keystroke simply retries after debounce.
- **Calculate stays** as the explicit first-run/force-run affordance.
- Deferred-decisions entry added (law-4 refinement: batch stays the first-run
  commit model); tech-debt's cancellation item re-worded for auto-runs.
- Tests: `SheetPage.test.tsx` gains a stateful `stubFetch` (bare bodies — the
  wire only unwraps `{value, warnings}` envelopes) covering: no auto-run
  before the first Calculate, one orchestrator run on Calculate, and a
  debounced re-run (counted by `/draw-phase` calls) after an edit.
