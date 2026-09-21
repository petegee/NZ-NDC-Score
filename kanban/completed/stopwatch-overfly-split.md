# Story — Stopwatch entry: one reading, split at working time

**Status:** Completed · **Raised:** 2026-09-21 (with the user) · Implemented same day.

## What

For tasks whose adopted class definition declares the `flightTime` +
`overflySeconds` pair (F3J, F5J, F5L, NZ F5J NDC — detected from the
definition, never class-branched), the sheet replaces the two time inputs
with **one Stopwatch column**: the organiser enters the single
launch-to-landing reading and Calculate splits it at the task's working time
before any command is queued —

- `overflySeconds = max(0, total − workingTime)`, truncated to whole seconds
  per the overfly metric's declared precision (`Truncate/1`);
- `flightTime = min(total, workingTime)`, rounded per the flight metric's
  declared rounding (`HalfUp/0.1` for F3J, `Truncate/1` for F5J/F5L).

A zero overfly is the metric's declared absence (`whenNotRecorded: 0`) and is
not captured; correcting a reading amends the flight side and — because
absence cannot unrecord an event — amends a previously captured overfly to
the assumed 0. Direct entry in the overfly cell is refused by validation with
a pointer (stale drafts from before the stopwatch column), never silently
ignored. Tasks without the pair keep the plain flightTime column; the
compliance drop list no longer offers the overfly metric on split tasks.

Boundary cases (600 s task): `590 → 590/0`, `604 → 600/4`, `604.4 → 600/4`.

## Why it matters

The organiser's paper tool records one stopwatch per flight. Asking for two
numbers (and hiding the second inside a compliance menu) made the sheet
harder than the paper it replaces, and invited inconsistent flight/overfly
pairs. The split is the rulebook's interpretation of the reading — capture
not scoring: no scores, totals, ranks or normalisation are computed client-
side (law 2), and every parameter of the split (working time, both rounding
modes/precisions, the blank-means-zero semantics) derives from the adopted
class definition (law 3).

## Shape

- `src/grid/stopwatch.ts` — `stopwatchPair` (pair detection) and
  `splitStopwatch` (the rulebook split); `src/grid/precision.ts` —
  `applyRounding` (declared mode/granularity), now shared with
  `sameMeasurement` in `calculate.ts`.
- `src/grid/schema.ts` — `TaskGridSchema.stopwatch` metadata;
  `GridColumn.stopwatchRole: 'total' | 'overfly'`; the total column's label
  becomes `Stopwatch`.
- `src/sheet/sheet.ts` — `resolveWorkingTime` (literal, or parameter via
  scoped/unscoped binding then sheet text with default rules);
  `validateSheet` refuses text in split-owned cells.
- `src/sheet/calculate.ts` — the capture loop's split path: one cell fans out
  to the flight chain and (when the reading exceeds working time, or a
  committed overfly must be erased) the overfly chain; unchanged pairs count
  once.
- `src/sheet/SheetPage.tsx` / `ResultsTable.tsx` — overfly columns get no
  grid real estate and no compliance-menu entry; the Stopwatch column is the
  only visible change.
- Fixture: real F3J seed class (`src/test/fixtures/50-f3j.json`).

## Done when (all verified)

- Split unit tests cover both declared rounding modes, the fly-off's 900 s
  working time, and the three boundary cases above.
- Calculate tests over the F3J fixture: inside-working captures flight only;
  over-working captures flight + overfly; re-run is a no-op (the pair counts
  once); correcting below working time amends flight and erases the overfly;
  a growing excess captures the new value; direct overfly entry refuses the
  run; two pilots complete the round on split values.
- SheetPage test: an NDC F5J definition shows the Stopwatch column, no
  flight-time column, no overfly input anywhere.
- `npm test`, `npm run lint`, `npm run build` green.
