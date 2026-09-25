import { describe, expect, it } from 'vitest'
import type { ClassDefinition } from '../api/types'
import type { GridColumn } from '../grid/schema'
import { ApiError } from '../api/wire'
import fixture from '../test/fixtures/85b-nz-f3k-ndc.json'
import f3jFixture from '../test/fixtures/50-f3j.json'
import f5jFixture from '../test/fixtures/85c-nz-f5j-ndc.json'
import radianFixture from '../test/fixtures/85-nz-p-radian.json'
import {
  CORRECTION_REASON,
  REOPEN_REASON,
  placeholderEmail,
  runCalculate,
  sameMeasurement,
  type CalcPrior,
  type CalcReport,
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
const f3j = f3jFixture as unknown as ClassDefinition

/** The contest names the orchestrator fabricates from these sheets' headers —
 * pinned as literals so the `<ISO date> <location> <class label>` format and
 * the class-label fallback (FAI designation, else the definition's name) are
 * asserted, not assumed. */
const F3K_CONTEST = '2026-09-19 Matamata F3K'
const RADIAN_CONTEST = '2026-09-19 Matamata ALES Radian (2 m all-foam electric glider)'
const X5J_CONTEST = '2026-09-22 Matamata X5J Electric'
const F3J_CONTEST = '2026-09-20 Matamata F3J'
const F5J_CONTEST = '2026-09-21 Matamata F5J'

function baseSheet(): SheetState {
  let s = sheetReducer(initialSheet(), { type: 'classChosen', contentHash: 'hash', definition: f3k })
  s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Matamata' })
  s = sheetReducer(s, { type: 'setField', field: 'date', value: '2026-09-19' })
  s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Pete' })
  s = sheetReducer(s, { type: 'setTaskPick', roundIndex: 0, taskRef: 'D' })
  s = sheetReducer(s, { type: 'setTaskPick', roundIndex: 1, taskRef: 'G' })
  s = sheetReducer(s, { type: 'setRounds', rounds: 2 })
  s = sheetReducer(s, { type: 'setPilot', index: 0, patch: { name: 'Ana Silva', mfnz: '1234' } })
  s = sheetReducer(s, { type: 'setPilotCount', count: 2 })
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
    expect(fake.competitionByName(F3K_CONTEST, '2026-09-19')).toBeDefined()
    expect(fake.personByName('Ana Silva')).toBeDefined()
    // Round 1 complete (both required flightTimes captured), round 2 untouched.
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
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
      skippedNotRegistered: 0,
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
    const first = fake.competitionByName(F3K_CONTEST, '2026-09-19')!

    await runCalculate(api, baseSheet(), noProgress)
    expect(fake.competitions).toHaveLength(1)
    expect(fake.competitionByName(F3K_CONTEST, '2026-09-19')!.id).toBe(first.id)
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
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    expect(comp.entries[0].amendments).toHaveLength(1)
    expect(comp.entries[0].amendments[0].newValue.number).toBe(61)
    expect(report.steps.some((s) => s.step === 'done' && s.status === 'ok')).toBe(true)
  })

  it('a correction on a completed round reopens with the auto reason and re-completes', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    await runCalculate(api, sheet, noProgress)
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
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

  it('a pilot added after Calculate is absorbed — unregistered, warned, everyone else unaffected', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    await runCalculate(api, sheet, noProgress)

    const grown = sheetReducer(sheet, { type: 'setPilotCount', count: sheet.pilots.length + 1 })
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

    // The field froze at draw acceptance (the first Calculate accepted it),
    // but the run is not dead: Cara is a person, never a competitor, and her
    // cell is counted and warned — while the rest of the sheet still works.
    expect(report.ok).toBe(true)
    expect(fake.personByName('Cara Ng')).toBeDefined()
    expect(fake.competitorsOf(fake.competitionByName(F3K_CONTEST, '2026-09-19')!.id)).toHaveLength(2)
    expect(report.counts.skippedNotRegistered).toBe(1)
    expect(report.steps.some((s) => s.status === 'warn' && s.label.includes('Cara Ng'))).toBe(true)
    expect(report.steps.some((s) => s.label.includes('field froze'))).toBe(true)

    // The organiser can still overtype and recalculate for the flown field.
    const edited = sheetReducer(withCell, {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'flightTime'),
      text: '1:01',
    })
    const rerun = await runCalculate(api, edited, noProgress)
    expect(rerun.ok).toBe(true)
    expect(rerun.counts.amended).toBe(1)
    expect(rerun.counts.skippedNotRegistered).toBe(1)
  })
})

