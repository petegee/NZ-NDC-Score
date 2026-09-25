# Story — Contest date entry: flexible day/month text and a four-digit year

**Status:** Completed · **Raised:** 2026-09-25 (user feedback) ·
**Landed:** 2026-09-25

## What

Tester feedback on the Contest panel's Date field, verbatim:

> "#3 The day/month/year entry defaults to two digits for day and month, and
> allows for more than four digits for year. It does not like more than four
> digits though. Found that one accidentally."

## What the investigation found (2026-09-25, traced end to end)

The Date field was a native `<input type="date">`
(`src/sheet/SheetPage.tsx`, the Contest card). Both symptoms are properties
of that widget, not of the sheet:

1. **"Defaults to two digits for day and month"** — the browser renders the
   date field as fixed locale segments (`dd/mm/yyyy`), so the organiser is
   pushed into two-digit day/month entry and cannot type freely — the
   opposite of the sheet's "type anywhere, any time" promise.
2. **"Allows more than four digits for year … does not like more than four
   digits"** — Chromium's year segment accepts up to six digits (max year
   275760), so an accidental `20266` produced `state.date = "20266-09-19"`.
   That text is the sheet's date and flows verbatim into the wire:
   `onOrAfter` on `GET /competitions`, the same-date find in
   `find-or-create competition`, and `startDate`/`endDate` on
   `create-competition` (`src/sheet/calculate.ts`). Soarscore's OpenAPI
   declares those as `format: "date"`
   (`openapi/v1.json` → `startDate`/`endDate`), so the service refuses the
   command downstream — the "does not like it" the tester hit. Nothing
   client-side ever validated the year.

The value is committed by the reducer's plain `setField`
(`src/sheet/sheet.ts`); validation at Calculate only checks non-empty
(`validateSheet`). So the failure surfaced only at the service, mid-run.

## What landed

A free-text date field with forgiving parsing and a hard four-digit year
rule — parse/validation lives in a new logic module; the page edit is the
one field swap:

- `src/sheet/dateText.ts` (new) — `parseDateText(text)` →
  `{ ok, iso } | { ok, error }`. Accepts: ISO (what the sheet holds,
  e.g. `2026-09-19`, also `2026-9-5`), day-first `d/m/yyyy` with 1-2 digit
  day/month (NZ paper-sheet order; `/`, `.`, `-` and spaces as
  separators), `d/m` (year defaults to the current one), two-digit years
  pivoted near the present (`5/9/26` → 2026), month names in either order
  (`5 Sep 2026`, `Sep 5 2026`, `5th Sep 2026`), and a four-digit year
  written first (`2026/9/5`). Rules enforced:
  - more than four year digits →
    *"Year must be four digits (e.g. 2026)."* — a 5-digit year can never
    reach the wire again;
  - a real calendar date only (leap days included);
  - a sane year range (1900-2100).
- `src/sheet/SheetPage.tsx` — the date input only: native `type="date"`
  replaced with a text input following the field's existing draft
  convention (as `pilotsDraft`). A parseable reading commits its ISO to
  the sheet text as it is typed; blur/Enter normalises the field to the
  committed ISO; an unparseable draft stays visible with an inline error
  (`<small class="field-error">`) while the last good value stays on the
  wire — garbage text can never be submitted.
- `src/index.css` — `.field-error` (danger-coloured small text).
- Tests: `src/sheet/dateText.test.ts` (13 cases — the 5-digit-year
  rejection, flexible day/month, pivots, month names, impossible dates,
  range, blank) and two `SheetPage` cases (flexible entry commits
  `2026-09-05` to the sheet text and shows the committed ISO; a 5-digit
  year shows the inline error and leaves the last good value stored; and
  Calculate's `create-competition` body carries a valid ISO
  `startDate`/`endDate`).

Not touched: `sheet.ts`, `calculate.ts`, the live modules, and Soarscore
itself (the wire already declares `format: "date"` — the client now
matches it before sending).

## Why it matters

First accidental keystroke found a path where the sheet text itself could
be invalid for the service it exists to drive: the organiser's one bad
digit in the year turned into a Calculate run that fails mid-orchestration
at find-or-create, with no client-side hint. The fix restores the
spreadsheet contract — type freely, see what is held (the field
normalises to the ISO the wire carries), and never send a date the API
must refuse.

## Verification

`npm test` 190 passed / 6 skipped (live); scoped `tsc` and `eslint` clean
over the touched files; `vite build` produces the bundle. Repo-wide
`npm run lint` / `npm run build` were red only through an unrelated
concurrent agent's untracked scratch file (`src/sheet/scratch-repro.test.ts`,
TS6133/no-unused-vars) present during verification — not this change.
