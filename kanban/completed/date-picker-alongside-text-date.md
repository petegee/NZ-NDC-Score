# Story — Date field keeps a calendar picker alongside the free-text entry

**Status:** Completed (NdcScore-side) · **Raised:** 2026-09-25 (follow-up to
`contest-date-flexible-entry-and-four-digit-year.md` — user asked "can we
still have a date picker?") · **Landed:** 2026-09-25

## What

The bug-#3 fix replaced the native `<input type="date">` with a forgiving
free-text field (that fixed the forced dd/mm segments and the >4-digit
year), which removed the calendar widget. The organiser asked to keep one.

## What landed

Both entry styles coexist — the text field remains the primary (it carries
the flexible parsing and the validation), and a calendar button beside it
serves mouse-first organisers:

- `src/sheet/SheetPage.tsx` — a hidden native `<input type="date">` sits in
  the field; the calendar button opens it with `showPicker()` (user
  activation, try/catch so browsers without the API simply keep the text
  field working). A picked ISO date commits through the same `setField`
  path as typed text, clears any stale draft/error, and normalises the
  visible field to ISO. The native input resets after each commit so
  picking the same date twice still fires. It carries an aria-label that
  never collides with the text field's `Date` label lookup.
- `src/index.css` — `.date-field` flex row, `.date-picker-btn`, and the
  visually-hidden `.date-native`.

## Why it matters

The picker is the mouse-first path for the organiser who prefers pointing
at a calendar; the text field is the fast typist's path and the thing that
actually fixed bug #3. Neither path can send an invalid date: both commit
ISO only (the picker produces it directly; text passes `parseDateText`).

## Verification

`npm test` 214 passed (new SheetPage test: the button opens the picker; a
picked date commits ISO, clears a stale inline error and normalises the
field; the native input resets so a repeat pick still fires), lint and
build green. SoarScore2 untouched (law 5).