describe('calculate — renaming a pilot after Calculate', () => {
  const priorOf = (report: CalcReport): CalcPrior => ({
    competitionId: report.competitionId ?? '',
    rowCompetitors: report.rowCompetitors,
    names: report.names,
  })

  it('a renamed row keeps its competitor: the person is renamed, nothing re-registers, results show the new name', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    const first = await runCalculate(api, sheet, noProgress)
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    const competitorId = comp.competitors[0].id
    const personId = comp.competitors[0].personId

    const renamed = sheetReducer(sheet, {
      type: 'setPilot',
      index: 0,
      patch: { name: 'Ana Silva-Ng' },
    })
    const report = await runCalculate(api, renamed, noProgress, priorOf(first))

    expect(report.ok).toBe(true)
    expect(fake.renameCalls).toBe(1)
    expect(fake.personByName('Ana Silva-Ng')).toBeDefined()
    expect(fake.personByName('Ana Silva')).toBeUndefined()
    // the same competitor — no re-registration behind a new person
    expect(comp.competitors).toHaveLength(2)
    expect(comp.competitors[0].id).toBe(competitorId)
    expect(comp.competitors[0].personId).toBe(personId)
    // the row's cells still diff against that competitor — plain no-op
    expect(report.counts).toEqual({
      captured: 0,
      amended: 0,
      unchanged: 2,
      failed: 0,
      skippedNotDrawn: 0,
      skippedNotRegistered: 0,
      penalties: 0,
    })
    // results display: the competitor shows the sheet's new name
    expect(report.rowCompetitors['1']).toBe(competitorId)
    expect(report.names[competitorId]).toBe('Ana Silva-Ng')
  })

  it('a rename without prior identity (the page reloaded) is recovered by elimination', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    await runCalculate(api, baseSheet(), noProgress)
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    const competitorId = comp.competitors[0].id
    const personId = comp.competitors[0].personId

    const renamed = sheetReducer(baseSheet(), {
      type: 'setPilot',
      index: 0,
      patch: { name: 'Ana Silva-Ng' },
    })
    // no prior passed — the session mapping is gone; the single unmatched row
    // and the single unmatched competitor are the same pilot
    const report = await runCalculate(api, renamed, noProgress)

    expect(report.ok).toBe(true)
    expect(fake.renameCalls).toBe(1)
    expect(fake.personByName('Ana Silva-Ng')).toBeDefined()
    expect(comp.competitors[0].id).toBe(competitorId)
    expect(comp.competitors[0].personId).toBe(personId)
    expect(report.names[competitorId]).toBe('Ana Silva-Ng')
    expect(report.counts.unchanged).toBe(2)
  })

  it('an unchanged name never re-issues a rename — the rescore stays a no-op', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    const first = await runCalculate(api, sheet, noProgress)
    const before = JSON.stringify(fake.competitions)

    const report = await runCalculate(api, sheet, noProgress, priorOf(first))

    expect(report.ok).toBe(true)
    expect(fake.renameCalls).toBe(0)
    expect(fake.people).toHaveLength(2)
    expect(JSON.stringify(fake.competitions)).toBe(before)
  })

  it('two rows renamed in one edit burst keep their own identities', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    const first = await runCalculate(api, sheet, noProgress)
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    const [ca, cb] = comp.competitors.map((k) => k.id)

    let renamed = sheetReducer(sheet, { type: 'setPilot', index: 0, patch: { name: 'Ana Silva-Ng' } })
    renamed = sheetReducer(renamed, { type: 'setPilot', index: 1, patch: { name: 'Ben Tu-Roa' } })
    const report = await runCalculate(api, renamed, noProgress, priorOf(first))

    expect(report.ok).toBe(true)
    expect(fake.renameCalls).toBe(2)
    expect(fake.personByName('Ana Silva-Ng')).toBeDefined()
    expect(fake.personByName('Ben Tu-Roa')).toBeDefined()
    // each row still owns the competitor it flew with
    expect(report.rowCompetitors['1']).toBe(ca)
    expect(report.rowCompetitors['2']).toBe(cb)
    expect(report.names[ca]).toBe('Ana Silva-Ng')
    expect(report.names[cb]).toBe('Ben Tu-Roa')
  })

  it('a refused rename warns, skips the row, and the flown field keeps working', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    const first = await runCalculate(api, sheet, noProgress)
    api.renamePerson = async () => {
      throw new ApiError(500, 'rename.refused', 'the rename was refused', [])
    }

    const renamed = sheetReducer(sheet, {
      type: 'setPilot',
      index: 0,
      patch: { name: 'Ana Silva-Ng' },
    })
    const report = await runCalculate(api, renamed, noProgress, priorOf(first))

    expect(report.ok).toBe(true)
    const warn = report.steps.find((s) => s.step === 'pilots' && s.status === 'warn')
    expect(warn?.label).toContain('Rename refused')
    expect(warn?.label).toContain('Ana Silva-Ng')
    // the wire keeps the old name; the row's cells are skipped, not lost
    expect(fake.personByName('Ana Silva')).toBeDefined()
    expect(report.counts.skippedNotRegistered).toBe(1)
    // Ben (row 2) still diffs and the results still name him
    expect(report.counts.unchanged).toBe(1)
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    expect(report.names[comp.competitors[1].id]).toBe('Ben Tu')
  })

  it('blanking a name mid-retype commits nothing and keeps the last sheet name for display', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    const first = await runCalculate(api, sheet, noProgress)
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    const competitorId = comp.competitors[0].id

    const blanked = sheetReducer(sheet, { type: 'setPilot', index: 0, patch: { name: '  ' } })
    const report = await runCalculate(api, blanked, noProgress, priorOf(first))

    expect(report.ok).toBe(true)
    expect(fake.renameCalls).toBe(0)
    expect(fake.people).toHaveLength(2)
    // the row dropped out of the field — no competitor mapping this run
    expect(report.rowCompetitors['1']).toBeUndefined()
    // …but the results still speak the competitor's last sheet name
    expect(report.names[competitorId]).toBe('Ana Silva')
    expect(report.counts.unchanged).toBe(1)
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

  it('a larger round count is absorbed — drawn rounds keep processing, the gap is named', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = sheetReducer(baseSheet(), { type: 'setRounds', rounds: 2 })
    await runCalculate(api, sheet, noProgress)
    const grown = sheetReducer(sheet, { type: 'setRounds', rounds: 3 })
    const withCell = sheetReducer(grown, {
      type: 'setCell',
      key: sheetCellKey(3, 1, 1, 'flightTime'),
      text: '57',
    })
    const report = await runCalculate(api, withCell, noProgress)

    expect(report.ok).toBe(true)
    const draw = report.steps.find((s) => s.step === 'draw' && s.status === 'warn')
    expect(draw?.detail).toMatch(/not drawn/i)
    expect(report.counts.failed).toBe(0)
    expect(report.counts.unchanged).toBe(2)
    expect(fake.competitionByName(F3K_CONTEST, '2026-09-19')!.rounds).toHaveLength(2)
  })

  it('a smaller round count is absorbed — the extra drawn round is skipped, never annulled', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    await runCalculate(api, sheet, noProgress)

    const shrunk = sheetReducer(sheet, { type: 'setRounds', rounds: 1 })
    const report = await runCalculate(api, shrunk, noProgress)

    expect(report.ok).toBe(true)
    expect(report.steps.some((s) => s.step === 'draw' && s.status === 'warn')).toBe(true)
    expect(report.steps.some((s) => s.status === 'warn' && s.label.includes('Round 2'))).toBe(true)
    expect(fake.competitionByName(F3K_CONTEST, '2026-09-19')!.rounds[1].state).toBe('Drawn')
    expect(report.counts.failed).toBe(0)
  })

  it('a round left open names its gaps — who has no entry, which flight misses which metrics', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    let s = sheetReducer(initialSheet(), { type: 'classChosen', contentHash: 'hash', definition: f3k })
    s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Matamata' })
    s = sheetReducer(s, { type: 'setField', field: 'date', value: '2026-09-19' })
    s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Pete' })
    s = sheetReducer(s, { type: 'setTaskPick', roundIndex: 0, taskRef: 'B' })
    s = sheetReducer(s, { type: 'setPilot', index: 0, patch: { name: 'Ana Silva' } })
    s = sheetReducer(s, { type: 'setPilotCount', count: 2 })
    s = sheetReducer(s, { type: 'setPilot', index: 1, patch: { name: 'Ben Tu' } })
    s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(1, 1, 1, 'flightTime'), text: '1:02' })
    // Flight 2 exists (a recorded flag) but its flight time never landed —
    // the entry's flight gap; Ben's row is silent — no entry at all.
    s = sheetReducer(s, {
      type: 'setCell',
      key: sheetCellKey(1, 1, 2, 'launchedInWorkingTime'),
      text: 'y',
    })

    const progress: string[] = []
    const report = await runCalculate(api, s, (p) =>
      progress.push(`${p.status} ${p.label}${p.detail ? ` — ${p.detail}` : ''}`),
    )

    expect(report.ok).toBe(true)
    const open = progress.find((l) => l.startsWith('warn Round 1 left open'))
    expect(open).toContain('2 gap(s)')
    expect(open).toContain('Ben Tu has no entry')
    expect(open).toContain('Ana Silva flight 2: Flight time not captured')
  })
})

