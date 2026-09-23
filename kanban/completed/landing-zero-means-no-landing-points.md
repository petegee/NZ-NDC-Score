# Story — A 0 entered on landing means zero landing points, not a 0 m landing

**Status:** Completed (NdcScore-side; the fix itself is Soarscore definition
data, raised blocked) · **Raised:** 2026-09-23 (user feedback) ·
**Landed:** 2026-09-23

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

## What the investigation found (2026-09-23, traced end to end)

The "0 = 0 m" interpretation is **class-definition award-table data, not
engine logic**:

1. **Client** — `parseCellText("0", Number, "m")` returns
   `{kind: "Number", number: 0}` (`src/grid/parse.ts`): the entered text
   reaches the wire verbatim. Nothing in the parse, capture or orchestration
   layers mangles a bare 0 or treats it as blank. Blank stays "no result".
2. **Engine** — `FlightInterpreter.EvaluateLookup` (SoarScore2
   `Scoring/FlightInterpreter.cs`) awards the first row with
   `metricValue <= UpTo`. Every NDC landing table's first band is `[0, 1]`
   (NZ-M 81: 50 pts), so a captured 0 earns the *best* award. No engine code
   special-cases 0 anywhere; NDC competitions declare no instruments, so the
   composed tape path (WI-1..WI-4) never engages.
3. **Adoption** — validation check 9 only compares consecutive bounded rows,
   so a leading `{upTo: 0, points: 0}` row is already legal: the fix is
   definition data in the seeded published classes, with no engine change
   for the distance path. The ">10 m vs >15 m" instinct resolves itself —
   every corpus class's past-tape row is unbounded with 0 points, so the
   leading zero row delivers "as if past the tape" per class with no
   per-class branch anywhere (law 3 holds).

The Soarscore-side work is raised blocked:
`kanban/blocked/ss_landing-zero-scores-no-landing-points.md` (raised on this
board by user instruction 2026-09-23, `ss_` prefix — superseding this
story's original "raise there when scheduled" stance).

## What landed (client-side)

- **Parse guard** (`src/grid/parse.test.ts`): a bare "0" parses to a zero
  Number reading, never blank — the wire fact the definition fix keys on.
- **Capture-flow guard** (`src/sheet/calculate.test.ts`): an entered landing
  0 flows through Calculate to `capture-measurement` as an exact
  `{kind: "Number", number: 0}` on the fake's entry — no layer between cell
  text and wire mangles or drops it.
- No cell hint added: the faint "0 = no landing points" placeholder the
  story allowed would contradict live engine behaviour (a captured 0 still
  awards best points) until the Soarscore change ships — it is recorded as
  NdcScore's optional follow-up in the ss story instead.

## Why it matters

First real-use feedback. The scoresheet convention (0 = flyaway / beyond
tape) collides with the metric convention (0 m = dead on the tape), and the
current interpretation silently awards the organiser's 0 the *highest*
landing score. Pedantic point preserved because it is the justification: an
exact 0 m reading is physically impossible — there is always a delta — so
treating 0 as "beyond tape" loses nothing real and matches what paper-takers
mean.

## Verification

`npm test` (159 passed), `npm run lint`, `npm run build` green. The engine
trace was read-only against SoarScore2 source (`FlightInterpreter.cs`,
`ClassDefinitionValidation.cs`, the NZ-M 81 fixture's landing rows); no
Soarscore file was touched (law 5).