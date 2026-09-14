# Tech debt

Residual technical debt identified or intentionally deferred while implementing a feature.
See CLAUDE.md house-keeping rule 5.

- [ ] Generated TS client has no drift guard. WI-1 generates the client from
  the API's `/openapi/v1.json`; nothing yet fails a build when the Soarscore
  API surface changes underneath it. Add a CI/regen check the first time the
  client and a deployed API disagree in practice.