describe('calculate — BeforeFlying parameters (NDC Radian)', () => {
  const radian = radianFixture as unknown as ClassDefinition

  function radianSheet(): SheetState {
    let s = sheetReducer(initialSheet(), { type: 'classChosen', contentHash: 'hash', definition: radian })
    s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Matamata' })
    s = sheetReducer(s, { type: 'setField', field: 'date', value: '2026-09-19' })
    s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Pete' })
    s = sheetReducer(s, { type: 'setPilot', index: 0, patch: { name: 'Ana Silva', mfnz: '1234' } })
    s = sheetReducer(s, { type: 'setPilotCount', count: 2 })
    s = sheetReducer(s, { type: 'setPilot', index: 1, patch: { name: 'Ben Tu', mfnz: '2345' } })
    // One stopwatch-style flightTime reading per pilot (no overfly metric in
    // this class — flightTime is a plain column) plus a landing distance.
    for (const [pi, row] of [1, 2].entries()) {
      s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(1, row, 1, 'flightTime'), text: `${300 + pi * 10}` })
      s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(1, row, 1, 'landingDistance'), text: `${8 + pi}` })
    }
    return s
  }

  it('binds the BeforeFlying working-time parameter and completes the round', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(radian)
    const sheet = radianSheet()

    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok, report.steps.map((s) => `${s.status} ${s.label} ${s.detail ?? ''}`).join('\n')).toBe(true)
    const comp = fake.competitionByName(RADIAN_CONTEST, '2026-09-19')!
    // roundDuration — the task's working time — landed as a binding.
    expect(comp.bindings.some((b) => b.parameterName === 'roundDuration')).toBe(true)
    expect(comp.rounds[0].state).toBe('Complete')
    expect(report.counts.captured).toBe(4)
  })

  it('binds roundDuration from the sheet input when the organiser types one', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(radian)
    const sheet = sheetReducer(radianSheet(), { type: 'setParam', name: 'roundDuration', text: '600' })

    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    const comp = fake.competitionByName(RADIAN_CONTEST, '2026-09-19')!
    const bind = comp.bindings.find((b) => b.parameterName === 'roundDuration')
    expect(bind?.value).toMatchObject({ kind: 'Number', number: 600 })
  })

  it('captures an entered landing 0 as an exact zero, never blank', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(radian)
    const sheet = sheetReducer(radianSheet(), {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'landingDistance'),
      text: '0',
    })

    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok, report.steps.map((s) => `${s.status} ${s.label} ${s.detail ?? ''}`).join('\n')).toBe(true)
    const flight = fake.competitionByName(RADIAN_CONTEST, '2026-09-19')!.entries[0].flights.get(1)!
    expect(flight.get('landingDistance')).toEqual({ kind: 'Number', number: 0 })
  })
})

