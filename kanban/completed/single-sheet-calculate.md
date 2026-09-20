# Story — One spreadsheet sheet + Calculate (the redesign)

**Status:** In progress · **Raised:** 2026-09-17 (with the user, after the
first evening with `single-form-contest-entry`) · Facts below inherit the
verified wire facts in `kanban/completed/single-form-contest-entry.md` —
nothing re-verified; each WI's *Done when* re-tests against a live API.

## What

The app becomes the xlsm illusion: **one page, one grid**. A header block
(class, contest, date, venue, CD, rounds, per-round task choices, setup
bindings), free pilot rows, and a full round grid whose columns derive from
the adopted class definition. The organiser types into any cell at any time —
before or after the draw exists — and presses one **Calculate** button. The
client then orchestrates the entire Soarscore command sequence invisibly
(find-or-create competition → bind → find-or-register pilots → draw → open
entry/flight → capture or amend → complete task-rounds) and reads scores back
from the result queries only. Corrections are entered freely: overtype a cell
and recalculate — the orchestrator amends with an auto-filled reason
(`Corrected from scoresheet`), reopening a completed task-round itself when a
late correction lands. The organiser is never asked for a reason.

The staged wizard (class → header → bindings → roster → draw → per-round
grid) is retired; so is per-cell write-through.

## Why it matters

The organiser thinks in the paper scoresheet: a grid, numbers typed anywhere,
one recalculation step. The wizard model made the app a form-filling exercise
in service-drawn order (pick class, create, bind, roster, draw, open a round,
then per-cell queues) — that is the API's shape, not the organiser's. The
illusion only works when the sheet looks dumb and the orchestration is
invisible.

Decisions settled with the user 2026-09-17 (recorded in
`kanban/deferred-decisions.md`):

- **The orchestration stays client-side** — no NdcScore backend; the
  existing adoption/retry machinery (`queue.ts`) runs inside the Calculate
  orchestrator.
- **Correction reasons auto-fill**; the wire keeps `Reason`/`By` mandatory.

## Laws (violating any is a design error, not a style choice)

From `CLAUDE.md` as amended 2026-09-17 — note law 4 is now **Batch on
Calculate** (it replaced write-through). Laws 1–3 unchanged: no backend, no
score arithmetic in the client, no class-specific logic.

## Shared facts (read once)

- All wire facts, id serialisation, envelope/ProblemDetails handling, ordinal
  conventions (phase 0-based; round/task-round 1-based), the event-log
  rebuild path, and the class-definition shape facts carry over verbatim from
  `kanban/completed/single-form-contest-entry.md` *Shared facts*. The `Api`
  surface (`src/api/client.ts`) already covers the full endpoint inventory,
  including `findCompetitions`, `acceptDraw` and the amend/reopen verbs.
- **Drawn schedule is service truth.** After a draw exists, the fold's
  rounds/tasks/groups are authoritative; a sheet that disagrees with a drawn
  fold is an error surfaced to the organiser, never silently reconciled.
- **Committed values rebuild only from the event log**
  (`GET /competition-event-log?id=&includePayload=true` → `src/sheet/rebuild.ts`).
  Whether a cell needs capture (new), amend (overtype of a committed value),
  or nothing (unchanged) is decided against that rebuild — never guessed.
- `openEntry.alreadyOpen` and `openFlight.duplicateSequence` are adopt, not
  retry (existing `queue.ts` behaviour); `eventStore.concurrencyConflict`
  refetches the fold once then retries; network errors retry once.
- Amend/reopen/annul reasons: auto-filled `Corrected from scoresheet` (or the
  specific reopen/annul variants); `By` = the CD display name from the sheet
  header.

## Plan

### WI-1 — Sheet state: the whole page as one document

