import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createApi } from '../api/client'
import type { FetchLike } from '../api/wire'
import type { ClassDefinitionSummary } from '../api/types'
import { isNdcClass, latestPerClass } from './classes'
import { formatValue } from '../grid/parse'
import type { FlightRowSpec, GridColumn } from '../grid/schema'
import { EXACT_ZERO_HINT } from '../grid/schema'
import { F3J_INSTRUMENT, LANDING_METRIC, TAPE_CHOICES, landingColumnLabel, readingSetFor, type TapeChoice } from './tapes'
import {
  initialSheet,
  loadSheet,
  paramsBoundAt,
  paramPlaceholder,
  parseParamInput,
  parsePenaltyText,
  penaltyOptions,
  phaseRoundsKind,
  phaseTasks,
  roundTimeHint,
  saveSheet,
  sheetCellKey,
  sheetCellParts,
  sheetPenaltyKey,
  sheetReducer,
  sheetRoundGrids,
  visibleFlightRows,
  type PenaltyOption,
  type SheetState,
} from './sheet'
import { runCalculate, type CalcProgress, type CalcReport } from './calculate'
import { fieldSizeWarnings, formatFieldSizeWarning } from './fieldSize'
import { parseDateText } from './dateText'
import { useStickyHead } from './sticky-head'
import { SheetResults } from './results'

/** Debounce window for the live re-score after the first successful
 * Calculate — short enough to feel live, long enough to let a keystroke
 * burst finish. */
const AUTO_RESCORE_DEBOUNCE_MS = 1200

function errorText(error: unknown): string {
  const code = (error as { code?: string }).code
  const detail = (error as { detail?: string }).detail
  if (code) return `${code}: ${detail ?? ''}`
  return String((error as Error)?.message ?? error)
}