describe('calculate — deselected compliance (the More list)', () => {
  it('a select-then-deselect before any Calculate captures nothing', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    // The More checkbox writes the exception ('n'); unticking clears it —
    // the sheet text ends blank before the first Calculate.
    const clicked = sheetReducer(baseSheet(), {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'launchedInWorkingTime'),
      text: 'n',
    })
    const deselected = sheetReducer(clicked, {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'launchedInWorkingTime'),
      text: '',
    })

    const report = await runCalculate(api, deselected, noProgress)

    expect(report.ok).toBe(true)
    expect(report.counts.captured).toBe(2) // the two flight times only
    const entry = fake.competitionByName(F3K_CONTEST, '2026-09-19')!.entries[0]
    expect(entry.flights.get(1)!.has('launchedInWorkingTime')).toBe(false)
    expect(entry.flights.get(1)!.get('flightTime')).toMatchObject({ kind: 'Number', number: 62 })
  })

  it('unticking after Calculate amends the captured flag back to the assumed value', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const checked = sheetReducer(baseSheet(), {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'launchedInWorkingTime'),
      text: 'n',
    })
    await runCalculate(api, checked, noProgress)
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    expect(comp.entries[0].flights.get(1)!.get('launchedInWorkingTime')).toMatchObject({
      kind: 'Flag',
      flag: false,
    })
    expect(comp.rounds[0].state).toBe('Complete')

    const deselected = sheetReducer(checked, {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'launchedInWorkingTime'),
      text: '',
    })
    const report = await runCalculate(api, deselected, noProgress)

    expect(report.ok).toBe(true)
    expect(report.counts.amended).toBe(1)
    expect(comp.entries[0].flights.get(1)!.get('launchedInWorkingTime')).toMatchObject({
      kind: 'Flag',
      flag: true,
    })
    expect(comp.entries[0].amendments).toEqual([
      expect.objectContaining({
        metric: 'launchedInWorkingTime',
        newValue: { kind: 'Flag', flag: true },
      }),
    ])
    // the completed round was reopened for the correction, then re-completed
    expect(comp.rounds[0].state).toBe('Complete')
  })

  it('a rerun after the amend is a no-op — blank agrees with the stored assumption', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const checked = sheetReducer(baseSheet(), {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'launchedInWorkingTime'),
      text: 'n',
    })
    await runCalculate(api, checked, noProgress)
    const deselected = sheetReducer(checked, {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'launchedInWorkingTime'),
      text: '',
    })
    await runCalculate(api, deselected, noProgress)
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    expect(comp.entries[0].amendments).toHaveLength(1)

    const report = await runCalculate(api, deselected, noProgress)

    expect(report.counts).toEqual({
      captured: 0,
      amended: 0,
      unchanged: 3, // two flight times + the reconciled flag agreeing with its assumption
      failed: 0,
      skippedNotDrawn: 0,
      skippedNotRegistered: 0,
      penalties: 0,
    })
    expect(comp.entries[0].amendments).toHaveLength(1)
  })

  it('unticking restores every flight the tick covered (two fixed flight rows)', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    // Task B is lastN 2: both flight rows are always visible, and the More
    // checkbox writes the exception onto both.
    let s = sheetReducer(baseSheet(), { type: 'setTaskPick', roundIndex: 0, taskRef: 'B' })
    s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(1, 1, 1, 'launchedInWorkingTime'), text: 'n' })
    s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(1, 1, 2, 'launchedInWorkingTime'), text: 'n' })
    const first = await runCalculate(api, s, noProgress)
    expect(first.counts.captured).toBe(4) // two flight times + two flags
    const comp = fake.competitionByName(F3K_CONTEST, '2026-09-19')!
    expect(comp.entries[0].flights.get(1)!.get('launchedInWorkingTime')).toMatchObject({ kind: 'Flag', flag: false })
    expect(comp.entries[0].flights.get(2)!.get('launchedInWorkingTime')).toMatchObject({ kind: 'Flag', flag: false })

    let d = sheetReducer(s, { type: 'setCell', key: sheetCellKey(1, 1, 1, 'launchedInWorkingTime'), text: '' })
    d = sheetReducer(d, { type: 'setCell', key: sheetCellKey(1, 1, 2, 'launchedInWorkingTime'), text: '' })
    const report = await runCalculate(api, d, noProgress)

    expect(report.ok).toBe(true)
    expect(report.counts.amended).toBe(2)
    expect(comp.entries[0].flights.get(1)!.get('launchedInWorkingTime')).toMatchObject({ kind: 'Flag', flag: true })
    expect(comp.entries[0].flights.get(2)!.get('launchedInWorkingTime')).toMatchObject({ kind: 'Flag', flag: true })
  })

  it('a cleared assumed value amends back to its assumption too', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(x5jLike)
    const filled = sheetReducer(x5jSheet(), {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'motorRestartRunTime'),
      text: '3',
    })
    await runCalculate(api, filled, noProgress)
    const comp = fake.competitionByName(X5J_CONTEST, '2026-09-22')!
    expect(comp.entries[0].flights.get(1)!.get('motorRestartRunTime')).toMatchObject({
      kind: 'Number',
      number: 3,
    })

    const cleared = sheetReducer(filled, {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'motorRestartRunTime'),
      text: '',
    })
    const report = await runCalculate(api, cleared, noProgress)

    expect(report.ok).toBe(true)
    expect(report.counts.amended).toBe(1)
    expect(comp.entries[0].flights.get(1)!.get('motorRestartRunTime')).toMatchObject({
      kind: 'Number',
      number: 0,
    })
  })

  it('blank on a required (non-assumed) metric is not an undo', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    await runCalculate(api, baseSheet(), noProgress)

    const cleared = sheetReducer(baseSheet(), {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'flightTime'),
      text: '',
    })
    const report = await runCalculate(api, cleared, noProgress)

    // No assumption to amend to, and the wire has no un-capture: the sheet
    // cannot express "no flight time" — the recorded value stays.
    expect(report.ok).toBe(true)
    expect(report.counts.amended).toBe(0)
    const entry = fake.competitionByName(F3K_CONTEST, '2026-09-19')!.entries[0]
    expect(entry.flights.get(1)!.get('flightTime')).toMatchObject({ kind: 'Number', number: 62 })
  })
})

