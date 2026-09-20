# Story — Single-form contest entry (the SPA core)

**Status:** Backlog · **Raised:** 2026-09-14 · **Fleshed:** 2026-09-17
(facts below verified against SoarScore2 `main` @ 2026-09-17; re-verify
nothing — each WI's *Done when* re-tests against a live API)

## What

The whole product: a React/TS single-page app that renders **one form shaped
like the paper NDC scoresheet** — contest header (class, name, date, venue,
CD), pilot rows (name + MFNZ #), and a round grid whose columns are generated
from the adopted class definition — writes every committed cell through to the
Soarscore API as it goes, and reads scores back from the service. NdcScore is
a pure web client of the Soarscore API: **no backend of its own, ever**
(`kanban/deferred-decisions.md`).

The counterpart Soarscore change (CORS) is already built: SoarScore2 branch
`api-cors`, `SoarScore2/kanban/completed/cors-for-ndcscore-spa.md`.

## Why it matters

NDC organisers capture results on paper during the day and score them at home
in the evening, today via `Soaring_NDC_Scoresheet_v3.xlsm`. The workbook
drifts (sheet names diverge from contents; landing-tape selector variants
duplicated as whole sheets) and embeds per-row formulas nobody should re-derive.
Every class the workbook covers already exists as a published Soarscore seed
definition (`SoarScore2/tools/Soarscore.SeedData/json/*.json`), so the app
adds only capture and display.

## Laws (violating any is a design error, not a style choice)

From `CLAUDE.md`; every WI below is written inside them.

1. **No backend.** The SPA talks HTTP to the Soarscore API only. CORS is on
   the service (`SOARSCORE_CORS_ORIGINS`), already built.
2. **No score arithmetic in the client, ever.** Scores, totals, ranks,
   normalisation come only from `GET /task-round-result` and
   `GET /competition-result`. Parsing a cell into a `MeasuredValue` is
   capture, not scoring — allowed. Rounding to metric precision is the
   service's job (`Entry.CaptureMeasurement` rounds — never do it in the
   client).
3. **No class-specific logic.** Grid columns, metrics, flags, flight-row
   counts, tasks: derived from `GET /class-definition`. The client never
   branches on F3K vs ALES vs X5J. (Tests may pin *against* snapshots of
   seed definitions; the app may not hard-code one.)
4. **Write-through, not batch.** A committed cell becomes a command
   promptly. Corrections are amends (`POST /amend-measurement`), never
   overwrites. Uncommitted cell text is the only client-local state
   (localStorage).

## Shared facts — read once, apply to every WI

These are verified wire facts. Sub-agents implement against them instead of
re-researching; spot-check only where a WI's *Done when* says so.

### Wire protocol (`SoarScore2/src/Soarscore.Api/`)

- Source of truth: `Routing/EndpointRouteBuilderExtensions.cs`,
  `Commands/Commands.cs`, `Queries/Queries.cs`; live document at
  `/openapi/v1.json` on any running instance.
- Commands: `POST /<kebab-verb>`, JSON body. Queries: `GET /<kebab-noun>`,
  `[AsParameters]` from the query string — **camelCase param names, ids as
  bare GUID strings**.
- **Id serialisation differs by position** (this will bite): in JSON bodies
  and responses every id (`PersonId`, `CompetitionId`, `CompetitorId`,
  `EntryId`, `GroupId`) is the nested struct `{"value": "<guid>"}`; in query
  strings the same ids are bare GUID strings. Verified in
  `SoarScore2/tests/Soarscore.Acceptance.Tests/Steps/SigningInSteps.cs`
  (register-person returns `{"value": "<guid>"}`).
- **JSON is camelCase; enums are strings** (`JsonStringEnumConverter`
  global — e.g. `"HigherIsBetter"`, `"Original"`); `DateOnly` is
  `"yyyy-MM-dd"`; timestamps are RFC 3339 offsets.
- Success: bare value; **with advisories** `{"value": <T>, "warnings":
  [{"code", "message"}]}`. Distinguish the envelope on status 200 + body
  owning exactly `value` and `warnings` keys. Today advisories only ride
  draw prescription (`prescribeDraw.groupBelowClassMinimum`) — warn-don't-
  refuse.
- Failure: RFC 9457 ProblemDetails — `title` = stable code, `detail` =
  human message, optional `defects: [{"code","path","message"}]`. Status:
  `*.notFound` → 404; `eventStore.streamAlreadyExists|concurrencyConflict|
  uniqueConstraintViolation` → 409; everything else → 400 (see the switch
  in `EndpointRouteBuilderExtensions.cs`).

### Endpoint inventory (the only ones NdcScore MVP touches)

Commands (POST): `create-competition`, `register-person`,
`register-competitor`, `draw-phase`, `bind-parameter`, `declare-instruments`
(deferred, see Decisions), `open-entry`, `open-flight`,
`capture-measurement`, `amend-measurement`, `record-entry-penalty`,
`annul-entry`, `complete-task-round`, `reopen-task-round`.
Queries (GET): `people`, `person`, `class-definitions`, `class-definition`,
`competitions`, `competition`, `entries`, `task-round-recording`,
`task-round-result`, `competition-result`, `competition-event-log`.

Exact record shapes: read `SoarScore2/src/Soarscore.Application/Commands|Queries/**`.
Key ones (property names = wire names, camelCased):

- `CreateCompetition(Name, Location, StartDate, EndDate, ClassContentHash)` —
  EndDate is required: an NDC is one day; the UI defaults it to StartDate.
  `ClassContentHash` must reference a published, unretired definition —
  failures `createCompetition.classDefinitionNotFound` / `.classDefinitionRetired`.
- `RegisterPerson(Name, Contact{Email, Phone?, HomeCity?}, Club?{ClubName,
  MembershipNumber?})` — email **required** (`person.contact.missing`,
  `person.email.invalid`); duplicates surface as 409
  `eventStore.uniqueConstraintViolation`. See *Decisions* for the
  placeholder-email convention.
- `RegisterCompetitor(CompetitionId, PersonId) → CompetitorId`.
- `DrawPhase(CompetitionId, Rounds, TaskRefs?)` — for
  `rounds.kind = "ChooseFromCatalogue"` (F3K NDC) `TaskRefs` is **required**:
  exactly `Rounds` distinct task codes from the phase catalogue
  (`drawPhase.*` failures otherwise); for `FixedSequence` omit it. Draw
  warnings ride the `{value, warnings}` envelope.
- `BindParameter(CompetitionRef, ParameterName, Value, By, PhaseOrdinal?,
  RoundOrdinal?)` — `By` is the CD's self-declared name (audit breadcrumb,
  non-empty). Phase/Round both-or-neither.
