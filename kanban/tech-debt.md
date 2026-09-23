# Tech debt

Residual technical debt identified or intentionally deferred while implementing a feature.
See CLAUDE.md house-keeping rule 5.

- [ ] Generated TS client has no drift guard. WI-1 generates the client from
  the API's `/openapi/v1.json`; nothing yet fails a build when the Soarscore
  API surface changes underneath it. Add a CI/regen check the first time the
  client and a deployed API disagree in practice.
- [ ] Pilot-name autocomplete is plain text. The sheet resolves pilots by
  exact name match on Calculate (then by the deterministic placeholder
  email); a typo silently creates a second person. Add debounced
  `GET /people?name=` autocomplete on the pilot-name cell (never without a
  criterion — `findPeople.noCriteria`) when the first duplicate happens in
  practice.
- [ ] Dynamic flight rows grow but never open unsequenced. A task whose
  selection is `all` with no `maxLaunches` adds rows with an explicit client
  computed sequence; the wire also supports open-flight without `Sequence`
  (derived max+1). No NDC seed task needs the difference yet — build it when
  a class does.
- [x] ~~Sheet-vs-draw conflict is fatal, not a guided fix~~ — resolved
  2026-09-23 (`completed/add-pilots-and-rounds-after-calculate.md`): a
  round-count mismatch now absorbs with loud warnings (the drawn fold stays
  the truth; growth names the missing Soarscore draw-extension capability,
  shrink skips without annulling), and a late pilot's `competition.field.frozen`
  is absorbed the same way. Per-round **task** disagreement stays fatal
  deliberately — the cells' meanings would change, so Calculate refuses.
- [ ] Soarscore capabilities this repo cannot build — parked as blocked
  stories 2026-09-23 (user instruction): `ss_late-registration-after-draw.md` →
  late registration onto an accepted draw (`competition.field.frozen`),
  including re-forming groups (F3K min group size 5), and
  `ss_extend-drawn-fold.md` → extending a drawn fold by more rounds (no
  draw-extension verb). Until they land the sheet warns and keeps the rest of
  the evening moving.
- [ ] Draw acceptance is implicit. Calculate draws and immediately accepts
  (`POST /accept-draw`) because capturing needs an accepted draw. A CD who
  wants to inspect or reject a draw before accepting has no UI
  (`reject-draw`/redraw is wire-supported); add an accept step if a CD ever
  asks for it.
- [ ] Calculate runs without a cancellation or offline queue. A failed step
  aborts with the error surfaced; partial cell failures are per-cell and
  retried on the next Calculate. Live re-score (2026-09-23,
  `completed/live-rescore-on-edit.md`) trades on this: edits now re-run the
  whole orchestrator debounced while the organiser keeps typing — still fine
  at club scale (runs are idempotent diffs), but the no-cancellation note
  now applies per auto-run, not just per button press.
