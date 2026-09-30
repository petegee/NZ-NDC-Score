# Story — Class-definition hints on the sheet: too-small-field warning and task time limits

**Status:** Backlog stub · **Raised:** 2026-09-23 (user feedback)

## What

Two client-side UX items from one evening's feedback, both derived from the
adopted class definition (law 3 — no class branches anywhere):

1. **Friendly too-small-field warning.** Calculating with a single pilot
   surfaces the raw engine refusal verbatim, late (after find-or-create, bind,
   register steps). The class definition already carries the per-task minimum
   `TaskDefinition.group.minPerGroup` (`GroupConstraint`, projected as
   `src/api/schema.d.ts:2401-2406` on `TaskDefinition.group`, `src/api/schema.d.ts:2726`;
   a `NumberOrParam` — literal or `{ param }`, possibly unbound). E.g. every
   F3K NDC task carries `group.minPerGroup: 5`
   (`src/test/fixtures/85b-nz-f3k-ndc.json:200-202`). This is **not** the
   phase-level field the stub first cited (there is no
   `PhaseDefinition.minGroupSize` on the wire — `src/api/schema.d.ts:2504-2514`),
   nor `PromotionRule.minGroupSize` (flyoff promotion, `:2555`) nor
   `ReflightRule.minNewGroupSize`. The client warns pre-Calculate and
   translates the `drawPhase.fieldTooSmall` ProblemDetails into organiser
   language when it does arrive.
2. **Task time limits on the grid.** The organiser wants "2 minute max"
   visible where the numbers are typed — and "10 minute max" was the wrong
   label for it: 600 s on F3K task G is the working-time *window*, while the
   2 minutes that matters is the per-flight score cap (120 s). Each round
   header now shows both, derived definition-driven (law 3):
   `"10 min window · 2 min max"` — window from per-task
   `TaskTiming.workingTime` (`src/api/schema.d.ts:2743-2748`, parsed by
   `workingTimeView`, `src/grid/schema.ts:302-312`, resolved by
   `resolveWorkingTime`, `src/sheet/sheet.ts`), max flight from the most
   restrictive resolvable per-flight rate cap (`ScoreTermRateTerm` with
   explicit `capScope: PerFlight` across `score` + `scoreNormalised`,
   conditional-aware — `perFlightCaps`, `src/grid/schema.ts`; resolved by
   `resolveMaxFlight`, `src/sheet/sheet.ts`). Both sides share one
   `NumberOrParam` chain (literal / numeric string / `{ param }` via scoped
   binding → unscoped → sheet text → declared default); either side
   unresolvable renders nothing for that side. Rendered as one faint hint on
   the round header (`src/sheet/SheetPage.tsx` thead) — same pattern as the
   existing `targetLabel` and `EXACT_ZERO_HINT` hints
   (`single-sheet-calculate.md` WI-3). Tasks without a per-flight cap (F3K H
   targets) show window only; a missing `capScope` is never treated as
   per-flight (a PerTask cap is a score total, not a max flight).

Feedback verbatim:

> "For F3K, best to state that on task G, 2 minute max."

> "F3K, entering a single flier score gives a Draw failed 'Draw failed —
> drawPhase.fieldTooSmall: Round 1 ('B'): the eligible field (1) is smaller
> than the class's minimum group size (5).'"

## Why it matters

The raw refusal reads like a crash and arrives after several commands have
already run; the missing time limit is the kind of thing the xlsm printed on
the paper sheet. Both fixes are rendering what the service already knows —
zero new client state, zero class logic.

## Soarscore involvement

None required. The wire's `GET /class-definition` projection already carries
per-task `group.minPerGroup` and per-task `TaskTiming.workingTime` (proven by
the checked-in fixtures and by the grid already consuming `maxLaunches` /
`workingTime` from the same projection). `NumberOrParam` / `FlagOrParam` are
empty schemas in `openapi/v1.json` (`"NumberOrParam": {}`), which is why the
generated client types them `unknown` (`src/api/schema.d.ts:2449`) — narrow
locally exactly as `workingTimeView` does; not a projection gap. If the
pre-start verification below ever finds either field missing, raise a
Soarscore projection gap there when scheduled — do not branch around it
client-side.

