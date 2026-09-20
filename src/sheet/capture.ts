import type { MeasuredValue, ReflightRole } from '../api/types'

export interface TaskRoundRef {
  phaseOrdinal: number
  roundOrdinal: number
  taskRoundOrdinal: number
  groupRef: string
  taskRef: string
}

export type CellStatus = 'uncommitted' | 'queued' | 'in-flight' | 'committed' | 'error'

export interface CellState {
  /** Uncommitted text — the only client-authored content that is not yet a
   * command; persisted in localStorage per cell. */
  text: string
  status: CellStatus
  /** Last committed value (from a capture, an amend, or the event-log rebuild). */
  value?: MeasuredValue
  /** Set when the event log or an amend shows a correction on this cell. */
  amended?: boolean
  errorCode?: string
  errorDetail?: string
}

interface CommandBase {
  id: number
  cellKey: string
  competitorId: string
  attempt: number
  running?: boolean
  blocked?: boolean
}

export interface EntryProgress {
  entryId?: string
  role?: ReflightRole
  annulled?: boolean
  openedFlights: Record<number, true>
  penalties: { infractionType: string; by?: string }[]
}

export type PendingCommand =
  | (CommandBase & { kind: 'open-entry' })
  | (CommandBase & { kind: 'open-flight'; flightSequence: number })
  | (CommandBase & {
      kind: 'capture'
      flightSequence: number
      metric: string
      value: MeasuredValue
    })
  | (CommandBase & {
      kind: 'amend'
      flightSequence: number
      metric: string
      value: MeasuredValue
      reason: string
    })
  | (CommandBase & { kind: 'penalty'; infractionType: string })

export interface CaptureState {
  active: TaskRoundRef | null
  entries: Record<string, EntryProgress>
  cells: Record<string, CellState>
  queue: PendingCommand[]
}

export const initialCapture: CaptureState = {
  active: null,
  entries: {},
  cells: {},
  queue: [],
}

export const cellKey = (competitorId: string, flightSequence: number, metric: string): string =>
  `${competitorId}|${flightSequence}|${metric}`

export const cellParts = (
  key: string,
): { competitorId: string; flightSequence: number; metric: string } => {
  const [competitorId, flightSequence, metric] = key.split('|')
  return { competitorId, flightSequence: Number(flightSequence), metric }
}

export const captureStorageKey = (compId: string, tr: TaskRoundRef): string =>
  `ndcscore.capture.${compId}.p${tr.phaseOrdinal}.r${tr.roundOrdinal}.t${tr.taskRoundOrdinal}.g${tr.groupRef}`

export function entryProgress(): EntryProgress {
  return { openedFlights: {}, penalties: [] }
}

/** The command chain a committed cell needs, in order. Already-satisfied
 * steps are left out; the pump re-checks in case the state moved on. */
export function chainCommands(
  key: string,
  competitorId: string,
  flightSequence: number,
  metric: string,
  value: MeasuredValue,
  entries: Record<string, EntryProgress>,
  nextId: () => number,
  amend?: { reason: string },
): PendingCommand[] {
  const progress = entries[competitorId]
  const commands: PendingCommand[] = []
  if (!progress?.entryId) {
    commands.push({ kind: 'open-entry', id: nextId(), cellKey: key, competitorId, attempt: 0 })
  }
  if (!progress?.openedFlights[flightSequence]) {
    commands.push({
      kind: 'open-flight',
      id: nextId(),
      cellKey: key,
      competitorId,
      flightSequence,
      attempt: 0,
    })
  }
  if (amend) {
    commands.push({
      kind: 'amend',
      id: nextId(),
      cellKey: key,
      competitorId,
      flightSequence,
      metric,
      value,
      reason: amend.reason,
      attempt: 0,
    })
  } else {
    commands.push({
      kind: 'capture',
      id: nextId(),
      cellKey: key,
      competitorId,
      flightSequence,
      metric,
      value,
      attempt: 0,
    })
  }
  return commands
}

export type CaptureAction =
  | { type: 'roundOpened'; active: TaskRoundRef; capture: CaptureState }
  | { type: 'roundClosed' }
  | { type: 'cellText'; cellKey: string; text: string }
  | { type: 'cellEnqueued'; cellKey: string; commands: PendingCommand[] }
  | { type: 'commandStarted'; id: number }
  | { type: 'commandSuperseded'; id: number }
  | {
      type: 'commandSucceeded'
      id: number
      entryId?: string
      flightSequence?: number
      value?: MeasuredValue
    }
  | { type: 'commandAdopted'; id: number; entryId?: string; flightSequence?: number }
  | { type: 'commandRetry'; id: number }
  | { type: 'commandFailed'; id: number; code: string; detail?: string }
  | { type: 'cellRetry'; cellKey: string }
  | { type: 'penaltyRecorded'; competitorId: string; infractionType: string; by?: string }
  | { type: 'entryAnnulled'; competitorId: string }