// --- an X5J-shaped definition for the assumed-value (Number) branch ---

const x5jLike = {
  name: 'X5J Electric',
  version: '1',
  parameters: [],
  penalties: [],
  phases: [
    {
      type: 'Preliminary',
      ordinal: 0,
      rounds: { kind: 'FixedSequence', tasksPerRound: 1, requireDistinctTaskPerRound: false, maxRounds: 1 },
      validity: {},
      tasks: [
        {
          code: 'D',
          name: 'Glide Duration',
          metrics: [
            { name: 'glideTime', kind: 'Number', unit: 's', declaredBeforeLaunch: false },
            {
              name: 'motorRestartRunTime',
              kind: 'Number',
              unit: 's',
              declaredBeforeLaunch: false,
              whenNotRecorded: { kind: 'Number', number: 0 },
            },
          ],
          flights: { $kind: 'last' },
          timing: { kind: 'Fixed', workingTime: 600, maxLaunches: 1 },
          normalise: {},
        },
      ],
    },
  ],
} as unknown as ClassDefinition

function x5jSheet(): SheetState {
  let s = sheetReducer(initialSheet(), {
    type: 'classChosen',
    contentHash: 'hash-x5j',
    definition: x5jLike,
  })
  s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Matamata' })
  s = sheetReducer(s, { type: 'setField', field: 'date', value: '2026-09-22' })
  s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Pete' })
  s = sheetReducer(s, { type: 'setPilot', index: 0, patch: { name: 'Ana Silva', mfnz: '1234' } })
  s = sheetReducer(s, { type: 'setPilotCount', count: 1 })
  s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(1, 1, 1, 'glideTime'), text: '60' })
  return s
}

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

