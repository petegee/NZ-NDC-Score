# Story — Contest name is fabricated from the header (no name field)

**Status:** Completed (NdcScore-side) · **Raised:** 2026-09-25 (user
feedback) · **Landed:** 2026-09-25

## What

Tester feedback on the mandatory Contest name field:

> "#4 'Contest name must be unique, cannot make two different entries with
> the same contest name. As this is an NDC oriented thing, I would think
> that contest name would be optional.'"

With the organiser's UX steer on record:

> "It might be best to remove the contest name text box; and fabricate a
> name from location, date, contest-type, and if there is duplicate in
> soarscore, then report it as an error."

## What the investigation found (2026-09-25, wire read read-only)

The "uniqueness" the tester fought is **client-side, not the wire's**:

1. **Engine** — `Competition.Decide` (SoarScore2
   `Soarscore.Domain/Competitions/Competition.cs`) validates the name only
   for blankness (`competition.name.blank`); nothing else. Location and
   dates likewise.
2. **Create** — `CreateCompetitionHandler`
   (`Soarscore.Application/Commands/Competitions/CreateCompetition.cs`)
   mints a fresh `CompetitionId` and appends with `ExpectedVersion.NoStream`.
   There is **no name-uniqueness check anywhere** — two competitions with
   the same name are legal on the wire, and no duplicate ProblemDetails
   exists for the client to surface on create.
3. **Search** — `GET /competitions` (`ICompetitionsQuery.SearchAsync`)
   filters on `onOrAfter` and `classContentHash` only; name matching was
   always the caller's job.
4. **Client** — `runCalculate`'s find-or-create matched the *typed* name +
   start date. That match is what made the name behave "unique": typing a
   name already in Soarscore silently bound the sheet to that competition,
   so the organiser had to invent a fresh name for every contest by hand —
   the exact friction reported.

The name was doing double duty as the contest's identity. The fix removes
the name from the organiser's hands entirely and derives it deterministically
from the header, so the identity question disappears (same header → same
contest) and a genuine identity collision becomes visible instead of silent.

## What landed (client-side)

- **No contest name in the sheet text.** `contestName` is gone from
  `SheetState`, the reducer's field union, validation ("Contest name is
  required.") and the Contest panel's field grid (Location widened into its
  span; law 4 clean — the fabrication is pure derivation, no new state). A
  draft saved before the change drops its legacy `contestName` key on load
  instead of resurrecting the field.
- **One fabrication, one place** — `fabricateContestName`
  (`src/sheet/contestName.ts`): `<ISO date> <location> <class label>`, e.g.
  `2026-09-25 Matamata F5J`. The class label is the adopted definition's
  `faiDesignation` when it declares one, else the definition's own name —
  definition data, never a client-side class branch (law 3). Human-readable
  by design: it is the name that appears in Soarscore listings and results.
  `runCalculate` uses it for both the find match and the create body.
- **Idempotent by construction** — a re-calc of the same header fabricates
  the same name, finds the same competition, and the run is a no-op (fake
  and SheetPage stubs updated so the find path, not a re-create, serves
  re-runs).
- **Duplicates are Soarscore's truth, reported loudly.** The wire cannot
  refuse a duplicate create (finding 2), so the collision surfaces where it
  is real: when the search returns **more than one** exact fabricated
  name + date match, the run stops with an error naming both ids and
  statuses — the client never silently picks one (a second same-day event
  at the same venue and class). Any create refusal the wire *does* raise
  surfaces verbatim (`<title code>: <detail>`) through the existing
  competition-step error, unchanged. No client-side uniqueness store was
  invented.
- The Contest panel announces the name once class, location and date are in
  ("Soarscore calls this contest "2026-09-25 Matamata F5J"…") so the
  organiser can see what results and emails will carry.
- Live tests switched from stamped names to a per-run date — the fabricated
  identity replaced the typed unique name, so two live runs must not share
  a date or the second adopts the first's field-frozen competition.

## Why it matters

One less typed field and one less thing to invent (unique names) on the
evening. The contest's identity is now a fact of the header rather than a
string the organiser must keep distinct; the happy path is idempotent, and
the one genuinely ambiguous case — two real contests with the same
location, date and class — stops the run with both competitions named
instead of merging scores silently.

## Verification

`npm test` (213 passed), `npm run lint`, `npm run build` green. New tests:
`contestName.test.ts` (format, designation fallback, trimming, blank parts,
determinism); `calculate.test.ts` (fabricated name on the wire, re-calc
finds the same competition, duplicate stop, verbatim create-refusal
surfacing); `SheetPage.test.tsx` (no name box, hint text, fabricated name
in the create body). SoarScore2 source was read read-only
(`CreateCompetition.cs`, `Competition.cs`, `ICompetitionsQuery.cs`); no
Soarscore file was touched (law 5). No `ss_` ticket: there is no wire or
engine gap — the engine's deliberate lack of name uniqueness is exactly
what makes find-or-create idempotent, and the duplicate case is handled by
reporting the search result the service already returns.
