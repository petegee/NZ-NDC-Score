# Story — Changing class must update the Rounds default (bug)

**Status:** Backlog stub · **Raised:** 2026-09-23 (user feedback) — **bug**

## What

Reported: after a reset, adopting a new class does not update the sheet's
**Rounds** field; the previous class's round count survives, the draw runs
with the stale count, and entered scores for four rounds score only three.

Feedback verbatim:

> "When one does a reset, and then changes the Class, the Rounds number does
> not update to the new Class selected."

> "Example, I score a Radian event (or try to do such), then select ALES 200,
> which shows 4 rounds for scoring. IF I do not manually update the Rounds
> number, but enter scores for four rounds, it scores only three rounds."

## Suspected spot

`src/sheet/sheet.ts:137-145` — the `classChosen` reducer keeps `state.rounds`
whenever it is **> 1**, falling back to the new definition's
`defaultRounds(phase)` (`src/grid/schema.ts:227`) only when rounds ≤ 1. A true
reset (`SheetPage.tsx:261` — `replace` with `initialSheet()`, rounds = 1)
*should* pick up the new default, so either the reset path did not run
(localStorage restore `ndcscore.sheet.v1` re-hydrating the old rounds), class
adoption happened without `classChosen`, or `defaultRounds` fell back (e.g.
`maxRounds` declared as an unresolvable param). Reproduce before touching
anything. The stale count matters twice over: the draw is requested with
`sheet.rounds` (`src/sheet/calculate.ts:503`).

## Before starting

- Reproduce the exact reported sequence: reset → adopt Radian → adopt ALES
  200 → inspect the Rounds field and the persisted sheet; also try adopt
  *without* an intervening reset (the more likely reproduction).
- Decide the desired rule: does the newly adopted class's default **always**
  win on class change, or only when the organiser has not hand-edited rounds?
  (If the latter, the Rounds field needs a "touched by hand" marker — and the
  stale-3-into-ALES case must still be caught.)
- Decide what happens to already-entered cells beyond the new round count
  (`setRounds` drops them silently today — `sheet.ts:104-109`).

## Done when

A reproduction test is red, the fix is green, and both classes' fixtures prove
no class branches (law 3): adopting a class whose phase declares `maxRounds`
shows that default (per the decided rule), and the draw can never silently use
a round count from a *previous* class.
