import { describe, expect, it } from 'vitest'
import { createApi } from '../api/client'
import { runCalculate } from '../sheet/calculate'
import { initialSheet, sheetCellKey, sheetReducer, type SheetState } from '../sheet/sheet'

declare const process: { env: Record<string, string | undefined> }

const BASE = process.env.LIVE_API_BASE ?? 'http://localhost:5000'
const LIVE = process.env.LIVE_API === '1'
const d = describe.skipIf(!LIVE)

// The fabricated contest name (date, location, class) replaced the typed
// unique name as the run's identity — a per-run date keeps the live repro
// from adopting a previous run's drawn, field-frozen competition.
const liveDate = new Date(
  Date.UTC(2026, 0, 1 + (Date.now() % 28)),
).toISOString().slice(0, 10)

d('live repro: NDC Radian', () => {
  it('calculates a correctly filled sheet', async () => {
    const api = createApi(BASE)
    const classes = await api.findClassDefinitions({ activeOnly: true })
    const rc = classes.value.find((c) => c.name.includes('Radian'))
    expect(rc).toBeDefined()
    const definition = (await api.getClassDefinition(rc!.contentHash)).value

    let s = sheetReducer(initialSheet(), { type: 'classChosen', contentHash: rc!.contentHash, definition })
    s = sheetReducer(s, { type: 'setField', field: 'location', value: 'Test Field' })
    s = sheetReducer(s, { type: 'setField', field: 'date', value: liveDate })
    s = sheetReducer(s, { type: 'setField', field: 'cdName', value: 'Live CD' })
    s = sheetReducer(s, { type: 'setPilot', index: 0, patch: { name: 'Live Radian A', mfnz: '700' } })
    s = sheetReducer(s, { type: 'setPilotCount', count: 2 })
    s = sheetReducer(s, { type: 'setPilot', index: 1, patch: { name: 'Live Radian B', mfnz: '701' } })
    for (const round of [1, 2, 3]) {
      for (const [pi, row] of [1, 2].entries()) {
        s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(round, row, 1, 'flightTime'), text: `${round * 100 + pi}` })
        s = sheetReducer(s, { type: 'setCell', key: sheetCellKey(round, row, 1, 'landingDistance'), text: `${round + pi}` })
      }
    }

    const sheet: SheetState = s
    const report = await runCalculate(api, sheet, (p) =>
      console.log(`${p.status.toUpperCase()} ${p.label} ${p.detail ?? ''}`),
    )
    console.log('COUNTS', JSON.stringify(report.counts))
    console.log('CELL ERRORS', JSON.stringify(report.cellErrors))
    expect(report.ok).toBe(true)
  }, 180000)
})
