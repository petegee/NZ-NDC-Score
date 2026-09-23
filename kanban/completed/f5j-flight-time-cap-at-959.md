# Story — F5J: flight time capped at 9:59 (600 s means the model never landed)

**Status:** Completed (NdcScore-side; the fix itself is Soarscore-side,
raised blocked) · **Raised:** 2026-09-23 (user feedback) ·
**Landed:** 2026-09-23

## What

F5J feedback: the recorded flight time should cap at **9:59**, not 10:00 — a
600 s flight means the model flew away and never landed, so a sheet showing
600 s together with landing points is an impossible state.

Feedback verbatim:

> "F5J, may be best to cap at 9:59 instead of 10:00"
> "That is, a 600 sec flight results in a zero landing."

## What the investigation found (2026-09-23, traced end to end)

The state is reachable through the client's own stopwatch split, and nothing
on the wire or in the engine can see it — every candidate home for the cap
is Soarscore-side:

1. **Client split** — `splitStopwatch` (`src/grid/stopwatch.ts`) turns a
   `10:00` reading into flight `min(600, 600)` = 600 (Truncate/1) with
   overfly `max(0, 600 − 600)` = 0 = the declared absence, so **no overfly
   is captured**. The same holds for any reading in [600, 601): the
   sub-second overfly truncates away. The engine receives a perfect
   in-window flight.
2. **Engine capture** — `Entry.CaptureMeasurement`
   (SoarScore2 `Soarscore.Domain/Entries/Entry.cs`) has no range/cap gate;
   "the working time is a scoring input, not a capture gate" by design.
3. **Wire** — `MetricDefinition` carries no min/max, so there is no
   definition data for the client to render a cap from (and law 3 forbids
   inventing one per class).
4. **Scoring** — the published F5J definition's rate term (`cap 600`) pays
   600 for the flyaway reading and its landing lookup (conditional only on
   `overflySeconds == 0 ∧ ¬touchedByCompetitor`) awards the entered landing:
   **600 + landing — the impossible state.**

The Soarscore-side work is raised blocked:
`kanban/blocked/ss_f5j-flight-time-cap-at-959.md` (raised on this board by
user instruction 2026-09-23, `ss_` prefix — superseding this story's
original "do not add to the Soarscore backlog from this repo" stance, same
as the landing-zero family). Proposed fix is definition data (landing
condition gains `flightTime < 600`; rate cap 600 → 599), with the
reject-vs-clamp-vs-reinterpret question and the FAI wording check recorded
there. Organiser steer on record: reinterpret.

## What landed (client-side)

A loud, non-blocking **horn warning** at Calculate — the sheet's absorb-
the-gap pattern (as with the frozen field and the unextendable draw), never
a refusal and never a reinterpretation (the reading is the organiser's; the
rules decision is Soarscore's):

- `src/sheet/calculate.ts` (`splitStopwatchCell`) — when a stopwatch total
  reaches the resolved working time **and no overfly survives the declared
  rounding** (`total ≥ workingTime ∧ split.overfly === 0`, definition-
  derived: the pair, the working time, the flight metric's granularity —
  law 3 clean, no score arithmetic, law 2 clean), the split emits a notice:
  *stopwatch 10:00 reaches the 10:00 working time with no overfly — … if
  the model landed inside the window, enter the reading as at most 9:59
  (9:59.9 at the flight metric's declared step); if it flew away, do not
  enter landing points (the flyaway reading is pending with Soarscore).*
  The capture itself proceeds unchanged — the engine is the truth.
- `src/grid/stopwatch.ts` — `formatClock` (organiser clock text: 599 →
  "9:59", 600.4 → "10:00.4") for the notice.
- Tests: the F3J horn cases (10:00 warns + still captures; 600.4 warns; a
  surviving overfly at 10:04 does not — the definition already zeroes that
  landing; a reading inside the window never warns) and the F5J case (whole
  seconds → the advice reads "at most 9:59"), plus `formatClock` units.

## Why it matters

First real-use feedback on the F5J sheet. The paper convention ("600 means
flyaway") collides with the metric convention ("600.00 s is a legal
reading"), and until Soarscore settles the interpretation the organiser
otherwise has nothing naming the impossible state at the moment it is
typed. The warning fires exactly in the defect band and is honest about the
engine's current behaviour.

## Verification

`npm test` (167 passed), `npm run lint`, `npm run build` green. The engine
trace was read-only against SoarScore2 source (`Entry.cs`, fai-rules
`docs/rules/f5j.md` / `rule-map.md`, the published F5J definition mirrored
in fixture `85c-nz-f5j-ndc.json`); no Soarscore file was touched (law 5).
