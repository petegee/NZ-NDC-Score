import { describe, expect, it } from 'vitest'
import {
  captureReducer,
  chainCommands,
  cellKey,
  entryProgress,
  initialCapture,
  type CaptureState,
} from './capture'

const base = { active: null, queue: [], cells: {}, entries: {} } satisfies CaptureState

describe('chainCommands', () => {
  it('opens entry and flight before capture when nothing exists', () => {
    const commands = chainCommands('k|1|flightTime', 'c-1', 1, 'flightTime', { kind: 'Number', number: 62 }, {}, () => 42)
    expect(commands.map((c) => c.kind)).toEqual(['open-entry', 'open-flight', 'capture'])
    expect(commands.every((c) => c.id === 42 && c.cellKey === 'k|1|flightTime')).toBe(true)
  })

  it('skips satisfied steps', () => {
    const entries = {
      'c-1': { ...entryProgress(), entryId: 'e-1', openedFlights: { 1: true as const } },
    }
    const commands = chainCommands('k', 'c-1', 1, 'flightTime', { kind: 'Number', number: 62 }, entries, () => 1)
    expect(commands.map((c) => c.kind)).toEqual(['capture'])
  })

  it('routes corrections through amend with the reason', () => {
    const entries = { 'c-1': { ...entryProgress(), entryId: 'e-1', openedFlights: { 1: true as const } } }
    const commands = chainCommands(
      'k',
      'c-1',
      1,
      'flightTime',
      { kind: 'Number', number: 412 },
      entries,
      () => 7,
      { reason: 'typo 4120' },
    )
    expect(commands.map((c) => c.kind)).toEqual(['amend'])
    expect(commands[0]).toMatchObject({ reason: 'typo 4120' })
  })
})

describe('captureReducer', () => {
  const enqueued: CaptureState = captureReducer(
    { ...initialCapture, active: { phaseOrdinal: 0, roundOrdinal: 1, taskRoundOrdinal: 1, groupRef: 'g', taskRef: 'D' } },
    {
      type: 'cellEnqueued',
      cellKey: 'k',
      commands: [
        { kind: 'open-entry', id: 1, cellKey: 'k', competitorId: 'c-1', attempt: 0 },
        { kind: 'open-flight', id: 2, cellKey: 'k', competitorId: 'c-1', flightSequence: 1, attempt: 0 },
        { kind: 'capture', id: 3, cellKey: 'k', competitorId: 'c-1', flightSequence: 1, metric: 'flightTime', value: { kind: 'Number', number: 62 }, attempt: 0 },
      ],
    },
  )

  it('marks the cell queued and keeps the chain in order', () => {
    expect(enqueued.cells[cellKey('k', 0, 'x')] === undefined).toBe(true)
    expect(enqueued.queue.map((c) => c.kind)).toEqual(['open-entry', 'open-flight', 'capture'])
  })

  it('a terminal failure marks the cell error and blocks the rest of the chain', () => {
    const failed = captureReducer(enqueued, {
      type: 'commandFailed',
      id: 1,
      code: 'openEntry.competitorWithdrawn',
      detail: 'withdrawn',
    })
    expect(failed.queue.every((c) => c.blocked)).toBe(true)
    expect(failed.cells['k']).toMatchObject({ status: 'error', errorCode: 'openEntry.competitorWithdrawn' })
  })

  it('adopted entry keeps the chain flowing', () => {
    const adopted = captureReducer(enqueued, { type: 'commandAdopted', id: 1, entryId: 'e-9' })
    expect(adopted.queue.map((c) => c.id)).toEqual([2, 3])
    expect(adopted.entries['c-1'].entryId).toBe('e-9')
  })

  it('capture success commits the value and clears text', () => {
    const withText: CaptureState = { ...enqueued, cells: { k: { text: '1:02', status: 'queued' } } }
    const done = captureReducer(withText, {
      type: 'commandSucceeded',
      id: 3,
      value: { kind: 'Number', number: 62 },
    })
    expect(done.cells['k']).toMatchObject({ status: 'committed', value: { kind: 'Number', number: 62 }, text: '' })
  })

  it('retry bumps attempt and returns the command to the head', () => {
    const retry = captureReducer(
      { ...base, queue: [{ kind: 'capture', id: 3, cellKey: 'k', competitorId: 'c-1', flightSequence: 1, metric: 'm', value: { kind: 'Number', number: 1 }, attempt: 0 }] },
      { type: 'commandRetry', id: 3 },
    )
    expect(retry.queue[0]).toMatchObject({ id: 3, attempt: 1 })
  })

  it('a superseded open-entry leaves no residue', () => {
    const superseded = captureReducer(enqueued, { type: 'commandSuperseded', id: 1 })
    expect(superseded.queue.map((c) => c.id)).toEqual([2, 3])
  })
})
