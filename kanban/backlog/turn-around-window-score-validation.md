# Story — Turn-around score caps and window-sum validation

**Status:** Backlog stub · **Raised:** 2026-09-23 (user feedback)

## What

Two score-sanity rules requested after an F3K evening, with the organiser
explicitly wondering whether they generalise beyond F3K:

1. **Max raw score on turn-around tasks** — the window time in seconds minus
   the number of flights. Verbatim: "Scores should have a maximum on
   turn-around tasks that is the window time in seconds minus number of
   flights. For example, task D (2 five minute flights) should have a maximum
   raw score of 598."
2. **Flag rounds that sum to the window** — verbatim: "I am wondering as to
   whether you should flag as invalid any round scores that sum up to the
   window time or greater. This may apply to more than F3K."

## Why it matters

Physically impossible scores (a pilot cannot fly 598 s of flying inside a
600 s window twice) can currently be captured and normalised silently —
skewing the whole round before anyone notices at finalisation. This is the
engine's job: the client must never compute or second-guess a score (law 2);
it can only surface what the engine says.

## Soarscore involvement

**Both rules are Soarscore-side** (scoring engine and/or published class
definitions). NdcScore's part is only to render warnings/refusals verbatim
once the engine produces them. **Do not add anything to the Soarscore backlog
from this repo** — raise the Soarscore-side work in the Soarscore repo when
this story is scheduled.

Design questions to settle there (recorded here so they are not lost):

- Is the turn-around cap already expressible in the existing scoring
  vocabulary (`ScoreTerm.Cap` / `CapScope`, `ClassDefinition.cs:212-221`) —
  i.e. class-definition *data* rather than new engine code?
- For the window-sum check: warn-through (SHOULD-level, the `shouldMinima`
  warning machinery) or refuse (SHALL)? The organiser said "flag as invalid"
  — refusal is the stronger reading, but warn-through keeps an evening moving.
- Scope: turn-around task kinds only, or every task whose window is declared?

## Before starting

- The `fai-rules` skill in the SoarScore2 repo — what the rulebook actually
  says about flight caps and window sums before inventing arithmetic.
- Read the engine's scoring pipeline for where a per-round sum check would
  live, and how a refusal vs warning would travel to
  `POST /complete-task-round` (the client already surfaces warnings verbatim).
- Confirm the client's only change: render the new warning/refusal codes (and
  a results-block flag) — no new client arithmetic.