- `OpenEntry(CompetitionRef, PhaseOrdinal, RoundOrdinal, TaskRoundOrdinal,
  GroupRef, CompetitorRef, Role?, CountsForRoundOrdinal?, Reason?)` —
  `Role` defaults `Original`; reflight fields exist but the MVP UI never
  sends them. Failure `openEntry.alreadyOpen` when a live entry exists for
  the competitor in the task-round (treat as *adopt*, see WI-4).
- `OpenFlight(EntryRef, Sequence?)` — omitted → derived max+1; duplicates
  and non-positive refused (BDD: "a duplicated launch is refused").
- `CaptureMeasurement(EntryRef, FlightSequence, Metric, Value, Instrument?)`
  — `Value` is `MeasuredValue`: `{"kind":"Number","number":<decimal>}` or
  `{"kind":"Flag","flag":<bool>}`. `Metric` is the definition's metric name
  string (e.g. `flightTime`, `landingDistance`, `landedWithin75m`).
- `AmendMeasurement(EntryRef, FlightSequence, Metric, NewValue, Reason, By,
  Instrument?, ChangeInstrument?)` — `Reason`/`By` mandatory.
- `CompleteTaskRound(CompetitionRef, PhaseOrdinal, RoundOrdinal,
  TaskRoundOrdinal)`; `ReopenTaskRound(+ Reason)`.
