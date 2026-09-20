import { useEffect, useState } from 'react'
import type { Api } from '../api/client'
import type { CompetitionScore, GroupScore } from '../api/types'
import type { CalcScheduleEntry } from './calculate'
import { ScoreTable, Standings } from '../scoring/ScoreTable'

/** Read-back only (law 2): every number here comes verbatim from
 * GET /task-round-result and GET /competition-result. */
export function SheetResults({
  api,
  competitionId,
  names,
  schedule,
  signal,
}: {
  api: Api
  competitionId: string
  names: Map<string, string>
  schedule: CalcScheduleEntry[]
  /** Bump to refetch (Calculate or manual refresh). */
  signal: number
}) {
  const [refresh, setRefresh] = useState(0)
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
  }, [api, competitionId, signal, refresh])

  if (schedule.length === 0) return null

  return (
    <section className="results">
      <h2>Results</h2>
      <p className="hint">Provisional — straight from the service, verbatim.</p>
      {schedule.map((entry) => {
        const k = `${entry.roundOrdinal}:${entry.taskRoundOrdinal}`
        return (
          <div key={k}>
            <h3>
              Round {entry.roundOrdinal} · task <code>{entry.taskRef}</code> · {entry.state}
            </h3>
            {roundErrors[k] ? (
              <p role="alert">{roundErrors[k]}</p>
            ) : roundScores[k] ? (
              <ScoreTable scores={roundScores[k]} names={names} />
            ) : (
              <p className="hint">Loading scores…</p>
            )}
          </div>
        )
      })}
      <h3>Competition standings</h3>
      {standingsError ? (
        <p role="alert">{standingsError}</p>
      ) : standings ? (
        <Standings standings={standings} names={names} />
      ) : (
        <p className="hint">Loading standings…</p>
      )}
      <button
        type="button"
        onClick={() => {
          setStandings(null)
          setRoundScores({})
          setRoundErrors({})
          setRefresh((n) => n + 1)
        }}
      >
        Refresh results
      </button>
    </section>
  )
}
