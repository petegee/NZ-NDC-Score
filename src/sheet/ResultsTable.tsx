import { Fragment } from 'react'
import type { CompetitionScore, CompetitorTaskResult, GroupScore } from '../api/types'
import type { GridColumn } from '../grid/schema'
import { LANDING_METRIC } from '../grid/schema'
import { Verbatim } from '../scoring/ScoreTable'
import { landingColumnLabel, type TapeChoice } from './tapes'
import { sheetCellKey, type SheetRoundGrid } from './sheet'
import { useStickyHead } from './sticky-head'

/** Round-block separation, identical to the entry sheet (SheetPage): a heavy
 * rule opens each group-round's column pair, alternate group-rounds carry a
 * tint. */
function roundClass(roundIndex: number, isBlockStart: boolean, ...base: string[]): string {
  return [...base, isBlockStart ? 'round-start' : '', roundIndex % 2 === 1 ? 'round-alt' : '']
    .filter(Boolean)
    .join(' ')
}

/** Key metric columns — the only columns that get grid real estate (same rule
 * as the entry sheet's shownColumns): a metric with a declared whenNotRecorded
 * assumption is non-key and never shown; the stopwatch split's overfly metric
 * is owned by the split, so the round shows its Flight time column instead. */
function keyColumns(rg: SheetRoundGrid | undefined): GridColumn[] {
  return rg
    ? rg.grid.columns.filter((c) => c.whenNotRecorded === undefined && c.stopwatchRole !== 'overfly')
    : []
}

/** The sheet's single results table: one row per competitor, ordered by the
 * server's placing (highest total first, unplaced last), then per group-round
 * a Round number, the round's key metrics (per flight, echoed verbatim from
 * the sheet text — each landing mark with the engine's awarded landing
 * points beside it, read verbatim from the task-round result's per-term
 * breakdown), and the Raw score, then the total. Scores are read-back
 * only (law 2); the metric readings are the organiser's own sheet text. */
