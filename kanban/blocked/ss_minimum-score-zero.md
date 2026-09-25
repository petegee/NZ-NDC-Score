# SS Story — F5J NDC: a very high launch scores a negative round score where the rules say zero

**Status:** Blocked (Soarscore-side; raised on the NdcScore board 2026-09-25
by user instruction, `ss_` prefix) · **Raised from:** tester report on the
F5J NDC sheet (live-use feedback, item #5 — no NdcScore completed story).
The tester's own question — *"i assume this is a soar-score bug?"* — is
answered **yes** by this story. Same class family as
`ss_landing-zero-scores-no-landing-points.md` and
`ss_f5j-flight-time-cap-at-959.md` (both also edit the same score sum); no
overlap in mechanism — this one is the missing zero floor on the raw score.

## What

An F5J NDC flight with a very high launch and a modest flight time scores a
**negative** round score: flight points minus the start-height deduction
comes out below zero, the sheet displays it verbatim, and the negative
drags the four-round NDC sum. The rulebook is explicit that this cannot
happen: the score floors at zero.

Feedback verbatim:

> "#5 "Minimum score should be zero... F5J calcs negative score with a very
> high launch."

> "i assume this is a soar-score bug?"

## Verified wire/engine facts (SoarScore2 + NdcScore, 2026-09-25, traced end to end)

The floor rule exists, is quoted verbatim in the engine's own comments, and
is implemented on exactly the one grain the NDC variant never reaches:

1. **The rules** — FAI F5J `5.5.11.12 f` (source
   `docs/rules/source-docs/f5-electric-2026.md:962-963`): *"Where the score
   is negative (below zero), a zero score will be recorded. Note that any
   penalty points applied in the round will remain effective."* The NZ NDC
   class adopts it whole: NZMAA S5 §0.3 c) "Contest rules as per FAI
   Section 4 … Volume F5" and f) "Scoring as per 5.5.11.12"
   (`docs/rules/nz/source-docs/nzmaa-s5-soaring-2024.md:126-132`), while
   §0.3 d) "Disregard 5.5.11.12.m and score the sum of the Raw Scores from
   the four rounds" is precisely why the NDC definition has no
   normalisation. The fai-rules digest states it in one line
   (`docs/rules/f5j.md:73`): "If the raw total is negative it is recorded
   as **0** (penalties still apply)."
2. **The definition** (seed `tools/Soarscore.SeedData/json/85c-nz-f5j-ndc.json`,
   mirrored by the NdcScore fixture
   `src/test/fixtures/85c-nz-f5j-ndc.json`) — one Preliminary phase, 4
   rounds, no drops, one task `D Duration` whose score list is rate
   (`flightTime × 1`, cap 600 PerFlight) **+** piecewise (`startHeight`:
   −0.5/m to 200 m, −3/m above — lines 244-258) **+** conditional landing
   lookup. The task carries **no `normalise` key anywhere in the file** —
   the truthful encoding of §0.3 d's sum-of-raw-scores.
3. **Per flight, no floor** — `FlightInterpreter.Interpret`
   (`Soarscore.Domain/Scoring/FlightInterpreter.cs:92-99`) sums the term
   contributions into `totalScore` verbatim. A 240 s flight from 300 m:
   240 − (0.5×200 + 3×100) = **−160**.
4. **Per task, no floor** — `FlightSelector.SelectAndScore`
   (`Scoring/FlightSelector.cs:117-125`): raw score = sum of selected
   flight scores, then PerTask caps and optional rounding. No clamp.
5. **Per group, the floor exists only on the normalised grain** —
   `NormalisationEngine.Normalise` (`Scoring/NormalisationEngine.cs`):
   lines 63-84, "No normalisation? Raw scores pass through" — untouched;
   lines 185-192 implement the lower clamp **citing 5.5.11.12 f by name**
   ("where the score is negative, a zero score will be recorded") but *only
   inside the has-normalisation branch*. The rule the comment claims is
   exactly the one the NDC path cannot reach.