- `src/sheet/sheet.ts`: sheet state = header fields (class hash, contest
  name/location/date, CD display name, round count, per-round task choices,
  setup parameter text) + pilot rows (name, MFNZ #, optional email) + cell
  text keyed `r{round}|p{row}|f{seq}|{metric}` + the last run's report.
  Reducer + localStorage persistence (`ndcscore.sheet.v1`) restored on mount;
  nothing else is client state.
- Grid shape derives purely from the class definition + sheet inputs via
  `src/grid/schema.ts` (unchanged): per-round task grid = flight rows ×
  metric columns; `all`-without-maxLaunches stays dynamic (a row appears when
  the previous flight row for that pilot has text). Once a fold exists the
  drawn task per round overrides the sheet's guess.
- **Done when:** unit tests cover reducer transitions, persistence
  round-trip, dynamic flight-row growth, and the grid-derivation glue over
  both class fixtures (ALES 200 NDC, F3K NDC) with no class branches.

### WI-2 — Calculate orchestrator: one sheet → the whole command sequence

- `src/sheet/calculate.ts` — pure-ish async function `(api, sheet, progress)
  → report`; yields progress events per step for the UI.
- Sequence (every step idempotent, safe to re-run):
  1. Local validation: header complete, ≥1 named pilot, every non-blank cell
     parses (parse failures listed per cell, run refused).
  2. Find-or-create competition: `GET /competitions?onOrAfter=&classContentHash=`
     matched by name+date, else `POST /create-competition`.
  3. Bind unbound `CompetitionSetup` parameters from the header block.
  4. Find-or-register persons: `GET /people?name=` exact match first; else
     `POST /register-person` (placeholder email per the settled decision,
     MFNZ # → `Club.MembershipNumber`); email-duplicate 409 re-searches.
  5. Find-or-register competitors (409 already-registered adopts from fold).
  6. Draw when the fold has no drawn phase (`draw-phase` + `accept-draw`,
     task refs only for catalogue rounds); when already drawn, sheet
     round/task edits that disagree with the fold fail loudly — the drawn
     schedule wins.
  7. Capture: per task-round in the fold, rebuild committed cells from the
     event log, then for every filled sheet cell: unchanged → skip; changed
     → amend (auto reason; reopen first when the task-round is complete);
     new → capture. Chains run through the existing queue pump
     (`chainCommands` + `runOne`) with its adoption/retry behaviour.
  8. Complete task-rounds whose recording shows no gaps; gaps surface as
     warnings, refusals verbatim — never silently proceeded.
  9. Scores are *not* computed here — the results block re-reads
     `GET /task-round-result` + `GET /competition-result` verbatim (law 2).
- **Done when:** stubbed-api unit tests cover the full sequence, the
  adopt-everything re-run (second Calculate is a no-op), the correction
  re-run (capture → amend with auto reason, including reopen-then-amend on a
  completed round), and parse-error refusal — all without a live API.

### WI-3 — The single page

- `src/sheet/SheetPage.tsx` renders everything: header block, pilot table
  (add/remove rows freely), the full grid (one table, pilot rows, one column
  block per round with the round's task grid), the **Calculate** button with
  live progress + per-step warnings/errors, and the results section
  (per-task-round score tables + provisional standings reusing
  `src/scoring/*`). No staged navigation anywhere.
- Cells: plain inputs (flag columns render as checkboxes storing y/n);
  `whenNotRecorded` assumptions render as faint hints; committed/amended
  state and per-cell errors surface after a run.
- Penalties and annul move out of this story (deferred — see
  `deferred-decisions.md`); the wire support stays in the client.
- **Done when:** scripted against a live API — fresh run (create → register
  → draw → capture a full F3K NDC round with a false-start flag → complete →
  scores render), then an edit + recalculate amends with the auto reason and
  standings move; reload mid-evening restores the sheet text.

## Out of scope

- Penalties / annul UI on the sheet (deferred, wire support intact).
- Competitor sign-up, email sending, results export — existing backlog
  stories, unaffected.
- Sign-in / auth — unchanged (`Auth:Mode=none` trust model).

## Verification (whole story)

One scripted end-to-end pass against the seeded local Soarscore API: build a
sheet for F3K NDC (4 rounds, catalogue tasks), 3 pilots, capture a full round
including a false-start flag and an out-of-order flight; Calculate → scores
render; overtype one cell + add a pilot mid-grid; recalculate → amend
(+ reopen if completed) and new pilot registered; scores match curl. Then
`npm test`, `npm run lint`, `npm run build` green.

Board hygiene: when the story lands, `git mv` to `kanban/completed/` and
record residual debt in `kanban/tech-debt.md`.