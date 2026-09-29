# Story — Mandatory tape choice: every contest declares points-tape or tape-measure up front

**Status:** Superseded 2026-09-29 by the provisional 2-tape MVP (owner direction):
`src/sheet/tapes.ts` (verbatim `tape-nz-f3j-side.json` + `tape-measure.json`,
F3J default; distances-only removed 2026-09-29 — tape-measure is Reading == UpTo
identity, so functionally identical for NZ NDC) · **Wire follow-up:**
`kanban/blocked/ss_tape-catalogue-on-the-wire.md` (still blocked, SoarScore-side)
· **Raised:** 2026-09-29 (owner direction via
`HANDOVER-landing-zero-flyaway-tape.md` §6) · **Supersedes:**
`kanban/deferred-decisions.md` "Landing-tape instruments are out of MVP"
(2026-09-17 — see §Supersession below)

## What

NdcScore forces an up-front choice for every contest — a **points tape**
(one of the named tapes) or the **distance tape** ("tape-measure", backed by
SoarScore2's new `tape-measure.json` scale) — **mandatory, never defaulting
to distance**. The record always says how a landing was measured. The empty
declaration (today's silent "distances only" default) stops being reachable
through the NdcScore flow.

Owner direction verbatim (handover §6): mandatory choice per contest — named
points tape or tape-measure — never defaulting to distance.

## Why it matters

The asymmetry that motivates the work: real Christchurch-2019 field data
shows ~15% of landings recorded as tape-mark 0 (off tape). On today's
distance path those would score maximum points (entered 0 reads as a 0 m
landing — the best band — until the landing-zero definition fix ships; and
even after it, a tape-measured landing entered as a distance is the wrong
provenance for the record). The tape path already has the right semantics —
points-tape reading 0 via the existing `OffScaleReading`, tape-measure 0.0
via off-scale — but NdcScore never declares an instrument, so no contest ever
reaches it. The choice gate is what connects the field reality to the engine
machinery.

## Scope

- **Setup-flow placement + sheet-entry gating.** Where the choice lives in
  the contest-setup flow (contest creation, before the first Calculate) and
  how it gates sheet entry: the sheet must not accept landing input until a
  tape is chosen. No default selection, no "skip for now defaults to
  distance" — an unchosen contest has a visibly unmeasured landing column,
  not a distance column. Decide the exact placement against the current setup
  flow (contest creation → class pick → Calculate); the story's acceptance is
  the gating property, not the widget position.
- **Declared tape reaches capture as the measurement's instrument.** The
  chosen tape is declared via the existing `POST /declare-instruments`
  (`src/api/client.ts` `declareInstruments`, `src/api/types.ts`
  `DeclaredInstrument`) and then flows into every landing capture as the
  measurement's `instrument` (`CaptureMeasurementInput.instrument`,
  `AmendMeasurementInput.instrument`) — the same field, carried on amends as
  well as first captures. Declaration-time composition is the loud gate:
  a non-composing tape is refused by the engine at declaration
  ("that side of the tape cannot score this class" —
  `Competition.ValidateInstrumentSet`), never silently degraded.
- **Landing column switches to mark mode.** Once a tape is declared, the
  landing column stops being free numeric entry and becomes a picker over
  the declared scale's **reading set** (`ReadingScale.readingSet` in the
  wire schema: each mark's reading plus the off-scale reading when it has
  one). The server enforces exact reading membership
  (`captureMeasurement.readingNotOnScale` — "a reading is an exact member
  of the named tape's reading set"; `Entry.cs` ~lines 409–427), so free text
  bounces: the picker is not a convenience, it is the only input shape that
  can pass. The **off-tape reading is one tap** — the Christchurch-2019
  ~15% case must be the easiest entry on the sheet, not a typed 0.
- **Laws 2/3 bind.** No score arithmetic in the client (law 2): the picker
  shows readings, never points — awards are the engine's composed rows. No
  per-class branching (law 3): the picker renders whatever reading set the
  declared tape carries; class names never appear in the choice or capture
  code.

## What can ship without the catalogue (choice gate is NOT blocked)

The choice gate — setup placement, gating, declare call, instrument
plumbing, distance-vs-mark column modes — ships against **transcribed**
scales: the client already has the `DeclaredInstrument` types and the
`declare-instruments` call, and the declaration's `scale` field is just data
the client posts. What is blocked on the SoarScore2 catalogue story
(`kanban/blocked/ss_tape-catalogue-on-the-wire.md`) is only the **picker
rendered purely from the wire**: without a catalogue endpoint the client
would have to transcribe tape marks by hand, which is exactly the
double-transcription the seed tool exists to prevent. Ship the gate first
with a minimal local scale source if needed; swap the source to the wire
when the catalogue lands. Never ship a hand-transcribed tape-measure scale
as if it were authoritative — mark it provisional or hold the mark-mode
picker until the wire is the source.

## Open questions

1. **Client-only gate (default) vs per-competition server capture policy.**
   Default assumption: the mandatory choice is an NdcScore-only gate and
   SoarScore2 supplies only the instrument (the `tape-measure.json` scale)
   — no engine/capture change. The server mechanism for enforcement exists
   (`ConfigureCapturePolicy` in the wire schema) if it is ever wanted, but
   that is explicitly **not this work**. Settle with the owner only if
   field experience shows organisers bypassing the gate.
2. **Fixture mirror for `tape-measure.json`?** No `tapes/` dir exists under
   `src/test/fixtures/` today; the 4 class fixtures were enough until now.
   Decide based on how fixture class definitions flow through
   `fake-soarscore.ts` / `classes.ts`: if the fake serves class definitions
   from the mirrored fixtures and mark-mode tests need a scale, mirror
   `tape-measure.json` (format-preserving, `version` lines kept per handover
   §5 discipline); if the catalogue story puts scales inside
   `GET /class-definition`, the class fixtures may carry what tests need and
   no mirror is required. Do not mirror speculatively — decide when the
   first mark-mode test needs a scale.
3. **Correcting the choice.** A first declaration is declared; every change
   after is a correction (`correct-instrument-declaration`, reason required
   — the wire keeps the split, cf. the correction-reasons deferred
   decision). Decide what the setup UI offers after the first Calculate:
   re-choice affordance, and what happens to already-captured readings when
   the tape changes (they keep their recorded instrument — capture-time
   truth — so a re-declare does not rewrite history; state this in the UI
   or refuse re-choice after capture — owner call).

## Must NOT do (tape-path semantics are settled)

Per SoarScore2 `kanban/deferred-decisions.md` (exact-zero convention entry):
the tape path keeps physical first-band semantics; the engine zero-branch
is declined. This story must not propose "fixing" the tape path (no
exact-zero carve-out in composed scales, no first-band award change) and
must not drop the convention row to reunify the paths. Zero means zero on
every real capture path already: direct entry via the `{0, 0}` row,
points-tape reading 0 via `OffScaleReading`, tape-measure 0.0 via
off-scale. If anything in that chain behaves differently through the
client, escalate with request/response evidence (handover §7) — do not work
around it client-side (laws 2/3).

## Acceptance

- [ ] Creating a contest without choosing a tape leaves landing entry
   gated — no distance default, no silent empty declaration through this
   flow.
- [ ] Choosing a tape declares it via `POST /declare-instruments`; a
   non-composing tape surfaces the engine's refusal verbatim
   ("that side of the tape cannot score this class").
- [ ] Every landing capture/amend carries the declared tape as
   `instrument`; the landing column renders a reading-set picker (source:
   wire catalogue once `ss_tape-catalogue-on-the-wire.md` lands,
   provisional local source before) with the off-tape reading as one tap.
- [ ] Full `vitest run` green; laws 2/3 hold (no reading→points mapping,
   no class-name branch anywhere in the new code).

## Supersession

This story supersedes `kanban/deferred-decisions.md` "Landing-tape
instruments are out of MVP" (2026-09-17: "MVP declares no instruments …
a scale editor adds up-front configuration to the night-one flow for
little capture gain"). The owner direction reverses the call: the ~15%
off-tape field rate plus the distance-path 0-scores-maximum asymmetry make
the choice load-bearing, not configuration. The deferred entry stays as
history; where the two disagree, this story wins. The companion reasons
untouched: correction reasons still auto-filled, not typed.