function withCell(state: CaptureState, key: string, patch: Partial<CellState>): CaptureState {
  const cell = state.cells[key] ?? { text: '', status: 'uncommitted' as const }
  return { ...state, cells: { ...state.cells, [key]: { ...cell, ...patch } } }
}

function popQueue(state: CaptureState, id: number): CaptureState {
  return { ...state, queue: state.queue.filter((c) => c.id !== id) }
}

function withEntry(
  state: CaptureState,
  competitorId: string,
  patch: (p: EntryProgress) => EntryProgress,
): CaptureState {
  const current = state.entries[competitorId] ?? entryProgress()
  return { ...state, entries: { ...state.entries, [competitorId]: patch(current) } }
}

export function captureReducer(state: CaptureState, action: CaptureAction): CaptureState {
  switch (action.type) {
    case 'roundOpened':
      return action.capture
    case 'roundClosed':
      return initialCapture

    case 'cellText':
      return withCell(state, action.cellKey, { text: action.text })

    case 'cellEnqueued': {
      const next: CaptureState = { ...state, queue: [...state.queue, ...action.commands] }
      return withCell(next, action.cellKey, {
        status: 'queued',
        errorCode: undefined,
        errorDetail: undefined,
      })
    }

    case 'commandStarted': {
      const cmd = state.queue.find((c) => c.id === action.id)
      if (!cmd) return state
      return {
        ...state,
        queue: state.queue.map((c) => (c.id === action.id ? { ...c, running: true } : c)),
      }
    }

    case 'commandSuperseded':
      return popQueue(state, action.id)

    case 'commandSucceeded': {
      const cmd = state.queue.find((c) => c.id === action.id)
      if (!cmd) return state
      let next = popQueue(state, action.id)
      switch (cmd.kind) {
        case 'open-entry':
          next = withEntry(next, cmd.competitorId, (p) => ({ ...p, entryId: action.entryId }))
          return next
        case 'open-flight': {
          const seq = action.flightSequence ?? cmd.flightSequence
          next = withEntry(next, cmd.competitorId, (p) => ({
            ...p,
            openedFlights: { ...p.openedFlights, [seq]: true },
          }))
          return next
        }
        case 'capture':
          return withCell(next, cmd.cellKey, {
            status: 'committed',
            value: action.value,
            text: '',
            errorCode: undefined,
            errorDetail: undefined,
          })
        case 'amend':
          return withCell(next, cmd.cellKey, {
            status: 'committed',
            value: action.value,
            amended: true,
            text: '',
            errorCode: undefined,
            errorDetail: undefined,
          })
        case 'penalty':
          // The penalty is an event on the entry, not a cell value — the sheet
          // text stays as the organiser's record of what was asked for.
          return next
      }
      return next
    }

    case 'commandAdopted': {
      const cmd = state.queue.find((c) => c.id === action.id)
      if (!cmd) return state
      let next = popQueue(state, action.id)
      if (action.entryId) {
        next = withEntry(next, cmd.competitorId, (p) => ({ ...p, entryId: action.entryId }))
      }
      if (action.flightSequence !== undefined) {
        const seq = action.flightSequence
        next = withEntry(next, cmd.competitorId, (p) => ({
          ...p,
          openedFlights: { ...p.openedFlights, [seq]: true },
        }))
      }
      return next
    }

    case 'commandRetry': {
      const cmd = state.queue.find((c) => c.id === action.id)
      if (!cmd) return state
      const retried: PendingCommand = {
        ...cmd,
        attempt: cmd.attempt + 1,
        running: false,
      } as PendingCommand
      return { ...state, queue: [retried, ...state.queue.filter((c) => c.id !== action.id)] }
    }

    case 'commandFailed': {
      const cmd = state.queue.find((c) => c.id === action.id)
      if (!cmd) return state
      const next = popQueue(state, action.id)
      const blocked = withCell(next, cmd.cellKey, {
        status: 'error',
        errorCode: action.code,
        errorDetail: action.detail,
      })
      return {
        ...blocked,
        queue: blocked.queue.map((c) => (c.cellKey === cmd.cellKey ? { ...c, blocked: true } : c)),
      }
    }

    case 'cellRetry': {
      const cell = state.cells[action.cellKey]
      if (!cell) return state
      const remaining = state.queue.filter((c) => c.cellKey === action.cellKey && !c.blocked)
      return {
        ...state,
        queue: state.queue.map((c) =>
          c.cellKey === action.cellKey
            ? c.blocked
              ? { ...c, blocked: false, attempt: 0 }
              : c
            : c,
        ),
        cells: {
          ...state.cells,
          [action.cellKey]: {
            ...cell,
            status: remaining.length > 0 ? 'queued' : 'uncommitted',
            errorCode: undefined,
            errorDetail: undefined,
          },
        },
      }
    }

    case 'penaltyRecorded':
      return withEntry(state, action.competitorId, (p) => ({
        ...p,
        penalties: [...p.penalties, { infractionType: action.infractionType, by: action.by }],
      }))

    case 'entryAnnulled':
      return withEntry(state, action.competitorId, (p) => ({ ...p, annulled: true }))
  }
}