// --- stopwatch entry: one reading, split at working time (F3J task D) ---

function f3jSheet(): SheetState {
  let s = sheetReducer(initialSheet(), {
    type: 'classChosen',
    contentHash: 'hash-f3j',
    definition: f3j,
  })
  s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Matamata' })
  s = sheetReducer(s, { type: 'setField', field: 'date', value: '2026-09-20' })
  s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Pete' })
  s = sheetReducer(s, { type: 'setPilot', index: 0, patch: { name: 'Ana Silva', mfnz: '1234' } })
  s = sheetReducer(s, { type: 'setPilotCount', count: 2 })
  s = sheetReducer(s, { type: 'setPilot', index: 1, patch: { name: 'Ben Tu', mfnz: '2345' } })
  return s
}

function f3jReading(
  sheet: SheetState,
  pilotRow: number,
  stopwatch: string,
  landing: string,
): SheetState {
  let s = sheetReducer(sheet, {
    type: 'setCell',
    key: sheetCellKey(1, pilotRow, 1, 'flightTime'),
    text: stopwatch,
  })
  s = sheetReducer(s, {
    type: 'setCell',
    key: sheetCellKey(1, pilotRow, 1, 'landingDistance'),
    text: landing,
  })
  return s
}

describe('calculate — stopwatch split (F3J task D, 600 s working time)', () => {
  it('a flight inside working time captures only the flight time — overfly omitted', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const sheet = f3jReading(f3jSheet(), 1, '9:50', '12.3')
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    expect(report.counts.captured).toBe(2)
    const entry = fake.competitionByName(F3J_CONTEST, '2026-09-20')!.entries[0]
    expect(entry.flights.get(1)!.get('flightTime')).toMatchObject({ kind: 'Number', number: 590 })
    expect(entry.flights.get(1)!.has('overflySeconds')).toBe(false)
  })

  it('a flight over working time splits: 604 → flight 600, overfly 4', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const sheet = f3jReading(f3jSheet(), 1, '10:04', '9.9')
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    expect(report.counts.captured).toBe(3)
    const flight = fake.competitionByName(F3J_CONTEST, '2026-09-20')!.entries[0].flights.get(1)!
    expect(flight.get('flightTime')).toMatchObject({ kind: 'Number', number: 600 })
    expect(flight.get('overflySeconds')).toMatchObject({ kind: 'Number', number: 4 })
  })

  it('a fractional excess truncates to whole overfly seconds: 604.4 → 600/4', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const sheet = f3jReading(f3jSheet(), 1, '604.4', '9.9')
    await runCalculate(api, sheet, noProgress)

    const flight = fake.competitionByName(F3J_CONTEST, '2026-09-20')!.entries[0].flights.get(1)!
    expect(flight.get('flightTime')).toMatchObject({ kind: 'Number', number: 600 })
    expect(flight.get('overflySeconds')).toMatchObject({ kind: 'Number', number: 4 })
  })

  it('the in-working part rounds per the flight metric (0.1 s HalfUp)', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    // 9:49.96 = 589.96 s → HalfUp to 590.0; still no overfly.
    const sheet = f3jReading(f3jSheet(), 1, '9:49.96', '12.3')
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    const flight = fake.competitionByName(F3J_CONTEST, '2026-09-20')!.entries[0].flights.get(1)!
    expect(flight.get('flightTime')).toMatchObject({ kind: 'Number', number: 590 })
    expect(flight.has('overflySeconds')).toBe(false)
  })

  it('re-running an unchanged sheet is a no-op — the split pair counts once', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const sheet = f3jReading(f3jSheet(), 1, '10:04', '9.9')
    await runCalculate(api, sheet, noProgress)

    const before = JSON.stringify(fake.competitions)
    const report = await runCalculate(api, sheet, noProgress)
    expect(report.ok).toBe(true)
    expect(report.counts).toEqual({
      captured: 0,
      amended: 0,
      unchanged: 2, // the stopwatch cell (flight + overfly) and the landing cell
      failed: 0,
      skippedNotDrawn: 0,
      skippedNotRegistered: 0,
      penalties: 0,
    })
    expect(JSON.stringify(fake.competitions)).toBe(before)
  })

  it('correcting below working time amends the flight and erases the captured overfly', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const base = f3jSheet()
    await runCalculate(api, f3jReading(f3jReading(base, 1, '10:04', '9.9'), 2, '9:55', '11.1'), noProgress)
    const comp = fake.competitionByName(F3J_CONTEST, '2026-09-20')!
    expect(comp.rounds[0].state).toBe('Complete')

    const edited = f3jReading(f3jReading(base, 1, '9:50', '9.9'), 2, '9:55', '11.1')
    const report = await runCalculate(api, edited, noProgress)

    expect(report.counts.amended).toBe(2)
    expect(report.counts.captured).toBe(0)
    const flight = comp.entries[0].flights.get(1)!
    expect(flight.get('flightTime')).toMatchObject({ kind: 'Number', number: 590 })
    expect(flight.get('overflySeconds')).toMatchObject({ kind: 'Number', number: 0 })
    expect(comp.entries[0].amendments.map((a) => a.metric).sort()).toEqual([
      'flightTime',
      'overflySeconds',
    ])
    expect(comp.rounds[0].state).toBe('Complete')
    // the completed round was reopened for the correction, then re-completed
    expect(report.steps.some((s) => s.step === 'complete' && s.status === 'ok')).toBe(true)
  })

  it('a growing overfly on a correction captures the new excess', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    await runCalculate(api, f3jReading(f3jSheet(), 1, '9:50', '9.9'), noProgress)
    const comp = fake.competitionByName(F3J_CONTEST, '2026-09-20')!

    const report = await runCalculate(api, f3jReading(f3jSheet(), 1, '605.7', '9.9'), noProgress)
    expect(report.counts.amended).toBe(1) // flightTime 590 → 600
    expect(report.counts.captured).toBe(1) // overflySeconds 5
    const flight = comp.entries[0].flights.get(1)!
    expect(flight.get('flightTime')).toMatchObject({ kind: 'Number', number: 600 })
    expect(flight.get('overflySeconds')).toMatchObject({ kind: 'Number', number: 5 })
  })

  it('refuses direct entry in the split-owned overfly cell', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const bad = sheetReducer(f3jReading(f3jSheet(), 1, '10:04', '9.9'), {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'overflySeconds'),
      text: '4',
    })
    const report = await runCalculate(api, bad, noProgress)

    expect(report.ok).toBe(false)
    expect(report.cellErrors).toEqual([
      {
        key: sheetCellKey(1, 1, 1, 'overflySeconds'),
        error: 'Overfly seconds is split from the stopwatch reading — clear this cell',
      },
    ])
    expect(fake.competitions).toHaveLength(0)
  })

  it('both pilots capture and the round completes on the split values', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    let sheet = f3jReading(f3jSheet(), 1, '9:50', '12.3')
    sheet = f3jReading(sheet, 2, '10:02', '7.7')
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    const comp = fake.competitionByName(F3J_CONTEST, '2026-09-20')!
    expect(comp.rounds[0].state).toBe('Complete')
    expect(comp.entries[0].flights.get(1)!.get('flightTime')).toMatchObject({ number: 590 })
    expect(comp.entries[1].flights.get(1)!.get('flightTime')).toMatchObject({ number: 600 })
    expect(comp.entries[1].flights.get(1)!.get('overflySeconds')).toMatchObject({ number: 2 })
  })
})

