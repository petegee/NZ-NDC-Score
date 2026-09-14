# Story — Email results

**Status:** Backlog stub · **Raised:** 2026-09-14

## What

Direct sending of the results email from the app (SMTP account config, or a
server-side mail helper), instead of the MVP's copy-for-email text.

## Why it matters

Removes the manual copy/paste step. Deferred out of MVP by user decision
2026-09-14 until the core flow is proven — see `deferred-decisions.md`.

## Before starting

- Depends on `results-view-and-export.md` (the rendered table is the payload).
- Decide SMTP-in-browser (won't work — browsers can't speak raw SMTP) vs a
  tiny send function alongside the API vs a third-party transactional API;
  that is the story's first decision, and it may reopen the "no backend"
  deferred decision deliberately and narrowly.
