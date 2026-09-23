# SS Story — Extend a drawn fold by more rounds

**Status:** Blocked (Soarscore-side; raised on the NdcScore board 2026-09-23
by user instruction, `ss_` prefix) · **Raised from:**
`kanban/completed/add-pilots-and-rounds-after-calculate.md` user feedback

## What

A Soarscore verb to **draw additional rounds onto an existing (accepted)
phase fold** — "the CD adds a round after the first calculate" — without
touching the rounds already flown.

Verified wire facts (SoarScore2, 2026-09-23):

- No extension verb exists (`Soarscore.Api/Commands/Commands.cs` inventory).
- A second `POST /draw-phase` refuses `drawPhase.alreadyDrawn` ("A phase has
  already been drawn for this competition.").
- `POST /prescribe-draw` replaces the phase wholesale and requires the CD to
  specify every round's complete group membership — not an extension, and
  unsafe to re-derive from a scoresheet.
- `POST /reject-draw` (remove phase, draw afresh) is refused once entries
  exist (`rejectDraw.entriesExist`) — unreachable after any capture.

## Why it matters

NdcScore feedback verbatim: "I just cannot add pilots or change the number of
rounds once I click Calculate." The client now absorbs the mismatch with a
loud warning ("Round(s) N–M are not drawn — extending a drawn fold needs a
Soarscore capability that does not exist yet; their cells are skipped") and
keeps processing the drawn rounds — but the extra rounds cannot exist until
Soarscore grows the capability.

## Design questions to settle in Soarscore

- Event shape: a `RoundsDrawn`-style fold-extension event vs replacing the
  phase (the event-log rebuild path and `Phases`-holds-only-live-phases
  decision D2 both lean one way or the other).
- Task selection for the new rounds: catalogue picks and `PerRound` parameter
  bindings must scope to the new ordinals only.
- Group formation for the new rounds only: the existing field (minus
  withdrawals?) re-grouped per `MinPerGroup`, protected pairs carried forward.
- Shrink is explicitly **out of scope**: removing drawn rounds is annul
  territory (`annul-task-round` exists); a shrink request stays a client-side
  warning.

## NdcScore's part once it lands

The orchestrator's draw step already diffs sheet-vs-fold and warns; on a
grow mismatch it would call the new verb for the extra rounds (with the
sheet's catalogue picks), refetch the fold, and let the existing capture loop
visit the new task-rounds. Shrink keeps warning. No other change expected.