- `RecordEntryPenalty(EntryRef, InfractionType, Scope, By?)` —
  `InfractionType` must be one of the adopted definition's `penalties[]`
  (undeclared → 400, BDD: "an undeclared infraction type is refused").
- `AnnulEntry(EntryRef, Reason, By)`.
- Queries: `FindPeople(Email?, Name?)` → **400 `findPeople.noCriteria` if
  neither** — autocomplete must always carry a criterion (email match
  returns 0–1 rows). `FindClassDefinitions(Name?, ActiveOnly=false)` →
  `ClassDefinitionSummary{Id, ContentHash, Name, FaiDesignation?, Version,
  PublishedAt, RetiredAt?}`. `GetClassDefinition(ContentHash)` → full
  `ClassDefinition`. `FindCompetitions(OnOrAfter?, ClassContentHash?)`.
  `GetCompetition(Id)` → `CompetitionView{competition, pairwiseCoOccurrence}`.
  `FindEntries(CompetitionRef, PhaseOrdinal?, RoundOrdinal?,
  TaskRoundOrdinal?, GroupRef?, CompetitorRef?)` → `EntrySummary{Id,
  CompetitionRef, PhaseOrdinal, RoundOrdinal, TaskRoundOrdinal, GroupRef,
  CompetitorRef, Role}`. `ScoreTaskRound(CompetitionRef, PhaseOrdinal,
  RoundOrdinal, TaskRoundOrdinal, GroupRef?)` → `GroupScoreView[]`.
  `ScoreCompetition(CompetitionRef)` → `CompetitionScoreView`.
  `GetTaskRoundRecording(CompetitionRef, PhaseOrdinal, RoundOrdinal,
  TaskRoundOrdinal, GroupRef?)` → `TaskRoundRecordingView`.

### Shape facts the grid depends on

- `ClassDefinition{name, faiDesignation?, version, parameters[], penalties[],
  phases[]}`; `PhaseDefinition{ordinal, type, rounds{kind, tasksPerRound,
  requireDistinctTaskPerRound, maxRounds?}, validity, tasks[]}`;
  `TaskDefinition{code, name, metrics[], flights, timing, group?,
  normalise?}`; `MetricDefinition{name, kind:"Number"|"Flag", unit?,
  declaredBeforeLaunch, precision?, whenNotRecorded?}`; `Parameter{name,
  kind, unit?, defaultValue?, allowedValues[], boundAt:"CompetitionSetup"|
  "BeforeFlying"|"PerRound"}`.
- **The time metric is `flightTime` (unit s); landing is `landingDistance`
  (unit m); flags carry semantic names** (`landedWithin75m`,
  `landedWithinWindow`, `launchedInWorkingTime`, `damagedAndNotSafelyFlyable`,
  `touchedByCompetitor`, `motorRestarted`, …). Column *labels* may be
  prettified; column *identity* is the metric name, always.
- Flight rows per pilot per task: derive — `timing.maxLaunches` when
  present; else `flights` `$kind`: `last`→1; `lastN{n}`/`exactlyN{n}`/
  `bestN{n}`→n; `all` without `maxLaunches`→dynamic (add a row on demand,
  open-flight without Sequence). Where `flights` carries `targets` +
  `targetValues` (F3K H: 60/120/180/240 s), use them as per-row labels.
- `whenNotRecorded` on a metric = declared absence semantics: a blank cell
  scores as that value. The grid shows the assumption as a hint; a blank is
  *not* a capture (never write an assumed value as if observed).
- **Ordinals on the wire: phase 0-based (first drawn phase = 0 — pinned by
  `CapturingAScoreSteps.cs` passing `0`), round and task-round 1-based.**
  Always copy ordinals from `GET /competition`'s fold; never count them
  client-side.
