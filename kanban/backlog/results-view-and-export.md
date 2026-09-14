# Story — Results view and copy-for-email export

**Status:** Backlog stub · **Raised:** 2026-09-14

## What

After `POST /finalise-competition`, a results view over
`GET /competition-result` (class-aware: normalised ×1000 where the class says
so, raw sums for N/P/M-NDC), with a **"copy for email"** button producing a
plain-text results table for pasting into the organiser's mail client.

## Why it matters

The evening workflow ends with emailing competitors. Email *sending* is
deliberately out of MVP (see `email-results.md` stub and
`deferred-decisions.md`); the results view plus copyable text is the minimum
that replaces the spreadsheet's results step without any mail configuration.

## Before starting

- Score-shape per class comes from the adopted definition via the engine — the
  view renders whatever `CompetitionScoreView` carries; no per-class ranking
  logic in the client (same law as the entry grid).
- Check `GET /competition-pending-tie-breaks` — finalisation can leave
  tie-breaks pending (`POST /record-tie-break-outcome` resolves them); the
  view should surface that state rather than render a misleading table.

## Plan

- **WI-1** — Results view wired to `/competition-result`, including
  provisional (pre-finalisation) standings for a quick mid-evening check.
- **WI-2** — Copy-for-email: deterministic plain-text rendering of the
  standings; copy button + download-as-.txt fallback.
