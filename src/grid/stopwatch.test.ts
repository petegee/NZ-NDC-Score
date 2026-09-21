import { describe, expect, it } from 'vitest'
import type { ClassDefinition } from '../api/types'
import f3jFixture from '../test/fixtures/50-f3j.json'
import { deriveTaskGrid, taskByRef, type GridColumn as Col } from '../grid/schema'
import { splitStopwatch, stopwatchPair } from '../grid/stopwatch'
import { applyRounding } from '../grid/precision'
import { parseCellText } from '../grid/parse'

const f3j = f3jFixture as unknown as ClassDefinition

const columnOf = (grid: ReturnType<typeof deriveTaskGrid>, metric: string): Col => {
  const col = grid.columns.find((c) => c.metric === metric)
  if (!col) throw new Error(`no column ${metric}`)
  return col
}

describe('deriveTaskGrid — stopwatch pair (F3J task D)', () => {
  const grid = deriveTaskGrid(taskByRef(f3j, 'D')!)

  it('declares the stopwatch pair: one total column, one split-owned', () => {
    expect(grid.stopwatch).toEqual({ flightMetric: 'flightTime', overflyMetric: 'overflySeconds' })
    expect(columnOf(grid, 'flightTime').stopwatchRole).toBe('total')
    expect(columnOf(grid, 'overflySeconds').stopwatchRole).toBe('overfly')
    expect(columnOf(grid, 'landingDistance').stopwatchRole).toBeUndefined()
  })

  it('labels the total column with its metric name and keeps the overfly column', () => {
    expect(columnOf(grid, 'flightTime').label).toBe('Flight time')
    expect(columnOf(grid, 'overflySeconds').label).toBe('Overfly seconds')
  })

  it('carries the declared precisions the split needs', () => {
    // F3J: flightTime 0.1 s HalfUp; overflySeconds whole seconds, truncate.
    expect(columnOf(grid, 'flightTime').precision).toEqual({ mode: 'HalfUp', precision: 0.1 })
    expect(columnOf(grid, 'overflySeconds').precision).toEqual({ mode: 'Truncate', precision: 1 })
    expect(columnOf(grid, 'overflySeconds').whenNotRecorded).toEqual({
      kind: 'Number',
      number: 0,
    })
  })
})

describe('stopwatchPair', () => {
  it('is absent without the overfly metric (plain F3K-style task)', () => {
    expect(
      stopwatchPair({ metrics: [{ name: 'flightTime', kind: 'Number', unit: 's' }] }),
    ).toBeUndefined()
  })

  it('is absent when either member is not a seconds number', () => {
    expect(
      stopwatchPair({
        metrics: [
          { name: 'flightTime', kind: 'Number', unit: 's' },
          { name: 'overflySeconds', kind: 'Flag' },
        ],
      }),
    ).toBeUndefined()
    expect(
      stopwatchPair({
        metrics: [
          { name: 'flightTime', kind: 'Number', unit: 'm' },
          { name: 'overflySeconds', kind: 'Number', unit: 's' },
        ],
      }),
    ).toBeUndefined()
  })
})

const f3jFlight = (grid: ReturnType<typeof deriveTaskGrid>): Col => columnOf(grid, 'flightTime')
const f3jOverfly = (grid: ReturnType<typeof deriveTaskGrid>): Col =>
  columnOf(grid, 'overflySeconds')

describe('splitStopwatch — boundary cases (F3J, 600 s working time)', () => {
  const grid = deriveTaskGrid(taskByRef(f3j, 'D')!)
  const flight = f3jFlight(grid)
  const overfly = f3jOverfly(grid)
  const split = (total: number) => splitStopwatch(total, 600, flight, overfly)

  it('a flight inside working time: flightTime only, overfly omitted/0', () => {
    const reading = split(590)
    expect(reading).toEqual({ flight: 590, overfly: 0 })
  })

  it('a flight over working time: capped flight, the excess as overfly', () => {
    expect(split(604)).toEqual({ flight: 600, overfly: 4 })
  })

  it('a fractional excess truncates to whole overfly seconds', () => {
    expect(split(604.4)).toEqual({ flight: 600, overfly: 4 })
  })

  it('the flight side keeps its 0.1 s HalfUp precision', () => {
    // 599.96 stays inside 600 → HalfUp to 600.0; overfly none.
    expect(split(599.96)).toEqual({ flight: 600, overfly: 0 })
    // just over the line: flight capped at exactly 600; the 0.4 s excess is
    // nothing once the overfly's whole-second truncation applies.
    expect(split(600.4)).toEqual({ flight: 600, overfly: 0 })
  })

  it('whole-second overfly precision applies on the split, not the raw reading', () => {
    // 605.7: flight 600; overfly 5.7 truncates to whole seconds per its
    // declared precision → 5.
    expect(split(605.7)).toEqual({ flight: 600, overfly: 5 })
  })

  it('the fly-off phase splits at its own 900 s working time', () => {
    const flyoff = deriveTaskGrid(f3j.phases[1].tasks[0])
    expect(splitStopwatch(895, 900, f3jFlight(flyoff), f3jOverfly(flyoff))).toEqual({
      flight: 895,
      overfly: 0,
    })
    expect(splitStopwatch(910.2, 900, f3jFlight(flyoff), f3jOverfly(flyoff))).toEqual({
      flight: 900,
      overfly: 10,
    })
  })
})

describe('applyRounding', () => {
  it('applies the declared mode over the declared granularity', () => {
    expect(applyRounding(604.4, { mode: 'Truncate', precision: 1 })).toBe(604)
    expect(applyRounding(604.4, { mode: 'HalfUp', precision: 0.1 })).toBe(604.4)
    expect(applyRounding(62.46, { mode: 'HalfUp', precision: 0.1 })).toBe(62.5)
    expect(applyRounding(12.3, { mode: 'Ceiling', precision: 1 })).toBe(13)
    expect(applyRounding(12.3, undefined)).toBe(12.3)
  })

  it('keeps float dust out of the comparison (0.1 steps)', () => {
    expect(applyRounding(1.4000000000000001, { mode: 'HalfUp', precision: 0.1 })).toBe(1.4)
  })
})

describe('parseCellText — stopwatch readings', () => {
  it('accepts mm:ss, clock and bare-decimal seconds for time metrics', () => {
    expect(parseCellText('10:04', 'Number', 's')).toEqual({
      ok: true,
      value: { kind: 'Number', number: 604 },
    })
    expect(parseCellText('10:04.4', 'Number', 's')).toEqual({
      ok: true,
      value: { kind: 'Number', number: 604.4 },
    })
    expect(parseCellText('604.4', 'Number', 's')).toEqual({
      ok: true,
      value: { kind: 'Number', number: 604.4 },
    })
    expect(parseCellText('1:10:04', 'Number', 's')).toEqual({
      ok: true,
      value: { kind: 'Number', number: 4204 },
    })
  })
})