- Groups exist only after the draw: `GET /competition` →
  `phases[].rounds[].taskRounds[].groups[]` with `id`, `ordinal`,
  `competitorRefs[]`, optional `spots[]` (empty = unassigned). Group ids are
  the `GroupRef` for open-entry / result queries.
- **Resume gap to know:** `GET /entries` returns coordinates only — no
  measured values. Committed cell *values* rebuild from
  `GET /competition-event-log?id=<comp>&includePayload=true` — per entry
  stream, `events[].payload` carries the raw events (flights opened,
  measurements captured/amended). That is the reload path; there is no
  per-entry measurement query.

### Runtime / trust model

- The MVP targets the API running with `Soarscore:Auth:Mode=none` (its
  appsettings default): no Authorization header, club-level no-auth trust
  model, matching the CORS story's stance (`AllowCredentials` deliberately
  unset). The wrapper (WI-1) leaves one place to attach a bearer header
  later; sign-in is a later story, not a WI here.
- CORS is service-side and already built — the SPA needs
  `SOARSCORE_CORS_ORIGINS=http://localhost:5173` (or `Vite` default port)
  on the API's environment. Nothing proxy-side.
- The API seeds all class definitions at startup, so a fresh `dotnet run` is
  fully populated.

### Decisions (settled with Pete 2026-09-17; recorded in deferred-decisions.md)

- **Unknown-pilot email:** `register-person` demands a non-blank email the
  paper sheet rarely carries. MVP prefills the placeholder
  `unknown@mfnz.invalid`, overtypeable when the organiser has a real
  address. The `.invalid` TLD makes accidental delivery impossible.
- **Landing tape is out of MVP:** the xlsm's tape-selector variants map to
  `POST /declare-instruments` (named instrument + `ReadingScale` marks
  against `landingDistance`). MVP declares no instruments (empty
  declaration is valid) and captures distances as plain metres; a follow-up
  story adds the tape declaration UI. Until then the `Instrument` fields on
  capture/amend stay unset, and no instrument UI exists.

## Plan

### WI-1 — Repo scaffold + generated TS client + wire wrapper

- Vite + React + TypeScript (`npm create vite@latest -- --template
  react-ts`), plain `npm run dev` (port 5173), no router, no state library —
  React hooks + reducer (the WI-5 orchestrator is a plain reducer).
- TS client **generated from `/openapi/v1.json`** (the API serves it in
  every environment): commit a snapshot of the document, a regen script
  (`npm run gen:client`), and the generated types. Client-generation drift
  guard is already on `kanban/tech-debt.md` — do not solve it here.
- Wire wrapper (hand-written, thin, around the generated client or `fetch`):
  - `VITE_API_BASE` is the only environment surface; start up fails fast
    with a helpful error when unset.
  - Envelope unwrap: bare value → value; `{value, warnings}` → value +
    surfaced warnings (typed `{code, message}[]`).
  - ProblemDetails → typed `ApiError{status, code (from title), detail,
    defects}`; every caller maps `code` to UI state, never string-matches
    `detail`.
  - One function per endpoint in the inventory above, each returning the
    unwrapped value and warnings.
  - A single attachment point for a future bearer header (comment only).
- A dev smoke script (or vitest) that `GET /class-definitions` against a
  running API and prints the class list — proves base URL + envelope +
  CORS end to end.
- **Done when:** `npm run build` green; unit tests cover envelope unwrap
  (bare value, `{value, warnings}`, ProblemDetails 400/404/409) without a
  live API; the smoke script round-trips a seeded local API.

### WI-2 — Setup flow: class picker, contest header, bindings, draw, grid schema

- Class picker: `GET /class-definitions?activeOnly=true`; display
  `Name` + `Version` (+ `FaiDesignation` when present). Filter for display
  only; the client hard-codes no class names or counts (law 3). Store the
  chosen `ContentHash`.
- Contest header form: name, location, date (one day; EndDate defaults to
  StartDate), CD display name (becomes `By` on later commands). Creates via
  `POST /create-competition`; all five fields required by the wire.
