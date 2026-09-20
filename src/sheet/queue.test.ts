import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../api/client'
import type { CaptureState, PendingCommand } from './capture'
import { runOne, type PumpDeps } from './queue'
import { ApiError } from '../api/wire'

const active = { phaseOrdinal: 0, roundOrdinal: 1, taskRoundOrdinal: 1, groupRef: 'g-1', taskRef: 'D' }

function state(overrides: Partial<CaptureState> = {}): CaptureState {
  return {
    active,
    entries: {},
    cells: {},
    queue: [],
    ...overrides,
  }
}

function deps(api: Partial<Api>, dispatchLog: unknown[] = []): PumpDeps & { dispatchLog: unknown[] } {
  return {
    api: api as Api,
    competitionId: 'comp-1',
    cdName: 'CD',
    dispatch: (action) => dispatchLog.push(action),
    refetchFold: vi.fn(async () => {}),
    delay: vi.fn(async () => {}),
    dispatchLog,
  }
}

const openEntry: PendingCommand = { kind: 'open-entry', id: 1, cellKey: 'k', competitorId: 'c-1', attempt: 0 }
const openFlight: PendingCommand = { kind: 'open-flight', id: 2, cellKey: 'k', competitorId: 'c-1', flightSequence: 1, attempt: 0 }
const capture: PendingCommand = {
  kind: 'capture',
  id: 3,
  cellKey: 'k',
  competitorId: 'c-1',
  flightSequence: 1,
  metric: 'flightTime',
  value: { kind: 'Number', number: 62 },
  attempt: 0,
}

describe('runOne — open-entry', () => {
  it('succeeds and records the entry id', async () => {
    const log: unknown[] = []
    const d = deps(
      { openEntry: vi.fn(async () => ({ value: 'e-1', warnings: [] })) },
      log,
    )
    await runOne(state({ queue: [openEntry] }), openEntry, d)
    expect(d.dispatchLog).toContainEqual({ type: 'commandSucceeded', id: 1, entryId: 'e-1' })
  })

  it('adopts the existing entry on alreadyOpen', async () => {
    const log: unknown[] = []
    const d = deps(
      {
        openEntry: vi.fn(async () => {
          throw new ApiError(400, 'openEntry.alreadyOpen', 'already open', [])
        }),
        findEntries: vi.fn(async () => ({
          value: [{ id: { value: 'e-7' }, competitionRef: { value: 'x' }, phaseOrdinal: 0, roundOrdinal: 1, taskRoundOrdinal: 1, groupRef: { value: 'g-1' }, competitorRef: { value: 'c-1' }, role: 'Original' as const }],
          warnings: [],
        })),
      },
      log,
    )
    await runOne(state({ queue: [openEntry] }), openEntry, d)
    expect(d.dispatchLog).toContainEqual({ type: 'commandAdopted', id: 1, entryId: 'e-7' })
  })

  it('retries once on network error, then fails with network.unreachable', async () => {
    const log: unknown[] = []
    const openEntryFn = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const d = deps({ openEntry: openEntryFn }, log)
    await runOne(state({ queue: [openEntry] }), { ...openEntry, attempt: 0 }, d)
    expect(d.dispatchLog).toContainEqual({ type: 'commandRetry', id: 1 })
    await runOne(state({ queue: [{ ...openEntry, attempt: 1 }] }), { ...openEntry, attempt: 1 }, d)
    expect(d.dispatchLog).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'commandFailed', id: 1, code: 'network.unreachable' })]),
    )
    expect(openEntryFn).toHaveBeenCalledTimes(2)
  })

  it('retries once on concurrency conflict after a fold refetch', async () => {
    const log: unknown[] = []
    const openEntryFn = vi
      .fn<() => Promise<{ value: string; warnings: never[] }>>()
      .mockRejectedValueOnce(new ApiError(409, 'eventStore.concurrencyConflict', 'modified', []))
      .mockResolvedValueOnce({ value: 'e-2', warnings: [] })
    const d = deps({ openEntry: openEntryFn }, log)
    await runOne(state({ queue: [openEntry] }), openEntry, d)
    expect(d.dispatchLog).toContainEqual({ type: 'commandRetry', id: 1 })
    await runOne(state({ queue: [{ ...openEntry, attempt: 1 }] }), { ...openEntry, attempt: 1 }, d)
    expect(d.refetchFold).toHaveBeenCalledTimes(1)
    expect(d.dispatchLog).toContainEqual({ type: 'commandSucceeded', id: 1, entryId: 'e-2' })
  })

  it('surfaces other refusals verbatim', async () => {
    const log: unknown[] = []
    const d = deps(
      {
        openEntry: vi.fn(async () => {
          throw new ApiError(400, 'openEntry.competitorWithdrawn', 'withdrawn', [])
        }),
      },
      log,
    )
    await runOne(state({ queue: [openEntry] }), openEntry, d)
    expect(d.dispatchLog).toContainEqual({
      type: 'commandFailed',
      id: 1,
      code: 'openEntry.competitorWithdrawn',
      detail: 'withdrawn',
    })
  })
})

