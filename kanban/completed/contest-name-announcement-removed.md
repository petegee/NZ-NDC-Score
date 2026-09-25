# Story — The fabricated contest name is silent (no announcement note)

**Status:** Completed (NdcScore-side) · **Raised:** 2026-09-25 (user asked
to remove the "Soarscore calls this contest …" note) · **Landed:** 2026-09-25

## What

The bug-#4 fix announced the fabricated name under the header once class,
location and date were in ("Soarscore calls this contest `2026-09-24 Te
Kuiti ALES Radian (2 m all-foam electric glider)` — the name is built from
the date, location and class, so it needs no typing and no uniqueness").
The user asked for that text to go.

## What landed

- `src/sheet/SheetPage.tsx` — the `sub-note contest-name-note` announcement
  removed, with the now-unused `fabricatedContest` value and
  `fabricateContestName` import. The comment records that calculate.ts
  fabricates the name silently; nothing the organiser types or sees.
- `src/sheet/SheetPage.test.tsx` — the former announcement test now asserts
  the note never appears (the wire body itself stays asserted in the
  calculate tests).

## Why it matters

The name is an internal wire identity, not sheet content — announcing it
invited the organiser to think about a field that no longer exists.

## Verification

`npm test` 214 passed, lint and build green. SoarScore2 untouched (law 5).