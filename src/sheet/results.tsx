import { useEffect, useState } from 'react'
import type { Api } from '../api/client'
import type { CompetitionScore, GroupScore } from '../api/types'
import type { CalcScheduleEntry } from './calculate'
import type { SheetRoundGrid } from './sheet'
import { ResultsTable } from './ResultsTable'

/** Read-back only (law 2): every score here comes verbatim from
 * GET /task-round-result and GET /competition-result, in one table —
 * a row per competitor, and per group-round the round's key metrics
 * (echoed from the sheet text) then the raw score, then totals. */
export function SheetResults({
  api,
  competitionId,
  names,
  schedule,
  signal,
  grids,
  cells,
  rowCompetitors,
  rowCountPerRound,
}: {
  api: Api
  competitionId: string
  names: Map<string, string>
  schedule: CalcScheduleEntry[]
  /** Bump to refetch — Calculate bumps it on every run, including the
   * debounced auto re-runs. */
  signal: number
  grids?: SheetRoundGrid[]
  cells?: Record<string, string>
  rowCompetitors?: Record<string, string>
  rowCountPerRound?: number[]
}) {
  const [standings, setStandings] = useState<CompetitionScore | null>(null)
  const [standingsError, setStandingsError] = useState<string | null>(null)
  const [roundScores, setRoundScores] = useState<Record<string, GroupScore[]>>({})
  const [roundErrors, setRoundErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const key = (entry: CalcScheduleEntry) => `${entry.roundOrdinal}:${entry.taskRoundOrdinal}`
    api
      .scoreCompetition(competitionId)
      .then((res) => {
        if (cancelled) return
        setStandings(res.value)
        setStandingsError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setStandingsError(String((e as Error).message ?? e))
      })
    for (const entry of schedule) {
      api
        .scoreTaskRound({
          competitionRef: competitionId,
          phaseOrdinal: entry.phaseOrdinal,
          roundOrdinal: entry.roundOrdinal,
          taskRoundOrdinal: entry.taskRoundOrdinal,
        })
        .then((res) => {
          if (cancelled) return
          setRoundScores((prev) => ({ ...prev, [key(entry)]: res.value }))
          setRoundErrors((prev) => {
            const next = { ...prev }
            delete next[key(entry)]
            return next
          })
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setRoundErrors((prev) => ({ ...prev, [key(entry)]: String((e as Error).message ?? e) }))
        })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, competitionId, signal])

  if (schedule.length === 0) return null

  return (
    <section className="results">
      <h2>Results</h2>
      <p className="hint">
        Provisional — scores straight from the service, verbatim; metric readings echoed from your
        sheet.
      </p>
      {Object.entries(roundErrors).map(([k, msg]) => (
        <p key={k} role="alert">
          Round {k}: {msg}
        </p>
      ))}
      {standingsError ? <p role="alert">{standingsError}</p> : null}
      {standings || Object.keys(roundScores).length > 0 ? (
        <ResultsTable
          schedule={schedule}
          roundScores={roundScores}
          standings={standings}
          names={names}
          grids={grids}
          cells={cells}
          rowCompetitors={rowCompetitors}
          rowCountPerRound={rowCountPerRound}
        />
      ) : !standingsError ? (
        <p className="hint">Loading scores…</p>
      ) : null}
    </section>
  )
}
