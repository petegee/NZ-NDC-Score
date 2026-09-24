# Story — Objective Three: drop the results refresh button, drop the checklist, field size decided up front

**Status:** Completed · **Raised:** 2026-09-25 (user objective) — three UI
simplifications that finish what `live-rescore-on-edit.md` started.

## What

1. **The small Refresh results button (bottom of the results block) is
   removed.** Edits auto-rescore and every run bumps the results refetch — a
   manual refresh button is a second, contradictory trigger. *The big green
   Calculate button stays*: it is the explicit first-run commit gate.
2. **The calculate bar's step checklist shows errors and warnings only**
   (every ✓ step line is gone); warn/error entries still stream in.
3. **Add/remove-pilot is removed.** The field size is an up-front decision —
   a "Pilots" input in the Contest panel — and cannot change once scored.

An earlier take of this story also removed the big Calculate button and made
a complete sheet run itself; the user corrected the target — the button to
remove was the results block's refresh, and the first Calculate must stay
manually triggered.

**Follow-up (same day, user request):** gaps that leave a round open now
name themselves — "Round 1 left open — 2 gap(s)" gains a detail line from
the recording view's own facts: `Ben Tu has no entry; Ana Silva flight 2:
Flight time not captured` (pilot names from the report's names map, metric
labels from the round's columns, raw metric names as fallback — no new
service surface). Cell parse errors in the calculate bar are decoded the
same way: `Round 1 · row 2 · flight 1 · <code>flightTime</code>: not a
time` replaces the raw `r1|p2|f1|flightTime` key.

## How it landed (2026-09-25)

- `results.tsx`: the "Refresh results" button and its `refresh` state are
  gone — `signal` (bumped by every Calculate run, manual or debounced) is the
  only refetch trigger. Read-back stays law-2-verbatim.
- `SheetPage.tsx`: progress list filters to `status !== 'ok'`; the Calculate
  button stays as the commit gate (nothing auto-runs before the first
  successful run — `scheduleAuto` remains `autoArmed`-gated);
  `'+ Add competitor'` block and the per-row ✕ column removed; Pilots input
  added after Rounds — drafts locally and commits on blur/Enter (a shrink
  prunes cells, so per-keystroke resize would destroy data mid-type),
  disabled while running or once a good report exists.
- `sheet.ts`: `addPilot`/`removePilot` replaced by `setPilotCount` — shrink
  slices rows and prunes every cell below the line (same rule as
  `setRounds`, no re-keying), grow lays blank rows back on; floor of 1.
- `calculate.ts` unchanged — the progress sink is kept (tests use it); the UI
  simply stops showing ok steps.
- `index.css`: `progress-ok` marker and `.add-competitor` styles pruned;
  `.calculate` styles stay (the button is back).
- Tests updated across `sheet.test.ts`, `calculate.test.ts`,
  `SheetPage.test.tsx` and the two live tests (171 passing, 6 live-gated
  skipped); lint and build clean.
