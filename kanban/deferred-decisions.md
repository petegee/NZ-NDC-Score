# Deferred decisions

Things decided *not* to do (yet), with the reasoning. Read before "fixing"
something that looks missing. Mirrors the Soarscore board convention.

## No NdcScore backend / BFF — the SPA calls the Soarscore API directly

**Decided:** 2026-09-14 (with the user); **reaffirmed** 2026-09-17 when the
spreadsheet redesign (`kanban/in-progress/single-sheet-calculate.md`) kept
the Calculate orchestration client-side. NdcScore is UI only: React/TS served
from its own origin, talking HTTP to the Soarscore API
(`MapCommand`/`MapQuery` surface). CORS for this lives on the service —
built on SoarScore2 branch `api-cors`
(`SoarScore2/kanban/completed/cors-for-ndcscore-spa.md`), configured via
`Soarscore:Cors:Origins` / `SOARSCORE_CORS_ORIGINS`.

Reasoning: the API is already the single front door with a stable,
OpenAPI-described protocol; a BFF would add a second server to build, deploy
and keep type-aligned for zero gain at club scale (≤ 20 pilots, one organiser
per contest). Revisit only if `email-results.md` forces a server-side
component — that would be a deliberate, narrow reopening, not a redesign.

## Write-through cell commits — retired by batch-on-Calculate

**Decided:** 2026-09-17 (with the user). The original story
(`kanban/completed/single-form-contest-entry.md`) committed each cell through
a debounced command queue. The spreadsheet redesign replaces it: the sheet is
uncommitted text until **Calculate**, which submits the whole sheet and
orchestrates the full command sequence invisibly. Reasoning: the organiser
asked for the xlsm illusion — type anywhere, one button, scores appear.
Write-through turned the app into a wizard with a live queue and made
corrections prompt-heavy; batch gives one obvious commit point, and the
client-local state is still just sheet text (localStorage). The adoption and
retry machinery (`src/sheet/queue.ts`) survives inside the Calculate
orchestrator.

## Live re-score after the first Calculate — batch stays the first-run commit model

**Decided:** 2026-09-23 (with the user, via
`kanban/in-progress/live-rescore-on-edit.md`). Law 4's batch-on-Calculate is
refined, not replaced: the **first** Calculate remains the only commit point
(nothing is submitted until a competition exists); after a successful run the
sheet re-runs the orchestrator automatically, debounced (~1.2 s) behind every
edit, so the results track the typing organiser. The Calculate button stays
as the explicit first-run/force-run affordance. A refused auto-run never
blanks the results block — the last good report stays on screen, the errors
surface in the calculate bar, and the next keystroke simply retries.

## The results refresh button is retired — Calculate and the auto-rescore are the only triggers

**Decided:** 2026-09-25 (with the user, via
`kanban/completed/objective-three-ui-simplifications.md`). The results
block's small "Refresh results" button is removed: the Calculate press (the
explicit first-run commit gate, kept) bumps the results refetch on every run,
and after the first good run the debounced auto-rescore bumps it behind every
edit — a manual refresh is a second, contradictory trigger. Law 4's
batch-on-Calculate stands exactly as refined on 2026-09-23: nothing is
submitted until the organiser presses Calculate; an un-pressed sheet never
sends commands, however complete it looks.

## Correction reasons are never typed by the organiser

**Decided:** 2026-09-17 (with the user). The wire keeps `Reason`/`By`
mandatory on `POST /amend-measurement` (and reopen/annul) — the service event
log stays the audit trail. But the organiser is never prompted: the Calculate
orchestrator auto-fills the reason (`Corrected from scoresheet`) on every
amend, and reopens a completed task-round the same way when a late correction
lands. Reasoning: corrections in the spreadsheet model are just overtyped
cells; asking for prose at that moment breaks the illusion, while dropping
the wire requirement would be a Soarscore-side rule change with weaker audit.

