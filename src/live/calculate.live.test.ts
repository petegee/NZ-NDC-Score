import { describe, expect, it } from 'vitest'
import { createApi } from '../api/client'
import type { ClassDefinition } from '../api/types'
import { runCalculate } from '../sheet/calculate'
import { initialSheet, sheetCellKey, sheetReducer, type SheetState } from '../sheet/sheet'

declare const process: { env: Record<string, string | undefined> }

const BASE = process.env.LIVE_API_BASE ?? 'http://localhost:5000'
const LIVE = process.env.LIVE_API === '1'
const d = describe.skipIf(!LIVE)

const stamp = Date.now()

function sheetFor(definition: ClassDefinition, contestName: string): SheetState {
  let s = sheetReducer(initialSheet(), {
    type: 'classChosen',
    contentHash: definition.name, // replaced by the real hash below
    definition,
  })
  s = sheetReducer(s, { type: 'setField', field: 'contestName', value: contestName })
  s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Test Field' })
  s = sheetReducer(s, { type: 'setField', field: 'date', value: '2026-09-19' })
  s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Live CD' })
  return s
}

d('Calculate: the whole sheet → one command sequence, against a live API', () => {
  it('ALES NDC: fresh run → capture → complete; re-run is a no-op; correction amends with the auto reason', async () => {
    const api = createApi(BASE)
    const classes = await api.findClassDefinitions({ activeOnly: true })
    const ales = classes.value.find((c) => c.name.includes('ALES 200') && c.name.includes('NDC'))
    expect(ales).toBeDefined()
    const definition = (await api.getClassDefinition(ales!.contentHash)).value

    const contestName = `Live ALES sheet ${stamp}`
    let sheet = sheetFor(definition, contestName)
    sheet = sheetReducer(sheet, { type: 'classChosen', contentHash: ales!.contentHash, definition })
    sheet = sheetReducer(sheet, { type: 'setParam', name: 'minNewGroup', text: '3' })
    for (const [i, name] of ['Live Pilot A', 'Live Pilot B', 'Live Pilot C'].entries()) {
      if (i > 0) sheet = sheetReducer(sheet, { type: 'addPilot' })
      sheet = sheetReducer(sheet, { type: 'setPilot', index: i, patch: { name, mfnz: String(700 + i) } })
    }
    // Round 1, flight 1: time + landing for all three pilots.
    for (const pi of [1, 2, 3]) {
      sheet = sheetReducer(sheet, {
        type: 'setCell',
        key: sheetCellKey(1, pi, 1, 'flightTime'),
        text: `${60 + pi}`,
      })
      sheet = sheetReducer(sheet, {
        type: 'setCell',
        key: sheetCellKey(1, pi, 1, 'landingDistance'),
        text: `${10 + pi}.5`,
      })
    }

    const progress: string[] = []
    const report = await runCalculate(api, sheet, (p) => progress.push(`${p.status} ${p.label}`))
    expect(report.ok, progress.join('\n')).toBe(true)
    expect(report.counts.captured).toBe(6)
    expect(report.competitionId).toMatch(/^[0-9a-f-]{36}$/)

    // The service completed round 1 and the bind landed.
    const fold = (await api.getCompetition(report.competitionId!)).value
    expect(fold.competition.phases[0].rounds[0].taskRounds[0].state).toBe('Complete')
    expect(
      fold.competition.parameterBindings.some((b) => b.parameterName === 'minNewGroup'),
    ).toBe(true)

    // Re-run without edits: everything unchanged, nothing re-sent.
    const rerun = await runCalculate(api, sheet)
    expect(rerun.ok).toBe(true)
    expect(rerun.counts).toMatchObject({ captured: 0, amended: 0, unchanged: 6, failed: 0 })

    // Overtyped cell → amend with the auto reason (visible in the event log).
    const corrected = sheetReducer(sheet, {
      type: 'setCell',
      key: sheetCellKey(1, 1, 1, 'flightTime'),
      text: '64.2',
    })
    const amendRun = await runCalculate(api, corrected)
    expect(amendRun.counts.amended).toBe(1)
    expect(amendRun.counts.captured).toBe(0)

    const log = (await api.getCompetitionEventLog(report.competitionId!, true)).value
    const amendEvents = log.streams.flatMap((s) => s.events).filter((e) => e.name === 'measurementAmended')
    expect(amendEvents.length).toBeGreaterThanOrEqual(1)
    const amendment = (amendEvents[0].payload as { amendment?: { reason?: string } }).amendment
    expect(amendment?.reason).toBe('Corrected from scoresheet')
  }, 120000)

  it('F3K NDC: catalogue draw, PerRound parameter binds, two flights per pilot', async () => {
    const api = createApi(BASE)
    const classes = await api.findClassDefinitions({ activeOnly: true })
    const f3k = classes.value.find((c) => c.name.includes('Hand-Launch') && c.name.includes('NDC'))
    expect(f3k).toBeDefined()
    const definition = (await api.getClassDefinition(f3k!.contentHash)).value

    const contestName = `Live F3K sheet ${stamp}`
    let sheet = sheetFor(definition, contestName)
    sheet = sheetReducer(sheet, { type: 'classChosen', contentHash: f3k!.contentHash, definition })
    sheet = sheetReducer(sheet, { type: 'setRounds', rounds: 2 })
    sheet = sheetReducer(sheet, { type: 'setTaskPick', roundIndex: 0, taskRef: 'B' })
    sheet = sheetReducer(sheet, { type: 'setTaskPick', roundIndex: 1, taskRef: 'D' })
    const pilots = ['Live F3K P1', 'Live F3K P2', 'Live F3K P3', 'Live F3K P4', 'Live F3K P5']
    for (const [i, name] of pilots.entries()) {
      if (i > 0) sheet = sheetReducer(sheet, { type: 'addPilot' })
      sheet = sheetReducer(sheet, { type: 'setPilot', index: i, patch: { name, mfnz: String(800 + i) } })
    }
    // Round 1 = task B (lastN 2): two flights per pilot, times only (the
    // window/working-time flags carry whenNotRecorded semantics).
    for (const pi of [1, 2, 3, 4, 5]) {
      sheet = sheetReducer(sheet, { type: 'setCell', key: sheetCellKey(1, pi, 1, 'flightTime'), text: '45' })
      sheet = sheetReducer(sheet, { type: 'setCell', key: sheetCellKey(1, pi, 2, 'flightTime'), text: '1:10' })
    }

    const report = await runCalculate(api, sheet)
    expect(report.ok, report.steps.map((s) => `${s.status} ${s.label} ${s.detail ?? ''}`).join('\n')).toBe(true)
    expect(report.counts.captured).toBe(10)

    const fold = (await api.getCompetition(report.competitionId!)).value
    expect(fold.competition.phases[0].rounds.map((r) => r.taskRounds[0].taskRef)).toEqual(['B', 'D'])
    // workingTime.B / maxFlight.B bound for round 1 (the task-B round).
    expect(
      fold.competition.parameterBindings.filter((b) => b.parameterName === 'workingTime.B'),
    ).toHaveLength(1)
    expect(fold.competition.phases[0].rounds[0].taskRounds[0].state).toBe('Complete')

    // Scores read back verbatim — the sheet itself computed nothing.
    const scores = (
      await api.scoreTaskRound({
        competitionRef: report.competitionId!,
        phaseOrdinal: 0,
        roundOrdinal: 1,
        taskRoundOrdinal: 1,
      })
    ).value
    expect(scores.length).toBeGreaterThan(0)
    for (const group of scores) {
      for (const row of group.results) {
        expect(String(row.rawScore)).toMatch(/^[0-9.]+$|^no result$|^[A-Za-z ]+$/)
      }
    }
  }, 120000)
})