// --- the flyaway ambiguity: a stopwatch reading at the working-time horn ---
// (`f5j-flight-time-cap-at-959.md` — "cap at 9:59; a 600 sec flight results in
// a zero landing". The engine cannot tell a flyaway from a horn-edge landing;
// the sheet warns loudly, never refuses, never reinterprets.)

function f5jSheet(): SheetState {
  const f5j = f5jFixture as unknown as ClassDefinition
  let s = sheetReducer(initialSheet(), {
    type: 'classChosen',
    contentHash: 'hash-f5j',
    definition: f5j,
  })
  s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Matamata' })
  s = sheetReducer(s, { type: 'setField', field: 'date', value: '2026-09-21' })
  s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Pete' })
  s = sheetReducer(s, { type: 'setPilot', index: 0, patch: { name: 'Ana Silva', mfnz: '1234' } })
  s = sheetReducer(s, { type: 'setPilotCount', count: 2 })
  s = sheetReducer(s, { type: 'setPilot', index: 1, patch: { name: 'Ben Tu', mfnz: '2345' } })
  return s
}

describe('calculate — stopwatch at the working-time horn (flyaway ambiguity)', () => {
  it('a 10:00 reading warns loudly and still captures — the engine is the truth', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const sheet = f3jReading(f3jSheet(), 1, '10:00', '9.9')
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    const warn = report.steps.find((s) => s.status === 'warn' && s.label.includes('Ana Silva'))
    expect(warn?.label).toMatch(/flight 1 — stopwatch 10:00 reaches the 10:00 working time with no overfly/)
    expect(warn?.detail).toMatch(/never landed/)
    expect(warn?.detail).toMatch(/at most 9:59\.9/) // the flight metric's 0.1 s step
    const flight = fake.competitionByName(F3J_CONTEST, '2026-09-20')!.entries[0].flights.get(1)!
    expect(flight.get('flightTime')).toMatchObject({ kind: 'Number', number: 600 })
    expect(flight.has('overflySeconds')).toBe(false)
  })

  it('a sub-second excess that truncates away warns too (600.4 → flight 600, no overfly)', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const sheet = f3jReading(f3jSheet(), 1, '600.4', '9.9')
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    expect(
      report.steps.some((s) => s.status === 'warn' && s.label.includes('10:00.4')),
    ).toBe(true)
  })

  it('a reading past the horn with a surviving overfly does not warn — the definition zeroes that landing', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const sheet = f3jReading(f3jSheet(), 1, '10:04', '9.9')
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    expect(report.steps.some((s) => s.status === 'warn' && s.label.includes('no overfly'))).toBe(false)
  })

  it('a reading inside the window never warns', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3j)
    const sheet = f3jReading(f3jSheet(), 1, '9:50', '12.3')
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    expect(report.steps.some((s) => s.status === 'warn' && s.label.includes('Ana Silva'))).toBe(false)
  })

  it('the advice speaks the class declaration — F5J whole seconds cap a landed reading at 9:59', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f5jFixture as unknown as ClassDefinition)
    let sheet = f5jSheet()
    sheet = sheetReducer(sheet, { type: 'setCell', key: sheetCellKey(1, 1, 1, 'flightTime'), text: '10:00' })
    sheet = sheetReducer(sheet, { type: 'setCell', key: sheetCellKey(1, 1, 1, 'startHeight'), text: '150' })
    sheet = sheetReducer(sheet, { type: 'setCell', key: sheetCellKey(1, 1, 1, 'landingDistance'), text: '3' })
    const report = await runCalculate(api, sheet, noProgress)

    expect(report.ok).toBe(true)
    const warn = report.steps.find((s) => s.status === 'warn' && s.label.includes('no overfly'))
    expect(warn?.label).toMatch(/stopwatch 10:00 reaches the 10:00 working time/)
    expect(warn?.detail).toMatch(/at most 9:59;/)
    const flight = fake.competitionByName(F5J_CONTEST, '2026-09-21')!.entries[0].flights.get(1)!
    expect(flight.get('flightTime')).toMatchObject({ kind: 'Number', number: 600 })
    expect(flight.has('overflySeconds')).toBe(false)
  })
})