- Load `GET /class-definition?contentHash=<hash>` once and keep the whole
  `ClassDefinition` in session state — it is the app's only schema source.
- Parameter bindings the definition demands at setup: for every
  `parameters[]` entry with `boundAt` `CompetitionSetup` (e.g. ALES NDC
  `minNewGroup`) collect a value (prefill `defaultValue`, validate against
  `allowedValues`) and `POST /bind-parameter` (`By` = CD name). Values
  bound `BeforeFlying`/`PerRound` show as "to bind later" (PerRound binds
  from the round header, WI-4).
- Draw: `POST /draw-phase` with `Rounds` (UI default: the definition's
  `maxRounds`), and `TaskRefs` **only** when `rounds.kind =
  "ChooseFromCatalogue"` — then the CD picks one task per round from
  `phase.tasks` (distinct when `requireDistinctTaskPerRound`; errors from
  `drawPhase.*` surfaced verbatim). Surface `{value, warnings}` advisories
  inline (below-SHOULD-minimum groups warn, don't refuse).
- Grid schema module — pure functions `ClassDefinition + bindings →
  GridSchema` (rounds, per-round task, columns from `task.metrics`,
  flight-row count and labels per the derivation rules in *Shared facts*).
  No component derives columns itself.
- Test fixtures: checked-in copies of `81-nz-m-ndc.json` and
  `85b-nz-f3k-ndc.json` (snapshot copies, labelled as fixtures with a
  pointer to the seed corpus — this is test data, not hard-coded class
  logic). Schema tests run the derivation over both.
- **Done when:** scripted flow against a running API: pick ALES 200 (NDC
  format) → bind `minNewGroup` → create → draw 4 rounds →
  `GET /competition` shows the drawn schedule and groups; repeat with F3K
  NDC including a catalogue task choice; GridSchema unit tests pass over
  both fixtures (ALES: 1 task `D`, 5 metrics, 1 flight row; F3K: 4 tasks,
  flight rows B=2, D=2, G=5, H=4 with 60/120/180/240 labels).

### WI-3 — Pilot rows: people autocomplete, registration, competitor rows

- Roster panel reads `GET /competition`: competitors (`competitorNumber`,
  `personRef`) and per-task-round groups. **The fold carries no names** —
  resolve each `personRef` with `GET /person?id=<guid>` (≤20 pilots; cache
  in session state).
- Add-pilot autocomplete: `GET /people?name=<typed>` debounced ~300 ms.
  A test pins the invariant that no autocomplete request is ever issued
  without a criterion (the API 400s `findPeople.noCriteria`). Email search
  (`?email=`) supported in the same control.
- Known pilot → `POST /register-competitor` with both ids as nested
  `{"value"}` bodies. Duplicate registration → 409 → surface and adopt the
  existing competitor (refetch the fold).
- Unknown pilot → register form: name (required, `person.name.blank`),
  email prefilled with the placeholder convention (above), optional club
  name, **MFNZ # → `Club.MembershipNumber`**. Note: the model's
  `membershipNumber` is a club membership number — the MFNZ national number
  is the best available slot; if the distinction ever matters it is a
  Soarscore-side change, flagged here not invented around.
  `POST /register-person` then `POST /register-competitor`. Email-duplicate
  409 (`eventStore.uniqueConstraintViolation`) → prompt to search instead.
- Pilot rows display: name, MFNZ #, competitor number; withdrawn flag from
  the fold (`withdrawnAt`) — display only; withdrawal is a CD action out of
  MVP UI (wire exists).
- **Done when:** add a known pilot via autocomplete, add an unknown pilot
  via placeholder email, both register and appear as competitor rows with
  numbers; duplicate email and duplicate competitor paths show their
  distinct messages; no criterion-less `/people` call exists (unit test).

### WI-4 — Round grid cells: capture, amend, penalties, annul

- Grid per task-round (chosen from the drawn schedule): rows = group
  members (competitor number + name), columns = flight rows × metric
  columns from the GridSchema. Cell types: time (`flightTime` — parse
  `mm:ss` or bare/decimal seconds), distance (`landingDistance` — metres),
  flags (checkbox). Parsing is capture, not arithmetic: `mm:ss` → seconds
  value sent as parsed; the service applies metric `precision`.
- Commit chain per cell, in order, orchestrated by the session (WI-5 owns
  the queue; WI-4 owns the affordances):
  1. `POST /open-entry` (first committed cell of a pilot in the task-round;
     `GroupRef` from the fold's group) — on failure
     `openEntry.alreadyOpen`, reconcile instead of retrying: `GET
     /entries?competitionRef=&taskRoundOrdinal=&competitorRef=`, adopt the
     existing entry id, continue.
  2. `POST /open-flight` for the cell's flight row (explicit `Sequence`
     from the row label; on duplicate-launch refusal, adopt the existing
     flight — refetch via the event log or recording view).
  3. `POST /capture-measurement` with the row's `FlightSequence`, the
     metric name, the parsed `MeasuredValue`.
  - Debounce per cell (~600 ms) + commit on blur/Enter; only uncommitted
    text lives in localStorage (keyed per cell; cleared on commit success;
    restored on reload).
- Blank cell = no capture; `whenNotRecorded` assumptions render as a faint
  hint (e.g. `landedWithin75m` assumed true) — blank never writes a value.
- Edit a committed cell → `POST /amend-measurement` with the new value plus
  **Reason** (mandatory on the wire) and `By` = CD name; prefill Reason
  empty and require it (the paper story is the audit trail). Show the
  correction inline (small "amended" marker).
- Penalties: per-pilot affordance listing the adopted definition's
  `penalties[]` (infraction type + effect points displayed) →
  `POST /record-entry-penalty`. Annul entry → `POST /annul-entry` with
  required reason + confirm. Both surface the service's refusal codes
  verbatim.
- `ReflightRole` renders as a badge (Original default, Entitled/Filler
  where present) — display only; reflow adjudication UI is out of MVP.
- Unreachable API / failing command: cell enters error state (queued /
  retry / failed + `ApiError.code`); uncommitted text and the queue survive
  reload. Auto-retry once on network error; 409 `eventStore.
  concurrencyConflict` → one refetch-then-retry; anything else needs a
  human (the cell shows the code, never a generic error).
- Per-round header: working-time display (bound `PerRound` parameters show
  their bound value; unbound ones prompt `POST /bind-parameter` with
  `PhaseOrdinal`+`RoundOrdinal`, `By` = CD name), `Fixed` vs
  `UntilAllFlightsComplete` ("open-ended" label, per BDD scenario 2).
- **Done when:** scripted against a live API — F3K NDC task D round with 3
  pilots × 2 flights including a false-start flag (`launchedInWorkingTime`
  false) and a 62 s flight; reload mid-round rebuilds committed cells from
  the event log and restores uncommitted text; amend 4120→412 round-trips
  (mirrors the BDD correction scenario); penalty and annul round-trip;
  duplicate-launch and alreadyOpen paths adopt rather than double-write.

### WI-5 — Session orchestrator: the create→enter→finish sequence as one reducer

- One reducer owns session state: `setup → drawn → capturing → (round
  lifecycle)`; the command queue is part of that state; every command the
  grid triggers (WI-4) flows through it, with per-cell status
  (uncommitted/queued/in-flight/committed/error).
- Round completion is a session action gated by `GET /task-round-recording`
  (`notRecordedCompetitorRefs`, `metricGaps`): when gaps clear the round
  header offers `POST /complete-task-round`; a service refusal (or a CD
  completing over a gap) surfaces the ProblemDetails verbatim — warn, never
  silently proceed. Late corrections after completion →
  `POST /reopen-task-round` (reason required) then amend.
- **Invariant pinned by a test: no code path computes a score client-side.**
  Enforce three ways: (a) score values are rendered verbatim from the WI-6
  fetch layer's types (no derived numeric fields exist in the display
  model); (b) an ESLint ban on arithmetic operators inside
  `src/scoring/**` (the only module allowed to touch score responses); (c)
  a unit test asserting a mocked `GroupScoreView` renders byte-equal to the
  server's numbers.
