# NdcScore — NDC contest entry and scoring for NZ glider organisers

A small web app for **NZMAA National Decentralised Contest (NDC)** organisers:
capture the day's paper scoresheet into one form in the evening, get correct
scores back from the [Soarscore](https://github.com/pete/Source/SoarScore2)
service, and hand the results to competitors.

It replaces the evening half of `Soaring_NDC_Scoresheet_v3.xlsm` — the
data-entry and formula drift — with a single web form. The field tool stays
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
- **No score arithmetic in the client.** Every score, total, rank and
  normalisation comes from the service; the grid's own shape comes from the
  adopted class definition. The client captures.
- **One contest = one immutable event log** in the Soarscore store — the
  audit trail behind every number on the results page.

See `kanban/backlog/single-form-contest-entry.md` for the build plan.

## Running (once stories land)

1. Soarscore API: from the SoarScore2 repo, `dotnet run --project
   src/Soarscore.Api` (SQLite by default, no Docker needed).
2. NdcScore: `npm install && npm run dev`, point it at the API
   (`VITE_API_BASE=http://localhost:<port>`).

## Board

`kanban/` — backlog / in-progress / blocked / completed, plus
`tech-debt.md` and `deferred-decisions.md`. One story = one markdown file;
the lane folder is the truth. Conventions match the Soarscore board.
