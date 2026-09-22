import { describe, expect, it } from 'vitest'
import type { ClassDefinition } from '../api/types'
import alesNdc from '../test/fixtures/81-nz-m-ndc.json'
import f3kNdc from '../test/fixtures/85b-nz-f3k-ndc.json'
import f5jNdc from '../test/fixtures/85c-nz-f5j-ndc.json'
import {
  defaultRounds,
  deriveFlightRows,
  deriveTaskGrid,
  phaseSetupInfo,
  taskByRef,
  workingTimeView,
} from './schema'

const ales = alesNdc as ClassDefinition
const f3k = f3kNdc as ClassDefinition
const f5j = f5jNdc as ClassDefinition

describe('ALES 200 (NDC format) fixture', () => {
  const phase0 = phaseSetupInfo(ales, 0)

  it('exposes one phase with one FixedSequence task D', () => {
    expect(ales.phases).toHaveLength(1)
    expect(phase0?.rounds?.kind).toBe('FixedSequence')
    expect(phase0?.rounds?.maxRounds).toBe(4)
    expect(phase0?.tasks.map((t) => t.code)).toEqual(['D'])
  })

  it('derives 5 metric columns in declared order for task D', () => {
    const grid = deriveTaskGrid(taskByRef(ales, 'D')!)
    expect(grid.columns.map((c) => c.metric)).toEqual([
      'flightTime',
      'landingDistance',
      'damagedAndNotSafelyFlyable',
      'touchedByCompetitor',
      'landedWithin75m',
    ])
  })

  it('derives 1 flight row (maxLaunches wins over the last selection)', () => {
    const grid = deriveTaskGrid(taskByRef(ales, 'D')!)
    expect(grid.flightRows).toHaveLength(1)
    expect(grid.flightRows[0]).toMatchObject({ sequence: 1, dynamic: false })
  })

  it('carries whenNotRecorded assumptions as hints', () => {
    const grid = deriveTaskGrid(taskByRef(ales, 'D')!)
    const landed = grid.columns.find((c) => c.metric === 'landedWithin75m')
    expect(landed?.whenNotRecorded).toEqual({ kind: 'Flag', flag: true })
    const time = grid.columns.find((c) => c.metric === 'flightTime')
    expect(time?.whenNotRecorded).toBeUndefined()
  })

  it('defaults the draw to the definition maxRounds', () => {
    expect(defaultRounds(phase0!)).toBe(4)
  })

  it('labels task D open-ended (UntilAllFlightsComplete)', () => {
    const view = workingTimeView(taskByRef(ales, 'D')!.timing)
    expect(view.kind).toBe('UntilAllFlightsComplete')
  })
})

describe('F3K NDC fixture', () => {
  const phase0 = phaseSetupInfo(f3k, 0)

  it('is ChooseFromCatalogue over 4 distinct tasks', () => {
    expect(phase0?.rounds?.kind).toBe('ChooseFromCatalogue')
    expect(phase0?.rounds?.requireDistinctTaskPerRound).toBe(true)
    expect(phase0?.tasks.map((t) => t.code)).toEqual(['B', 'D', 'G', 'H'])
  })

  it('derives flight rows B=2, D=2, G=5, H=4', () => {
    const rows = (code: string) => deriveFlightRows(taskByRef(f3k, code)!)
    expect(rows('B')).toHaveLength(2)
    expect(rows('D')).toHaveLength(2)
    expect(rows('G')).toHaveLength(5)
    expect(rows('H')).toHaveLength(4)
    for (const code of ['B', 'D', 'G', 'H']) {
      expect(rows(code).map((r) => r.sequence)).toEqual(
        Array.from({ length: rows(code).length }, (_, i) => i + 1),
      )
    }
  })

  it('labels task H rows with the 60/120/180/240 s targets', () => {
    const rows = deriveFlightRows(taskByRef(f3k, 'H')!)
    expect(rows.map((r) => r.targetLabel)).toEqual(['60 s target', '120 s target', '180 s target', '240 s target'])
  })

  it('derives dynamic rows for an all-selection without maxLaunches', () => {
    const task = {
      ...taskByRef(f3k, 'D')!,
      flights: { $kind: 'all' as const },
      timing: { kind: 'Fixed' as const, workingTime: 600 },
    }
    const rows = deriveFlightRows(task)
    expect(rows).toHaveLength(1)
    expect(rows[0].dynamic).toBe(true)
  })

  it('shows task B working time as the bound param', () => {
    const view = workingTimeView(taskByRef(f3k, 'B')!.timing)
    expect(view.kind).toBe('Fixed')
    expect(view.param).toBe('workingTime.B')
  })

  it('keeps column identity on metric names with prettified labels', () => {
    const grid = deriveTaskGrid(taskByRef(f3k, 'B')!)
    expect(grid.columns.map((c) => c.metric)).toEqual([
      'flightTime',
      'landedWithinWindow',
      'launchedInWorkingTime',
    ])
    expect(grid.columns.map((c) => c.label)).toEqual([
      'Flight time',
      'Landed within window',
      'Launched in working time',
    ])
  })

  it('derives the zero-flight flags from flightValidWhen, generically', () => {
    for (const ref of ['B', 'D', 'G', 'H']) {
      expect(deriveTaskGrid(taskByRef(f3k, ref)!).zeroFlightFlags).toEqual([
        'landedWithinWindow',
        'launchedInWorkingTime',
      ])
    }
    // The M-class task zeroes on a different declared flag.
    expect(deriveTaskGrid(taskByRef(ales, 'D')!).zeroFlightFlags).toEqual(['landedWithin75m'])
  })
})

describe('F5J NDC fixture (recordedness gate)', () => {
  it('keeps startHeight a demanded key column — no assumption, no flag', () => {
    const grid = deriveTaskGrid(taskByRef(f5j, 'D')!)
    expect(grid.columns.map((c) => c.metric)).toEqual([
      'flightTime',
      'startHeight',
      'landingDistance',
      'overflySeconds',
      'touchedByCompetitor',
      'landedWithin75m',
    ])
    const height = grid.columns.find((c) => c.metric === 'startHeight')
    expect(height?.whenNotRecorded).toBeUndefined()
  })

  it('derives only the flag zero-flight metrics: recordedness is not one', () => {
    // 5.5.11.7 e cancels a flight whose AMRT records no Start Height data —
    // the gate child is `isRecorded`, not a flag comparison to tick, so
    // startHeight never becomes a drop-list entry: blank resolves at
    // Calculate (the flight zeroes), typed scores normally. One input.
    // landedWithin75m stays a flag gate (NZ.0.3 h) — an assumed metric.
    expect(deriveTaskGrid(taskByRef(f5j, 'D')!).zeroFlightFlags).toEqual(['landedWithin75m'])
  })

  it('derives 1 flight row per round (last selection)', () => {
    const grid = deriveTaskGrid(taskByRef(f5j, 'D')!)
    expect(grid.flightRows).toHaveLength(1)
    expect(grid.flightRows[0]).toMatchObject({ sequence: 1, dynamic: false })
  })

  it('declares the flightTime + overflySeconds stopwatch pair', () => {
    const grid = deriveTaskGrid(taskByRef(f5j, 'D')!)
    expect(grid.stopwatch).toEqual({ flightMetric: 'flightTime', overflyMetric: 'overflySeconds' })
  })
})
