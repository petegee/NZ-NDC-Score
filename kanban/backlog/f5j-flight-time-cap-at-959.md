# Story — F5J: flight time capped at 9:59 (600 s means the model never landed)

**Status:** Backlog stub · **Raised:** 2026-09-23 (user feedback)

## What

F5J feedback: the recorded flight time should cap at **9:59**, not 10:00 — a
600 s flight means the model flew away and never landed, so a sheet showing
600 s together with landing points is an impossible state.

Feedback verbatim:

> "F5J, may be best to cap at 9:59 instead of 10:00"
> "That is, a 600 sec flight results in a zero landing."

## Why it matters

Same ambiguity family as `landing-zero-means-no-landing-points.md`: the paper
convention ("600 means flyaway") vs the metric convention ("600.00 s is a
legal reading"). If 600 s is capturable today alongside a landing distance,
the engine will score maximum flight time *and* whatever landing was entered —
a state the rulebook does not allow.

## Soarscore involvement

Where the cap belongs — class-definition data (an allowed range or cap on the
flight-time metric), an engine capture validation, or a scoring interpretation
(600 s ⇒ zero landing rather than reject) — is a Soarscore-side question.
NdcScore renders validation from the definition/engine verbatim: no
class-specific client logic (law 3), no client arithmetic (law 2). **Do not
add anything to the Soarscore backlog from this repo** — raise there when
scheduled.

## Before starting

- How does the F5J class definition score the flight-time metric today, and
  what does the engine currently do with a captured 600.00 s + a landing
  distance? (Trace one capture end to end.)
- The `fai-rules` skill in the SoarScore2 repo — the exact F5J flight-cap and
  landing interplay wording (is 600.00 s a legal *time* at all, or is the max
  awarded time 599.99 s by rule?).
- Decide reject-vs-reinterpret with the organiser: is a 600 s entry refused,
  clamped, or accepted as "zero landing"?
- Cross-reference `landing-zero-means-no-landing-points.md` — the two stories
  may share one design answer about flyaway encoding.