- Optional property test (only if it earns its keep once this shape
  exists): fast-check — "replaying any command sequence the reducer
  accepted produces the same queued command list". Example-based tests may
  prove enough; drop the property if it needs a harness that outlives the
  reducer.
- **Done when:** a scripted full evening — create → bind → draw → capture
  round 1 → complete → capture round 2 → complete — passes against a live
  API; a flaky-fetch mock test proves the queue retries and resumes; the
  invariant test exists and fails if arithmetic is added to a score path.

### WI-6 — Score read-back: round scores and competition standings

- After commits settle (debounced ~1.5 s per task-round), refetch
  `GET /task-round-result?competitionRef=&phaseOrdinal=&roundOrdinal=&
  taskRoundOrdinal=&groupRef=` and render the score column/rows verbatim:
  `rawScore` **is the post-normalisation score** (trap 5 in
  `ScoreTaskRound.cs` — despite the name) with `preNormalisationScore`
  shown secondarily when they differ; `awaitingCapture[]` renders as the
  gap badge; `winnerRef` marks the group winner; `state: "NoResult"` rows
  render as no-result, never zero.
- Groups with no flown entries are **absent** from the response — render
  "no scores yet", never zeros.
- Competition footer: `GET /competition-result` (per-competitor `score`,
  `disqualified`, `placing`) — refreshed automatically when a round
  completes and on manual refresh. Provisional (pre-finalisation) standings
  are expected and labelled as such.
