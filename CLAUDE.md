# CLAUDE.md — NdcScore

Companion SPA to the Soarscore service (sibling repo
`~/Source/SoarScore2`). Keep this file succinct.

## What this is

A single spreadsheet-like web page for NZMAA NDC organisers who capture
results on paper during the day and score them at home in the evening: one
grid, free entry in any cell at any time, one **Calculate** button. Replaces
`SoarScore2/Soaring_NDC_Scoresheet_v3.xlsm`; the field tool stays paper.

Read the docs/Functional Overview.md doc for an overview of the UI application.
Read the docs/soaring-domain-glossary.md for an overview of the key nouns of the domain

## Laws (violating any of these is a design error, not a style choice)

1. **NdcScore has no backend.** It is a pure web client of the Soarscore API
   (commands `POST /<verb>` with a JSON body, queries `GET /<noun>` with
   `[AsParameters]`; success = bare value or `{value, warnings}`, failure =
   RFC 9457 ProblemDetails with the stable code in `title`). CORS is a
   service-side concern, already built on SoarScore2 `api-cors`.
2. **No score arithmetic in the client, ever.** Scores, totals, ranks,
   normalisation: only from `GET /task-round-result` and
   `GET /competition-result`.
3. **No class-specific logic in the client.** Grid columns, metrics, flags
   and tasks derive from `GET /class-definition` for the adopted class — the
   client must never branch on F3K vs ALES vs X5J.
4. **Batch on Calculate.** The sheet is uncommitted text until **Calculate**;
   then the client orchestrates the whole command sequence invisibly
   (find-or-create competition → bind → find-or-register pilots → draw →
   open entry/flight → capture or amend → complete task-rounds → read
   scores). Nothing but the sheet text is client state. Corrections are
   entered freely — overtype and recalculate: amends carry an auto-filled
   reason, never overwrites, and the organiser is never asked for one.
5. **No Changes to Soarscore** Under no circumstance do you add/alter/delete
   any file in the Soarscore API/Engine itself. You can report that you wanted
   to, and why only.

## Board

`kanban/` mirrors the Soarscore convention: four lanes, `tech-debt.md`,
`deferred-decisions.md`; one story = one markdown file; `git mv` between
lanes *is* the status change; completed stories are history — never edit.

## Pointers

- Wire protocol and endpoint list: `SoarScore2/src/Soarscore.Api/`
  (`Commands.cs`, `Queries.cs`, `Routing/EndpointRouteBuilderExtensions.cs`),
  live at `/openapi/v1.json` on any running instance.
- Domain concepts: `SoarScore2/docs/soaring-domain-glossary.md` — new concepts
  need explicit approval there, not here.
- The rules behind the numbers: the `fai-rules` skill in the SoarScore2 repo.
