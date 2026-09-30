# SS Story — Catalogue on the wire: the client never transcribes tapes

**Status:** Abandoned 2026-09-30 (owner direction — no longer needed at this
stage; moved from `kanban/blocked/` via `git mv`, `abandoned/` lane created
for this story) · **Was:** Blocked (Soarscore-side; raised on the NdcScore
board 2026-09-29 by owner direction, `ss_` prefix) · **Raised from:** the
mandatory tape-choice UI (`kanban/backlog/mandatory-tape-choice.md`), which
needs the picker source

## What

Expose the tape catalogue over the API so NdcScore renders its mandatory
tape choice and its mark-mode landing picker **purely from the wire** —
never by transcribing tape marks into client code. Two shape options; pick
one in SoarScore2:

1. **`GET /tape-catalogue`** — the whole catalogue (names, units, marks,
   off-scale readings; the `TapeCorpus` the seed tool already counts:
   `ExpectedCount = 4` after the tape-measure story) as a standalone read.
2. **Instruments-that-can-score-this-class inside `GET /class-definition`**
   — the catalogue pre-filtered through `TapeComposition.Compose` against
   this class's landing tables, so the client offers exactly the tapes whose
   declaration would pass the declaration-time gate (plus the loud refusal
   for anything else, which stays server-side regardless).

Either may be complemented by the other; the requirement is that at least
one exists. `ClassDefinition` on the wire today carries no tape surface at
all (name/designation/version/parameters/reflight/penalties/phases only),
and the client has no tape source — the gap is total, not a refinement.

## Why (single source of truth)

The seed tool (`tools/Soarscore.SeedData`, `TapeCorpus`) exists so tape
scales are authored once and emitted as data. A hand-transcribed scale in
the client is a second authoring: every mark a drift surface, every
off-scale reading a guess, with the declaration-time composition gate as
the only backstop — and that gate refuses loudly at declaration time, i.e.
after the organiser has already chosen. The catalogue endpoint keeps one
source of truth: the client renders what the server publishes, the server
refuses what cannot compose, and the two can never disagree about what a
tape contains. This is the double-transcription the seed tool exists to
prevent, stated as a wire requirement.

## Proposed shape notes (Soarscore to settle)

- Each catalogue entry needs at minimum: tape name (the `instrument` string
  declarations bind), unit (composition refuses on mismatch —
  `tapeComposition.unitMismatch`), full marks (`upTo`/`reading` pairs; the
  tape-measure scale is 1500 cm marks 0.01–15.00 m, Reading == UpTo, first
  mark above 0) and the off-scale reading (0 for the points tapes and the
  tape-measure; null where the instrument has none — the catalogue stays
  nullable where the evidence is silent, per `ReadingScale`'s contract).
- The reading set (`ReadingSet` — marks plus off-scale) is what the picker
  renders; exact membership is what capture enforces
  (`captureMeasurement.readingNotOnScale`). The wire should carry the marks
  (bands derive from them) and the client derives the set — or carry the set
  explicitly; either way state which is canonical.
- If option 2 (per-class filter): the filter is `TapeComposition.Compose`
  itself — the same function the declaration gate and scoring resolve
  through — not a second implementation. A refused pairing keeps its stable
  `tapeComposition.*` code; the per-class list simply omits it.
- Versioning: catalogue entries version with the seed corpus (the class
  fixtures' `version`-pin discipline applies — pins are fixture-only, never
  "fixed" toward the corpus in passing).

## Design questions to settle in Soarscore

- Standalone catalogue, per-class list, or both? (Both is allowed; neither
  is not.)
- Does the catalogue include composition metadata (which classes each tape
  composes with — the matrix the tape-measure story verified empirically:
  identity with all 11 distance-keyed tables, unit-mismatch refusal for
  unitless, no pairing for 10-f3k/70-f3f/85b/90-aggregate), or does the
  client discover composability only through the declaration refusal?
- Read model vs query: is the catalogue a query over published data (like
  class definitions) or part of the competition fold once adopted?

## NdcScore's part once it lands

The mark-mode picker renders from the wire: choice list from the catalogue
(names + units), picker options from the chosen tape's reading set, off-tape
reading as one tap. No client-side scale data remains (any provisional local
source used before this lands is deleted, not kept as fallback). Declaration
still goes through `POST /declare-instruments` with the full scale; capture
still names the instrument per measurement.

## Blocking note

This story **blocks the NdcScore mark-mode picker** (rendered purely from
the wire) but **not the choice gate**: setup placement, sheet-entry gating,
the declare call, instrument plumbing and distance-vs-mark column modes all
ship without it (see the choice story's "What can ship without the
catalogue"). Do not hold the gate for the catalogue.

## Acceptance

- [ ] NdcScore can render the tape choice (names + units) and, after the
   choice, the full reading-set picker including the off-tape reading,
   from one wire read — with zero tape marks transcribed in client code.
- [ ] Every offered tape, declared as-is, passes the declaration-time
   composition gate for its class (option 2), or the refusal for a
   non-composing choice renders verbatim (option 1) — no silent mismatch
   between what the catalogue shows and what declaration accepts.