## Field-size warning design (so the implementer does not invent it)

- **Source of truth per round:** each visible round's `taskRef` (via
  `sheetRoundGrids`, `src/sheet/sheet.ts:280-304`) → `taskGridFor` →
  `TaskDefinition.group.minPerGroup`. Catalogue rounds may draw different
  tasks with different minima — evaluate **per round**, never a single
  sheet-wide N.
- **Resolution:** same `NumberOrParam` narrowing as `workingTimeView` (literal
  as-is; `{ param }` via that round's scoped binding → unscoped binding →
  sheet param text → declared default). Unresolvable (unbound param, no
  default) means **skip the hint for that round**; the engine error still
  rules.
- **Pilot count:** named sheet rows (`sheet.pilots` non-blank names) — the same
  count the orchestrator will try to draw with. Registered-competitor count is
  not used pre-Calculate.
- **Copy (supplements, never replaces, the verbatim ProblemDetails — law 1,
  surfaced at `src/sheet/calculate.ts:740`):**
  - Pre-Calculate banner when any round's resolvable minimum exceeds the named
    pilot count: `Round {n} ({taskRef}) needs at least {min} pilots to draw —
    the sheet names {count}. Add pilots or the draw will be refused.`
    Multiple rounds: one line per round, strictest first.
  - On `drawPhase.fieldTooSmall` arrival, prefix the verbatim detail with:
    `Too few pilots for the draw — ` and keep the engine `code: detail`
    visible underneath.
- `GroupConstraint.minValidResults` / `minEnforcement` are out of scope —
  draw-time refusal only.

## Before starting

- Verify what the generated client schema (`src/api/schema.d.ts`) actually
  projects for task `group.minPerGroup` and task `workingTime` before designing
  either hint (expect `GroupConstraint` at `:2401` and `TaskTiming` at `:2743`;
  there is deliberately no `PhaseDefinition.minGroupSize`).
- `minPerGroup` / `workingTime` may each be a `param` reference unbound until
  CompetitionSetup / PerRound binds — pre-bind behaviour is skip-the-hint for
  that round; the engine error still rules.
- Keep the engine refusal surfaced verbatim somewhere on failure (law 1 —
  ProblemDetails is the truth); the friendly line supplements, never replaces.
- Check whether other catalogue tasks (H, poker) need the same hint shape so
  the rendering stays definition-driven.
- Working-time hint formatting: window as `"10 min window"` (whole minutes;
  sub-minute remainders as `"M:SS window"` via `formatClock`), max flight as
  `"2 min max"` / `"M:SS max"`; combined `"10 min window · 2 min max"`.
  Either side unresolvable renders nothing for that side. Both literal
  (`"workingTime": 600`, `"cap": 120`) and param
  (`{"param": "workingTime.B"}`, `{"param": "maxFlight.B"}`) shapes occur on
  the wire — see `85c-nz-f5j-ndc.json:202` and `85b-nz-f3k-ndc.json:196-198`.

## Done when

- Single-pilot sheet shows the per-round organiser-language warning after the
  first Calculate press (never on a freshly chosen class — an empty sheet is
  the starting point, not a warning; e.g. F3K task B: `Round 1 (B) needs at
  least 5 pilots to draw — the sheet names 1.`); the fieldTooSmall refusal
  (if reached) renders the friendly prefix with the verbatim `code: detail`
  retained underneath.
- Every round shows its window and, where the task declares one, its max
  flight on the grid round header (e.g. F3K task G: `10 min window · 2 min
  max`; F3K task H targets: `10 min window` only; literal and `{ param }`
  shapes verified against F3K + F5J fixtures); an unresolvable side shows
  nothing for that side.
- No per-class branches (law 3).
