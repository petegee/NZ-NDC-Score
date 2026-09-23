# SS Story — Late registration onto an accepted draw

**Status:** Blocked (Soarscore-side; raised on the NdcScore board 2026-09-23
by user instruction, `ss_` prefix) · **Raised from:**
`kanban/completed/add-pilots-and-rounds-after-calculate.md` user feedback

## What

A Soarscore capability to register a competitor **after the draw has been
accepted** — the "competitor arrives late" evening reality — plus the group
re-formation it implies.

Verified wire facts (SoarScore2, 2026-09-23):

- `POST /register-competitor` refuses with `competition.field.frozen`
  ("The field is frozen: the draw has been accepted.") once any phase's draw
  status is `accepted` — `Competition.cs` `ValidateFieldNotFrozen`.
- The only reopen path today is `POST /reject-draw`, which removes the phase
  (reopening registration) but is refused once entries exist
  (`rejectDraw.entriesExist`) — so after a single capture it is unreachable.
- NdcScore's first Calculate draws **and accepts** immediately (capturing
  needs an accepted draw), so every post-first-Calculate registration is past
  the freeze.

## Why it matters

NdcScore feedback verbatim: "if I enter a competitor and click calculate,
then it will not accept additional input." The client now absorbs the refusal
(warn per pilot, count their skipped cells, keep the evening moving) — but the
late pilot still cannot fly until Soarscore allows the registration.

## Design questions to settle in Soarscore

- Does a late competitor slot into an **already-drawn round's** groups, or
  only fly from the next round? (NdcScore's open question from the source
  story.)
- How do groups re-form — F3K's min group size 5, protected pairs, and the
  event-log rebuild path all interact. Is a *group amendment* event needed, or
  a fold extension of `DrawPhase`?
- Interaction with `maxLaunches`/recordedness gates and `TaskRoundRecording`
  expected-competitor lists once a newcomer lands mid-round.
- Freeze semantics: is the freeze at *acceptance* the right line, or should
  the field freeze at first entry (acceptance already gates entries)?

## NdcScore's part once it lands

The client already: registers the person, adopts `competition.field.frozen`
without aborting, and keeps the pilot's cells as uncommitted sheet text.
Once registration succeeds post-acceptance, the capture loop needs only to
treat a newly-registered competitor like any other (their cells then capture
or warn `not drawn into this round` per group membership) — no orchestration
change expected beyond removing the special-case messaging.
