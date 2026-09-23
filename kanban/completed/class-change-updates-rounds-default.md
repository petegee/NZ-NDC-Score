# Story — Changing class must update the Rounds default (bug)

**Status:** Completed · **Raised:** 2026-09-23 (user feedback) — **bug** · Fixed same day.

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

## Diagnosis

Reproduced without the reset: `classChosen` (`src/sheet/sheet.ts:137-145`)
kept `state.rounds` whenever it was **> 1**, so adopt Radian (maxRounds 3) →
adopt ALES 200 (maxRounds 4) kept 3. The draw was then requested with
`sheet.rounds` (`src/sheet/calculate.ts`), and round 4's entered cells were
silently ignored by validation and capture (no grid for that round). A true
reset (`replace` with `initialSheet()`) did pick up the new default — the
reported "reset then change" reading of the feedback was the same adopt-after-
adopt path. Soarscore was never the bug: `ResolveSchedule`
(`Competition.cs:1518`) already refuses a draw above the class's maxRounds
(`roundsInvalid`), and a stale count below the max is indistinguishable from
a legitimate shorter event — unfixable server-side.

## Decided rule

**The newly adopted class's default always wins on class change.** A class
swap re-templates the whole sheet from the definition — columns, tasks,
penalties, parameters — and the round count belongs to that same setup; a
count kept from the previous class has no defensible meaning. A "touched by
hand" marker was rejected as hidden state that would still need the stale
case special-cased. The organiser adjusts Rounds after adopting if the event
runs fewer — an ordinary, supported edit. Cells beyond the new count are
pruned with the same rule as `setRounds`, and `taskPicks` are cleared (task
refs are class-specific codes; a stale pick silently dropped a round in
`sheetRoundGrids`).

## Shape

- `src/sheet/sheet.ts` — `classChosen` adopts `defaultRounds(phase)` of the
  new definition unconditionally, clears `taskPicks`, prunes cells beyond the
  new count; the prune loop is shared with `setRounds` as
  `pruneCellsBeyond`.
- No Soarscore change (law 5): the over-max guard already exists; nothing
  else was wanted from the service.

## Done when (all verified)

- Red reproduction: two reducer tests adopting across the Radian (3) and
  ALES 200 (4) fixtures in both directions — stale count never survives;
  cells and task picks beyond the new count are dropped.
- Full suite green: 159 passed (14 files); `npx tsc -b` clean;
  `npx eslint` clean on the touched files.
- Both fixtures drive the behaviour from `phase.rounds.maxRounds` — no class
  branches (law 3); the draw can never silently use a previous class's count.

## Note

An unrelated, pre-existing uncommitted WIP for `live-rescore-on-edit.md`
(`src/sheet/SheetPage.tsx` auto-rescore refs) fails `npm run lint`
("Cannot access refs during render", exhaustive-deps) in this tree. It is not
part of this story.