import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GroupScore } from '../api/types'
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
