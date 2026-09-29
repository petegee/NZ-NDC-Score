# SS Story — F5J: the flyaway reading — flight time caps at 9:59, a 600 s flight scores no landing

**Status:** Completed · **Lane path:** blocked → completed 2026-09-29
(NdcScore-side as-built below; no in-progress layover — the client change
landed in one session) · **Raised from:**
`kanban/completed/f5j-flight-time-cap-at-959.md` user feedback · Same
ambiguity family as `ss_landing-zero-scores-no-landing-points.md` — the two
may share one design answer about flyaway encoding.

## What

On the paper scoresheet a stopwatch that reads **10:00** means the model flew
away and never landed; a sheet showing a 600 s flight **together with landing
points** is an impossible state the rulebook does not allow. The organiser's
ask: cap the recorded flight time at **9:59** — "a 600 sec flight results in
a zero landing."

Feedback verbatim:

> "F5J, may be best to cap at 9:59 instead of 10:00"
> "That is, a 600 sec flight results in a zero landing."

## Verified wire/engine facts (SoarScore2 + NdcScore, 2026-09-23, traced end to end)

The state is reachable through the client's own stopwatch split, and nothing
on the wire or in the engine can see it:

1. **Client split** — F5J Duration declares the `flightTime` + `overflySeconds`
   stopwatch pair with a 600 s working time, so the organiser enters one
   reading and `splitStopwatch` (NdcScore `src/grid/stopwatch.ts`) splits it:
   `10:00` → flight `min(600, 600)` = **600** (Truncate/1), overfly
   `max(0, 600 − 600)` = **0** — and 0 is the metric's declared absence
   (`whenNotRecorded: 0`), so **no overfly is captured at all**. Worse, the
   same holds for any reading in **[600, 601)**: the sub-second overfly
   (e.g. 0.4 s) is truncated to whole seconds and vanishes. The engine
   receives a *perfect in-window flight*.
2. **Engine capture** — `Entry.CaptureMeasurement`
   (`Soarscore.Domain/Entries/Entry.cs`) gates only flight-not-found,
   metric-not-declared and kind-mismatch (and routes a second capture to
   amendment). By design "flight times are NOT checked against any working
   time at capture — the working time is a scoring input, not a capture
   gate" (comment at the head of `Entry.cs`). No metric carries a range or
   cap at capture.
3. **Wire** — `MetricDefinition` (the `GET /class-definition` projection,
   `openapi/v1.json`) carries name/kind/unit/declaredBeforeLaunch/
   precision/whenNotRecorded only: **no min/max/allowed-range**. There is
   nothing for NdcScore to render a cap from — and law 3 forbids the client
   inventing one per class.
4. **Scoring today** (published F5J definition; NdcScore fixture
   `85c-nz-f5j-ndc.json` mirrors it) — rate term `flightTime × 1 pt/s, cap
   600 PerFlight`: a 600.0 s flight earns the full **600**; the landing
   lookup is conditional on `overflySeconds == 0 ∧ ¬touchedByCompetitor`,
   which **holds** — so an entered landing distance awards its table points
   on top. Result: **600 + landing — the impossible state.**
5. **The rules reading** (fai-rules skill, `docs/rules/f5j.md`,
   `rule-map.md`) — F5J flight points 1 pt/s capped 600 qualifying / 900
   fly-off (`5.5.11.12 h`); "no landing bonus if it overflies at all; score
   0 if the model overflies the end of working time by more than 1 minute".
   The definition already implements both *for a captured overfly* — the
   defect is precisely the band where an overfly existed but **does not
   survive the declared rounding**.

## Why it matters

