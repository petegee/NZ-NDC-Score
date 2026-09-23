# Story — Add pilots and change rounds after Calculate

**Status:** Backlog stub · **Raised:** 2026-09-23 (user feedback)

## What

After the first **Calculate**, the sheet accepts overtype-and-recalculate of
captured values (amends work), but refuses two things the organiser expects to
do freely: **adding a pilot** and **changing the number of rounds**. The
orchestrator should absorb both the way it absorbs corrections: re-running the
idempotent sequence with a new pilot row registers/registers-competitors and
captures their cells; a larger round count draws the extra task-rounds.

Feedback verbatim:

> "Another wee bit is that if I enter a competitor and click calculate, then
> it will not accept additional input."

> "I see now that I can amend scores that are already submitted. I just cannot
> add pilots or change the number of rounds once I click Calculate"

**Recorded alternative** (its own feedback item; per decision 2026-09-23 this
is *noted*, not pursued — it would sit in tension with law 4's batch model):

> "An alternate is to have scores being shown when entered, and only submitted
> after the submitter approves the calculated scores."

If the lock-out proves intractable to lift, revisit the approve-gate as the
fallback design; otherwise leave it here as history.

## Why it matters

Evening reality: a competitor arrives late or the organiser adds a round after
the first calculate. Today that dead-ends into creating a second competition
or hand-editing around the lock. The xlsm illusion (type anywhere, one
button) should not end the moment the button is pressed once.

## Soarscore involvement

Both asks collide with "drawn schedule is service truth"
(`single-sheet-calculate.md` shared facts) and tech-debt's "sheet-vs-draw
conflict is fatal, not a guided fix":

- **Adding a competitor to an accepted draw** — does the wire support adding
  an entry post-draw, and how do groups re-form (F3K min group size 5)?
  Verify against the fold/event-log behaviour; may need Soarscore support.
- **Extending a drawn fold by more rounds** — no "draw more rounds" verb is
  known today (`Routing/EndpointRouteBuilderExtensions.cs`); likely needs a
  Soarscore capability. **Do not add anything to the Soarscore backlog from
  this repo** — raise there when scheduled.

## Before starting

- Reproduce precisely what refuses today: fresh comp → 1 pilot → Calculate →
  add pilot row → Calculate; then same with a round-count bump. Client
  refusal, validation refusal, or API error?
- Read `single-sheet-calculate.md` WI-2 — identify which steps refuse when the
  fold already exists (draw step: `openEntry.alreadyOpen` adopts;
  `accept-draw`; per-round completeness).
- Decide the round-growth rule: growing rounds re-draws only the *new* rounds
  (fold extension), shrinking rounds is refused (annul territory).

## Open questions

- Should a mid-evening added pilot be slotted into an already-drawn round, or
  only fly from the next round?
- Does the approve-gate alternative deserve its own deferred-decisions entry?