- Envelope warnings surface inline in the round header
  (`prescribeDraw.groupBelowClassMinimum` warns-don't-refuses — mirror the
  service's stance); 400/404/409 never render as silent zeros.
- **Done when:** after the WI-5 scripted evening, every rendered score
  equals the same endpoint fetched with curl (no transform, no formatting
  beyond display); a mid-round capture visibly reorders provisional
  standings; warnings surface.

## Out of scope (other stories / deliberate deferrals)

- Results view, finalisation, copy-for-email → `results-view-and-export.md`
  (`/finalise-competition`, `/competition-result` presentation beyond the
  WI-6 footer, `/competition-pending-tie-breaks`).
- Email sending → `email-results.md`; copy-for-email only, per
  `deferred-decisions.md`.
- Landing-tape instrument declaration → follow-up story (decision above);
  wire support (`declare-instruments`, `Instrument` on capture/amend)
  already exists and the wrapper carries it.
- Sign-in: MVP targets `Auth:Mode=none`; bearer header attach-point only
  (WI-1).
- Reflight adjudication UI (re-flight groups, rulings): data model carries
  `role` and the grid displays it; adjudication commands stay wire-only in
  MVP.
- Client drift guard → `kanban/tech-debt.md`.

## Verification (whole story)

One scripted end-to-end pass against `dotnet run --project
src/Soarscore.Api` (SoarScore2, SQLite, seeded corpus,
`SOARSCORE_CORS_ORIGINS` set):

1. ALES 200 (NDC format): class pick → bind `minNewGroup` → create → draw 4
   rounds → 6 pilots registered (4 known, 2 new with placeholder email) →
   capture a full round (time + landing + 75 m flag, one false 4120→412
   amend, one penalty) → complete round → scores render matching curl.
2. F3K NDC: catalogue draw (4 tasks across 4 rounds) → false-start flag
   captured alongside `flightTime` → duplicate-launch refusal adopted →
   out-of-order flight capture scores identically (BDD scenario) → round
   complete → warnings surface.

Board hygiene: when the story lands, `git mv` this file to
`kanban/completed/` and record any residual debt in `kanban/tech-debt.md`.