## Unknown-pilot email placeholder

**Decided:** 2026-09-17 (with the user); **refined** 2026-09-17 in
`single-sheet-calculate.md`. `POST /register-person` requires a non-blank
email (`person.contact.missing`), but paper scoresheets rarely carry pilot
emails. Unknown pilots register with the placeholder
`unknown+<name-slug>@mfnz.invalid` — deterministic (the same name resolves to
the same person on every recalculate, so re-runs are idempotent) and unique
(the projection's email index arbitrates; a single shared literal would 409
on the second unknown pilot). The `.invalid` TLD keeps delivery impossible.
Reasoning: making email optional is a Soarscore-side change with real rule
questions (what is a person without an email?); the placeholder costs
nothing. Revisit if the placeholder pollutes `GET /people?email=` searches in
practice — `kanban/backlog/competitor-signup-invites.md` investigates exactly
that (competitor email sign-up so placeholders become reusable, verified
people).

## Landing-tape instruments are out of MVP

**Decided:** 2026-09-17 (with the user). The xlsm's landing-tape selector
variants map to `POST /declare-instruments` (a named instrument plus a
`ReadingScale` of tape marks against the `landingDistance` metric — the wire
support already exists). MVP declares no instruments (the empty declaration
is valid) and captures landing distances as plain metres. Reasoning: the
organiser reads metres off the tape by eye today; a scale editor adds
up-front configuration to the night-one flow for little capture gain. The
single-tape declaration UI is a follow-up story if real tape-reading enters
the workflow.

## Email sending is out of MVP

**Decided:** 2026-09-14 (with the user). The MVP ships the results view with
copy-for-email plain text; nothing in NdcScore sends mail. Reasoning: zero
configuration on night one, and the organiser already has a mail workflow;
direct sending is a follow-up story (`kanban/backlog/email-results.md`).

## Penalties and annul are off the sheet

**Decided:** 2026-09-17 (with the user, in `single-sheet-calculate.md`). The
spreadsheet redesign ships without a penalties/annul UI: in the sheet model
they are annotations, not cells, and their placement (per pilot? per
pilot-round?) is a design question the core illusion does not need answered
on night one. The wire support stays in the client (`record-entry-penalty`,
`annul-entry` — `Reason`/`By` would be auto-filled like corrections) and a
per-pilot affordance can be added once entries exist after a Calculate.
Revisit when an organiser records a real penalty at an NDC.

## Late registration and fold extension are not NdcScore features

**Decided:** 2026-09-30 (with the user). The two blocked `ss_` stories raised
2026-09-23 from `kanban/completed/add-pilots-and-rounds-after-calculate.md`
feedback — `ss_late-registration-after-draw.md` (register onto an accepted
draw, `competition.field.frozen`) and `ss_extend-drawn-fold.md` (draw extra
rounds onto an accepted fold, `drawPhase.alreadyDrawn`) — are **abandoned**
(files removed from `kanban/blocked/` in this commit, not moved to another
lane: there is no abandoned lane, and completed stories are history).

Reasoning: NdcScore is retrospective entry (CLAUDE.md — paper at the field,
scored at home in the evening). Rounds and competitors are known up front
from the paper record; a "late" pilot or an extra round after the first
Calculate is a transcription mismatch against that record, not a live
competition event. The client-side absorption that already landed stays as
the guard: frozen-field and round-count mismatches warn loudly, skip the
cells, and keep the rest of the run moving — but no Soarscore capability is
awaited, and none is requested from this repo.

Soarscore side: no placeholder story raised there either. Pre-entry late
registration already exists via reject → register → redraw → accept
(SoarScore2 `kanban/completed/draw-acceptance-redraw.md`); post-entry refusal
(`rejectDraw.entriesExist`) is deliberate entry-identity safety, and fold
extension has no live requester. A future CD asking for either raises it on
the Soarscore board with rulebook grounding — not carried here.
