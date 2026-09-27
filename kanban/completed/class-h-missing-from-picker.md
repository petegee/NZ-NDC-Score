# Story — Class H (NZ Thermal 2 Metre) missing from the class picker

**Status:** Completed (client-side) · **Raised:** 2026-09-27 (user feedback) —
**bug** · Fixed same day.

## What

Reported: after Soarscore2 gained the NZ Class H — Thermal 2 Metre seed class
(`87-nz-h-thermal-2m`, story `Soarscore2/kanban/completed/nz-class-h-thermal-2m-seed.md`),
the class did not appear in NdcScore's class selection options.

## Cause

`src/sheet/classes.ts`'s `isNdcClass` gates the picker (`SheetPage.tsx` filters
`findClassDefinitions({ activeOnly: true })` through it) on a token list:
`['ndc', 'x5j', 'nz radian', 'ales radian']`. The new definition's name —
"NZ Thermal 2 Metre (Class H)" — matches none of them, so the catalogue had it
(the Soarscore acceptance suite proves the seeding) and the picker hid it.

## Fix

- Added the token `'thermal 2 metre'` — the same mechanism that already admits
  X5J and the Radians, NDC-flown classes without an NDC-branded rulebook
  variant. Law 3 (no class-specific logic) is untouched: no grid, metric or
  scoring code branches on the class; this is the picker's service-scope
  statement only.
- Tests: `classes.test.ts` gains the Class H match plus two negative cases
  ('Thermal Duration', 'F3J — RC Thermal Gliders') locking that the token
  doesn't widen to other thermal classes; `SheetPage.test.tsx`'s `isNdcClass`
  table gains the Class H row. `npm test` 216 passed, lint clean.

## Operator note

The SPA reads the catalogue live; the Soarscore API re-seeds the corpus on
every boot (`ClassCorpusSeeder` re-sends every file, idempotent by content
hash), so an existing store gains Class H on the next API restart with the
rebuilt corpus — no store surgery.