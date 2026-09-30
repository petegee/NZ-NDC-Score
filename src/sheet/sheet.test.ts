import { describe, expect, it } from 'vitest'
import type { ClassDefinition, ParameterBindingFold } from '../api/types'
import alesFixture from '../test/fixtures/81-nz-m-ndc.json'
import fixture from '../test/fixtures/85b-nz-f3k-ndc.json'
import f5jFixture from '../test/fixtures/85c-nz-f5j-ndc.json'
import radianFixture from '../test/fixtures/85-nz-p-radian.json'
import {
  initialSheet,
  loadSheet,
  parseParamInput,
  parsePenaltyText,
  penaltyOptions,
  resolveMaxFlight,
  resolveMaxLaunches,
  resolveWorkingTime,
  roundTimeHint,
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
const ales = alesFixture as unknown as ClassDefinition
const radian = radianFixture as unknown as ClassDefinition
const f5j = f5jFixture as unknown as ClassDefinition

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

  it('setPilotCount above the default appends empty rows', () => {
    const s = sheetReducer(initialSheet(), { type: 'setPilotCount', count: 12 })
    expect(s.pilots).toHaveLength(12)
    expect(s.pilots.every((p) => p.name === '' && p.mfnz === '' && p.email === '')).toBe(true)
  })

  it('setPilotCount prunes cells beyond the count without re-keying the kept rows', () => {
    let s = f3kSheet()
    const r1 = sheetCellKey(1, 1, 1, 'flightTime')
    const r2 = sheetCellKey(1, 2, 1, 'flightTime')
    const r3 = sheetCellKey(1, 3, 1, 'flightTime')
    s = sheetReducer(s, { type: 'setCell', key: r1, text: '62' })
    s = sheetReducer(s, { type: 'setCell', key: r2, text: '63' })
    s = sheetReducer(s, { type: 'setCell', key: r3, text: '64' })
    s = sheetReducer(s, { type: 'setPilotCount', count: 2 })
    expect(Object.keys(s.cells)).toEqual([r1, r2])
    expect(s.cells).toEqual({ [r1]: '62', [r2]: '63' })
  })

  it('setPilotCount floors at one pilot', () => {
    for (const count of [0, -3, 0.5, Number.NaN]) {
      const s = sheetReducer(initialSheet(), { type: 'setPilotCount', count })
      expect(s.pilots).toHaveLength(1)
    }
    expect(sheetReducer(initialSheet(), { type: 'setPilotCount', count: 2.7 }).pilots).toHaveLength(2)
  })

  it('growing back does not resurrect pruned cells', () => {
    let s = f3kSheet()
    const r3 = sheetCellKey(1, 3, 1, 'flightTime')
    s = sheetReducer(s, { type: 'setCell', key: r3, text: '64' })
    s = sheetReducer(s, { type: 'setPilotCount', count: 1 })
    expect(s.cells).toEqual({})
    s = sheetReducer(s, { type: 'setPilotCount', count: 4 })
    expect(s.pilots).toHaveLength(4)
    expect(s.cells).toEqual({})
  })

  it('choosing a class adopts the definition and default rounds', () => {
    const s = f3kSheet()
    expect(s.classContentHash).toBe('hash-1')
    expect(s.classDefinition?.name).toContain('NDC')
    expect(s.rounds).toBe(4)
  })

  it('changing class adopts the default rounds of the new class — a stale count never survives', () => {
    const radianSheet = sheetReducer(initialSheet(), {
      type: 'classChosen',
      contentHash: 'hash-r',
      definition: radian,
    })
    expect(radianSheet.rounds).toBe(3)
    const alesSheet = sheetReducer(radianSheet, {
      type: 'classChosen',
      contentHash: 'hash-a',
      definition: ales,
    })
    expect(alesSheet.rounds).toBe(4)
    const back = sheetReducer(alesSheet, {
      type: 'classChosen',
      contentHash: 'hash-r',
      definition: radian,
    })
    expect(back.rounds).toBe(3)
  })

  it('changing class drops cells and task picks beyond the new round count', () => {
    let s = sheetReducer(initialSheet(), {
      type: 'classChosen',
      contentHash: 'hash-a',
      definition: ales,
    })
    s = sheetReducer(s, { type: 'setTaskPick', roundIndex: 1, taskRef: 'X' })
    s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(4, 1, 1, 'flightTime'), text: '61' })
    s = sheetReducer(s, {
      type: 'classChosen',
      contentHash: 'hash-r',
      definition: radian,
    })
    expect(s.rounds).toBe(3)
    expect(s.taskPicks).toEqual({})
    expect(s.cells).toEqual({})
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

  it('shrinking the field keeps row numbers as identity — kept cells stay under the same keys', () => {
    let s = f3kSheet()
    s = sheetReducer(s, { type: 'setPilotCount', count: 12 })
    const r1 = sheetCellKey(1, 1, 1, 'flightTime')
    const r2 = sheetCellKey(1, 2, 1, 'flightTime')
    const r12 = sheetCellKey(1, 12, 1, 'flightTime')
    s = sheetReducer(s, { type: 'setCell', key: r1, text: '62' })
    s = sheetReducer(s, { type: 'setCell', key: r2, text: '63' })
    s = sheetReducer(s, { type: 'setCell', key: r12, text: '64' })
    s = sheetReducer(s, { type: 'setPilotCount', count: 2 })
    expect(sheetCellParts(r1).pilotRow).toBe(1)
    expect(sheetCellParts(r2).pilotRow).toBe(2)
    expect(s.cells[r1]).toBe('62')
    expect(s.cells[r2]).toBe('63')
    expect(s.cells[r12]).toBeUndefined()
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

  it('options derive from the adopted class, humanised and deduped', () => {
    const options = penaltyOptions(f3k)
    expect(options.map((o) => o.infractionType)).toContain('landedInSafetyArea')
    expect(options.find((o) => o.infractionType === 'safetyAreaPersonContact')?.label).toBe(
      'Safety Area Person Contact',
    )
    expect(options.find((o) => o.infractionType === 'unsignedScoreCard')?.label).toBe(
      'Unsigned Score Card',
    )
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

describe('resolveWorkingTime — what the stopwatch split divides at', () => {
  const taskB = f3k.phases[0].tasks.find((t) => t.code === 'B')!
  const taskD = f3k.phases[0].tasks.find((t) => t.code === 'D')!
  const wtParam = f3k.parameters!.find((p) => p.name === 'workingTime.B')!
  const noBindings: ParameterBindingFold[] = []

  it('uses a declared literal working time as-is', () => {
    expect(resolveWorkingTime(taskD.timing, [], {}, noBindings, 0, 1)).toBe(600)
  })

  it('resolves a parameter reference from a scoped round binding first', () => {
    const bindings: ParameterBindingFold[] = [
      {
        parameterName: 'workingTime.B',
        boundValue: { kind: 'Number', number: 480 },
        by: 'CD',
        at: '',
        phaseOrdinal: 0,
        roundOrdinal: 2,
      },
      {
        parameterName: 'workingTime.B',
        boundValue: { kind: 'Number', number: 420 },
        by: 'CD',
        at: '',
      },
    ]
    expect(resolveWorkingTime(taskB.timing, [wtParam], {}, bindings, 0, 2)).toBe(480)
    expect(resolveWorkingTime(taskB.timing, [wtParam], {}, bindings, 0, 3)).toBe(420)
  })

  it('falls back to the sheet parameter input (declared default on blank)', () => {
    expect(resolveWorkingTime(taskB.timing, [wtParam], {}, noBindings, 0, 1)).toBe(600)
    expect(resolveWorkingTime(taskB.timing, [wtParam], { 'workingTime.B': '420' }, noBindings, 0, 1)).toBe(420)
  })

  it('a working time that resolves to nothing usable is undefined', () => {
    const noDefault = { name: 'workingTime.B', kind: 'Number', boundAt: 'PerRound' } as never
    expect(resolveWorkingTime(taskB.timing, [noDefault], {}, noBindings, 0, 1)).toBeUndefined()
    expect(resolveWorkingTime(taskB.timing, [], {}, noBindings, 0, 1)).toBeUndefined()
  })
})

describe('roundTimeHint — the faint per-round window + max flight on the grid header', () => {
  it('shows window and max (F5J task D: 600 s window, 599 s per-flight cap)', () => {
    const [rg] = sheetRoundGrids(f5j, 1, {})
    expect(rg.taskRef).toBe('D')
    expect(roundTimeHint(f5j, rg, {})).toBe('10 min window · 9:59 max')
  })

  it('resolves {param} sides through sheet text + defaults (F3K task B)', () => {
    const [rg] = sheetRoundGrids(f3k, 1, { 0: 'B' })
    expect(rg.taskRef).toBe('B')
    // workingTime.B default 600, maxFlight.B default 240.
    expect(roundTimeHint(f3k, rg, {})).toBe('10 min window · 4 min max')
    expect(roundTimeHint(f3k, rg, { 'workingTime.B': '420' })).toBe('7 min window · 4 min max')
    expect(roundTimeHint(f3k, rg, { 'maxFlight.B': '180' })).toBe('10 min window · 3 min max')
  })

  it('shows the headline case (F3K task G: 10 min window, 2 min max flight)', () => {
    const [, , g] = sheetRoundGrids(f3k, 4, { 0: 'B', 1: 'D', 2: 'G', 3: 'H' })
    expect(g.taskRef).toBe('G')
    expect(roundTimeHint(f3k, g, {})).toBe('10 min window · 2 min max')
  })

  it('shows window only when the task has no per-flight cap (F3K task H targets)', () => {
    const [, , , h] = sheetRoundGrids(f3k, 4, { 0: 'B', 1: 'D', 2: 'G', 3: 'H' })
    expect(h.taskRef).toBe('H')
    expect(roundTimeHint(f3k, h, {})).toBe('10 min window')
  })

  it('each catalogue round shows its own task limits', () => {
    const grids = sheetRoundGrids(f3k, 4, { 0: 'B', 1: 'D', 2: 'G', 3: 'H' })
    expect(grids.map((g) => g.taskRef)).toEqual(['B', 'D', 'G', 'H'])
    // Only the B round consumes workingTime.B / maxFlight.B — the sheet text
    // moves its hint alone; every other round keeps its own literals. Only
    // task D declares maxLaunches.
    expect(grids.map((g) => roundTimeHint(f3k, g, { 'workingTime.B': '420' }))).toEqual([
      '7 min window · 4 min max',
      '10 min window · 5 min max · 2 launches',
      '10 min window · 2 min max',
      '10 min window',
    ])
  })

  it('shows launches alone when there is no window and no cap (ALES 200: 1 launch)', () => {
    const [rg] = sheetRoundGrids(ales, 1, {})
    expect(rg.taskRef).toBe('D')
    expect(roundTimeHint(ales, rg, {})).toBe('1 launch')
  })

  it('shows launches alone when the window is unresolvable (Radian roundDuration)', () => {
    const [rg] = sheetRoundGrids(radian, 1, {})
    expect(rg.taskRef).toBe('D')
    expect(roundTimeHint(radian, rg, {})).toBe('1 launch')
  })

  it('resolveMaxLaunches passes literals through and rejects non-integers', () => {
    const [rgD] = sheetRoundGrids(f3k, 4, { 0: 'B', 1: 'D', 2: 'G', 3: 'H' }).slice(1)
    expect(resolveMaxLaunches(rgD.grid.timing, rgD.perRoundParams, {}, [], 0, 1)).toBe(2)
    const [rgG] = sheetRoundGrids(f3k, 4, { 0: 'B', 1: 'D', 2: 'G', 3: 'H' }).slice(2)
    expect(resolveMaxLaunches(rgG.grid.timing, rgG.perRoundParams, {}, [], 0, 3)).toBeUndefined()
    expect(
      resolveMaxLaunches({ kind: 'Fixed', workingTime: 600, maxLaunches: 2.5 } as never, [], {}, [], 0, 1),
    ).toBeUndefined()
  })

  it('shows max only when the window is unresolvable but the cap resolves', () => {
    const [rg] = sheetRoundGrids(f3k, 1, { 0: 'B' })
    const noWindowParam = {
      ...rg,
      perRoundParams: rg.perRoundParams.filter((p) => p.name !== 'workingTime.B'),
    }
    expect(roundTimeHint(f3k, noWindowParam, {})).toBe('4 min max')
  })

  it('shows no hint when no side resolves', () => {
    const [rg] = sheetRoundGrids(f3k, 1, { 0: 'B' })
    const noParams = { ...rg, perRoundParams: [] }
    expect(roundTimeHint(f3k, noParams, {})).toBeUndefined()
  })

  it('resolveMaxFlight takes the most restrictive resolvable cap', () => {
    const [rgB] = sheetRoundGrids(f3k, 1, { 0: 'B' })
    const params = rgB.perRoundParams
    expect(resolveMaxFlight('G', f3k, params, {}, [], 0, 1)).toBe(120)
    expect(resolveMaxFlight('H', f3k, params, {}, [], 0, 1)).toBeUndefined()
    expect(resolveMaxFlight('B', f3k, params, {}, [], 0, 1)).toBe(240)
    expect(resolveMaxFlight('B', f3k, params, { 'maxFlight.B': '180' }, [], 0, 1)).toBe(180)
    expect(resolveMaxFlight('ZZZ', f3k, params, {}, [], 0, 1)).toBeUndefined()
  })
})
