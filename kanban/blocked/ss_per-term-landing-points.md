# SS Story — Per-term landing points on the wire: the client never computes awards

**Status:** Blocked (Soarscore-side; raised on the NdcScore board 2026-09-29
by owner direction, `ss_` prefix) · **Raised from:** the results-table
request for a landing-points column next to each raw mark capture column
(`src/sheet/ResultsTable.tsx`)

## What

Expose the landing term's awarded points over the API so NdcScore renders a
landing-points column **purely from the wire** — never by mapping readings to
points in client code (law 2). Shape to settle in SoarScore2; the requirement
is that at least the landing term's contribution is readable per scored unit,
verbatim, from the same functions scoring already resolves through.

## Why (single source of truth)

The class's landing table turns a mark's band into points; the engine composes
the terms. A client-side reading→points lookup is a second implementation of
that table: every conditional branch, rounding mode and normalisation step a
drift surface, with silent disagreement against the engine as the failure
mode. `GET /task-round-result` and `GET /competition-result` today carry only
task-level totals per competitor (`rawScore`, `preNormalisationScore`) — there
is no landing-points value to read, so the column cannot be built without
computing. The breakdown keeps one source of truth: the engine awards, the
client renders.

## Proposed shape notes (Soarscore to settle)

- NdcScore's need is the landing term's points **per flight**, to sit beside
  each mark cell in the round block (`ResultsTable.tsx` renders per-flight
  sheet text + one task-round raw score). A per-(competitor, task-round)
  landing subtotal is a usable fallback if per-flight is disproportionate —
  state which granularity ships.
- Identify the term by the metric it consumes (`metricRef: landingDistance`
  on the lookup/rate/piecewise term), not by position: term order is an
  engine detail the client must never index into (law 3 — no per-class
  branching, no class-name checks).
- Values render verbatim (`Verbatim` in `src/scoring/ScoreTable.tsx` —
  `String(value)`, no arithmetic, no formatting). `NoResult` stays `NoResult`;
  a missed landing is absence, never zero.
- Multi-flight rows (F3K/F5K `all`): each flight's landing term value is its
  own cell; aggregation across flights stays server-side.

## Design questions to settle in Soarscore

- Extend the existing result views (`GroupScore`/`CompetitorTaskResult`) with
  a per-term breakdown, or a new read (e.g. `GET /task-round-term-results`)?
- Per-flight granularity, or per-(competitor, task-round) subtotal only?
- Does the breakdown cover every score term or only the landing term?
  (Landing-only is allowed; everything is not required.)

## NdcScore's part once it lands

The results table adds one column per landing column rendering the term value
verbatim next to the echoed mark text (off-tape `0` shows the engine's zero,
never a client-mapped one). No reading→points mapping enters client code;
`mandatory-tape-choice.md` laws 2/3 hold unchanged.

## Blocking note

This story blocks **only** the landing-points column. The results table as it
stands (echoed marks + verbatim raw score + totals) ships without it. Do not
hold any capture, declaration or scoring work for this breakdown.

## Acceptance

- [ ] NdcScore can render, beside each captured landing mark, the landing
  points the engine awarded for that flight (or task-round), from wire reads
  alone — with zero award arithmetic in client code.
- [ ] Every rendered value equals what the engine's own scoring resolved
  (conditionals, rounding, normalisation included) — no silent mismatch
  between the points column and the raw-score/total columns.
