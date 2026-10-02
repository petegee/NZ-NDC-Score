# Organiser people admin — grant/revoke Organiser from the UI

**Status:** In progress · **Raised:** 2026-10-02 · **Source:** beta cohort needs Organiser without per-tester Fly secrets

## What

A People tab (signed-in app only) that lists people via `GET /people` and
grants/revokes the Organiser role via `POST /grant-role` / `/revoke-role`.
Replaces the bootstrap-secrets round-trip for each new tester.

## Notes

- `GET /who-am-i` gates the page: non-organisers get the ask-an-organiser
  note (`/people` is organiser-only on the API, so no point showing the list).
- PersonRole crosses the wire numerically (Competitor = 0, Organiser = 1) —
  the API has no string-enum converter. The client sends numbers and reads
  back either shape (`holdsRole` / `personRoleLabel` in `api/types.ts`).
- No Soarscore changes: all four endpoints already existed.

## Acceptance

- [ ] Organiser searches a tester by email and grants Organiser; tester can Calculate.
- [ ] Revoke removes it; non-organiser sees the note, never the list.
- [ ] `npm test` / `lint` / `build` green.
