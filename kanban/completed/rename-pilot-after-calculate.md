# Story — Rename a pilot after the first Calculate

**Status:** Completed (NdcScore-side — no Soarscore gap; the wire already
had `POST /rename-person`) · **Raised:** 2026-09-25 (user feedback) ·
**Landed:** 2026-09-25

## What

Tester feedback (verbatim):

> "#2 Even modifying a pilot name after initial calculation is not allowed."

with the reporter's own guess: "i assume this is similar to number #1 above
but the name is not reflected in the results" — after the first Calculate,
editing a pilot name either does nothing or dead-ends the row.

## What the investigation found (2026-09-25, traced end to end)

The name input is never locked (`SheetPage.tsx` renders it plain), and the
debounced live re-score does run — but the orchestrator resolves rows to
people strictly by the **current** name:

1. `src/sheet/calculate.ts` step 4 did `findPeople(name)` per named row; a
   renamed row matched nobody, so it **registered a brand-new person** with a
   fresh placeholder email.
2. `registerCompetitor` for that new person is refused with
   `competition.field.frozen` (the first Calculate accepts the draw — see
   `add-pilots-and-rounds-after-calculate.md`), absorbed as a warn.
3. The row therefore lost its competitor mapping: every cell the organiser
   had captured for that pilot was counted `skippedNotRegistered`, the drawn
   competitor kept the **old** name, and the results block kept showing it —
   "the name is not reflected in the results".

The wire was never the gap: `POST /rename-person` exists
(`openapi/v1.json` → `RenamePerson { id, name }`; SoarScore2
`Commands/Commands.cs` route, `RenamePersonHandler`, `Person.Rename` — only
guard `person.name.blank`; policy `SelfOrOrganiserPolicy`, satisfied by the
same organiser principal that already registers people). No `ss_` ticket
raised — none of the existing blocked tickets cover renames
(`ss_late-registration-after-draw.md` is about *new* competitors after the
freeze, which stays out of scope here: a renamed row reuses its competitor,
it does not need the field unfrozen).

## What landed

- `src/sheet/calculate.ts` — `runCalculate` takes the previous successful
  report as `prior` (`CalcPrior`: competition id, row → competitor, names).
  Resolution per named row is now: **prior identity first** — a row keeps the
  competitor it flew with (a row is a position, not a name; a stranger name
  match must never re-bind a flown row, and two rows renamed in one burst are
  only resolvable through the prior mapping); the person record is renamed on
  the wire when the sheet name differs from what the row last sent. Rows
  without prior identity (page reloaded) go to the name match as before, with
  one recovery: **exactly one unmatched row + exactly one unmatched
  competitor = the same pilot renamed** (elimination); anything ambiguous
  falls through to registration as before. A refused rename warns
  ("Rename refused: …"), skips the row's cells, and the next edit retries —
  the flown field keeps working either way. Competitors the sheet no longer
  names (a blanked row mid-retype) keep their last sheet name in the results
  instead of a raw id.
- `src/sheet/SheetPage.tsx` — passes the last good report (via a ref, so
  debounced runs see the latest mapping) as `prior`; Reset clears it.
- `src/api/client.ts` + `src/api/types.ts` — `renamePerson(personId, name)`
  on the Api (the id struct nesting stays in one place).
- `src/sheet/fake-soarscore.ts` — mirrors the rename (projection reads the
  current name; blank refused; `renameCalls` counter for no-op assertions).
- Tests (`calculate.test.ts`): rename keeps the same competitor/person and
  the cells still diff (no re-registration, results show the new name);
  rename recovered by elimination without prior (reload); an unchanged name
  never re-issues a rename; two rows renamed in one burst keep their own
  identities; a refused rename warns and keeps the field working; blanking a
  name mid-retype commits nothing and keeps the last display name.
  (`SheetPage.test.tsx`): after Calculate, correcting the name in the sheet
  sends exactly one `POST /rename-person` for the registered person and
  never re-registers the competitor.

## Why it matters

Corrections are entered freely — overtype and recalculate (law 4). A name is
the label of a flown pilot, not a re-binding key: the competitor, draw spot
and committed cells must survive any rename, and the results must speak the
sheet. The client now does everything the wire permits and says precisely
when it cannot.

## Verification

`npm test` (202 passed), `npm run lint`, `npm run build` green. Wire trace
read-only against SoarScore2 (`RenamePerson.cs`, `Person.cs`,
`CommandPolicyTable.cs`, `Commands.cs`); no Soarscore file was touched
(law 5).
