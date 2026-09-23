# Story — Class-definition hints on the sheet: too-small-field warning and task time limits

**Status:** Backlog stub · **Raised:** 2026-09-23 (user feedback)

## What

Two client-side UX items from one evening's feedback, both derived from the
adopted class definition (law 3 — no class branches anywhere):

1. **Friendly too-small-field warning.** Calculating with a single pilot
   surfaces the raw engine refusal verbatim, late (after find-or-create, bind,
   register steps). The class definition already carries the phase's
   `MinGroupSize` (`Soarscore.Domain/PublishedClassDefinition/ClassDefinition.cs:175`,
   a `NumberOrParam` — possibly an unbound parameter). The client can warn
   pre-Calculate ("the draw needs at least N pilots; the sheet names 1") and
   translate the `drawPhase.fieldTooSmall` ProblemDetails into organiser
   language when it does arrive.
2. **Task time limits on the grid.** The organiser wants "2 minute max"
   visible where the numbers are typed. Per-task `TaskTiming.WorkingTime`
   already exists in the definition
   (`ClassDefinition.cs:262-275`), and `workingTimeView` already parses it
   (`src/grid/schema.ts:233`). Render as a faint hint on the task's column
   head — same pattern as the existing `whenNotRecorded` hints
   (`single-sheet-calculate.md` WI-3).

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

None required if the wire's `GET /class-definition` projection already
carries `MinGroupSize` and per-task `TaskTiming` (it is expected to — the grid
already consumes `maxLaunches` from it). If it does not, that is a Soarscore
projection gap to raise there when scheduled.

## Before starting

- Verify what the generated client schema (`src/api/schema.d.ts`) actually
  projects for phase `minGroupSize` and task `workingTime` before designing
  either hint.
- `MinGroupSize` may be a `param` reference that is unbound until the
  CompetitionSetup binds — decide pre-bind behaviour (skip the hint; the
  engine error still rules).
- Keep the engine refusal surfaced verbatim somewhere on failure (law 1 —
  ProblemDetails is the truth); the friendly line supplements, never replaces.
- Check whether other catalogue tasks (H, poker) need the same hint shape so
  the rendering stays definition-driven.

## Done when

Single-pilot sheet shows the organiser-language warning before Calculate; the
fieldTooSmall refusal (if reached) renders organiser-readable; every task with
a resolvable working time shows its limit on the grid; no per-class branches.