describe('runOne — penalties', () => {
  const entries = { 'c-1': { ...{ openedFlights: {}, penalties: [] }, entryId: 'e-1' } }
  const penalty: PendingCommand = {
    kind: 'penalty',
    id: 5,
    cellKey: 'c-1|1|penalties',
    competitorId: 'c-1',
    infractionType: 'landedInSafetyArea',
    attempt: 0,
  }

  it('records an entry-scoped penalty signed by the CD', async () => {
    const log: unknown[] = []
    const recordEntryPenalty = vi.fn(async () => ({ value: 'e-1', warnings: [] }))
    const d = deps({ recordEntryPenalty }, log)
    await runOne(state({ entries, queue: [penalty] }), penalty, d)
    expect(recordEntryPenalty).toHaveBeenCalledWith({
      entryRef: 'e-1',
      infractionType: 'landedInSafetyArea',
      scope: 'Entry',
      by: 'CD',
    })
    expect(d.dispatchLog).toContainEqual({ type: 'commandSucceeded', id: 5 })
  })

  it('is superseded when the entry is not open yet', async () => {
    const log: unknown[] = []
    const recordEntryPenalty = vi.fn(async () => ({ value: 'e-1', warnings: [] }))
    const d = deps({ recordEntryPenalty }, log)
    await runOne(state({ queue: [penalty] }), penalty, d)
    expect(recordEntryPenalty).not.toHaveBeenCalled()
    expect(d.dispatchLog).toContainEqual({ type: 'commandSuperseded', id: 5 })
  })

  it('surfaces a refusal verbatim', async () => {
    const log: unknown[] = []
    const d = deps(
      {
        recordEntryPenalty: vi.fn(async () => {
          throw new ApiError(400, 'recordPenalty.infractionTypeNotDeclared', 'not declared', [])
        }),
      },
      log,
    )
    await runOne(state({ entries, queue: [penalty] }), penalty, d)
    expect(d.dispatchLog).toContainEqual({
      type: 'commandFailed',
      id: 5,
      code: 'recordPenalty.infractionTypeNotDeclared',
      detail: 'not declared',
    })
  })
})

describe('runOne — open-flight and capture', () => {
  const entries = { 'c-1': { ...{ openedFlights: {}, penalties: [] }, entryId: 'e-1' } }

  it('adopts on duplicate launch refusal', async () => {
    const log: unknown[] = []
    const d = deps(
      {
        openFlight: vi.fn(async () => {
          throw new ApiError(400, 'openFlight.duplicateSequence', 'duplicated', [])
        }),
      },
      log,
    )
    await runOne(state({ entries, queue: [openFlight] }), openFlight, d)
    expect(d.dispatchLog).toContainEqual({ type: 'commandAdopted', id: 2, flightSequence: 1 })
  })

  it('captures and commits', async () => {
    const log: unknown[] = []
    const d = deps(
      { captureMeasurement: vi.fn(async () => ({ value: 'e-1', warnings: [] })) },
      log,
    )
    await runOne(state({ entries, queue: [capture] }), capture, d)
    expect(d.dispatchLog).toContainEqual({ type: 'commandSucceeded', id: 3, value: { kind: 'Number', number: 62 } })
  })

  it('amends with the reason and the CD as By', async () => {
    const log: unknown[] = []
    const amendMeasurement = vi.fn(async () => ({ value: 'e-1', warnings: [] }))
    const d = deps({ amendMeasurement }, log)
    const amend: PendingCommand = {
      kind: 'amend',
      id: 4,
      cellKey: 'k',
      competitorId: 'c-1',
      flightSequence: 1,
      metric: 'flightTime',
      value: { kind: 'Number', number: 412 },
      reason: 'typo 4120',
      attempt: 0,
    }
    await runOne(state({ entries, queue: [amend] }), amend, d)
    expect(amendMeasurement).toHaveBeenCalledWith(
      expect.objectContaining({ entryRef: 'e-1', newValue: { kind: 'Number', number: 412 }, reason: 'typo 4120', by: 'CD' }),
    )
    expect(d.dispatchLog).toContainEqual({ type: 'commandSucceeded', id: 4, value: { kind: 'Number', number: 412 } })
  })
})
