import { describe, expect, it } from 'vitest'
import type { ClassDefinition } from '../api/types'
import type { GridColumn } from '../grid/schema'
import fixture from '../test/fixtures/85b-nz-f3k-ndc.json'
import {
  CORRECTION_REASON,
  REOPEN_REASON,
  placeholderEmail,
  runCalculate,
  sameMeasurement,
} from './calculate'
import { FakeSoarscore } from './fake-soarscore'
import {
  initialSheet,
  sheetCellKey,
  sheetPenaltyKey,
  sheetReducer,
  type SheetState,
} from './sheet'

const f3k = fixture as unknown as ClassDefinition

function baseSheet(): SheetState {
  let s = sheetReducer(initialSheet(), { type: 'classChosen', contentHash: 'hash', definition: f3k })
  s = sheetReducer(s, { type: 'setField', field: 'contestName', value: 'Waikato NDC' })
  s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Matamata' })
  s = sheetReducer(s, { type: 'setField', field: 'date', value: '2026-09-19' })
  s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Pete' })
  s = sheetReducer(s, { type: 'setTaskPick', roundIndex: 0, taskRef: 'D' })
  s = sheetReducer(s, { type: 'setTaskPick', roundIndex: 1, taskRef: 'G' })
  s = sheetReducer(s, { type: 'setRounds', rounds: 2 })
  s = sheetReducer(s, { type: 'setPilot', index: 0, patch: { name: 'Ana Silva', mfnz: '1234' } })
  s = sheetReducer(s, { type: 'addPilot' })
  s = sheetReducer(s, { type: 'setPilot', index: 1, patch: { name: 'Ben Tu', mfnz: '2345' } })
  s = sheetReducer(s, {
    type: 'setCell',
    key: sheetCellKey(1, 1, 1, 'flightTime'),
    text: '1:02',
  })
  s = sheetReducer(s, {
    type: 'setCell',
    key: sheetCellKey(1, 2, 1, 'flightTime'),
    text: '58.5',
  })
  return s
}

const noProgress = () => {}

describe('calculate — fresh run', () => {
  it('creates everything, draws with catalogue tasks, captures and completes', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()

    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    expect(report.competitionId).toBeTruthy()
    expect(report.counts.captured).toBe(2)
    expect(report.counts.amended).toBe(0)
    expect(fake.competitionByName('Waikato NDC', '2026-09-19')).toBeDefined()
    expect(fake.personByName('Ana Silva')).toBeDefined()
    // Round 1 complete (both required flightTimes captured), round 2 untouched.
    const comp = fake.competitionByName('Waikato NDC', '2026-09-19')!
    expect(comp.rounds[0].state).toBe('Complete')
    expect(comp.rounds[1].state).toBe('Drawn')
    // F3K NDC PerRound params bind only for task-B rounds — none here.
    expect(comp.bindings).toHaveLength(0)
    // The draw used the sheet's task picks.
    expect(comp.rounds.map((r) => r.taskRef)).toEqual(['D', 'G'])
  })

  it('re-running an unchanged sheet is a no-op', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    await runCalculate(api, sheet, noProgress)

    const before = JSON.stringify(fake.competitions)
    const peopleBefore = fake.people.length
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    expect(report.counts).toEqual({
      captured: 0,
      amended: 0,
      unchanged: 2,
      failed: 0,
      skippedNotDrawn: 0,
      penalties: 0,
    })
    expect(fake.people).toHaveLength(peopleBefore)
    expect(JSON.stringify(fake.competitions)).toBe(before)
  })

  it('records round penalties once — a re-run does not duplicate them', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = sheetReducer(baseSheet(), {
      type: 'setCell',
      key: sheetPenaltyKey(1, 1),
      text: 'landedInSafetyArea, landedInSafetyArea, unknownInfraction',
    })

    const first = await runCalculate(api, sheet, noProgress)
    expect(first.ok).toBe(false) // 'unknownInfraction' is not declared by the class
    expect(first.problems.some((p) => p.includes('unknownInfraction'))).toBe(true)

    const clean = sheetReducer(baseSheet(), {
      type: 'setCell',
      key: sheetPenaltyKey(1, 1),
      text: 'landedInSafetyArea',
    })
    const ok = await runCalculate(api, clean, noProgress)
    expect(ok.ok).toBe(true)
    expect(ok.counts.penalties).toBe(1)

    const againProgress: unknown[] = []
    const again = await runCalculate(api, clean, (p) => againProgress.push(p))
    expect(again.counts.penalties).toBe(0)
    expect(
      againProgress.some(
        (p) => (p as { label?: string }).label?.includes('committed penalty') ?? false,
      ),
    ).toBe(false)
  })

  it('re-uses an existing competition with the same name and date', async () => {    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    await runCalculate(api, baseSheet(), noProgress)
    const first = fake.competitionByName('Waikato NDC', '2026-09-19')!

    await runCalculate(api, baseSheet(), noProgress)
    expect(fake.competitions).toHaveLength(1)
    expect(fake.competitionByName('Waikato NDC', '2026-09-19')!.id).toBe(first.id)
  })

  it('registers unknown pilots with a deterministic placeholder email', async () => {
    expect(placeholderEmail('Ana Silva')).toBe('unknown+ana-silva@mfnz.invalid')
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    await runCalculate(api, baseSheet(), noProgress)
    expect(fake.personByName('Ana Silva')!.email).toBe('unknown+ana-silva@mfnz.invalid')
  })
})

