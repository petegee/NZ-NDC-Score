# Story — A 0 entered on landing means zero landing points, not a 0 m landing

**Status:** Backlog stub · **Raised:** 2026-09-23 (user feedback)

## What

On the paper scoresheet, an organiser writes **0** in the landing cell to mean
"zero landing score" — the model landed beyond the tape. The app/engine must
score an entered 0 as if the model landed **past the class's maximum tape
distance** (e.g. >10 m, >15 m depending on class), i.e. no landing points.
Leaving the landing cell **blank** stays "no result" (current behaviour,
accepted). Today an entered 0 is read as a 0 m landing — the *best possible*
landing points — which is the opposite of the organiser's intent.

Feedback verbatim:

> "I might suggest that a zero entry on the landing is for a zero landing
> score. If I leave the landing distance blank, the raw score is 'no result'"

> "Back to landing, I think it would be best with an entered zero being scored
> as a >10m (or 15m depending on class). To be stupid pedantic, it is
> impossible to get an exact 0m landing. There will always be a small delta..."

## Why it matters

First real-use feedback. The scoresheet convention (0 = flyaway / beyond
tape) collides with the metric convention (0 m = dead on the tape), and the
current interpretation silently awards the organiser's 0 the *highest*
landing score. Pedantic point preserved because it is the justification: an
exact 0 m reading is physically impossible — there is always a delta — so
treating 0 as "beyond tape" loses nothing real and matches what paper-takers
mean.

## Soarscore involvement

The landing interpretation lives engine-side (how `landingDistance` becomes
landing score); NdcScore only posts the entered text. **No entry will be
added to the Soarscore backlog from this repo** — when this story is
scheduled, raise the Soarscore-side work there. Likely a change to the
published class definitions' landing award bands (the scoring vocabulary's
band/lookup machinery) or the engine's landing-metric interpretation; the
"depends on class" (>10 m vs >15 m) suggests definition data, not a constant.

## Before starting

- Verify exactly where "0 = 0 m" happens today: class-definition landing
  awards vs engine interpretation (trace one captured 0 end to end).
- Decide whether the rule generalises ("entered 0 = beyond max tape") across
  every class with a landing metric or is per-class definition data — the
  client must never branch per class either way (law 3).
- NdcScore's part is likely nil beyond possibly a faint cell hint; confirm no
  client parse layer mangles a bare "0".

## Open questions

- Should a *negative* or sub-1 m entered value be warned about the same way?
- Does any other metric have the same "0 means something else on paper"
  ambiguity (cross-check with `f5j-flight-time-cap-at-959.md`, same family)?
