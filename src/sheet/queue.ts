import type { Api } from '../api/client'
import type { CaptureState, PendingCommand, TaskRoundRef } from './capture'
import type { CaptureAction } from './capture'
import { ApiError } from '../api/wire'

export interface PumpDeps {
  api: Api
  competitionId: string
  cdName: string
  dispatch(action: CaptureAction): void
  /** Refetch the fold once before a concurrency-conflict retry. */
  refetchFold(): Promise<void>
  /** Sleep between retries. */
  delay(ms: number): Promise<void>
}

const ADOPTABLE = new Set(['openEntry.alreadyOpen'])
const FLIGHT_ADOPTABLE = new Set(['openFlight.duplicateSequence'])

function isNetworkError(error: unknown): boolean {
  return !(error instanceof ApiError)
}

/** Runs one queued command to a terminal dispatch. Returns true if the loop
 * should continue immediately (retry re-queued). */
export async function runOne(
  state: CaptureState,
  cmd: PendingCommand,
  deps: PumpDeps,
): Promise<boolean> {
  const { dispatch } = deps
  const tr: TaskRoundRef | null = state.active
  if (!tr) {
    dispatch({ type: 'commandSuperseded', id: cmd.id })
    return true
  }

  if (cmd.blocked) {
    dispatch({ type: 'commandSuperseded', id: cmd.id })
    return true
  }

  const entryId = state.entries[cmd.competitorId]?.entryId

  if (cmd.kind === 'open-entry') {
    if (entryId) {
      dispatch({ type: 'commandSuperseded', id: cmd.id })
      return true
    }
    dispatch({ type: 'commandStarted', id: cmd.id })
    try {
      const res = await deps.api.openEntry({
        competitionRef: deps.competitionId,
        phaseOrdinal: tr.phaseOrdinal,
        roundOrdinal: tr.roundOrdinal,
        taskRoundOrdinal: tr.taskRoundOrdinal,
        groupRef: tr.groupRef,
        competitorRef: cmd.competitorId,
      })
      dispatch({ type: 'commandSucceeded', id: cmd.id, entryId: res.value })
      return true
    } catch (error) {
      if (error instanceof ApiError) {
        if (ADOPTABLE.has(error.code)) {
          const found = await deps.api.findEntries({
            competitionRef: deps.competitionId,
            phaseOrdinal: tr.phaseOrdinal,
            roundOrdinal: tr.roundOrdinal,
            taskRoundOrdinal: tr.taskRoundOrdinal,
            groupRef: tr.groupRef,
            competitorRef: cmd.competitorId,
          })
          const existing = found.value[0]
          dispatch({ type: 'commandAdopted', id: cmd.id, entryId: existing?.id.value })
          return true
        }
        if (error.code === 'eventStore.concurrencyConflict' && cmd.attempt < 1) {
          await deps.refetchFold()
          dispatch({ type: 'commandRetry', id: cmd.id })
          await deps.delay(400)
          return true
        }
        dispatch({ type: 'commandFailed', id: cmd.id, code: error.code, detail: error.detail })
        return false
      }
      if (cmd.attempt < 1) {
        dispatch({ type: 'commandRetry', id: cmd.id })
        await deps.delay(400)
        return true
      }
      dispatch({
        type: 'commandFailed',
        id: cmd.id,
        code: 'network.unreachable',
        detail: String((error as Error)?.message ?? error),
      })
      return false
    }
  }

  if (cmd.kind === 'open-flight') {
    if (!entryId) {
      dispatch({ type: 'commandSuperseded', id: cmd.id })
      return true
    }
    const opened = state.entries[cmd.competitorId]?.openedFlights[cmd.flightSequence]
    if (opened) {
      dispatch({ type: 'commandSuperseded', id: cmd.id })
      return true
    }
    dispatch({ type: 'commandStarted', id: cmd.id })
    try {
      await deps.api.openFlight(entryId, cmd.flightSequence)
      dispatch({ type: 'commandSucceeded', id: cmd.id, flightSequence: cmd.flightSequence })
      return true
    } catch (error) {
      if (error instanceof ApiError) {
        if (FLIGHT_ADOPTABLE.has(error.code)) {
          dispatch({ type: 'commandAdopted', id: cmd.id, flightSequence: cmd.flightSequence })
          return true
        }
        if (error.code === 'eventStore.concurrencyConflict' && cmd.attempt < 1) {
          await deps.refetchFold()
          dispatch({ type: 'commandRetry', id: cmd.id })
          await deps.delay(400)
          return true
        }
        dispatch({ type: 'commandFailed', id: cmd.id, code: error.code, detail: error.detail })
        return false
      }
      if (cmd.attempt < 1) {
        dispatch({ type: 'commandRetry', id: cmd.id })
        await deps.delay(400)
        return true
      }
      dispatch({
        type: 'commandFailed',
        id: cmd.id,
        code: 'network.unreachable',
        detail: String((error as Error)?.message ?? error),
      })
      return false
    }
  }

  // penalty — entry-scoped by design: the sheet records round penalties
  // against the competitor's entry in this task-round.
  if (cmd.kind === 'penalty') {
    if (!entryId) {
      dispatch({ type: 'commandSuperseded', id: cmd.id })
      return false
    }
    dispatch({ type: 'commandStarted', id: cmd.id })
    try {
      await deps.api.recordEntryPenalty({
        entryRef: entryId,
        infractionType: cmd.infractionType,
        scope: 'Entry',
        by: deps.cdName,
      })
      dispatch({ type: 'commandSucceeded', id: cmd.id })
      return true
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'eventStore.concurrencyConflict' && cmd.attempt < 1) {
          await deps.refetchFold()
          dispatch({ type: 'commandRetry', id: cmd.id })
          await deps.delay(400)
          return true
        }
        dispatch({ type: 'commandFailed', id: cmd.id, code: error.code, detail: error.detail })
        return false
      }
      if (cmd.attempt < 1) {
        dispatch({ type: 'commandRetry', id: cmd.id })
        await deps.delay(400)
        return true
      }
      dispatch({
        type: 'commandFailed',
        id: cmd.id,
        code: 'network.unreachable',
        detail: String((error as Error)?.message ?? error),
      })
      return false
    }
  }

  // capture / amend
  if (!entryId) {
    dispatch({ type: 'commandSuperseded', id: cmd.id })
    return false
  }
  dispatch({ type: 'commandStarted', id: cmd.id })
  try {
    if (cmd.kind === 'capture') {
      await deps.api.captureMeasurement({
        entryRef: entryId,
        flightSequence: cmd.flightSequence,
        metric: cmd.metric,
        value: cmd.value,
      })
    } else {
      await deps.api.amendMeasurement({
        entryRef: entryId,
        flightSequence: cmd.flightSequence,
        metric: cmd.metric,
        newValue: cmd.value,
        reason: cmd.reason,
        by: deps.cdName,
      })
    }
    dispatch({ type: 'commandSucceeded', id: cmd.id, value: cmd.value })
    return true
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'eventStore.concurrencyConflict' && cmd.attempt < 1) {
        await deps.refetchFold()
        dispatch({ type: 'commandRetry', id: cmd.id })
        await deps.delay(400)
        return true
      }
      dispatch({ type: 'commandFailed', id: cmd.id, code: error.code, detail: error.detail })
      return false
    }
    if (isNetworkError(error) && cmd.attempt < 1) {
      dispatch({ type: 'commandRetry', id: cmd.id })
      await deps.delay(400)
      return true
    }
    dispatch({
      type: 'commandFailed',
      id: cmd.id,
      code: 'network.unreachable',
      detail: String((error as Error)?.message ?? error),
    })
    return false
  }
}

/** Drains nothing itself: the hook calls runOne for the queue head and lets
 * the resulting dispatch re-trigger the effect. Head-first, one command per
 * call, so every transition lands through the reducer. */
