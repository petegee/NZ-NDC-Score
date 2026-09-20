import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GroupScore } from '../api/types'
import { ScoreTable, Standings } from './ScoreTable'

const group: GroupScore = {
  groupRef: { value: 'g-1' },
  results: [
    {
      competitorRef: { value: 'c-1' },
      role: 'Original',
      state: 'Valid',
      // The service's decimals may arrive as strings (event-log payloads do);
      // rendering must not care: String(value) either way.
      rawScore: '1200.0',
      preNormalisationScore: '1200',
      awaitingCapture: [],
    },
    {
      competitorRef: { value: 'c-2' },
      role: 'Original',
      state: 'NoResult',
      rawScore: 0,
      preNormalisationScore: 0,
      awaitingCapture: [{ flightSequence: 2, awaitedMetric: 'flightTime' }],
    },
    {
      competitorRef: { value: 'c-3' },
      role: 'Filler',
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

const names = new Map([
  ['c-1', 'Alice A'],
  ['c-2', 'Bob B'],
  ['c-3', 'Carol C'],
])

describe('ScoreTable — verbatim score rendering (law 2 invariant)', () => {
  it('renders the server\u2019s numbers byte-equal, with no formatting', () => {
    const { container } = render(<ScoreTable scores={[group]} names={names} />)
    const text = container.textContent ?? ''

    // Byte-equal: the exact serialised form the server sent.
    expect(text).toContain('1200.0')
    expect(text).toContain('995.5')
    expect(text).toContain('1200') // pre-normalisation, verbatim too
    // No clock reformatting, no rounding, no thousand separators:
    expect(text).not.toContain('1,200')
  })

  it('shows pre-normalisation only when it differs', () => {
    render(<ScoreTable scores={[group]} names={names} />)
    const rows = screen.getAllByRole('row')
    const aliceRow = rows.find((r) => r.textContent?.includes('Alice A'))
    expect(aliceRow?.textContent).toContain('1200')
    const carolRow = rows.find((r) => r.textContent?.includes('Carol C'))
    expect(carolRow?.textContent).toContain('same')
  })

  it('renders NoResult as no-result, never as a zero display of state', () => {
    render(<ScoreTable scores={[group]} names={names} />)
    expect(screen.getByText('no result')).toBeInTheDocument()
    // The gap badge renders the awaited metric, not a zero.
    expect(screen.getByText(/flight 2: flightTime/)).toBeInTheDocument()
  })

  it('marks the group winner', () => {
    render(<ScoreTable scores={[group]} names={names} />)
    const aliceRow = screen.getAllByRole('row').find((r) => r.textContent?.includes('Alice A'))
    expect(aliceRow?.textContent).toContain('★')
  })

  it('renders absent groups as no scores, never zeros', () => {
    const { container } = render(<ScoreTable scores={[]} names={names} />)
    expect(container.textContent).toContain('No scores yet')
  })
})

describe('Standings — verbatim, placing order only', () => {
  it('renders scores and placings as the server sent them', () => {
    const { container } = render(
      <Standings
        standings={{
          scores: [
            { competitorRef: { value: 'c-2' }, score: '1100', disqualified: false, placing: 2 },
            { competitorRef: { value: 'c-1' }, score: '1200.0', disqualified: false, placing: 1 },
            { competitorRef: { value: 'c-4' }, score: 0, disqualified: true, placing: null },
          ],
        }}
        names={names}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('1200.0')
    expect(text).toContain('1100')
    expect(text).toContain('DQ')
    const order = ['c-1', 'c-2', 'c-4'].map((id) => text.indexOf(names.get(id) ?? id))
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
  })
})