First real-use feedback on the F5J sheet. The paper convention ("600 means
flyaway") collides with the metric convention ("600.00 s is a legal
reading"), exactly as 0-on-landing did for `ss_landing-zero-scores-no-landing-points.md`.
Today the engine silently scores the impossible state: maximum flight time
*and* whatever landing was entered.

## Proposed change (Soarscore)

The organiser's steer is *reinterpret, not reject*: cap the flight at 9:59
and let 600 mean zero landing. The home is **definition data, versioned with
the published classes — no engine code**:

1. **The landing award condition** in the F5J definition gains a flight-time
   test so a flight that reached the horn earns no landing: the conditional
   lookup's `when` becomes `overflySeconds == 0 ∧ ¬touchedByCompetitor ∧
   flightTime < 600`. (Today it tests only the overfly, which is absent —
   not merely zero — in the defect band.)
2. **The rate term cap** drops `600 → 599` ("cap at 9:59") so a flyaway
   reading cannot out-score a landed 9:59 flight.
3. Same examination for every class with the stopwatch pair: F3J (flight
   HalfUp/0.1, overfly Truncate/1 — readings in [600, 601) lose the overfly
   the same way; its landing/overfly-penalty conditionals need the same
   flight-time test), F5L (2 pt/s, cap 390 within a 540 s window), NZ F5J
   NDC 85, and the fly-off phases (900 s). The condition should reference
   the task's own working time; if definitions cannot express that today,
   that expression gap is part of this story.
4. Seed-path discipline: the published definitions live in the Marten store
   (`soarscore.db`) — the seed corpus and golden/parallel-run fixtures need
   the same edit plus the drift guard run (as with the landing-zero change).

Alternative homes considered and set aside: engine capture validation
(reject/clamp) would need new `MetricDefinition` range data on the wire plus
a capture gate — more machinery, and it contradicts the organiser's
expressed preference (the reading is legitimate *paper language*; it is the
scoring that must interpret it).

## Design questions to settle in Soarscore

- Is 600.00 s a legal *time* at all under `5.5.11.12 h`, or is the max
  awarded time 599 s by rule (making the rate-cap change 600 → 599 the
  *correction* and 600-⇒-no-landing its consequence)? Settle from the FAI
  wording, not the convention.
- Reject vs clamp vs reinterpret was the organiser question; the steer is
  reinterpret (this story's proposal). Confirm.
- Generalisation: is "a reading that reaches the horn with no surviving
  overfly = flyaway" a *rule* every stopwatch-pair class shares (one
  definition idiom) or per-class data? The client must never branch per
  class either way (NdcScore law 3).
- The sub-second band [W, W+1): an overfly of 0<x<1 s truncates to 0 under
  the declared Truncate/1 and today *preserves* landing points although the
  rulebook denies landing to any overfly at all. If the fix is the
  flight-time test (`flightTime < W`), this band is covered too — verify.
- Cross-reference `ss_landing-zero-scores-no-landing-points.md`: together
  the two define the flyaway encoding on the sheet (600 on the stopwatch,
  0 on the landing). One design answer should cover both.

## NdcScore as-built (2026-09-29 — the reword the story's §"NdcScore's part" called for)

SoarScore2 shipped the reinterpretation (commit `80d1545`: landing `when`
gains `flightTime < W`, rate caps 600→599 / 900→899; mirrored into
`src/test/fixtures/` — 85c: cap 599 + `< 600` test + leading `{upTo: 0}`
landing row; 50-f3j: caps 599/899 + both `< W` tests). The stopgap warning
is retired and the landed truth encoded — uncommitted, owner reviews:

1. `src/sheet/calculate.ts` (`splitStopwatchCell`) — the horn notice no
   longer says the reading is "pending with Soarscore" and no longer claims
   the engine "will score any landing entered". New text: a horn reading is
   scored **as a flyaway — capped flight time with no landing points,
   whatever landing is entered**; landed-inside-the-window advice is
   unchanged (enter at most W − step, definition-derived per class:
   9:59.9 F3J, 9:59 F5J); flyaway advice is now "leave the landing blank
   (any landing entered scores nothing)". Trigger unchanged
   (`total ≥ W ∧ split.overfly === 0`, definition-derived, law 3 clean);
   no score arithmetic anywhere (law 2 clean). Doc comment and inline
   comment updated to match.
2. `src/grid/stopwatch.ts` — untouched: `10:00` still splits to flight 600
   with overfly absent. Reinterpretation is server-side.
3. `src/sheet/calculate.test.ts` ("stopwatch at the working-time horn
   (flyaway reading)") — the five horn cases now assert the landed
   semantics: 10:00 warns + captures flight 600 / no overfly (F3J and F5J,
   each checking the flyaway wording and the class-declared step);
   the 600.4 sub-second band warns as a flyaway; a surviving overfly
   (10:04) and an inside-the-window reading (9:50) never warn.

Verification: `calculate.test.ts` 49/49; full `vitest run` 216 passed,
6 skipped (live); `eslint` clean. `tsc -b`/`vite build` currently fail on
concurrent in-progress work (`zeroHintMetrics` in `src/grid/schema.ts` +
`SheetPage.tsx` placeholder, a second worker's lane) — no error in either
file this story touched. Sheet never contradicts live engine behaviour:
600 → 599 flight + zero landing, whatever landing is entered.
