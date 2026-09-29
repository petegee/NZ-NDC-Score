import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GroupScore } from '../api/types'
import { LANDING_METRIC } from '../grid/schema'
import { sheetCellKey, type SheetRoundGrid } from './sheet'
import { ResultsTable } from './ResultsTable'

const names = new Map([
  ['c-1', 'Alice A'],
  ['c-2', 'Bob B'],
  ['c-3', 'Carol C'],
])

describe('ResultsTable — one row per competitor, one column pair per group-round', () => {
  const resultsNames = new Map([...names, ['c-4', 'Dave D']])
  const schedule = [
    { roundOrdinal: 1, taskRoundOrdinal: 1, taskRef: 'D' },
    { roundOrdinal: 2, taskRoundOrdinal: 1, taskRef: 'B' },
  ]
  const round1: GroupScore = {
    groupRef: { value: 'g-1' },
    results: [
      {
        competitorRef: { value: 'c-1' },
        role: 'Original',
        state: 'Valid',
        rawScore: '1200.0',
        preNormalisationScore: '1200',
        awaitingCapture: [],
      },
      {
        competitorRef: { value: 'c-3' },
        role: 'Original',
        state: 'Valid',
        rawScore: '995.5',
        preNormalisationScore: '995.5',
        awaitingCapture: [],
      },
    ],
    winnerRef: { value: 'c-1' },
    validCount: 2,
    isAnnulled: false,
  }
  const round2: GroupScore = {
    groupRef: { value: 'g-2' },
    results: [
      {
        competitorRef: { value: 'c-1' },
        role: 'Original',
        state: 'Valid',
        rawScore: '980',
        preNormalisationScore: '980',
        awaitingCapture: [],
      },
    ],
    winnerRef: { value: 'c-1' },
    validCount: 1,
    isAnnulled: false,
  }
  const standings = {
    scores: [
      { competitorRef: { value: 'c-3' }, score: '995.5', disqualified: false, placing: 2 },
      { competitorRef: { value: 'c-1' }, score: '2180.0', disqualified: false, placing: 1 },
      { competitorRef: { value: 'c-4' }, score: 0, disqualified: true, placing: null },
    ],
  }

  it('orders rows by the server’s placing — highest total first, unplaced last', () => {
    render(
      <ResultsTable
        schedule={schedule}
        roundScores={{ '1:1': [round1], '2:1': [round2] }}
        standings={standings}
        names={resultsNames}
      />,
    )
    const text = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    const indexOf = (who: string) => text.findIndex((t) => t.includes(who))
    expect(indexOf('Alice A')).toBeLessThan(indexOf('Carol C'))
    expect(indexOf('Carol C')).toBeLessThan(indexOf('Dave D'))
    expect(indexOf('Dave D')).toBeGreaterThan(-1)
  })

  it('renders the round number and verbatim raw score per group-round, total last', () => {
    const { container } = render(
      <ResultsTable
        schedule={schedule}
        roundScores={{ '1:1': [round1], '2:1': [round2] }}
        standings={standings}
        names={resultsNames}
      />,
    )
    const aliceRow = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Alice A')) as HTMLElement
    const cells = Array.from(aliceRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells[0]).toBe('Alice A')
    expect(cells[1]).toBe('1')
    expect(cells[2]).toBe('1200.0')
    expect(cells[3]).toBe('2')
    expect(cells[4]).toBe('980')
    expect(cells[5]).toBe('2180.0')
    // No thousand separators, no rounding — byte-equal (law 2).
    expect(container.textContent).not.toContain('2,180')
  })

  it('shows no result for a NoResult round and leaves never-flown rounds empty', () => {
    const noResult: GroupScore = {
      groupRef: { value: 'g-3' },
      results: [
        {
          competitorRef: { value: 'c-1' },
          role: 'Original',
          state: 'NoResult',
          rawScore: 0,
          preNormalisationScore: 0,
          awaitingCapture: [],
        },
      ],
      validCount: 0,
      isAnnulled: false,
    }
    render(
      <ResultsTable
        schedule={[...schedule, { roundOrdinal: 3, taskRoundOrdinal: 1, taskRef: 'D' }]}
        roundScores={{ '1:1': [round1], '2:1': [round2], '3:1': [noResult] }}
        standings={standings}
        names={resultsNames}
      />,
    )
    const aliceRow = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Alice A')) as HTMLElement
    const cells = Array.from(aliceRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells[6]).toBe('no result') // never a zero display of state
    expect(cells[7]).toBe('2180.0')
    // Dave: disqualified, flew nothing — empty round cells, DQ never zero.
    const daveRow = screen
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Dave D')) as HTMLElement
    const daveCells = Array.from(daveRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(daveCells[2]).toBe('')
    expect(daveCells[4]).toBe('')
    expect(daveCells[6]).toBe('')
    expect(daveCells[7]).toBe('DQ')
  })

  it('carries the entry sheet’s round-block rule and tint classes', () => {
    render(
      <ResultsTable
        schedule={schedule}
        roundScores={{ '1:1': [round1], '2:1': [round2] }}
        standings={standings}
        names={resultsNames}
      />,
    )
    const rows = screen.getAllByRole('row')
    const head = rows[0]
    const roundHeads = Array.from(head.querySelectorAll('th')).filter((th) =>
      th.textContent?.startsWith('Round'),
    )
    expect(roundHeads[0]).toHaveClass('round-start')
    expect(roundHeads[0]).not.toHaveClass('round-alt')
    expect(roundHeads[1]).toHaveClass('round-start', 'round-alt')
    const aliceRow = rows.find((r) => r.textContent?.includes('Alice A')) as HTMLElement
    const cells = Array.from(aliceRow.querySelectorAll('td'))
    expect(cells[1]).toHaveClass('round-start')
    expect(cells[3]).toHaveClass('round-start', 'round-alt')
    expect(cells[4]).toHaveClass('round-alt')
    expect(cells[4]).not.toHaveClass('round-start')
  })

  it('keeps competitors with round results but no total yet, after the placed rows', () => {
    render(
      <ResultsTable
        schedule={schedule}
        roundScores={{ '1:1': [round1] }}
        standings={{ scores: standings.scores.filter((s) => s.competitorRef.value !== 'c-3') }}
        names={resultsNames}
      />,
    )
    const text = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    const indexOf = (who: string) => text.findIndex((t) => t.includes(who))
    expect(indexOf('Carol C')).toBeGreaterThan(indexOf('Alice A'))
    expect(indexOf('Carol C')).toBeGreaterThan(indexOf('Dave D'))
  })

  it('shows each flight’s key metrics from the sheet text before the raw score', () => {
    // A two-flight task with one key metric and one assumed (non-key) metric —
    // the non-key one never gets a column (same rule as the entry sheet).
    const roundGrid: SheetRoundGrid = {
      roundOrdinal: 1,
      taskRef: 'D',
      grid: {
        taskRef: 'D',
        taskName: 'Duration',
        timing: { kind: 'Fixed' },
        columns: [
          { metric: 'flightTime', label: 'Time', kind: 'Number', unit: 's', declaredBeforeLaunch: false },
          {
            metric: 'launchHeight',
            label: 'Height',
            kind: 'Number',
            unit: 'm',
            declaredBeforeLaunch: false,
            whenNotRecorded: { kind: 'Number', number: 0 },
          },
        ],
        flightRows: [
          { sequence: 1, label: 'Flight 1 (60 s target)', dynamic: false, targetLabel: '60 s target' },
          { sequence: 2, label: 'Flight 2', dynamic: false },
        ],
        zeroFlightFlags: [],
        zeroHintMetrics: [],
      },
      perRoundParams: [],
    }
    // Alice is sheet row 1, Carol row 2; Dave never had a sheet row.
    const cells: Record<string, string> = {
      [sheetCellKey(1, 1, 1, 'flightTime')]: '35.2',
      [sheetCellKey(1, 1, 2, 'flightTime')]: '40.0',
      [sheetCellKey(1, 1, 1, 'launchHeight')]: '55', // non-key: never shown
      [sheetCellKey(1, 2, 1, 'flightTime')]: '36.1',
      // Carol's flight 2 was never flown — no cell.
    }
    render(
      <ResultsTable
        schedule={[schedule[0]]}
        roundScores={{ '1:1': [round1] }}
        standings={standings}
        names={resultsNames}
        grids={[roundGrid]}
        cells={cells}
        rowCompetitors={{ '1': 'c-1', '2': 'c-3' }}
        rowCountPerRound={[2]}
      />,
    )
    const rows = screen.getAllByRole('row')
    const head = rows[0]
    // Block header spans round + 2 flights × 1 key metric + raw score = 4 columns.
    const blockHead = Array.from(head.querySelectorAll('th')).find((th) =>
      th.textContent?.includes('Round 1'),
    ) as HTMLElement
    expect(blockHead).toHaveAttribute('colspan', '4')
    const subHeads = Array.from(rows[1].querySelectorAll('th')).map((th) => th.textContent ?? '')
    expect(subHeads).toEqual(['Round', '60 s targetTime (s)', 'Time (s)', 'Raw score'])
    expect(subHeads.join(' ')).not.toContain('Height')

    const aliceRow = rows.find((r) => r.textContent?.includes('Alice A')) as HTMLElement
    const alice = Array.from(aliceRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(alice[0]).toBe('Alice A')
    expect(alice[1]).toBe('1') // round label
    expect(alice[2]).toBe('35.2') // flight 1, verbatim sheet text
    expect(alice[3]).toBe('40.0') // flight 2
    expect(alice[4]).toBe('1200.0') // raw score after the metrics

    const carolRow = rows.find((r) => r.textContent?.includes('Carol C')) as HTMLElement
    const carol = Array.from(carolRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(carol[2]).toBe('36.1')
    expect(carol[3]).toBe('') // never-flown flight: empty, never zero

    const daveRow = rows.find((r) => r.textContent?.includes('Dave D')) as HTMLElement
    const dave = Array.from(daveRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(dave[2]).toBe('') // no sheet row: empty, never zero
    // Flight 2's first (only) column opens with the lighter flight rule.
    expect(aliceRow.querySelectorAll('td')[3]).toHaveClass('flight-start')
    expect(aliceRow.querySelectorAll('td')[2]).not.toHaveClass('flight-start')
  })
})

describe('ResultsTable — landing-points column (ss_per-term-landing-points)', () => {
  const landingGrid: SheetRoundGrid = {
    roundOrdinal: 1,
    taskRef: 'A',
    grid: {
      taskRef: 'A',
      taskName: 'Task A',
      timing: { kind: 'Fixed' },
      columns: [
        { metric: 'flightTime', label: 'Time', kind: 'Number', unit: 's', declaredBeforeLaunch: false },
        { metric: LANDING_METRIC, label: 'Landing', kind: 'Number', declaredBeforeLaunch: false },
      ],
      flightRows: [
        { sequence: 1, label: 'Flight 1', dynamic: false },
        { sequence: 2, label: 'Flight 2', dynamic: false },
      ],
      zeroFlightFlags: [],
      zeroHintMetrics: [],
    },
    perRoundParams: [],
  }
  const landingSchedule = [{ roundOrdinal: 1, taskRoundOrdinal: 1, taskRef: 'A' }]
  const landingStandings = {
    scores: [
      { competitorRef: { value: 'c-1' }, score: '625', disqualified: false, placing: 1 },
      { competitorRef: { value: 'c-2' }, score: '300', disqualified: false, placing: 2 },
    ],
  }
  // Alice: two flown flights. Flight 1 lists the landing term second (engine
  // order); flight 2 lists it first — the column keys by metricRef, never by
  // position. Bob: NoResult — absence, never zero.
  const landingRound: GroupScore = {
    groupRef: { value: 'g-1' },
    results: [
      {
        competitorRef: { value: 'c-1' },
        role: 'Original',
        state: 'Valid',
        rawScore: '625',
        preNormalisationScore: '625',
        awaitingCapture: [],
        flights: [
          {
            sequence: 1,
            terms: [
              { termIndex: 0, metricRef: 'flightTime', metricConsumed: 300, points: 300 },
              { termIndex: 1, metricRef: LANDING_METRIC, metricConsumed: 7, points: 25 },
            ],
          },
          {
            sequence: 2,
            terms: [
              { termIndex: 1, metricRef: LANDING_METRIC, metricConsumed: 3, points: 50 },
              { termIndex: 0, metricRef: 'flightTime', metricConsumed: 250, points: 250 },
            ],
          },
        ],
      },
      {
        competitorRef: { value: 'c-2' },
        role: 'Original',
        state: 'NoResult',
        rawScore: 0,
        preNormalisationScore: 0,
        awaitingCapture: [{ flightSequence: 1, awaitedMetric: 'flightTime' }],
        flights: [],
      },
    ],
    winnerRef: { value: 'c-1' },
    validCount: 1,
    isAnnulled: false,
  }
  const landingCells: Record<string, string> = {
    [sheetCellKey(1, 1, 1, 'flightTime')]: '300',
    [sheetCellKey(1, 1, 1, LANDING_METRIC)]: '7',
    [sheetCellKey(1, 1, 2, 'flightTime')]: '250',
    [sheetCellKey(1, 1, 2, LANDING_METRIC)]: '3',
  }
  const landingProps = {
    schedule: landingSchedule,
    roundScores: { '1:1': [landingRound] },
    standings: landingStandings,
    names,
    grids: [landingGrid],
    cells: landingCells,
    rowCompetitors: { '1': 'c-1', '2': 'c-2' },
    rowCountPerRound: [2],
  }

  it('renders one points column per landing column, the engine award verbatim beside each mark', () => {
    render(<ResultsTable {...landingProps} />)
    const rows = screen.getAllByRole('row')
    // Block header spans round + 2 flights × (2 marks + 1 pts) + raw = 8.
    const blockHead = Array.from(rows[0].querySelectorAll('th')).find((th) =>
      th.textContent?.includes('Round 1'),
    ) as HTMLElement
    expect(blockHead).toHaveAttribute('colspan', '8')
    const subHeads = Array.from(rows[1].querySelectorAll('th')).map((th) => th.textContent ?? '')
    expect(subHeads).toEqual([
      'Round',
      'Time (s)',
      'Landing',
      'Landing pts',
      'Time (s)',
      'Landing',
      'Landing pts',
      'Raw score',
    ])

    const aliceRow = rows.find((r) => r.textContent?.includes('Alice A')) as HTMLElement
    const alice = Array.from(aliceRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(alice[0]).toBe('Alice A')
    expect(alice[1]).toBe('1')
    expect(alice[2]).toBe('300') // flight 1 mark text, verbatim
    expect(alice[3]).toBe('7')
    expect(alice[4]).toBe('25') // flight 1 engine award, verbatim
    expect(alice[5]).toBe('250')
    expect(alice[6]).toBe('3')
    expect(alice[7]).toBe('50') // found by metricRef though listed first
    expect(alice[8]).toBe('625')
  })

  it('never leaks non-landing terms into the points column and never computes', () => {
    // Flight-time points (300/250) appear nowhere in the pts cells — only the
    // landing term's award does, read straight off the wire (law 2: no
    // reading→points mapping, no arithmetic in client code).
    render(<ResultsTable {...landingProps} />)
    const rows = screen.getAllByRole('row')
    const aliceRow = rows.find((r) => r.textContent?.includes('Alice A')) as HTMLElement
    const pts = [aliceRow.querySelectorAll('td')[4].textContent, aliceRow.querySelectorAll('td')[7].textContent]
    expect(pts).toEqual(['25', '50'])
  })

  it('shows absence as empty, never zero — NoResult, pending and gate-zeroed flights', () => {
    const gateZeroed: GroupScore = {
      ...landingRound,
      results: [
        landingRound.results[0],
        landingRound.results[1],
        {
          competitorRef: { value: 'c-3' },
          role: 'Original',
          state: 'Valid',
          rawScore: 0,
          preNormalisationScore: 0,
          awaitingCapture: [],
          // Flight-gate-zeroed: the flight is selected at 0 with the
          // interpreter's own empty terms — no landing value to show.
          flights: [{ sequence: 1, terms: [] }],
        },
      ],
    }
    render(
      <ResultsTable
        {...landingProps}
        roundScores={{ '1:1': [gateZeroed] }}
        standings={{
          scores: [
            ...landingStandings.scores,
            { competitorRef: { value: 'c-3' }, score: 0, disqualified: false, placing: 3 },
          ],
        }}
        names={new Map([...names, ['c-3', 'Carol C']])}
        rowCompetitors={{ '1': 'c-1', '2': 'c-2', '3': 'c-3' }}
      />,
    )
    const rows = screen.getAllByRole('row')
    const bobRow = rows.find((r) => r.textContent?.includes('Bob B')) as HTMLElement
    const bob = Array.from(bobRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(bob[4]).toBe('') // NoResult flight 1 pts: empty, never zero
    expect(bob[7]).toBe('') // NoResult flight 2 pts: empty, never zero
    expect(bob[8]).toBe('no result')

    const carolRow = rows.find((r) => r.textContent?.includes('Carol C')) as HTMLElement
    const carol = Array.from(carolRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(carol[4]).toBe('') // gate-zeroed: empty terms, empty cell
    expect(carol[8]).toBe('0') // …while the raw score still shows the engine's zero
  })

  it('renders the engine’s zero for an off-tape 0, distinct from absence', () => {
    const offTape: GroupScore = {
      ...landingRound,
      results: [
        {
          ...landingRound.results[0],
          flights: [
            {
              sequence: 1,
              terms: [
                { termIndex: 0, metricRef: 'flightTime', metricConsumed: 300, points: 300 },
                { termIndex: 1, metricRef: LANDING_METRIC, metricConsumed: 0, points: 0 },
              ],
            },
            ...(landingRound.results[0].flights ?? []).filter((f) => f.sequence === 2),
          ],
        },
        landingRound.results[1],
      ],
    }
    render(
      <ResultsTable
        {...landingProps}
        roundScores={{ '1:1': [offTape] }}
        cells={{ ...landingCells, [sheetCellKey(1, 1, 1, LANDING_METRIC)]: '0' }}
      />,
    )
    const rows = screen.getAllByRole('row')
    const aliceRow = rows.find((r) => r.textContent?.includes('Alice A')) as HTMLElement
    const alice = Array.from(aliceRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(alice[3]).toBe('0') // the off-tape mark, echoed
    expect(alice[4]).toBe('0') // the engine's zero — a value, not absence
  })

  it('tolerates results predating the breakdown — missing flights reads as empty', () => {
    const legacy: GroupScore = {
      groupRef: { value: 'g-9' },
      results: [
        {
          competitorRef: { value: 'c-1' },
          role: 'Original',
          state: 'Valid',
          rawScore: '300',
          preNormalisationScore: '300',
          awaitingCapture: [],
        },
      ],
      validCount: 1,
      isAnnulled: false,
    }
    render(<ResultsTable {...landingProps} roundScores={{ '1:1': [legacy] }} />)
    const rows = screen.getAllByRole('row')
    const aliceRow = rows.find((r) => r.textContent?.includes('Alice A')) as HTMLElement
    const alice = Array.from(aliceRow.querySelectorAll('td')).map((td) => td.textContent)
    expect(alice[4]).toBe('')
    expect(alice[7]).toBe('')
    expect(alice[8]).toBe('300')
  })
})
