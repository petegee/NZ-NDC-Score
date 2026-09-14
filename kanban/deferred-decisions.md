# Deferred decisions

Things decided *not* to do (yet), with the reasoning. Read before "fixing"
something that looks missing. Mirrors the Soarscore board convention.

## No NdcScore backend / BFF — the SPA calls the Soarscore API directly

**Decided:** 2026-09-14 (with the user). NdcScore is UI only: React/TS served
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

## Email sending is out of MVP

**Decided:** 2026-09-14 (with the user). The MVP ships the results view with
copy-for-email plain text; nothing in NdcScore sends mail. Reasoning: zero
configuration on night one, and the organiser already has a mail workflow;
direct sending is a follow-up story (`kanban/backlog/email-results.md`).
