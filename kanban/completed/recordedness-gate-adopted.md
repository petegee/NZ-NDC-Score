# Story — Recordedness gate adopted: one input for start height

**Status:** Completed · **Raised:** 2026-09-22 (with the user) · Implemented same day.

## What

The Soarscore engine gained the `IsRecorded` predicate
(Soarscore `kanban/in-progress/add-recorded-predicate.md`): a flight gate can
read a metric's recordedness, so the NZ F5J NDC seed now cancels a flight
whose AMRT recorded no Start Height data (5.5.11.7 e, carried by NZ.0.3 c)
with `Predicate.IsRecorded("startHeight")` — the flag metric
(`startHeightRecorded`) is gone. Blank height ⇒ the flight completes zeroed;
typed height ⇒ the flight scores normally. ONE input, no second tick.

NdcScore incorporated the feature with no behavioural code change — the
client is definition-driven (law 3), and with the flag metric gone from the
definition the second input disappears by itself:

- Wire contract: `openapi/v1.json` refreshed from the live service,
  `npm run gen:client` — `Predicate` gains the `PredicateIsRecorded`
  discriminator; `src/api/types.ts` is pure re-exports, so nothing
  hand-written changes.
- The compliance drop list is built from `whenNotRecorded` columns only
  (`SheetPage.tsx`); `startHeight` (no assumption) keeps its key column and
  never becomes a drop-list entry. `zeroFlightFlagMetrics`
  (`src/grid/schema.ts`) ignores `isRecorded` gate children — correct by
  construction, now pinned by tests.
- `fake-soarscore.ts` mirrors the service's gap semantics generically:
  `awaitingCapture` excludes metrics a recordedness gate reads (their absence
  zeroes the flight instead of pending it) and `missingMetrics` now lists
  every absent declared metric, the same recorded fact the real
  `GET /task-round-recording` reports.
- Fixture: the real seed class (`src/test/fixtures/85c-nz-f5j-ndc.json`,
  copied from the Soarscore corpus).

## Why it matters

The organiser captures the day on paper: one height per flight. The previous
shapes either blocked the round on a missing tick or silently zeroed
measured flights when the tick was forgotten. Absence is now the class
definition's stated fact, not a capture gap — and the sheet needed no UI
change to honour it.

## Shape

- `openapi/v1.json`, `src/api/schema.d.ts` — regenerated contract.
- `src/sheet/fake-soarscore.ts` — `recordednessGateMetrics` (generic walk of
  the flight gate); `gapCount`, `awaitingMetrics` and the
  `getTaskRoundRecording` projection honour the carve-out.
- `src/grid/schema.test.ts` — F5J NDC fixture cases: demanded `startHeight`
  column, no assumption, `zeroFlightFlags` = the landed flag only,
  stopwatch pair, single flight row.
- `src/sheet/SheetPage.test.tsx` — the F5J stub definition carries the real
  recordedness gate; a recordedness-gated metric shows as a column and never
  in the Flight compliance menu.

## Done when (all verified)

- `npm test`, `npm run lint`, `npx tsc -b` green (149 passed, 5 skipped).
- No metric-name branches anywhere; scores still service-read only (law 2).
