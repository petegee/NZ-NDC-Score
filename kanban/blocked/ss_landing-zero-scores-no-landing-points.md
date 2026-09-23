# SS Story — An entered 0 on landing scores zero landing points, not a 0 m landing

**Status:** Blocked (Soarscore-side; raised on the NdcScore board 2026-09-23
by user instruction, `ss_` prefix) · **Raised from:**
`kanban/completed/landing-zero-means-no-landing-points.md` user feedback

## What

An entered **0** in a landing-distance cell must score **zero landing
points** — the paper scoresheet's convention for "landed beyond the tape" —
not the first award band's best points, which is what a 0 m reading earns
today. A blank cell stays "no result" (unchanged, accepted).

The fix is **definition data, not engine code**: the published NDC class
definitions' landing award tables gain a leading exact-zero row. The
">10 m vs >15 m depends on class" instinct resolves itself — every corpus
class's past-tape row is already unbounded with 0 points, so the leading
`{upTo: 0, points: 0}` row delivers "scored as if past the tape" per class
without any per-class client or engine branch.

## Verified wire/engine facts (SoarScore2, 2026-09-23, traced end to end)

- NdcScore posts the entered text verbatim: `parseCellText("0", Number, "m")`
  → `{kind: "Number", number: 0}` (`src/grid/parse.ts`), now pinned by
  regression tests at the parse layer and through `capture-measurement` —
  the client mangles nothing; blank stays "no result".
- Engine: `FlightInterpreter.EvaluateLookup` (Scoring/FlightInterpreter.cs)
  walks rows and awards the first row with `metricValue <= UpTo`. A captured
  0 falls in every NDC landing table's first band `[0, 1]` — NZ-M 81: 50
  pts, the *best* award. No engine code special-cases 0 anywhere.
- The "0 = 0 m" reading therefore lives in the **published class
  definitions' landing tables**, not engine logic: the first band starts at
  0 and the tables reserve no meaning for an exact 0.
- Adoption check 9 (`ClassDefinitionValidation.cs` "rows-not-ascending")
  only compares consecutive bounded rows — a leading `{upTo: 0, points: 0}`
  row is legal today; **no engine change is required for the distance path**.
- NDC competitions declare no instruments, so the composed tape path
  (ReadingScale/TapeComposition, WI-1..WI-4) never engages for them; the
  plain distance walk applies.

## Why it matters

First real-use feedback, verbatim:

> "I might suggest that a zero entry on the landing is for a zero landing
> score. If I leave the landing distance blank, the raw score is 'no result'"

> "…an entered zero being scored as a >10m (or 15m depending on class). To
> be stupid pedantic, it is impossible to get an exact 0m landing. There
> will always be a small delta…"

The pedantic point is the licence: an exact 0 m reading is physically
impossible, so reserving exact 0 as "zero landing score" loses nothing real
and matches what paper-takers mean. Today the engine silently awards the
organiser's 0 the *highest* landing score — the opposite of intent.

## Proposed change (Soarscore)

1. Update the seeded NDC class definitions' landing lookup tables (NZ-M 81,
   NZ-P Radian 85, NZ F5J 85c, and any other distance-landing class) to
   insert a leading `{upTo: 0, points: 0}` row: band `[0, 0]` awards zero.
   Seeded definitions live in the Marten store (`soarscore.db`) — the seed
   update path (seed-class-corpus-at-startup / parallel-run fixtures) needs
   the same edit, and golden/parallel-run fixtures that assert landing
   tables need the drift guard run.
2. Keep the award-table shape untouched otherwise; no scoring-engine,
   validation-check or wire change is needed for the NDC distance path.

## Design questions to settle in Soarscore

- Semantics: "exact 0 = zero points" vs "exact 0 = the terminal band's
  award". They coincide (0 points) in every corpus class; pick one reading
  and state it in the definition so future classes can't diverge silently.
- The composed tape path: a declared instrument's first mark band is
  `[0, UpTo[0]]` and `ComposeBand` awards by the band's *upper* bound, so a
  tape-declared competition would still award reading 0 the first band's
  points. If the convention must hold there too, the scale's first mark
  band or the composition needs the same exact-zero carve-out.
- Negative or sub-1 m entered values: with the leading row, a negative
  distance also falls in `[0, 0]` and awards zero silently. Should capture
  warn (the source story's open question)?
- Paper-0 ambiguity elsewhere: cross-check `f5j-flight-time-cap-at-959.md`
  (same family) for other "0 means something else on paper" metrics.

## NdcScore's part once it lands

Nothing structural — the client already posts the 0 verbatim and blank stays
"no result". Optionally the faint cell hint the source story allowed: a
placeholder ("0 = no landing points") on distance columns via the existing
assumption-placeholder mechanism (`SheetPage.tsx`); deliberately **not**
added now because it would contradict live engine behaviour until this
change ships.