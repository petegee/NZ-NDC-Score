# NdcScore — NDC contest entry and scoring for NZ glider organisers

A small web app for **NZMAA National Decentralised Contest (NDC)** organisers:
capture the day's paper scoresheet into one spreadsheet-like page in the
evening — free entry in any cell, any time — press **Calculate**, and get
correct scores back from the
[Soarscore](https://github.com/pete/Source/SoarScore2) service. Corrections
are just overtyped and recalculated; the organiser is never asked for a
reason.

It replaces the evening half of `Soaring_NDC_Scoresheet_v3.xlsm` — the
data-entry and formula drift — with a single web sheet. The field tool stays
paper.

## Architecture

```
NdcScore SPA (React/TS, this repo)
    │  HTTP — commands POST /<verb>, queries GET /<noun>
    ▼
Soarscore API (SoarScore2 repo) ──► SQLite (home) / Postgres (hosted)
```

- **No NdcScore backend.** The SPA is a pure client of the Soarscore API;
  CORS is configured on the service (`SOARSCORE_CORS_ORIGINS`).
- **Batch on Calculate.** The sheet is uncommitted text until **Calculate**,
  which submits the whole sheet: the client orchestrates the full command
  sequence invisibly (find-or-create competition → bind → find-or-register
  pilots → draw → open entry/flight → capture or amend → complete task-rounds
  → read scores). Corrections are amends with an auto-filled reason.
- **No score arithmetic in the client.** Every score, total, rank and
  normalisation comes from the service; the grid's own shape comes from the
  adopted class definition. The client captures.
- **One contest = one immutable event log** in the Soarscore store — the
  audit trail behind every number on the results page.

See `kanban/completed/single-sheet-calculate.md` for what landed (the
spreadsheet + Calculate redesign) and
`kanban/completed/single-form-contest-entry.md` for the original build and
the verified wire facts.

## Running

1. Soarscore API: from the SoarScore2 repo,
   ```
   ASPNETCORE_ENVIRONMENT=Development \
   SOARSCORE_CORS_ORIGINS=http://localhost:5173 \
   Soarscore__SeedCorpusDirectory=$PWD/tools/Soarscore.SeedData/json \
     dotnet run --no-launch-profile --project src/Soarscore.Api
   ```
   (Development allows `Auth:Mode=none`; the seed corpus publishes the class
   definitions, including the NDC formats.)
2. NdcScore: `npm install`, copy `.env.example` to `.env` with
   `VITE_API_BASE=http://localhost:5000` (the API's port), then `npm run dev`.
3. Checks: `npm test` (unit), `npm run lint`, `npm run build`,
   `npm run smoke` (round-trips a running API), and
   `npm run test:live` for the scripted live-API flows.

## Deploy

Same CI/CD shape as Soarscore (`build-and-test.yml`): push/PR to `master` runs
lint, build and test; pushes additionally deploy to Fly.io. One-time setup:

1. `fly apps create ndcscore` (adjust `app` in `fly.toml` if you chose a
   generated name).
2. Add the `FLY_IO_DEPLOY_TOKEN` secret to this repo (`fly tokens deploy`).
3. Tell the service to allow this origin: `SOARSCORE_CORS_ORIGINS` on the
   Soarscore deployment must include `https://ndcscore.fly.dev`.

`VITE_API_BASE` is baked at build time from the `[build.args]` in `fly.toml`.

## Board

`kanban/` — backlog / in-progress / blocked / completed, plus
`tech-debt.md` and `deferred-decisions.md`. One story = one markdown file;
the lane folder is the truth. Conventions match the Soarscore board.