export function ResultsTable({
  schedule,
  roundScores,
  standings,
  names,
  grids = [],
  cells = {},
  rowCompetitors = {},
  tapeChoice,
  rowCountPerRound = [],
}: {
  schedule: { roundOrdinal: number; taskRoundOrdinal: number; taskRef: string }[]
  roundScores: Record<string, GroupScore[]>
  standings: CompetitionScore | null
  names?: Map<string, string>
  /** The entry sheet's round grids, matched by roundOrdinal — they carry each
   * round's task and its key metric columns. */
  grids?: SheetRoundGrid[]
  /** The sheet's cell text, keyed as the entry sheet keys it. */
  cells?: Record<string, string>
  /** competitor id → 1-based sheet pilot row (from the Calculate report). */
  rowCompetitors?: Record<string, string>
  /** Flight-row count per grids index (the entry sheet's header spans). */
  rowCountPerRound?: number[]
  /** The organiser's selected tape — the landing header follows it ("Landing
   * Tape" vs "Landing (m)"); absent leaves the definition label. */
  tapeChoice?: TapeChoice
}) {
  const { tableRef, headRowRef } = useStickyHead<HTMLTableElement>()
  const key = (r: { roundOrdinal: number; taskRoundOrdinal: number }) =>
    `${r.roundOrdinal}:${r.taskRoundOrdinal}`

  const totals = new Map((standings?.scores ?? []).map((s) => [s.competitorRef.value, s] as const))
  const known = new Set(totals.keys())
  // Competitors seen in round scores but not yet in the standings (transient
  // or failed /competition-result) still get a row, after every placed one.
  const extras: string[] = []
  for (const groups of Object.values(roundScores)) {
    for (const group of groups) {
      for (const r of group.results) {
        if (!known.has(r.competitorRef.value) && !extras.includes(r.competitorRef.value)) {
          extras.push(r.competitorRef.value)
        }
      }
    }
  }

  const unplaced = Number.MAX_SAFE_INTEGER
  const rows: { ref: string; score: number | string | null; disqualified: boolean }[] = [
    ...(standings?.scores ?? [])
      .map((s) => ({
        ref: s.competitorRef.value,
        score: s.disqualified ? null : s.score,
        disqualified: s.disqualified,
        placing: s.placing ?? unplaced,
      }))
      .sort((a, b) => a.placing - b.placing)
      .map(({ ref, score, disqualified }) => ({ ref, score, disqualified })),
    ...extras.map((ref) => ({ ref, score: null as number | string | null, disqualified: false })),
  ]

  if (rows.length === 0) {
    return <p className="hint">No scores yet — groups with no flown entries are absent, never zero.</p>
  }

  /** First result across the task-round's groups. A reflight entry shares the
   * task-round with its original; the service's group order decides which is
   * shown, and whichever is shown is shown verbatim. */
  const rawScoreFor = (ref: string, k: string) => {
    for (const group of roundScores[k] ?? []) {
      const hit = group.results.find((r) => r.competitorRef.value === ref)
      if (hit) return hit
    }
    return undefined
  }

  /** The engine's awarded landing points for one competitor's flight —
   * a pure wire read (law 2): the flight whose sequence matches, the term
   * whose metricRef is the landing metric (law 3 — string equality against
   * the class definition's own metric name, never a positional index),
   * rendered verbatim by the caller. Absence (NoResult, pending, missed or
   * gate-zeroed landing) is undefined — never zero. */
  const landingPointsFor = (
    hit: CompetitorTaskResult | undefined,
    flightSequence: number,
  ): number | string | undefined => {
    const flight = (hit?.flights ?? []).find((f) => f.sequence === flightSequence)
    return flight?.terms.find((t) => t.metricRef === LANDING_METRIC)?.points
  }

  /** Landing-mark columns carry a points column each: the engine's award
   * beside the echoed mark text (ss_per-term-landing-points). Derived from
   * the metric name alone — never a class branch (law 3). */
  const landingCols = (cols: GridColumn[]): number =>
    cols.filter((c) => c.metric === LANDING_METRIC).length

  /** The rendered mark header: the landing column follows the selected tape,
   * every other column the definition label. */
  const markLabel = (col: GridColumn): string =>
    col.metric === LANDING_METRIC && tapeChoice ? landingColumnLabel(tapeChoice) : col.label

  /** The sheet's cell text for one competitor's flight-row metric — empty when
   * the competitor has no sheet row (registered off-sheet) or the cell was
   * never filled. */
  const rowOf = new Map(
    Object.entries(rowCompetitors).map(([pilotRow, ref]) => [ref, pilotRow] as const),
  )
  const sheetText = (ref: string, roundOrdinal: number, flightSequence: number, metric: string) => {
    const pilotRow = rowOf.get(ref)
    return pilotRow ? (cells[sheetCellKey(roundOrdinal, Number(pilotRow), flightSequence, metric)] ?? '') : ''
  }

  const flightCount = (rg: SheetRoundGrid | undefined, gridIndex: number) =>
    Math.max(1, rowCountPerRound[gridIndex] ?? rg?.grid.flightRows.length ?? 1)

  /** Everything the block for one group-round needs: its grid (if the sheet
   * has one for that round), its key columns, and the header's flight-row
   * count. */
  const roundInfo = (entry: { roundOrdinal: number }) => {
    const gi = grids.findIndex((g) => g.roundOrdinal === entry.roundOrdinal)
    const rg = gi >= 0 ? grids[gi] : undefined
    return { rg, cols: keyColumns(rg), flights: flightCount(rg, gi) }
  }

  return (
    <table ref={tableRef} className="grid sheet-grid sticky-head results-grid">
      <thead>
        <tr ref={headRowRef}>
          <th rowSpan={2} className="pilot-col">
            Name
          </th>
          {schedule.map((entry, i) => {
            const { cols, flights } = roundInfo(entry)
            return (
              <th
                key={key(entry)}
                colSpan={1 + flights * (cols.length + landingCols(cols)) + 1}
                className={roundClass(i, true)}
              >
                Round {entry.roundOrdinal} · <code>{entry.taskRef}</code>
              </th>
            )
          })}
          <th rowSpan={2} className="num">
            Total
          </th>
        </tr>
        <tr>
          {schedule.map((entry, i) => {
            const { rg, cols, flights } = roundInfo(entry)
            return (
              <Fragment key={key(entry)}>
                <th className={roundClass(i, true, 'col-head')}>Round</th>
                {Array.from({ length: flights }, (_, rowIdx) =>
                  cols.flatMap((col, ci) => {
                    const target = rg?.grid.flightRows[rowIdx]?.targetLabel
                    const mark = (
                      <th
                        key={`${rowIdx}:${col.metric}`}
                        className={roundClass(
                          i,
                          false,
                          rowIdx > 0 && ci === 0 ? 'flight-start' : '',
                          'col-head',
                        )}
                      >
                        {target ? (
                          <span className="target-label">
                            {target}
                            <br />
                          </span>
                        ) : null}
                        <small>
                          {col.metric === LANDING_METRIC ? (
                            markLabel(col)
                          ) : (
                            <>
                              {col.label}
                              {col.unit ? ` (${col.unit})` : ''}
                            </>
                          )}
                        </small>
                      </th>
                    )
                    // The landing-points column: the engine's award beside the
                    // echoed mark text, verbatim — never a client-mapped value.
                    // Its header carries no unit (points, not a distance).
                    if (col.metric !== LANDING_METRIC) return [mark]
                    return [
                      mark,
                      <th
                        key={`${rowIdx}:${col.metric}:pts`}
                        className={roundClass(i, false, 'col-head', 'num')}
                      >
                        <small>{col.label} pts</small>
                      </th>,
                    ]
                  }),
                )}
                <th className={roundClass(i, false, 'col-head', 'num')}>Raw score</th>
              </Fragment>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.ref}>
            <td className="pilot-col">{names?.get(row.ref) ?? row.ref}</td>
            {schedule.map((entry, i) => {
              const { cols, flights } = roundInfo(entry)
              const hit = rawScoreFor(row.ref, key(entry))
              return (
                <Fragment key={key(entry)}>
                  <td className={roundClass(i, true, 'num')}>
                    {entry.taskRoundOrdinal === 1
                      ? entry.roundOrdinal
                      : `${entry.roundOrdinal}.${entry.taskRoundOrdinal}`}
                  </td>
                  {Array.from({ length: flights }, (_, rowIdx) =>
                    cols.flatMap((col, ci) => {
                      const mark = (
                        <td
                          key={`${rowIdx}:${col.metric}`}
                          className={roundClass(
                            i,
                            false,
                            rowIdx > 0 && ci === 0 ? 'flight-start' : '',
                          )}
                        >
                          {sheetText(row.ref, entry.roundOrdinal, rowIdx + 1, col.metric)}
                        </td>
                      )
                      if (col.metric !== LANDING_METRIC) return [mark]
                      // Absence (no breakdown, pending flight, missed or
                      // gate-zeroed landing) renders empty — never zero. An
                      // off-tape 0 renders the engine's own zero verbatim.
                      const points = landingPointsFor(hit, rowIdx + 1)
                      return [
                        mark,
                        <td key={`${rowIdx}:${col.metric}:pts`} className={roundClass(i, false, 'num')}>
                          {points === undefined ? '' : <Verbatim value={points} />}
                        </td>,
                      ]
                    }),
                  )}
                  <td className={roundClass(i, false, 'num')}>
                    {hit ? (hit.state === 'NoResult' ? 'no result' : <Verbatim value={hit.rawScore} />) : ''}
                  </td>
                </Fragment>
              )
            })}
            <td className="num">
              {row.disqualified ? 'DQ' : row.score === null ? '—' : <Verbatim value={row.score} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
