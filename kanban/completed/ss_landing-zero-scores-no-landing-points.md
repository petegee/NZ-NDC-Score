# SS Story — An entered 0 on landing scores zero landing points, not a 0 m landing

**Status:** Completed (NdcScore-side placeholder landed 2026-09-29; the
Soarscore definition fix shipped as commit 80d1545) · **Raised:** blocked
on the NdcScore board 2026-09-23 by user instruction, `ss_` prefix ·
**Raised from:**
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

## NdcScore-side as built (2026-09-29)

The Soarscore fix has shipped (every corpus landing table leads with
`{upTo: 0, points: 0}`; mirrored fixtures in `src/test/fixtures/` carry the
new shape), so the hint no longer contradicts live behaviour — it landed as
faint placeholder text only. No capture, parse or scoring change: an entered
0 still posts verbatim, blank still stays "no result".

- **Placeholder path check (the handover caution):** `landingDistance` is a
  demanded observation with no `whenNotRecorded` assumption, so the existing
  assumption-placeholder mechanism (`PenaltyCell`, `SheetPage.tsx:835` —
  `placeholder={formatValue(assumption, col.unit)}`) never touches it: that
  path only renders non-key assumed metrics inside the compliance drop list.
  The hint is therefore wired on the key-column path instead — `SheetCell`
  takes an optional `placeholder` prop, set from the grid derivation below.
- **Structural derivation, no per-class branch (law 3):**
  `exactZeroNoPointsMetrics(task)` (`src/grid/schema.ts`, cf.
  `zeroFlightFlagMetrics`) walks the task's `score` + `scoreNormalised`
  terms, recursing through conditional then/else branches (the landing award
  sits inside the landing `when`), and collects every lookup `metricRef`
  whose leading row is `{upTo: 0, points: 0}` (number|string coerced). It
  surfaces as `TaskGridSchema.zeroHintMetrics` alongside `zeroFlightFlags`;
  `SheetPage.tsx` renders `EXACT_ZERO_HINT` (`'0 = no landing points'`) on
  exactly those columns. A `landingDistance` column with no such award shape
  gets no hint — pinned by test, so the hint can never drift into a
  metric-name rule.
- **Files:** `src/grid/schema.ts` (derivation + `zeroHintMetrics` +
  `EXACT_ZERO_HINT`), `src/sheet/SheetPage.tsx` (`SheetCell` placeholder
  prop + wiring), `src/grid/zero-hint.test.ts` (new: fixture coverage over
  all four mirrored landing-zero tasks incl. the 50-f3j fly-off, rate-only
  F3K negative, non-zero-leading-row / points-awarding-zero-row /
  string-form / else-branch synthetic cases),
  `src/sheet/SheetPage.test.tsx` (F5J stub gains the conditional landing
  lookup; two render tests: landing cells hinted / flight-time + start-height
  bare, and the X5J landing column stays bare without an award shape),
  `src/sheet/ResultsTable.test.tsx` (hand-built grid literal gains the new
  required `zeroHintMetrics: []` field — mechanical).
- **Verification:** full `npx vitest run` 225 passed / 6 skipped (baseline
  before this change 216 passed — the 3 pre-existing `landedWithin75m`
  drift failures are gone, fixed by the committed mirror
  `3534e95` which this work builds on, untouched);
  `npm run lint` clean; `npm run build` green.
- **Lane:** blocked → completed directly (`kanban/in-progress/` holds only
  `.gitkeep` — no standing NdcScore in-progress convention; the sibling
  `landing-zero-means-no-landing-points.md` likewise landed straight in
  completed with its as-built).