export function SheetPage({
  base,
  fetchImpl,
  cdDefault = '',
}: {
  base: string
  fetchImpl?: FetchLike
  cdDefault?: string
}) {
  const api = useMemo(() => createApi(base, fetchImpl), [base, fetchImpl])
  const [state, dispatch] = useReducer(sheetReducer, undefined, loadSheet)
  const [classList, setClassList] = useState<ClassDefinitionSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<CalcProgress[]>([])
  const [report, setReport] = useState<CalcReport | null>(null)
  // Whether Calculate has been pressed since the current class was chosen —
  // the too-small-field banner stays hidden until then (a fresh class with
  // no pilots yet is the normal starting point, not a warning).
  const [hasAttempted, setHasAttempted] = useState(false)
  const [resultsSignal, setResultsSignal] = useState(0)
  const [paramsOpen, setParamsOpen] = useState(false)
  // The Pilots input is a decision, not a live resize: shrinking drops cells,
  // so the typed draft commits on blur/Enter instead of per keystroke.
  const [pilotsDraft, setPilotsDraft] = useState<string | null>(null)
  // The Date input takes free text (the native date widget forced dd/mm and
  // let a 5-digit year through to the wire): the draft parses as it is
  // typed — a valid reading commits the ISO date straight away — and on
  // blur/Enter the field normalises to the committed ISO. An unparseable
  // draft keeps last good value on the wire and the error under the field.
  // A calendar button beside it opens the browser's picker (a hidden native
  // date input) for mouse-first organisers; a picked date commits the same
  // ISO through the same path.
  const [dateDraft, setDateDraft] = useState<string | null>(null)
  const datePickerRef = useRef<HTMLInputElement>(null)
  const dateDraftParse = dateDraft === null ? null : parseDateText(dateDraft)
  const dateError =
    dateDraftParse && !dateDraftParse.ok && dateDraft!.trim() !== '' ? dateDraftParse.error : null

  // Latest sheet text for callbacks that must not re-trigger effects —
  // synced in an effect, read from event handlers and the debounced re-run.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  // Live re-score (after the first Calculate): edits re-run the orchestrator
  // debounced; the last good report stays on screen when a run is refused.
  const autoArmedRef = useRef(false)
  const runningRef = useRef(false)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lastGood, setLastGood] = useState<CalcReport | null>(null)
  // The prior identity mapping for the next orchestrator run (sheet row →
  // competitor): the last successful report, read through a ref so a run
  // started by the debounced timer always sees the latest mapping.
  const lastGoodRef = useRef<CalcReport | null>(null)

  // The sheet text is the only client state — persist every keystroke.
  useEffect(() => {
    saveSheet(state)
  }, [state])

  // Default the Contest Director to the signed-in user. Only fills a blank
  // field — a typed name, including one restored from a saved draft, is
  // never overwritten. Re-fills after Reset (which blanks the field).
  useEffect(() => {
    if (cdDefault.trim() !== '' && state.cdName.trim() === '') {
      dispatch({ type: 'setField', field: 'cdName', value: cdDefault })
    }
  }, [cdDefault, state.cdName])

  useEffect(() => {
    api
      .findClassDefinitions({ activeOnly: true })
      .then((res) => setClassList(latestPerClass(res.value.filter(isNdcClass))))
      .catch((error: unknown) => setLoadError(errorText(error)))
  }, [api])

  const definition = state.classDefinition
  const grids = useMemo(
    () => (definition ? sheetRoundGrids(definition, state.rounds, state.taskPicks) : []),
    [definition, state.rounds, state.taskPicks],
  )
  const catalogue = definition ? phaseRoundsKind(definition) === 'ChooseFromCatalogue' : false
  const tasks = definition ? phaseTasks(definition) : []
  const setupParams = definition ? paramsBoundAt(definition, 'CompetitionSetup') : []
  const beforeFlyingParams = definition ? paramsBoundAt(definition, 'BeforeFlying') : []
  const penalties = useMemo(() => (definition ? penaltyOptions(definition) : []), [definition])
  const perRoundParamNames = [
    ...new Set(grids.flatMap((rg) => rg.perRoundParams.map((p) => p.name))),
  ]
  // Friendly too-small-field warning (WI-1): each visible round's task
  // minimum against the named sheet rows. Displayed only after the first
  // Calculate press (see hasAttempted) — before that an empty sheet is the
  // starting point, not a warning. No fold bindings exist before the first
  // run, so `{ param }` minima resolve from the sheet's parameter text →
  // declared defaults; unresolvable rounds warn nothing and the engine
  // error still rules.
  const fieldWarnings = useMemo(
    () =>
      definition
        ? fieldSizeWarnings(definition, state.rounds, state.taskPicks, state.pilots, state.params)
        : [],
    [definition, state.rounds, state.taskPicks, state.pilots, state.params],
  )

  // The contest has no name field (bug #4): calculate.ts fabricates the name
  // Soarscore sees from the date, location and adopted class — the organiser
  // never types one and never sees one.

  // Header column spans must cover the widest pilot's visible flight rows.
  const rowCountPerRound = useMemo(
    () =>
      grids.map((rg) =>
        Math.max(
          1,
          ...state.pilots.map((_, pi) =>
            visibleFlightRows(rg.grid, rg.roundOrdinal, pi + 1, state.cells).length,
          ),
        ),
      ),
    [grids, state.pilots, state.cells],
  )

  const pickClass = async (hash: string) => {
    setLoadError(null)
    setHasAttempted(false)
    try {
      const res = await api.getClassDefinition(hash)
      dispatch({ type: 'classChosen', contentHash: hash, definition: res.value })
    } catch (error) {
      setLoadError(errorText(error))
    }
  }

  const calculate = async () => {
    setHasAttempted(true)
    if (runningRef.current) {
      dirtyRef.current = true
      return
    }
    runningRef.current = true
    setRunning(true)
    setProgress([])
    setReport(null)
    const rep = await runCalculate(api, stateRef.current, (p) => setProgress((prev) => [...prev, p]), lastGoodRef.current ?? undefined)
    setReport(rep)
    runningRef.current = false
    setRunning(false)
    if (rep.ok && rep.competitionId) {
      setLastGood(rep)
      lastGoodRef.current = rep
      autoArmedRef.current = true
    }
    if (rep.competitionId && rep.schedule.length > 0) setResultsSignal((n) => n + 1)
    // An edit landed while the run was in flight: go again with the latest
    // sheet so nothing typed during the run stays un-reflected.
    if (dirtyRef.current && rep.competitionId) {
      dirtyRef.current = false
      scheduleAuto()
    }
  }

  // The Calculate press is the commit gate: nothing is submitted until the
  // first successful run arms the live re-score. From then on every edit
  // schedules a debounced re-run; a refused run keeps the last good results
  // on screen and the next keystroke simply retries.
  const scheduleAuto = () => {
    if (!autoArmedRef.current || runningRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      dirtyRef.current = false
      void calculate()
    }, AUTO_RESCORE_DEBOUNCE_MS)
  }

  useEffect(() => {
    if (!autoArmedRef.current) return
    dirtyRef.current = true
    scheduleAuto()
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    // scheduleAuto reads only refs and state setters — sheet text changes
    // are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Show the latest good report; a refused run (validation, network, cell
  // errors) keeps the previous results on screen instead of blanking them —
  // the errors surface in the calculate bar.
  const results = report?.ok && report.competitionId
    ? report
    : lastGood?.ok && lastGood.competitionId
      ? lastGood
      : null

  // Error → cell highlighting: every error the calculate bar shows that
  // directly relates to a textbox/cell also puts a red border on that exact
  // control. Grid cells highlight from the report's cellErrors (sheet key →
  // message); header/parameter/pilot/penalty problems highlight from the
  // report's problem strings intersected with the current sheet text, so a
  // highlight clears as soon as its field is fixed, and grid highlights
  // persist alongside the error bar until the next Calculate.
  const cellErrorMap = useMemo(
    () => new Map((report?.cellErrors ?? []).map((c) => [c.key, c.error] as const)),
    [report],
  )
  const problemSet = useMemo(() => new Set(report?.problems ?? []), [report])
  const penaltyErrorKeys = useMemo(() => {
    if (!report || !definition) return new Set<string>()
    if (![...problemSet].some((p) => p.includes('is not an infraction'))) return new Set<string>()
    const declared = new Set((definition.penalties ?? []).map((p) => p.infractionType))
    const out = new Set<string>()
    for (const [key, text] of Object.entries(state.cells)) {
      if (!text.trim()) continue
      let parts: ReturnType<typeof sheetCellParts>
      try {
        parts = sheetCellParts(key)
      } catch {
        continue
      }
      if (parts.metric !== 'penalties') continue
      if (!grids.some((r) => r.roundOrdinal === parts.roundOrdinal)) continue
      for (const t of parsePenaltyText(text)) {
        if (!declared.has(t)) {
          out.add(key)
          break
        }
      }
    }
    return out
  }, [report, definition, state.cells, problemSet, grids])
  const duplicatePilotRows = useMemo(() => {
    if (![...problemSet].some((p) => p.includes('duplicated'))) return new Set<number>()
    const seen = new Map<string, number>()
    const dup = new Set<number>()
    state.pilots.forEach((row, idx) => {
      const key = row.name.trim().toLowerCase()
      if (!key) return
      const first = seen.get(key)
      if (first !== undefined) {
        dup.add(first)
        dup.add(idx)
      } else {
        seen.set(key, idx)
      }
    })
    return dup
  }, [problemSet, state.pilots])
  const paramErrorNames = useMemo(() => {
    if (!report || !definition) return new Set<string>()
    const out = new Set<string>()
    const seen = new Set<string>()
    const allParams = definition
      ? [
          ...paramsBoundAt(definition, 'CompetitionSetup'),
          ...paramsBoundAt(definition, 'BeforeFlying'),
          ...grids.flatMap((g) => g.perRoundParams),
        ]
      : []
    for (const p of allParams) {
      if (seen.has(p.name)) continue
      seen.add(p.name)
      const parsed = parseParamInput(p, state.params[p.name] ?? '')
      if (!parsed.ok && !parsed.blank && problemSet.has(parsed.error)) out.add(p.name)
    }
    return out
  }, [report, definition, grids, state.params, problemSet])
  const locationInvalid = problemSet.has('Location is required.') && !state.location.trim()
  const cdInvalid =
    problemSet.has('CD name is required.') && !state.cdName.trim()
  const dateRequiredInvalid = problemSet.has('Date is required.') && !state.date.trim()
  const dateInvalid = dateRequiredInvalid || dateError !== null
  const classInvalid =
    problemSet.has('Pick the adopted class first.') && (!definition || !state.classContentHash)
  const tapeInvalid = useMemo(
    () => (report?.steps ?? []).some((s) => s.step === 'instruments' && s.status === 'error'),
    [report],
  )

  return (
    <main className="sheet-page">
      <header className="page-head">
        <h1>NDC Scoresheet</h1>
        <p className="lede">
          Type anywhere, any time. <strong>Calculate</strong> scores the whole sheet — after that,
          every edit re-scores automatically.
        </p>
      </header>

      {loadError && <p className="error-bar">{loadError}</p>}

      <section className="panel contest-card">
        <h2 className="panel-title">Contest</h2>
        <div className="field-grid">
          <label className="span-3">
            <span>Class</span>
            <select
              value={state.classContentHash ?? ''}
              className={classInvalid ? 'cell-error' : undefined}
              aria-invalid={classInvalid || undefined}
              title={classInvalid ? 'Pick the adopted class first.' : undefined}
              onChange={(e) => void pickClass(e.target.value)}
            >
              <option value="">— pick the NDC class —</option>
              {(classList ?? []).map((c) => (
                <option key={c.contentHash} value={c.contentHash}>
                  {c.faiDesignation ? `${c.faiDesignation} — ` : ''}
                  {c.name} · v{c.version}
                </option>
              ))}
            </select>
          </label>
          <label className="span-3">
            <span>Location</span>
            <input
              value={state.location}
              className={locationInvalid ? 'cell-error' : undefined}
              aria-invalid={locationInvalid || undefined}
              title={locationInvalid ? 'Location is required.' : undefined}
              onChange={(e) => dispatch({ type: 'setField', field: 'location', value: e.target.value })}
            />
          </label>
          <label className="span-2">
            <span>Date</span>
            <div className="date-field">
              <input
                type="text"
                value={dateDraft ?? state.date}
                placeholder="d/m/yyyy — e.g. 5/9/2026"
                className={dateInvalid ? 'cell-error' : undefined}
                aria-invalid={dateInvalid || undefined}
                title={dateError ?? (dateRequiredInvalid ? 'Date is required.' : undefined)}
                onChange={(e) => {
                  const text = e.target.value
                  setDateDraft(text)
                  const parsed = parseDateText(text)
                  if (parsed.ok) {
                    dispatch({ type: 'setField', field: 'date', value: parsed.iso })
                  }
                }}
                onBlur={() => {
                  if (dateDraft === null) return
                  const parsed = parseDateText(dateDraft)
                  if (parsed.ok) {
                    dispatch({ type: 'setField', field: 'date', value: parsed.iso })
                    setDateDraft(null)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
              <button
                type="button"
                className="date-picker-btn"
                aria-label="Pick the contest date"
                title="Pick a date"
                onClick={() => {
                  try {
                    datePickerRef.current?.showPicker()
                  } catch {
                    // no picker in this browser — the text field still works
                  }
                }}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="5" y1="1" x2="5" y2="4" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="11" y1="1" x2="11" y2="4" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <input
                ref={datePickerRef}
                type="date"
                className="date-native"
                aria-label="date picker source"
                tabIndex={-1}
                onChange={(e) => {
                  const iso = e.target.value
                  e.target.value = ''
                  if (!iso) return
                  dispatch({ type: 'setField', field: 'date', value: iso })
                  setDateDraft(null)
                }}
              />
            </div>
            {dateError && <small className="field-error">{dateError}</small>}
          </label>
          <label className="span-2">
            <span>Contest Director</span>
            <input
              value={state.cdName}
              className={cdInvalid ? 'cell-error' : undefined}
              aria-invalid={cdInvalid || undefined}
              title={cdInvalid ? 'CD name is required.' : undefined}
              onChange={(e) => dispatch({ type: 'setField', field: 'cdName', value: e.target.value })}
            />
          </label>
          <label>
            <span>Rounds</span>
            <input
              inputMode="numeric"
              value={String(state.rounds)}
              onChange={(e) => dispatch({ type: 'setRounds', rounds: Number(e.target.value) })}
            />
          </label>
          <label>
            <span>Pilots</span>
            <input
              inputMode="numeric"
              value={pilotsDraft ?? String(state.pilots.length)}
              title={
                results
                  ? 'The field is fixed once the sheet is scored'
                  : 'Number of competitor rows — blank rows are fine, they stay blank until a name is entered'
              }
              disabled={running || results !== null}
              onChange={(e) => setPilotsDraft(e.target.value)}
              onBlur={() => {
                if (pilotsDraft === null) return
                dispatch({ type: 'setPilotCount', count: Number(pilotsDraft) })
                setPilotsDraft(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </label>
          <label className="span-3">
            <span>Landing tape</span>
            <select
              value={state.tapeChoice}
              className={tapeInvalid ? 'cell-error' : undefined}
              aria-invalid={tapeInvalid || undefined}
              onChange={(e) => dispatch({ type: 'setTapeChoice', choice: e.target.value as TapeChoice })}
            >
              {TAPE_CHOICES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <small className="sub-note">0 is the off-tape reading — record 0 for a landing that scores zero landing points.</small>
          </label>
        </div>
        {catalogue && (
          <section className="sub-panel">
            <h3 className="sub-title">Task per round</h3>
            <div className="field-grid">
              {Array.from({ length: state.rounds }, (_, i) => (
                <label key={i} className="span-2">
                  <span>Round {i + 1}</span>
                  <select
                    value={state.taskPicks[i] ?? tasks[i % Math.max(tasks.length, 1)]?.code ?? ''}
                    onChange={(e) => dispatch({ type: 'setTaskPick', roundIndex: i, taskRef: e.target.value })}
                  >
                    {tasks.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} — {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        )}
        {(setupParams.length > 0 || beforeFlyingParams.length > 0 || perRoundParamNames.length > 0) && (
          <section className="sub-panel">
            <div className="sub-head">
              <button
                type="button"
                className="params-toggle"
                aria-expanded={paramsOpen}
                title={paramsOpen ? 'Hide parameters (defaults apply when blank)' : 'Show parameters'}
                onClick={() => setParamsOpen(!paramsOpen)}
              >
                {paramsOpen ? '−' : '+'}
              </button>
              <h3 className="sub-title">Parameters</h3>
              <span className="sub-note">defaults apply when blank</span>
            </div>
            {paramsOpen && (
              <div className="field-grid">
                {[...setupParams, ...beforeFlyingParams, ...grids.flatMap((g) => g.perRoundParams)]
                  .filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i)
                  .map((p) => {
                    const paramInvalid = paramErrorNames.has(p.name)
                    const paramProblem = [...problemSet].find((m) => m.startsWith(`${p.name}:`) || m.startsWith(`${p.name} must be`) || m.startsWith(`${p.name} is required`))
                    return (
                    <label key={p.name} className="span-2">
                      <span>
                        {p.name}
                        {p.unit ? ` (${p.unit})` : ''} — {p.boundAt ?? 'CompetitionSetup'}
                      </span>
                      <input
                        value={state.params[p.name] ?? ''}
                        placeholder={paramPlaceholder(p)}
                        className={paramInvalid ? 'cell-error' : undefined}
                        aria-invalid={paramInvalid || undefined}
                        title={paramInvalid ? paramProblem : undefined}
                        onChange={(e) => dispatch({ type: 'setParam', name: p.name, text: e.target.value })}
                      />
                    </label>
                    )
                  })}
              </div>
            )}
          </section>
        )}
      </section>

      {grids.length > 0 && (
        <SheetGrid
          state={state}
          grids={grids}
          rowCountPerRound={rowCountPerRound}
          penalties={penalties}
          dispatch={dispatch}
          cellErrorMap={cellErrorMap}
          penaltyErrorKeys={penaltyErrorKeys}
          duplicatePilotRows={duplicatePilotRows}
        />
      )}

      <section className="calculate-bar">
        {hasAttempted && fieldWarnings.length > 0 && (
          <div className="warning-bar" role="note" aria-label="Field too small for the draw">
            {fieldWarnings.map((w) => (
              <p key={w.roundOrdinal}>{formatFieldSizeWarning(w)}</p>
            ))}
          </div>
        )}
        <button type="button" className="calculate" disabled={running} onClick={() => void calculate()}>
          {running ? 'Calculating…' : 'Calculate'}
        </button>
        <button
          type="button"
          className="reset"
          disabled={running}
          onClick={() => {
            if (window.confirm('Clear the whole sheet — every cell, pilot and header field?')) {
              dispatch({ type: 'replace', state: initialSheet() })
              setReport(null)
              setProgress([])
              setHasAttempted(false)
              setPilotsDraft(null)
              autoArmedRef.current = false
              setLastGood(null)
              lastGoodRef.current = null
              if (timerRef.current) {
                clearTimeout(timerRef.current)
                timerRef.current = null
              }
            }
          }}
        >
          Reset
        </button>
        {report && !running && report.problems.length > 0 && (
          <div className="error-bar">
            {report.problems.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
        {report && !running && report.cellErrors.length > 0 && (
          <div className="error-bar">
            {report.cellErrors.map((c) => {
              const parts = sheetCellParts(c.key)
              return (
                <p key={c.key}>
                  Round {parts.roundOrdinal} · row {parts.pilotRow} · flight {parts.flightSequence} ·{' '}
                  <code>{parts.metric}</code>: {c.error}
                </p>
              )
            })}
          </div>
        )}
        {progress.some((p) => p.status !== 'ok') && (
          <ol className="progress">
            {progress
              .filter((p) => p.status !== 'ok')
              .map((p, i) => (
                <li key={i} className={`progress-${p.status}`}>
                  {p.label}
                  {p.detail ? ` — ${p.detail}` : ''}
                </li>
              ))}
          </ol>
        )}
      </section>

      {results && (
        <SheetResults
          api={api}
          competitionId={results.competitionId!}
          names={new Map(Object.entries(results.names))}
          schedule={results.schedule}
          signal={resultsSignal}
          grids={grids}
          cells={state.cells}
          rowCompetitors={results.rowCompetitors}
          rowCountPerRound={rowCountPerRound}
          tapeChoice={state.tapeChoice}
        />
      )}

      <footer className="page-foot">
        Powered by <a href="https://github.com/petegee/Soarscore2">Soarscore</a>
      </footer>
    </main>
  )
}

function SheetGrid({
  state,
  grids,
  rowCountPerRound,
  penalties,
  dispatch,
  cellErrorMap,
  penaltyErrorKeys,
  duplicatePilotRows,
}: {
  state: SheetState
  grids: ReturnType<typeof sheetRoundGrids>
  rowCountPerRound: number[]
  penalties: PenaltyOption[]
  dispatch: (action: Parameters<typeof sheetReducer>[1]) => void
  cellErrorMap: Map<string, string>
  penaltyErrorKeys: Set<string>
  duplicatePilotRows: Set<number>
}) {
  const { tableRef, headRowRef } = useStickyHead<HTMLTableElement>()
  return (
    <table ref={tableRef} className="grid sheet-grid sticky-head">
      <thead>
        <tr ref={headRowRef}>
          <th rowSpan={2} className="pilot-col">
            Pilot
          </th>
          <th rowSpan={2} className="mfnz-col">
            MFNZ #
          </th>
          {grids.map((rg, i) => {
            const timeHint = state.classDefinition
              ? roundTimeHint(state.classDefinition, rg, state.params)
              : undefined
            return (
              <th
                key={rg.roundOrdinal}
                colSpan={
                  rowCountPerRound[i] * shownColumns(rg).length + (withComplianceColumn(rg, penalties) ? 1 : 0)
                }
                className={roundCellClassName(i, true)}
              >
                Round {rg.roundOrdinal} · <code>{rg.taskRef}</code> {rg.grid.taskName}
                {timeHint ? (
                  <>
                    <br />
                    <span className="target-label">{timeHint}</span>
                  </>
                ) : null}
              </th>
            )
          })}
        </tr>
        <tr>
          {grids.map((rg, i) => {
            const cols = shownColumns(rg)
            return (
              <Fragment key={rg.roundOrdinal}>
                {Array.from({ length: rowCountPerRound[i] }, (_, rowIdx) =>
                  cols.map((col, ci) => (
                    <th
                      key={`${rg.roundOrdinal}:${rowIdx}:${col.metric}`}
                      className={roundCellClassName(i, rowIdx === 0 && ci === 0, rowIdx > 0 && ci === 0, 'col-head')}
                    >
                      {rg.grid.flightRows[rowIdx]?.targetLabel ? (
                        <span className="target-label">
                          {rg.grid.flightRows[rowIdx].targetLabel}
                          <br />
                        </span>
                      ) : null}
                      <small>
                        {col.metric === LANDING_METRIC ? (
                          landingColumnLabel(state.tapeChoice)
                        ) : (
                          <>
                            {col.label}
                            {col.unit ? ` (${col.unit})` : ''}
                          </>
                        )}
                      </small>
                    </th>
                  )),
                ).flat()}
                {withComplianceColumn(rg, penalties) && (
                  <th
                    key={`${rg.roundOrdinal}:penalties`}
                    className={roundCellClassName(i, cols.length === 0, false, 'col-head')}
                  >
                    More
                  </th>
                )}
              </Fragment>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {state.pilots.map((pilot, pi) => (
          <tr key={pi}>
            <td className="pilot-col">
              <input
                className={`cell${duplicatePilotRows.has(pi) ? ' cell-error' : ''}`}
                value={pilot.name}
                placeholder="Pilot name"
                aria-invalid={duplicatePilotRows.has(pi) || undefined}
                title={duplicatePilotRows.has(pi) ? 'Pilot name duplicated.' : undefined}
                onChange={(e) => dispatch({ type: 'setPilot', index: pi, patch: { name: e.target.value } })}
              />
            </td>
            <td className="mfnz-col">
              <input
                className="cell"
                value={pilot.mfnz}
                placeholder="MFNZ #"
                onChange={(e) => dispatch({ type: 'setPilot', index: pi, patch: { mfnz: e.target.value } })}
              />
            </td>
            {grids.map((rg, i) => {
              const keyCols = shownColumns(rg)
              return (
                <Fragment key={rg.roundOrdinal}>
                  {Array.from({ length: rowCountPerRound[i] }, (_, rowIdx) => {
                    const spec: FlightRowSpec =
                      visibleFlightRows(rg.grid, rg.roundOrdinal, pi + 1, state.cells)[rowIdx] ?? {
                        sequence: rowIdx + 1,
                        label: `Flight ${rowIdx + 1}`,
                        dynamic: true,
                      }
                    const enabled =
                      (visibleFlightRows(rg.grid, rg.roundOrdinal, pi + 1, state.cells).length ?? 0) > rowIdx
                    return keyCols.map((col, ci) => {
                      const cellKey = sheetCellKey(rg.roundOrdinal, pi + 1, spec.sequence, col.metric)
                      const cellError = cellErrorMap.get(cellKey)
                      return (
                      <td
                        key={`${rowIdx}:${col.metric}`}
                        className={roundCellClassName(i, rowIdx === 0 && ci === 0, rowIdx > 0 && ci === 0)}
                      >
                        <SheetCell
                          text={state.cells[cellKey] ?? ''}
                          enabled={enabled}
                          column={col}
                          tapeChoice={col.metric === LANDING_METRIC ? state.tapeChoice : undefined}
                          placeholder={
                            rg.grid.zeroHintMetrics.includes(col.metric) ? EXACT_ZERO_HINT : undefined
                          }
                          invalid={cellError !== undefined}
                          errorText={cellError}
                          onText={(text) =>
                            dispatch({
                              type: 'setCell',
                              key: cellKey,
                              text,
                            })
                          }
                        />
                      </td>
                      )
                    })
                  })}
                  {withComplianceColumn(rg, penalties) && (
                    <td className={roundCellClassName(i, keyCols.length === 0)}>
                      <PenaltyCell
                        text={state.cells[sheetPenaltyKey(rg.roundOrdinal, pi + 1)] ?? ''}
                        options={penalties}
                        flightRows={visibleFlightRows(rg.grid, rg.roundOrdinal, pi + 1, state.cells)}
                        assumed={assumedColumns(rg)}
                        invalid={
                          cellErrorMap.has(sheetPenaltyKey(rg.roundOrdinal, pi + 1)) ||
                          penaltyErrorKeys.has(sheetPenaltyKey(rg.roundOrdinal, pi + 1))
                        }
                        errorText={
                          cellErrorMap.get(sheetPenaltyKey(rg.roundOrdinal, pi + 1)) ??
                          (penaltyErrorKeys.has(sheetPenaltyKey(rg.roundOrdinal, pi + 1))
                            ? 'Not an infraction declared by the adopted class.'
                            : undefined)
                        }
                        cellText={(sequence, metric) =>
                          state.cells[sheetCellKey(rg.roundOrdinal, pi + 1, sequence, metric)] ?? ''
                        }
                        onText={(text) =>
                          dispatch({
                            type: 'setCell',
                            key: sheetPenaltyKey(rg.roundOrdinal, pi + 1),
                            text,
                          })
                        }
                        onCell={(sequence, metric, text) =>
                          dispatch({
                            type: 'setCell',
                            key: sheetCellKey(rg.roundOrdinal, pi + 1, sequence, metric),
                            text,
                          })
                        }
                      />
                    </td>
                  )}
                </Fragment>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Key metric columns — the only columns that get grid real estate. A metric
 * with a declared whenNotRecorded assumption is non-key: blank means the
 * assumption, so only an exception is ever recorded, and it is captured in
 * the round's drop list instead of its own column (Functional Overview). The
 * stopwatch split's overfly metric is owned by the split at Calculate and
 * never takes direct entry, so it gets no column either — the round shows the
 * one Flight time column (the organiser's stopwatch reading) where the class
 * declares the flightTime + overflySeconds pair. */
function shownColumns(rg: ReturnType<typeof sheetRoundGrids>[number]): GridColumn[] {
  return rg.grid.columns.filter(
    (c) => c.whenNotRecorded === undefined && c.stopwatchRole !== 'overfly',
  )
}

/** Non-key metrics of the round — one drop-list entry per metric, definition
 * order, no repeats. The split's overfly metric is not a compliance fact the
 * CD records — it is derived from the stopwatch reading. */
function assumedColumns(rg: ReturnType<typeof sheetRoundGrids>[number]): GridColumn[] {
  return [
    ...new Map(
      rg.grid.columns
        .filter((c) => c.whenNotRecorded !== undefined && c.stopwatchRole !== 'overfly')
        .map((c) => [c.metric, c] as const),
    ).values(),
  ]
}

/** The round shows a penalties/compliance column when it has anything to
 * record: the class's declared penalties plus the round's optional metrics
 * (flags and values whose blank resolves to a whenNotRecorded assumption). */
function withComplianceColumn(
  rg: ReturnType<typeof sheetRoundGrids>[number],
  penalties: PenaltyOption[],
): boolean {
  return penalties.length > 0 || assumedColumns(rg).length > 0
}

/** Round-group separation (Functional Overview: columns are visually grouped
 * by group-round): a heavy rule opens each round block, a lighter rule opens
 * each flight-row group inside it, alternate rounds are tinted. `isBlockStart`
 * marks the block's first cell; empty tasks (flags only) start at their
 * penalty column. */
function roundCellClassName(
  roundIndex: number,
  isBlockStart: boolean,
  isFlightStart = false,
  ...base: string[]
): string {
  return [
    ...base,
    isBlockStart ? 'round-start' : '',
    isFlightStart ? 'flight-start' : '',
    roundIndex % 2 === 1 ? 'round-alt' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Presentation-only inversion of a zero-flight flag label — the checkbox
 * records the logical negation of the metric ("launched in working time" →
 * "launched outside working time"). Falls back to an explicit "not" phrasing. */
function negateFlagLabel(label: string): string {
  const negated = label
    .replace(/\bin working time\b/i, 'outside working time')
    .replace(/\bwithin window\b/i, 'outside window')
  return negated === label ? `not ${label.toLowerCase()}` : negated
}

/** One round-level multi-select: the class's declared penalties followed by
 * one entry per non-key metric (each carries a whenNotRecorded assumption),
 * one flat list. Compliance is whole-round — a tick applies the exception to
 * every flight row, a value applies to every flight row — so each item lists
 * once, with no flight-number text. The sheet text is the only state. */
function PenaltyCell({
  text,
  options,
  flightRows,
  assumed,
  cellText,
  onText,
  onCell,
  invalid,
  errorText,
}: {
  text: string
  options: PenaltyOption[]
  flightRows: FlightRowSpec[]
  assumed: GridColumn[]
  cellText(sequence: number, metric: string): string
  onText(text: string): void
  onCell(sequence: number, metric: string, text: string): void
  invalid?: boolean
  errorText?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  const selected = parsePenaltyText(text)
  const toggle = (infractionType: string) => {
    const next = selected.includes(infractionType)
      ? selected.filter((t) => t !== infractionType)
      : [...selected, infractionType]
    // canonical order = definition order
    onText(options.map((o) => o.infractionType).filter((t) => next.includes(t)).join(', '))
  }
  const isFlagged = (col: GridColumn): boolean => {
    const assumption = col.whenNotRecorded
    if (!assumption || flightRows.length === 0) return false
    if (col.kind === 'Flag') {
      const exception = assumption.flag ? 'n' : 'y'
      return flightRows.some((r) => cellText(r.sequence, col.metric) === exception)
    }
    return flightRows.some((r) => cellText(r.sequence, col.metric).trim() !== '')
  }
  const setAll = (col: GridColumn, value: string) => {
    for (const r of flightRows) onCell(r.sequence, col.metric, value)
  }
  const count = selected.length + assumed.filter((col) => isFlagged(col)).length
  return (
    <div className="penalty-cell" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="More"
        className={`flag-cell ${count === 0 ? 'flag-blank' : ''}${invalid ? ' cell-error' : ''}`}
        title={errorText ?? (options.map((o) => o.label).join('\n') || 'The adopted class declares no penalties')}
        aria-invalid={invalid || undefined}
        disabled={options.length === 0 && assumed.length === 0}
        onClick={() => setOpen(!open)}
      >
        {count === 0 ? '...' : <span className="penalty-mark">{count}</span>}
      </button>
      {open && (
        <div className="penalty-menu">
          {options.map((o) => (
            <label key={o.infractionType}>
              <input
                type="checkbox"
                checked={selected.includes(o.infractionType)}
                onChange={() => toggle(o.infractionType)}
              />
              {o.label}
            </label>
          ))}
          {assumed.map((col) => {
            const assumption = col.whenNotRecorded
            if (!assumption) return null
            if (col.kind === 'Flag') {
              const exception = assumption.flag ? 'n' : 'y'
              return (
                <label key={col.metric}>
                  <input
                    type="checkbox"
                    checked={isFlagged(col)}
                    onChange={() => setAll(col, isFlagged(col) ? '' : exception)}
                  />
                  {assumption.flag ? negateFlagLabel(col.label) : col.label}
                </label>
              )
            }
            const first = flightRows[0]
            return (
              <label key={col.metric} className="assumed-value">
                <span>{col.label}</span>
                <input
                  inputMode={col.kind === 'Number' ? 'decimal' : undefined}
                  value={first ? cellText(first.sequence, col.metric) : ''}
                  placeholder={formatValue(assumption, col.unit)}
                  onChange={(e) => setAll(col, e.target.value)}
                />
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SheetCell({
  text,
  enabled,
  column,
  tapeChoice,
  placeholder,
  onText,
  invalid,
  errorText,
}: {
  text: string
  enabled: boolean
  column: GridColumn
  tapeChoice?: TapeChoice
  placeholder?: string
  onText(text: string): void
  invalid?: boolean
  errorText?: string
}) {
  const errorClass = invalid ? ' cell-error' : ''
  if (column.kind === 'Flag') {
    const cycle = text === '' ? 'y' : text === 'y' ? 'n' : ''
    return (
      <button
        type="button"
        className={`flag-cell${text === '' ? ' flag-blank' : ''}${errorClass}`}
        disabled={!enabled}
        title={errorText ?? column.label}
        aria-invalid={invalid || undefined}
        onClick={() => onText(cycle)}
      >
        {text === '' ? '–' : text}
      </button>
    )
  }
  // Provisional mark-mode picker: the F3J landing column renders the wire
  // reading set (readings only, never points); off-tape 0 is one tap via the
  // blank option's explicit 0. Tape-measure stays free-text — the cm-grid
  // check in validateSheet is the gate.
  if (column.metric === LANDING_METRIC && tapeChoice === F3J_INSTRUMENT) {
    const options = readingSetFor(F3J_INSTRUMENT)
    return (
      <select
        className={`cell${errorClass}`}
        value={text}
        disabled={!enabled}
        aria-invalid={invalid || undefined}
        title={errorText}
        onChange={(e) => onText(e.target.value)}
      >
        <option value="">—</option>
        {options.map((r) => (
          <option key={r} value={String(r)}>
            {r === 0 ? '0 (off tape)' : String(r)}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      className={`cell${errorClass}`}
      inputMode="decimal"
      value={text}
      disabled={!enabled}
      placeholder={placeholder ?? (column.metric === LANDING_METRIC ? '0 or 0.01–15.00' : undefined)}
      aria-invalid={invalid || undefined}
      title={errorText}
      onChange={(e) => onText(e.target.value)}
    />
  )
}
