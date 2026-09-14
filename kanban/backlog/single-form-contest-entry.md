# Story — Single-form contest entry (the SPA core)

**Status:** Backlog stub · **Raised:** 2026-09-14

## What

The whole product: a React/TS single-page app that renders **one form shaped
like the paper NDC scoresheet** — contest header (class, name, date, venue,
CD, tape binding), pilot rows (name + MFNZ #), and a round grid whose columns
are generated from the adopted class definition — writes every committed cell
through to the Soarscore API as it goes, and reads scores back from the
service. NdcScore is a pure web client of the Soarscore API: **no backend of
its own, ever** (deferred-decisions.md).

The counterpart Soarscore change (CORS) is already built: SoarScore2 branch
`api-cors`, `kanban/completed/cors-for-ndcscore-spa.md`.

## Why it matters

NDC organisers capture results on paper during the day and score them at home
in the evening, today via `Soaring_NDC_Scoresheet_v3.xlsm`. The workbook
drifts (sheet names diverge from contents; landing-tape selector variants
duplicated as whole sheets) and embeds per-row formulas nobody should re-derive.
Every class the workbook covers — ALES 123 (N), ALES 200 (M + its NDC format),
Radian (P), X5J, F3K NDC tasks B/D/G/H, F5J/F5K NDC — already exists as a
published Soarscore seed definition, so the app adds only capture and display.

## Core constraint (law, not preference)

**No score arithmetic in the client, ever.** Round score, total, ranking and
normalisation come only from `GET /task-round-result` and
`GET /competition-result`. The client's only job is capture. Likewise the grid
schema (which columns exist: min:sec / landing / height / F3K task-flight
groups) is generated from `GET /class-definition` for the chosen class — never
hard-coded per class in the client.

## Before starting

- Read the wire protocol before writing the client:
  `SoarScore2/src/Soarscore.Api/Routing/EndpointRouteBuilderExtensions.cs` —
  commands `POST /<kebab-verb>` (JSON body), queries `GET /<kebab-noun>`
  (`[AsParameters]` from query string); success returns the bare value or
  `{value, warnings}`; failure is RFC 9457 ProblemDetails with the stable code
  in `title` (404 `*.notFound`, 409 store conflicts, 400 everything else). The
  TS client maps those to grid-cell error states.
- Map the capture lifecycle precisely before building the grid:
  `POST /open-entry` → `POST /open-flight` → `POST /capture-measurement` per
  metric, amends via `POST /amend-measurement`. The executable spec for the
  sequence is the Soarscore BDD suite
  (`SoarScore2/tests/Soarscore.Acceptance.Tests/Features/CapturingAScore.feature`).
  Note `GET /people` requires `?email=` or `?name=` (400 otherwise) — pilot
  autocomplete must always carry criteria.
- The app is config-driven for the API base URL (`VITE_API_BASE` or similar);
  no other environment surface in the MVP.

## Plan

- **WI-1** — Repo scaffold: Vite + React + TypeScript, TS client **generated
  from `/openapi/v1.json`** (the API already serves it), wire-protocol wrapper
  (envelope unwrap, `{value, warnings}` surfacing, ProblemDetails → cell
  errors), typed per-endpoint functions for the verbs below.
- **WI-2** — Contest header + class picker: `GET /class-definitions` for the
  list (the NZ NDC classes), `GET /class-definition` for the adopted shape;
  grid schema derived from the definition (rounds × metrics; F3K NDC renders
  tasks B/D/G/H flight groups; X5J adds height). CD-announced target time
  (Class M) and tape choice become `POST /bind-parameter` bindings at setup.
- **WI-3** — Pilot rows: autocomplete against `GET /people?name=<typed>`;
  unknown name → `POST /register-person` then `POST /register-competitor`.
  MFNZ number stored with the competitor.
- **WI-4** — Round grid cells: min:sec parsed to seconds, landing distance,
  flags (motor restart, 75 m) as the definition declares them. Commit =
  write-through `POST /capture-measurement` (debounced per cell), edit =
  `POST /amend-measurement`. Uncommitted text is the only client-local state
  (localStorage); everything committed survives reload — resume a half-entered
  contest from `GET /competitions` + `GET /entries`.
- **WI-5** — Session orchestrator: the create→enter→finish sequence as one
  reducer, command queue with per-cell retry/error state; `POST
  /complete-task-round` per round; **invariant pinned by a test: no code path
  computes a score client-side**.
- **WI-6** — Score read-back: score columns/rows poll or refetch `GET
  /task-round-result` after commits; warnings from the envelope surface inline
  (should-level minima warn-don't-refuse).

Property-based note: the candidate property here is the **orchestrator
reducer** — "replaying any command sequence the reducer accepted produces the
same queued command list" — if it earns its keep once WI-5's shape exists;
example-based tests may prove enough.
