import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createApi } from '../api/client'
import type { ClassDefinitionSummary } from '../api/types'
import { isNdcClass, latestPerClass } from './classes'
import { formatValue } from '../grid/parse'
import type { FlightRowSpec, GridColumn } from '../grid/schema'
import {
  initialSheet,
  loadSheet,
  paramsBoundAt,
  paramPlaceholder,
  parsePenaltyText,
  penaltyOptions,
  phaseRoundsKind,
  phaseTasks,
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

export function SheetPage({ base }: { base: string }) {
  const api = useMemo(() => createApi(base), [base])
  const [state, dispatch] = useReducer(sheetReducer, undefined, loadSheet)
  const [classList, setClassList] = useState<ClassDefinitionSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<CalcProgress[]>([])
  const [report, setReport] = useState<CalcReport | null>(null)
  const [resultsSignal, setResultsSignal] = useState(0)
  const [paramsOpen, setParamsOpen] = useState(false)
  // The Pilots input is a decision, not a live resize: shrinking drops cells,
  // so the typed draft commits on blur/Enter instead of per keystroke.
  const [pilotsDraft, setPilotsDraft] = useState<string | null>(null)

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

  // The sheet text is the only client state — persist every keystroke.
  useEffect(() => {
    saveSheet(state)
  }, [state])

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
    try {
      const res = await api.getClassDefinition(hash)
      dispatch({ type: 'classChosen', contentHash: hash, definition: res.value })
    } catch (error) {
      setLoadError(errorText(error))
    }
  }

  const calculate = async () => {
    if (runningRef.current) {
      dirtyRef.current = true
      return
    }
    runningRef.current = true
    setRunning(true)
    setProgress([])
    setReport(null)
    const rep = await runCalculate(api, stateRef.current, (p) => setProgress((prev) => [...prev, p]))
    setReport(rep)
    runningRef.current = false
    setRunning(false)
    if (rep.ok && rep.competitionId) {
      setLastGood(rep)
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
            <span>Contest name</span>
            <input
              value={state.contestName}
              onChange={(e) => dispatch({ type: 'setField', field: 'contestName', value: e.target.value })}
              placeholder="e.g. NZMAA NDC 2026"
            />
          </label>
          <label className="span-2">
            <span>Location</span>
            <input
              value={state.location}
              onChange={(e) => dispatch({ type: 'setField', field: 'location', value: e.target.value })}
            />
          </label>
          <label className="span-2">
            <span>Date</span>
            <input
              type="date"
              value={state.date}
              onChange={(e) => dispatch({ type: 'setField', field: 'date', value: e.target.value })}
            />
          </label>
          <label className="span-2">
            <span>CD (signs the commands)</span>
            <input
              value={state.cdName}
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
                  : 'Number of competitor rows — blank rows are fine, they stay blank until a name lands'
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
                  .map((p) => (
                    <label key={p.name} className="span-2">
                      <span>
                        {p.name}
                        {p.unit ? ` (${p.unit})` : ''} — {p.boundAt ?? 'CompetitionSetup'}
                      </span>
                      <input
                        value={state.params[p.name] ?? ''}
                        placeholder={paramPlaceholder(p)}
                        onChange={(e) => dispatch({ type: 'setParam', name: p.name, text: e.target.value })}
                      />
                    </label>
                  ))}
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
        />
      )}

      <section className="calculate-bar">
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
              setPilotsDraft(null)
              autoArmedRef.current = false
              setLastGood(null)
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
}: {
  state: SheetState
  grids: ReturnType<typeof sheetRoundGrids>
  rowCountPerRound: number[]
  penalties: PenaltyOption[]
  dispatch: (action: Parameters<typeof sheetReducer>[1]) => void
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
          {grids.map((rg, i) => (
            <th
              key={rg.roundOrdinal}
              colSpan={
                rowCountPerRound[i] * shownColumns(rg).length + (withComplianceColumn(rg, penalties) ? 1 : 0)
              }
              className={roundCellClassName(i, true)}
            >
              Round {rg.roundOrdinal} · <code>{rg.taskRef}</code> {rg.grid.taskName}
            </th>
          ))}
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
                        {col.label}
                        {col.unit ? ` (${col.unit})` : ''}
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
                className="cell"
                value={pilot.name}
                placeholder="Pilot name"
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
                    return keyCols.map((col, ci) => (
                      <td
                        key={`${rowIdx}:${col.metric}`}
                        className={roundCellClassName(i, rowIdx === 0 && ci === 0, rowIdx > 0 && ci === 0)}
                      >
                        <SheetCell
                          text={state.cells[sheetCellKey(rg.roundOrdinal, pi + 1, spec.sequence, col.metric)] ?? ''}
                          enabled={enabled}
                          column={col}
                          onText={(text) =>
                            dispatch({
                              type: 'setCell',
                              key: sheetCellKey(rg.roundOrdinal, pi + 1, spec.sequence, col.metric),
                              text,
                            })
                          }
                        />
                      </td>
                    ))
                  })}
                  {withComplianceColumn(rg, penalties) && (
                    <td className={roundCellClassName(i, keyCols.length === 0)}>
                      <PenaltyCell
                        text={state.cells[sheetPenaltyKey(rg.roundOrdinal, pi + 1)] ?? ''}
                        options={penalties}
                        flightRows={visibleFlightRows(rg.grid, rg.roundOrdinal, pi + 1, state.cells)}
                        assumed={assumedColumns(rg)}
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
}: {
  text: string
  options: PenaltyOption[]
  flightRows: FlightRowSpec[]
  assumed: GridColumn[]
  cellText(sequence: number, metric: string): string
  onText(text: string): void
  onCell(sequence: number, metric: string, text: string): void
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
        className={`flag-cell ${count === 0 ? 'flag-blank' : ''}`}
        title={options.map((o) => o.label).join('\n') || 'The adopted class declares no penalties'}
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
  onText,
}: {
  text: string
  enabled: boolean
  column: GridColumn
  onText(text: string): void
}) {
  if (column.kind === 'Flag') {
    const cycle = text === '' ? 'y' : text === 'y' ? 'n' : ''
    return (
      <button
        type="button"
        className={`flag-cell ${text === '' ? 'flag-blank' : ''}`}
        disabled={!enabled}
        title={column.label}
        onClick={() => onText(cycle)}
      >
        {text === '' ? '–' : text}
      </button>
    )
  }
  return (
    <input
      className="cell"
      inputMode="decimal"
      value={text}
      disabled={!enabled}
      onChange={(e) => onText(e.target.value)}
    />
  )
}
