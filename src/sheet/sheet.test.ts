import { describe, expect, it } from 'vitest'
import type { ClassDefinition } from '../api/types'
import fixture from '../test/fixtures/85b-nz-f3k-ndc.json'
import {
  initialSheet,
  loadSheet,
  parseParamInput,
  parsePenaltyText,
  penaltyOptions,
  sheetCellKey,
  sheetCellParts,
  sheetPenaltyKey,
  sheetReducer,
  sheetRoundGrids,
  validateSheet,
  visibleFlightRows,
  type SheetState,
} from './sheet'

const f3k = fixture as unknown as ClassDefinition

function f3kSheet(): SheetState {
  return sheetReducer(initialSheet(), {
    type: 'classChosen',
    contentHash: 'hash-1',
    definition: f3k,
  })
}

describe('sheet reducer', () => {
  it('opens with 10 pilot rows, like the paper scoresheet', () => {
    expect(initialSheet().pilots).toHaveLength(10)
    expect(initialSheet().pilots.every((p) => p.name === '' && p.mfnz === '' && p.email === '')).toBe(true)
  })

  it('addPilot appends after the default rows', () => {
    const s = sheetReducer(initialSheet(), { type: 'addPilot' })
    expect(s.pilots).toHaveLength(11)
  })

  it('choosing a class adopts the definition and default rounds', () => {
    const s = f3kSheet()
    expect(s.classContentHash).toBe('hash-1')
    expect(s.classDefinition?.name).toContain('NDC')
    expect(s.rounds).toBe(4)
  })

  it('cell keys round-trip through parts', () => {
    const key = sheetCellKey(2, 3, 1, 'flightTime')
    expect(sheetCellParts(key)).toEqual({
      roundOrdinal: 2,
      pilotRow: 3,
      flightSequence: 1,
      metric: 'flightTime',
    })
  })

  it('setting rounds drops cells beyond the new count', () => {
    let s = f3kSheet()
    s = sheetReducer(s, { type: 'setRounds', rounds: 2 })
    s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(1, 1, 1, 'flightTime'), text: '62' })
    s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(3, 1, 1, 'flightTime'), text: '62' })
    s = sheetReducer(s, { type: 'setRounds', rounds: 2 })
    expect(Object.keys(s.cells)).toEqual([sheetCellKey(1, 1, 1, 'flightTime')])
  })

  it('removing a pilot re-keys the rows below it', () => {
    let s = f3kSheet()
    s = sheetReducer(s, { type: 'addPilot' })
    s = sheetReducer(s, { type: 'addPilot' })
    const r1 = sheetCellKey(1, 1, 1, 'flightTime')
    const r2 = sheetCellKey(1, 2, 1, 'flightTime')
    const r3 = sheetCellKey(1, 3, 1, 'flightTime')
    s = sheetReducer(s, { type: 'setCell', key: r1, text: '62' })
    s = sheetReducer(s, { type: 'setCell', key: r2, text: '63' })
    s = sheetReducer(s, { type: 'setCell', key: r3, text: '64' })
    s = sheetReducer(s, { type: 'removePilot', index: 1 })
    expect(Object.fromEntries(Object.entries(s.cells).map(([k, v]) => [sheetCellParts(k).pilotRow, v])))
      .toEqual({ 1: '62', 2: '64' })
  })
})

describe('sheet round grids', () => {
  it('derives catalogue grids per round without class branches', () => {
    const grids = sheetRoundGrids(f3k, 4, { 0: 'D', 1: 'G', 2: 'B', 3: 'H' })
    expect(grids.map((g) => g.taskRef)).toEqual(['D', 'G', 'B', 'H'])
    expect(grids[0].grid.flightRows).toHaveLength(2)
    expect(grids[2].grid.columns.map((c) => c.metric)).toContain('launchedInWorkingTime')
    // workingTime.B binds only rounds flying task B
    expect(grids[0].perRoundParams.map((p) => p.name)).toEqual([])
    expect(grids[2].perRoundParams.map((p) => p.name)).toEqual(['workingTime.B', 'maxFlight.B'])
  })

  it('dynamic flight rows grow with entered text', () => {
    const grids = sheetRoundGrids(f3k, 4, { 0: 'D', 1: 'G', 2: 'B', 3: 'H' })
    const d = grids[0]
    expect(visibleFlightRows(d.grid, 1, 1, {})).toHaveLength(2)
    const cells = { [sheetCellKey(1, 1, 1, 'flightTime')]: '62' }
    expect(visibleFlightRows(d.grid, 1, 1, cells)).toHaveLength(2)
  })
})

