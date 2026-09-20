import { describe, expect, it } from 'vitest'
import type { CompetitionEventLog } from '../api/types'
import { rebuildFromEventLog } from './rebuild'
import { cellKey } from './capture'

const coordinate = { phaseOrdinal: 0, roundOrdinal: 1, taskRoundOrdinal: 1, groupRef: 'g-1', taskRef: 'D' }

function log(streams: unknown[]): CompetitionEventLog {
  return {
    id: { value: 'comp-1' },
    name: 'Test',
    streams: streams as CompetitionEventLog['streams'],
  }
}

describe('rebuildFromEventLog', () => {
  it('rebuilds entries, flights and committed cells from payloads', () => {
    const result = rebuildFromEventLog(
      log([
        {
          streamId: 'e-1',
          kind: 'entry',
          label: 'c-1 @ round 1',
          events: [
            { version: 1, name: 'entryOpened', payload: { id: { value: 'e-1' }, competitionRef: { value: 'comp-1' }, phaseOrdinal: 0, roundOrdinal: 1, taskRoundOrdinal: 1, groupRef: { value: 'g-1' }, competitorRef: { value: 'c-1' }, role: 'Original', at: '2026-09-17T00:00:00Z' } },
            { version: 2, name: 'flightOpened', payload: { sequence: 1, at: '2026-09-17T00:00:01Z' } },
            { version: 3, name: 'measurementCaptured', payload: { flightSequence: 1, measurement: { metric: 'flightTime', value: { kind: 'Number', number: 62 }, capturedAt: '2026-09-17T00:00:02Z', amendments: [] } } },
            { version: 4, name: 'measurementCaptured', payload: { flightSequence: 1, measurement: { metric: 'landedWithin75m', value: { kind: 'Flag', flag: false }, capturedAt: '2026-09-17T00:00:03Z', amendments: [] } } },
          ],
        },
      ]),
      coordinate,
    )
    expect(result.entries['c-1']).toMatchObject({ entryId: 'e-1', role: 'Original' })
    expect(result.entries['c-1'].openedFlights[1]).toBe(true)
    expect(result.cells[cellKey('c-1', 1, 'flightTime')]).toMatchObject({
      status: 'committed',
      value: { kind: 'Number', number: 62 },
    })
    expect(result.cells[cellKey('c-1', 1, 'landedWithin75m')]).toMatchObject({
      value: { kind: 'Flag', flag: false },
    })
  })

  it('marks amended cells and prefers the amendment value', () => {
    const result = rebuildFromEventLog(
      log([
        {
          streamId: 'e-1',
          kind: 'entry',
          events: [
            { version: 1, name: 'entryOpened', payload: { id: { value: 'e-1' }, competitionRef: { value: 'comp-1' }, phaseOrdinal: 0, roundOrdinal: 1, taskRoundOrdinal: 1, groupRef: { value: 'g-1' }, competitorRef: { value: 'c-1' }, role: 'Original', at: 'x' } },
            { version: 2, name: 'flightOpened', payload: { sequence: 1, at: 'x' } },
            { version: 3, name: 'measurementCaptured', payload: { flightSequence: 1, measurement: { metric: 'flightTime', value: { kind: 'Number', number: 4120 }, capturedAt: 'x', amendments: [] } } },
            { version: 4, name: 'measurementAmended', payload: { flightSequence: 1, metric: 'flightTime', amendment: { newValue: { kind: 'Number', number: 412 }, reason: 'typo 4120', by: 'CD', at: 'x' } } },
          ],
        },
      ]),
      coordinate,
    )
    const cell = result.cells[cellKey('c-1', 1, 'flightTime')]
    expect(cell).toMatchObject({ status: 'committed', value: { kind: 'Number', number: 412 }, amended: true })
  })

  it('ignores other task-rounds, annulments and penalties land on the entry', () => {
    const result = rebuildFromEventLog(
      log([
        {
          streamId: 'e-1',
          kind: 'entry',
          events: [
            { version: 1, name: 'entryOpened', payload: { id: { value: 'e-1' }, competitionRef: { value: 'comp-1' }, phaseOrdinal: 0, roundOrdinal: 2, taskRoundOrdinal: 1, groupRef: { value: 'g-1' }, competitorRef: { value: 'c-1' }, role: 'Original', at: 'x' } },
            { version: 2, name: 'measurementCaptured', payload: { flightSequence: 1, measurement: { metric: 'flightTime', value: { kind: 'Number', number: 9 }, capturedAt: 'x', amendments: [] } } },
          ],
        },
        {
          streamId: 'e-2',
          kind: 'entry',
          events: [
            { version: 1, name: 'entryOpened', payload: { id: { value: 'e-2' }, competitionRef: { value: 'comp-1' }, phaseOrdinal: 0, roundOrdinal: 1, taskRoundOrdinal: 1, groupRef: { value: 'g-1' }, competitorRef: { value: 'c-2' }, role: 'Original', at: 'x' } },
            { version: 2, name: 'flightOpened', payload: { sequence: 1, at: 'x' } },
            { version: 3, name: 'penaltyRecorded', payload: { penalty: { infractionType: 'launchOutsideBuzzerWindow', scope: 'Entry', by: 'CD' } } },
            { version: 4, name: 'entryAnnulled', payload: { annulment: { reason: 'wrong group', by: 'CD', at: 'x' } } },
          ],
        },
      ]),
      coordinate,
    )
    expect(result.cells[cellKey('c-1', 1, 'flightTime')]).toBeUndefined()
    expect(result.entries['c-2']).toMatchObject({
      entryId: 'e-2',
      annulled: true,
    })
    expect(result.entries['c-2'].penalties).toEqual([
      { infractionType: 'launchOutsideBuzzerWindow', by: 'CD' },
    ])
  })
})
