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
- [ ] Sheet-vs-draw conflict is fatal, not a guided fix. When the drawn
  schedule disagrees with the sheet (rounds or tasks), Calculate stops with
  an error telling the organiser the drawn schedule wins. A friendlier path —
  adopt-the-draw-and-reflow-the-sheet affordance — is unbuilt.
- [ ] Draw acceptance is implicit. Calculate draws and immediately accepts
  (`POST /accept-draw`) because capturing needs an accepted draw. A CD who
  wants to inspect or reject a draw before accepting has no UI
  (`reject-draw`/redraw is wire-supported); add an accept step if a CD ever
  asks for it.
- [ ] Calculate runs without a cancellation or offline queue. A failed step
  aborts with the error surfaced; partial cell failures are per-cell and
  retried on the next Calculate. There is no background retry while the
  organiser keeps typing — acceptable at club scale, revisit if an evening
  ever outgrows it.