6. **The recorded-penalty floor is not this rule's home** —
   `PenaltyEngine.ApplyRawPenalties` already floors
   (`PenaltyEngine.cs:129-133`, `Math.Max(0m, result.RawScore -
   totalDeduction)`, "floored per D4 — HigherIsBetter analogue of FAI
   General §6 / C.19"). But the start-height deduction is a **score term**
   (a negative-rate piecewise), not a RecordedPenalty — no penalty is
   recorded on a clean flight, so that floor never sees the deficit.
7. **Negative survives to the wire** — `PhaseAggregator` sums plainly; the
   competition walk adds phase aggregates and subtracts aggregate penalties
   with no clamp (`ScoringService.cs:565-597`). `GET /task-round-result`
   and `GET /competition-result` carry bare numbers, no floor metadata
   (NdcScore `openapi/v1.json`) — there is nothing on the wire for the
   client to key a display clamp from, and NdcScore law 2 forbids one.
8. **Blast radius: every no-normalise class** — the seven NZ classes
   (81 NZ-M NDC, 83 NZ-N ALES123, 85 NZ-P Radian, 85b F3K NDC, 85c F5J NDC,
   85d F5K NDC, 86 X5J) all pass through; **six of the seven carry
   negative-rate terms** (only 85b F3K NDC cannot go negative). 80
   NZ-M ALES200 normalises, so the existing clamp covers it; international
   F5J (30-f5j.json, `normalise` at lines 242/485) is likewise protected —
   which is why the bug surfaced on the NDC sheet first.

## Why it matters

First real-use feedback on the F5J NDC sheet. A 300 m launch costs 400
points — more than many flights earn — so the defect band is not exotic; it
is the normal shape of a poor flight on a windy day. Today the engine
records −160 where the rulebook mandates 0, the standings sum the negative
into the four-round total, and the displayed score contradicts the paper
scoresheet the organiser is transcribing from.

## Proposed change (Soarscore)

The floor is arithmetic at the score grain — engine code — but it must be
**gated on definition data** so it fires only where a class's rules state
it, per the repo's no-stated-policy discipline:

1. **Add a task-level datum** to `TaskDefinition`
   (`PublishedClassDefinition/ClassDefinition.cs:197` area — additive
   NFR-2, e.g. `FloorAtZero` with a rulebook citation, omitted by canonical
   JSON so every existing payload and seed is unchanged). No idiom in the
   `ScoreTerm` vocabulary can express it today
   (`ScoringVocabulary.cs:199-256`): a rate's cap "clamps the METRIC
   consumed, not the points produced" (:216), and `conditional`'s
   when/then/else tests *metrics*, never the running sum — there is no
   `max(total, 0)` term and none should be invented.
2. **Apply it at the end of the raw stage**, after raw penalties (mirroring
   `ApplyRawPenalties`'s existing `Math.Max(0m, …)` placement), so the
   floored score still reflects "penalties remain effective" — the penalty
   is what pushed the score to the floor.
3. **Seed the definitions** whose rules state the floor: 85c F5J NDC
   (via `5.5.11.12 f` adopted by NZ S5 §0.3 f), and examine 81, 83, 85,
   85d, 86 for their own wording (NZ-M 3.16.1 b's "If the total of all
   points is negative, the score is zero (0)" — nzmaa source
   :1914-1920 — shows the F5K/NZ pattern is already stated per class).
   Published definitions live in the Marten store (`soarscore.db`) — the
   seed corpus and golden/parallel-run fixtures need the same edit plus the
   drift guard run (as with the landing-zero change).

Alternative home considered and set aside: an unconditional floor in
`NormalisationEngine`'s pass-through branch would be the one-line fix, but
it is unstated engine policy for any class whose rules are silent, and
silently rewriting definition semantics is what the closed vocabulary
exists to prevent.

## Design questions to settle in Soarscore

- **Grain:** per task-round score (the FAI rule sits in the group-score
  section `5.5.11.12`), or per flight for multi-flight tasks? 85c is
  single-flight so the two coincide; F3K-family tasks never go negative, so
  no corpus case distinguishes them — pick one and state it.
- **Competition grain:** `ScoringService.cs:592` subtracts aggregate
  penalties from the total with no clamp, and the fly-off total has its own
  negative→zero wording (`f5-electric-2026.md:1010`, `5.5.11.13`). Does the
  floor apply there too, or only per round? Settle from the wording, not
  symmetry.
- **`PreNormalisationScores`** (`kanban/in-progress/pre-normalisation-score-view-field.md`):
  for a floored row, is the preserved pre-normalisation value the true
  negative or the floored zero? The view field exists precisely to show
  what normalisation consumed — decide which truth it owes.
- **Drops:** floored-zero cells change which cell a drop policy selects in
  classes that do drop (85c drops none — verify no NDC class is affected).
- **Cross-reference** `ss_landing-zero-scores-no-landing-points.md` and
  `ss_f5j-flight-time-cap-at-959.md`: all three edit the same F5J score
  sum (landing award rows, flight-time cap, and this floor); land them in
  one review so the seed drift guard runs once.

## NdcScore's part once it lands

Nothing structural. The client already renders the engine's number
verbatim (`src/scoring/ScoreTable.tsx:6-8` — `Verbatim` is
`String(value)`, no arithmetic, no formatting), so today a negative shows
as `-160` in both the Group scores table and Provisional standings, and
once the engine floors, the display corrects itself with no client change.
A display-side clamp is **not** an option (NdcScore law 2: no score
arithmetic in the client, ever).