describe('parameter parsing', () => {
  it('falls back to the declared default on blank', () => {
    const wt = f3k.parameters!.find((p) => p.name === 'workingTime.B')!
    expect(parseParamInput(wt, '').ok).toBe(true)
    expect(parseParamInput(wt, '420')).toEqual({ ok: true, value: { kind: 'Number', number: 420 } })
    expect(parseParamInput(wt, '500').ok).toBe(false)
  })

  it('resolves a no-default flag to off and a no-default number to 0', () => {
    const flag = parseParamInput({ name: 'carryPenalties', kind: 'Flag' } as never, '')
    expect(flag).toEqual({ ok: true, value: { kind: 'Flag', flag: false } })
    const num = parseParamInput({ name: 'flyoffSize', kind: 'Number' } as never, '')
    expect(num).toEqual({ ok: true, value: { kind: 'Number', number: 0 } })
  })
})

describe('penalties', () => {
  it('parses the wire text: trimmed, deduped, order kept', () => {
    expect(parsePenaltyText(' landedInSafetyArea , unsignedScoreCard,,landedInSafetyArea')).toEqual([
      'landedInSafetyArea',
      'unsignedScoreCard',
    ])
    expect(parsePenaltyText('')).toEqual([])
  })

  it('options derive from the adopted class, labelled and deduped', () => {
    const options = penaltyOptions(f3k)
    expect(options.map((o) => o.infractionType)).toContain('landedInSafetyArea')
    expect(options.find((o) => o.infractionType === 'safetyAreaPersonContact')?.label).toContain('−300')
    expect(options.find((o) => o.infractionType === 'unsignedScoreCard')?.label).toContain('zero round')
  })

  it('a penalty cell is a round-level key, not per flight', () => {
    expect(sheetPenaltyKey(2, 3)).toBe(sheetCellKey(2, 3, 1, 'penalties'))
  })

  it('validation rejects infractions the class does not declare', () => {
    const s = sheetReducer(f3kSheet(), {
      type: 'setCell',
      key: sheetPenaltyKey(1, 1),
      text: 'landedInSafetyArea, madeItUp',
    })
    const v = validateSheet(s)
    expect(v.ok).toBe(false)
    expect(v.problems.some((p) => p.includes('madeItUp'))).toBe(true)
    expect(v.cellErrors).toHaveLength(0) // the penalty column is not a measured cell
  })
})

describe('validation', () => {
  it('collects header, pilot and cell problems', () => {
    const v = validateSheet(initialSheet())
    expect(v.ok).toBe(false)
    expect(v.problems.join(' ')).toMatch(/class/i)
    expect(v.problems.join(' ')).toMatch(/pilot/i)

    let s = f3kSheet()
    s = {
      ...s,
      contestName: 'NDC',
      location: 'Field',
      date: '2026-09-19',
      cdName: 'Pete',
      pilots: [
        { name: 'A', mfnz: '', email: '' },
        { name: 'a', mfnz: '', email: '' },
      ],
      cells: { [sheetCellKey(1, 1, 1, 'flightTime')]: 'not a time' },
    }
    const v2 = validateSheet(s)
    expect(v2.problems.join(' ')).toMatch(/duplicate/i)
    expect(v2.cellErrors).toHaveLength(1)
  })
})

describe('persistence', () => {
  it('round-trips through localStorage', () => {
    const s = f3kSheet()
    localStorage.setItem('ndcscore.sheet.v1', JSON.stringify(s))
    expect(loadSheet().classContentHash).toBe('hash-1')
  })
})
