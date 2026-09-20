import { useEffect, useState } from 'react'
import type { Api } from '../api/client'
import type { CompetitionScore, GroupScore } from '../api/types'
import type { ApiError } from '../api/wire'
import type { TaskRoundRef } from '../sheet/capture'
import { ScoreError, ScoreTable, Standings } from './ScoreTable'

const SCORE_REFRESH_DEBOUNCE_MS = 1500

export function RoundScores({
  api,
  competitionId,
  active,
  names,
  queueLength,
  roundCompleted,
}: {
  api: Api
  competitionId: string
  active: TaskRoundRef
  names: Map<string, string>
  /** Settling trigger: refetch ~1.5 s after the queue drains. */
  queueLength: number
  roundCompleted: boolean
}) {
  const [scores, setScores] = useState<GroupScore[] | null>(null)
  const [error, setError] = useState<ApiError>()
  const [warnings, setWarnings] = useState<{ code: string; message: string }[]>([])

  useEffect(() => {
    let cancelled = false
    api
      .scoreTaskRound({
        competitionRef: competitionId,
        phaseOrdinal: active.phaseOrdinal,
        roundOrdinal: active.roundOrdinal,
        taskRoundOrdinal: active.taskRoundOrdinal,
        groupRef: active.groupRef || undefined,
      })
      .then((res) => {
        if (cancelled) return
        setScores(res.value)
        setWarnings(res.warnings)
        setError(undefined)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e as ApiError)
      })
    return () => {
      cancelled = true
    }
  }, [api, competitionId, active, roundCompleted])

  useEffect(() => {
    if (queueLength > 0) return
    const timer = setTimeout(() => {
      api
        .scoreTaskRound({
          competitionRef: competitionId,
          phaseOrdinal: active.phaseOrdinal,
          roundOrdinal: active.roundOrdinal,
          taskRoundOrdinal: active.taskRoundOrdinal,
          groupRef: active.groupRef || undefined,
        })
        .then((res) => {
          setScores(res.value)
          setWarnings(res.warnings)
          setError(undefined)
        })
        .catch((e: unknown) => setError(e as ApiError))
    }, SCORE_REFRESH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [api, competitionId, active, queueLength])

  return (
    <section>
      <h3>Group scores</h3>
      {warnings.map((w, i) => (
        <p key={i} role="status" className="warning-bar">
          <strong>Advisory</strong> <code>{w.code}</code>: {w.message}
        </p>
      ))}
      {error ? (
        <ScoreError error={error} />
      ) : scores ? (
        <ScoreTable scores={scores} names={names} />
      ) : (
        <p>Loading scores…</p>
      )}
      <button
        type="button"
        onClick={() => {
          void api
            .scoreTaskRound({
              competitionRef: competitionId,
              phaseOrdinal: active.phaseOrdinal,
              roundOrdinal: active.roundOrdinal,
              taskRoundOrdinal: active.taskRoundOrdinal,
              groupRef: active.groupRef || undefined,
            })
            .then((res) => {
              setScores(res.value)
              setWarnings(res.warnings)
              setError(undefined)
            })
            .catch((e: unknown) => setError(e as ApiError))
        }}
      >
        Refresh scores
      </button>
    </section>
  )
}

export function CompetitionStandings({
  api,
  competitionId,
  names,
  refreshSignal,
}: {
  api: Api
  competitionId: string
  names: Map<string, string>
  /** Bump when a round completes to refresh automatically. */
  refreshSignal: number
}) {
  const [standings, setStandings] = useState<CompetitionScore | null>(null)
  const [error, setError] = useState<ApiError>()

  useEffect(() => {
    let cancelled = false
    api
      .scoreCompetition(competitionId)
      .then((res) => {
        if (cancelled) return
        setStandings(res.value)
        setError(undefined)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e as ApiError)
      })
    return () => {
      cancelled = true
    }
  }, [api, competitionId, refreshSignal])

  return (
    <section>
      <h2>Provisional standings</h2>
      <p className="hint">Provisional — before finalisation. Refreshed on round completion and on demand.</p>
      {error ? (
        <ScoreError error={error} />
      ) : standings ? (
        <Standings standings={standings} names={names} />
      ) : (
        <p>Loading standings…</p>
      )}
      <button
        type="button"
        onClick={() => {
          void api
            .scoreCompetition(competitionId)
            .then((res) => {
              setStandings(res.value)
              setError(undefined)
            })
            .catch((e: unknown) => setError(e as ApiError))
        }}
      >
        Refresh standings
      </button>
    </section>
  )
}