// --- the fabricated contest identity (bug #4: no contest-name field) ---

/** A duplicate the way only the wire could hold one: two competitions that
 * share the sheet's fabricated identity (a second same-day event at the
 * same venue and class, created outside this sheet). */
function seedDuplicate(fake: FakeSoarscore, id: string): void {
  fake.competitions.push({
    id,
    name: F3K_CONTEST,
    location: 'Matamata',
    date: '2026-09-19',
    classContentHash: 'hash',
    bindings: [],
    drawStatus: 'none',
    rounds: [],
    groups: new Map(),
    competitors: [],
    entries: [],
  })
}

describe('calculate — the fabricated contest name (no contest-name field)', () => {
  it('creates under the fabricated name `<ISO date> <location> <class label>`', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)

    const report = await runCalculate(api, baseSheet(), noProgress)

    expect(report.ok).toBe(true)
    expect(fake.competitionByName('2026-09-19 Matamata F3K', '2026-09-19')).toBeDefined()
    expect(fake.competitions[0].name).toBe(F3K_CONTEST)
  })

  it('a re-calc of the same header finds the same competition — the fabricated name is the identity', async () => {
    const fake = new FakeSoarscore()
    const api = fake.api(f3k)
    const sheet = baseSheet()
    const first = await runCalculate(api, sheet, noProgress)

    const second = await runCalculate(api, sheet, noProgress)

    expect(second.ok).toBe(true)
    expect(second.competitionId).toBe(first.competitionId)
    expect(fake.competitions).toHaveLength(1)
  })

  it('a duplicate in Soarscore (two contests with the fabricated identity) stops the run — the client never picks one', async () => {
    const fake = new FakeSoarscore()
    seedDuplicate(fake, 'dup-1')
    seedDuplicate(fake, 'dup-2')
    const api = fake.api(f3k)

    const report = await runCalculate(api, baseSheet(), noProgress)

    expect(report.ok).toBe(false)
    expect(report.competitionId).toBeNull()
    const failed = report.steps.find((s) => s.step === 'competition' && s.status === 'error')
    expect(failed?.label).toBe(
      '2 contests are already named "2026-09-19 Matamata F3K" starting 2026-09-19',
    )
    expect(failed?.detail).toContain('dup-1')
    expect(failed?.detail).toContain('dup-2')
    // Nothing else ran: no create, no registration, no draw.
    expect(fake.competitions).toHaveLength(2)
    expect(fake.people).toHaveLength(0)
  })

  it('a wire refusal on the fabricated name surfaces verbatim (RFC 9457 title code + detail)', async () => {
    const fake = new FakeSoarscore()
    const api = {
      ...fake.api(f3k),
      createCompetition: async () => {
        throw new ApiError(
          409,
          'competition.name.unique',
          'A competition with that name already exists.',
          [],
        )
      },
    }

    const report = await runCalculate(api, baseSheet(), noProgress)

    expect(report.ok).toBe(false)
    expect(report.competitionId).toBeNull()
    const failed = report.steps.find((s) => s.step === 'competition' && s.status === 'error')
    expect(failed?.label).toBe('Find-or-create competition failed')
    expect(failed?.detail).toBe(
      'competition.name.unique: A competition with that name already exists.',
    )
  })
})