describe('calculate — corrections', () => {
  it('overtyping a cell amends with the auto reason', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    await runCalculate(api, sheet, noProgress)

    const edited = sheetReducer(sheet, {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'flightTime'),
      text: '1:01',
    })
    const report = await runCalculate(api, edited, noProgress)

    expect(report.counts.amended).toBe(1)
    expect(report.counts.captured).toBe(0)
    const comp = fake.competitionByName('Waikato NDC', '2026-09-19')!
    expect(comp.entries[0].amendments).toHaveLength(1)
    expect(comp.entries[0].amendments[0].newValue.number).toBe(61)
    expect(report.steps.some((s) => s.step === 'done' && s.status === 'ok')).toBe(true)
  })

  it('a correction on a completed round reopens with the auto reason and re-completes', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    await runCalculate(api, sheet, noProgress)
    const comp = fake.competitionByName('Waikato NDC', '2026-09-19')!
    expect(comp.rounds[0].state).toBe('Complete')

    const edited = sheetReducer(sheet, {
      type: 'setCell',
      key: sheetCellKey(1, 2, 1, 'flightTime'),
      text: '59',
    })
    const report = await runCalculate(api, edited, noProgress)

    expect(report.counts.amended).toBe(1)
    expect(comp.rounds[0].state).toBe('Complete')
    expect(report.steps.some((s) => s.label.includes('Reopened') || s.label.includes('complete'))).toBe(true)
  })

  it('a pilot added after the draw is warned about and skipped — the drawn schedule is immutable', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    await runCalculate(api, sheet, noProgress)

    const grown = sheetReducer(sheet, { type: 'addPilot' })
    const withPilot = sheetReducer(grown, {
      type: 'setPilot',
      index: 2,
      patch: { name: 'Cara Ng', mfnz: '3456' },
    })
    const withCell = sheetReducer(withPilot, {
      type: 'setCell',
      key: sheetCellKey(1, 3, 1, 'flightTime'),
      text: '55',
    })
    const report = await runCalculate(api, withCell, noProgress)

    expect(report.ok).toBe(true)
    expect(report.counts.captured).toBe(0)
    expect(report.counts.skippedNotDrawn).toBe(1)
    expect(fake.personByName('Cara Ng')).toBeDefined()
    expect(fake.competitorsOf(fake.competitionByName('Waikato NDC', '2026-09-19')!.id)).toHaveLength(3)
    expect(report.steps.some((s) => s.status === 'warn')).toBe(true)
  })
})

describe('calculate — refusals', () => {
  it('refuses the whole run when a cell does not parse', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const bad = sheetReducer(baseSheet(), {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'flightTime'),
      text: 'soon',
    })
    const report = await runCalculate(api, bad, noProgress)

    expect(report.ok).toBe(false)
    expect(report.cellErrors).toHaveLength(1)
    expect(fake.competitions).toHaveLength(0)
  })

  it('refuses capture when the sheet disagrees with the drawn schedule', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    await runCalculate(api, sheet, noProgress)

    const changed = sheetReducer(sheet, { type: 'setTaskPick', roundIndex: 1, taskRef: 'H' })
    const report = await runCalculate(api, changed, noProgress)

    expect(report.ok).toBe(false)
    const step = report.steps.find((s) => s.step === 'draw')
    expect(step?.status).toBe('error')
    expect(step?.detail).toMatch(/drawn schedule/i)
  })

  it('surfaces a sheet claiming more rounds than drawn', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = sheetReducer(baseSheet(), { type: 'setRounds', rounds: 2 })
    await runCalculate(api, sheet, noProgress)
    const grown = sheetReducer(sheet, { type: 'setRounds', rounds: 3 })
    const report = await runCalculate(api, grown, noProgress)
    expect(report.ok).toBe(false)
    expect(report.steps.find((s) => s.step === 'draw')?.detail).toMatch(/4|3/)
  })
})

describe('sameMeasurement', () => {
  const truncate1 = {
    metric: 'flightTime',
    label: 'Flight time',
    kind: 'Number',
    declaredBeforeLaunch: false,
    precision: { mode: 'Truncate', precision: 1 },
  } as GridColumn
  const ceiling1 = {
    metric: 'landingDistance',
    label: 'Landing',
    kind: 'Number',
    declaredBeforeLaunch: false,
    precision: { mode: 'Ceiling', precision: 1 },
  } as GridColumn
  it('applies the service rounding modes to both sides', () => {
    // the service stored the truncated value of 61.4; sheet still says 61.4
    expect(sameMeasurement({ kind: 'Number', number: '61' }, { kind: 'Number', number: 61.4 }, truncate1)).toBe(true)
    // a genuine edit differs (truncation of 60.6 is 60, not the stored 61)
    expect(sameMeasurement({ kind: 'Number', number: '61' }, { kind: 'Number', number: 60.6 }, truncate1)).toBe(false)
    // ceiling: 12.3 was stored as 13
    expect(sameMeasurement({ kind: 'Number', number: '13' }, { kind: 'Number', number: 12.3 }, ceiling1)).toBe(true)
    expect(sameMeasurement({ kind: 'Number', number: '13' }, { kind: 'Number', number: 12.9 }, ceiling1)).toBe(true)
    expect(sameMeasurement({ kind: 'Number', number: '13' }, { kind: 'Number', number: 13.1 }, ceiling1)).toBe(false)
  })
  it('compares flags exactly and absent stored values as different', () => {
    expect(sameMeasurement({ kind: 'Flag', flag: true }, { kind: 'Flag', flag: true })).toBe(true)
    expect(sameMeasurement({ kind: 'Flag', flag: false }, { kind: 'Flag', flag: true })).toBe(false)
    expect(sameMeasurement(undefined, { kind: 'Number', number: 62 })).toBe(false)
  })
})

describe('reasons', () => {
  it('keeps the auto reasons distinct from each other', () => {
    expect(CORRECTION_REASON).toBeTruthy()
    expect(REOPEN_REASON).toBeTruthy()
    expect(CORRECTION_REASON).not.toBe(REOPEN_REASON)
  })
})
