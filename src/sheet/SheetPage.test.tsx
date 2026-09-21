import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SheetPage } from './SheetPage'
import { isNdcClass } from './classes'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** An NDC-format F5J definition: the task declares the flightTime +
 * overflySeconds pair, so the sheet shows the flight-time column for the one
 * reading. */
const f5jNdcDefinition = {
  name: 'RC Electric Powered Thermal Duration Gliders (NDC format)',
  faiDesignation: 'F5J',
  version: '1',
  parameters: [],
  penalties: [
    {
      infractionType: 'launchedOutsideWindow',
      exclusionGroups: [],
      accrual: 'OncePerAttempt',
      effects: [{ effect: 'DeductPoints', points: 100 }],
    },
  ],
  phases: [
    {
      type: 'Preliminary',
      ordinal: 0,
      rounds: { kind: 'FixedSequence', tasksPerRound: 1, requireDistinctTaskPerRound: false, maxRounds: 2 },
      validity: {},
      tasks: [
        {
          code: 'D',
          name: 'Duration',
          metrics: [
            {
              name: 'flightTime',
              kind: 'Number',
              unit: 's',
              declaredBeforeLaunch: false,
              precision: { mode: 'Truncate', precision: 1 },
            },
            {
              name: 'landingDistance',
              kind: 'Number',
              unit: 'm',
              declaredBeforeLaunch: false,
              precision: { mode: 'Truncate', precision: 0.1 },
            },
            {
              name: 'overflySeconds',
              kind: 'Number',
              unit: 's',
              declaredBeforeLaunch: false,
              precision: { mode: 'Truncate', precision: 1 },
              whenNotRecorded: { kind: 'Number', number: 0 },
            },
            {
              name: 'landedWithin75m',
              kind: 'Flag',
              declaredBeforeLaunch: false,
              whenNotRecorded: { kind: 'Flag', flag: true },
            },
          ],
          flights: { $kind: 'last' },
          timing: { kind: 'Fixed', workingTime: 600 },
          flightValidWhen: {
            $kind: 'allOf',
            children: [
              {
                $kind: 'comparison',
                leftMetricRef: 'landedWithin75m',
                op: 'EqualTo',
                rightValue: { kind: 'Flag', flag: true },
              },
            ],
          },
          normalise: {},
        },
      ],
    },
  ],
}

/** The F3K-NDC shape the original stub returned, extracted so the stub can
 * also serve the F5J-NDC stopwatch definition. */
const f3kNdcDefinition = {
  name: 'RC Hand-Launch Gliders (NDC format)',
  version: '1',
  parameters: [],
  penalties: [
    {
      infractionType: 'landedInSafetyArea',
      exclusionGroups: [],
      accrual: 'OncePerAttempt',
      effects: [{ effect: 'DeductPoints', points: 100 }],
    },
  ],
  phases: [
    {
      type: 'Preliminary',
      ordinal: 0,
      rounds: { kind: 'FixedSequence', tasksPerRound: 1, requireDistinctTaskPerRound: false, maxRounds: 4 },
      validity: {},
      tasks: [
        {
          code: 'D',
          name: 'Duration',
          metrics: [
            { name: 'flightTime', kind: 'Number', unit: 's', declaredBeforeLaunch: false },
            {
              name: 'landedWithinWindow',
              kind: 'Flag',
              declaredBeforeLaunch: false,
              whenNotRecorded: { kind: 'Flag', flag: true },
            },
            {
              name: 'launchedInWorkingTime',
              kind: 'Flag',
              declaredBeforeLaunch: false,
              whenNotRecorded: { kind: 'Flag', flag: true },
            },
          ],
          flights: { $kind: 'lastN', count: 2, targetValues: [60, 120] },
          timing: { kind: 'Fixed', workingTime: 300 },
          flightValidWhen: {
            $kind: 'allOf',
            children: [
              {
                $kind: 'comparison',
                leftMetricRef: 'landedWithinWindow',
                op: 'EqualTo',
                rightValue: { kind: 'Flag', flag: true },
              },
              {
                $kind: 'comparison',
                leftMetricRef: 'launchedInWorkingTime',
                op: 'EqualTo',
                rightValue: { kind: 'Flag', flag: true },
              },
            ],
          },
          normalise: {},
        },
      ],
    },
  ],
}

function stubFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/class-definitions')) {
      return jsonResponse([
        {
          id: 'a1',
          contentHash: 'hash-f3k',
          name: 'RC Hand-Launch Gliders (NDC format)',
          version: '1',
          publishedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'a2',
          contentHash: 'hash-x5j',
          name: 'X5J Electric',
          faiDesignation: 'X5J',
          version: '1',
          publishedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'a3',
          contentHash: 'hash-radian',
          name: 'NZ Radian',
          version: '1',
          publishedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'a4',
          contentHash: 'hash-other',
          name: 'ALES 200',
          version: '1',
          publishedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'a5',
          contentHash: 'hash-f5j-ndc',
          name: 'RC Electric Powered Thermal Duration Gliders (NDC format)',
          faiDesignation: 'F5J',
          version: '1',
          publishedAt: '2026-01-01T00:00:00Z',
        },
      ])
    }
    if (url.includes('/class-definition')) {
      const body = url.includes('hash-f5j-ndc') ? f5jNdcDefinition : f3kNdcDefinition
      return jsonResponse(body)
    }
    return jsonResponse({ value: null })
  }) as unknown as typeof fetch
}

describe('SheetPage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('offers NZ NDC contest types only: NDC-named, X5J and NZ Radian', async () => {
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)

      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      const options = [...screen.getByLabelText(/Class/).querySelectorAll('option')].map(
        (o) => o.textContent ?? '',
      )
      expect(options).toEqual([
        '— pick the adopted class —',
        'RC Hand-Launch Gliders (NDC format) · v1',
        'X5J — X5J Electric · v1',
        'NZ Radian · v1',
        'F5J — RC Electric Powered Thermal Duration Gliders (NDC format) · v1',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders the single sheet: header, pilots, grid and Calculate', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)

      expect(screen.getByRole('heading', { name: 'NdcScore' })).toBeInTheDocument()
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())

      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k')
      // The grid derives from the definition: flight-time column headers appear.
      await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))
      expect(screen.getByRole('button', { name: 'Calculate' })).toBeInTheDocument()
      expect(screen.getByText(/type anywhere, any time/)).toBeInTheDocument()

      // Ten rows by default; the Add competitor button appends one more.
      const nameInputs = () => screen.getAllByPlaceholderText('Pilot name')
      expect(nameInputs()).toHaveLength(10)
      await user.click(screen.getByRole('button', { name: '+ Add competitor' }))
      expect(nameInputs()).toHaveLength(11)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the penalty dropdown lists the declared infractions and closes on outside click / Escape', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k')
      await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))

      const toggle = screen.getAllByRole('button', { name: 'Penalties' })[0]
      expect(screen.queryByLabelText(/Landed In Safety Area/)).not.toBeInTheDocument()
      await user.click(toggle)
      expect(screen.getByLabelText(/Landed In Safety Area/)).toBeInTheDocument()

      await user.click(screen.getByRole('heading', { name: 'NdcScore' }))
      expect(screen.queryByLabelText(/Landed In Safety Area/)).not.toBeInTheDocument()

      await user.click(toggle)
      await user.keyboard('{Escape}')
      expect(screen.queryByLabelText(/Landed In Safety Area/)).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('zero-flight flags live in the drop list, not as columns; ticking writes the flag cell', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k')
      await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))

      // The covered flag columns are gone from the grid — only flight time remains.
      expect(screen.queryByText('Landed within window')).not.toBeInTheDocument()
      expect(screen.queryByText('Launched in working time')).not.toBeInTheDocument()
      expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0)

      await user.click(screen.getAllByRole('button', { name: 'Penalties' })[0])
      const outside = screen.getByLabelText(/launched outside working time/i)
      expect(outside).not.toBeChecked()
      await user.click(outside)
      expect(screen.getByLabelText(/launched outside working time/i)).toBeChecked()

      // round-level compliance: the flag lands on every flight row of the round
      const stored = JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}')
      expect(stored.cells['r1|p1|f1|launchedInWorkingTime']).toBe('n')
      expect(stored.cells['r1|p1|f2|launchedInWorkingTime']).toBe('n')
      // the cell button shows the red tick with the mark count, not the list
      expect(
        screen.getAllByRole('button', { name: 'Penalties' })[0].textContent,
      ).toContain('✔ 1')

      // one entry per item: no flight-number text, nothing duplicated
      const menu = document.querySelector('.penalty-menu')
      const labels = [...(menu?.querySelectorAll('label') ?? [])].map((l) => l.textContent ?? '')
      expect(labels.length).toBeGreaterThan(0)
      expect(labels.every((t) => !/F\d/.test(t))).toBe(true)
      expect(new Set(labels).size).toBe(labels.length)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reset clears the whole sheet after confirmation', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k')
      await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(10))

      await user.type(screen.getAllByPlaceholderText('Pilot name')[0], 'Someone')
      expect(screen.getByDisplayValue('Someone')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Reset' }))
      expect(confirm).toHaveBeenCalledOnce()
      expect(screen.queryByDisplayValue('Someone')).not.toBeInTheDocument()
      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}')
        expect(Object.keys(stored.cells ?? {})).toHaveLength(0)
        expect(stored.classContentHash).toBeNull()
      })
    } finally {
      confirm.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('lays the grid out evenly: one physical row per competitor, no span spills', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k')
      await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(10))

      // 10 pilots, one <tr> each; 2 flight rows + penalty per round →
      // pilot + mfnz + 4 rounds × (2×flightTime + penalties) + remove = 15 cells.
      const bodyRows = [...document.querySelectorAll('tbody tr')]
      for (const row of bodyRows) {
        expect(row.querySelectorAll('td')).toHaveLength(15)
      }
      expect(document.querySelectorAll('input[placeholder="Pilot name"]')).toHaveLength(10)
      // no rowSpan/colSpan anywhere in the body — nothing can spill
      expect(document.querySelectorAll('tbody td[rowspan], tbody td[colspan]')).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('groups columns by round: each round block ends with its own Penalties head, aligned over its cells', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k')
      await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(10))

      // Column-head row: 4 rounds × (F1, F2, Penalties) — each penalty head
      // closes its own round block instead of trailing the sheet. Flights are
      // told apart by target label only — no F-numbers over the columns.
      const headEls = [...document.querySelectorAll('thead tr:nth-child(2) th')]
      const heads = headEls.map((th) => th.textContent ?? '')
      expect(heads).toHaveLength(12)
      expect(document.querySelector('thead')?.textContent ?? '').not.toMatch(/F\d/)
      for (const base of [0, 3, 6, 9]) {
        expect(heads[base]).toContain('60 s target')
        expect(heads[base]).toContain('Flight time')
        expect(heads[base + 1]).toContain('120 s target')
        expect(heads[base + 1]).toContain('Flight time')
        expect(heads[base + 2]).toBe('Penalties')
      }

      // Body order matches: each round block is [flightTime, flightTime, penalties].
      const cells = [...document.querySelectorAll('tbody tr')[0].querySelectorAll('td')]
      expect(cells).toHaveLength(15)
      for (const base of [2, 5, 8, 11]) {
        expect(cells[base].querySelector('input.cell')).not.toBeNull()
        expect(cells[base + 1].querySelector('input.cell')).not.toBeNull()
        expect(cells[base + 2].querySelector('.penalty-cell')).not.toBeNull()
      }
      expect(cells[0]).toHaveClass('pilot-col')
      expect(cells[1]).toHaveClass('mfnz-col')

      // Visual grouping: a heavy rule opens each round block, a lighter rule
      // opens each flight-row group, alternate rounds tinted.
      expect(cells[2]).toHaveClass('round-start')
      expect(cells[3]).toHaveClass('flight-start')
      expect(cells[3]).not.toHaveClass('round-start')
      expect(cells[4]).not.toHaveClass('flight-start')
      expect(headEls[1]).toHaveClass('flight-start')
      expect(cells[5]).toHaveClass('round-start', 'round-alt')
      expect(cells[6]).toHaveClass('round-alt')
      expect(cells[8]).toHaveClass('round-start')
      expect(cells[11]).toHaveClass('round-start', 'round-alt')
      const roundHeads = [...document.querySelectorAll('thead tr:nth-child(1) th')]
      expect(roundHeads[2]).toHaveClass('round-start')
      expect(roundHeads[3]).toHaveClass('round-start', 'round-alt')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('an overfly task keeps the Flight time column and drops the overfly input', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/Thermal Duration Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f5j-ndc')

      // Under stopwatch entry the flight-time column carries the single
      // reading; the split-owned overfly metric never takes real estate.
      await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))
      expect(screen.queryByText('Stopwatch')).not.toBeInTheDocument()
      expect(screen.queryByText('Overfly seconds')).not.toBeInTheDocument()
      expect(screen.getAllByText(/Landing distance/i).length).toBeGreaterThan(0)

      // The compliance menu still offers the landed flag, but the overfly
      // metric is owned by the stopwatch split — no input for it.
      await user.click(screen.getAllByRole('button', { name: 'Penalties' })[0])
      expect(screen.queryByLabelText(/Overfly seconds/i)).not.toBeInTheDocument()
      expect(screen.getByLabelText(/not landed within 75/i)).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  describe('isNdcClass', () => {
    it.each([
      ['ALES 200 (NDC format)', undefined, true],
      ['Thermal Duration (NDC)', '', true],
      ['X5J Electric', 'X5J', true],
      ['NZ Radian', null, true],
      ['ALES Radian', undefined, true],
      ['ales radian (glider)', undefined, true],
      ['ALES 200', undefined, false],
      ['F5J Electric', 'F5J', false],
      ['Thermal Duration', '', false],
    ])('%s (%s) → %s', (name, faiDesignation, expected) => {
      expect(isNdcClass({ name, faiDesignation })).toBe(expected)
    })
  })
})
