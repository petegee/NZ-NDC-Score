import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SheetPage } from './SheetPage'
import { isNdcClass } from './classes'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** An NDC-format F5J definition: the task declares the flightTime +
 * overflySeconds pair, so the sheet shows the flight-time column for the one
 * reading. The flight gate reads the start height's recordedness
 * (`isRecorded`, 5.5.11.7 e) — no flag, no second input. */
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
              name: 'startHeight',
              kind: 'Number',
              unit: 'm',
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
                leftMetricRef: 'overflySeconds',
                op: 'LessOrEqual',
                rightValue: { kind: 'Number', number: 60 },
              },
              {
                $kind: 'isRecorded',
                metricRef: 'startHeight',
              },
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

/** An X5J-shaped definition: no declared penalties, but the task carries
 * optional metrics — flags and a value whose blank resolves to a
 * whenNotRecorded assumption. The compliance drop list records their
 * exceptions, so the round still shows a penalties/compliance column. */
const x5jDefinition = {
  name: 'X5J Electric',
  faiDesignation: 'X5J',
  version: '1',
  parameters: [],
  penalties: [],
  phases: [
    {
      type: 'Preliminary',
      ordinal: 0,
      rounds: { kind: 'FixedSequence', tasksPerRound: 1, requireDistinctTaskPerRound: false, maxRounds: 4 },
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
            {
              name: 'motorRestarted',
              kind: 'Flag',
              declaredBeforeLaunch: false,
              whenNotRecorded: { kind: 'Flag', flag: false },
            },
            {
              name: 'airborneAtRoundEnd',
              kind: 'Flag',
              declaredBeforeLaunch: false,
              whenNotRecorded: { kind: 'Flag', flag: false },
            },
            {
              name: 'landedWithin75m',
              kind: 'Flag',
              declaredBeforeLaunch: false,
              whenNotRecorded: { kind: 'Flag', flag: true },
            },
            { name: 'landingDistance', kind: 'Number', unit: 'm', declaredBeforeLaunch: false },
          ],
          flights: { $kind: 'last' },
          timing: { kind: 'Fixed', workingTime: 600, maxLaunches: 1 },
          flightValidWhen: {
            $kind: 'comparison',
            leftMetricRef: 'landedWithin75m',
            op: 'EqualTo',
            rightValue: { kind: 'Flag', flag: true },
          },
          normalise: {},
        },
      ],
    },
  ],
}

function stubFetch(): typeof fetch {
  // Stateful enough for runCalculate to complete a minimal run: one person,
  // one competitor, a drawn phase of four rounds, empty groups and empty
  // recordings (every round completes; nothing to capture).
  const state = { people: 0, competitors: 0, drawn: false }
  const fold = () => ({
    competition: {
      id: { value: 'comp-1' },
      name: 'Test NDC',
      location: 'Somewhere',
      startDate: '2026-09-19',
      endDate: '2026-09-19',
      evaluatorVersion: '1',
      competitors: state.drawn
        ? [{ id: { value: 'competitor-1' }, personRef: { value: 'person-1' }, competitorNumber: 1, registeredAt: '2026-09-19T00:00:00Z' }]
        : [],
      phases: state.drawn
        ? [
            {
              type: 'Preliminary',
              ordinal: 0,
              draw: { createdAt: '2026-09-19T00:00:00Z', status: 'Accepted' },
              rounds: Array.from({ length: 4 }, (_, i) => ({
                ordinal: i + 1,
                taskRounds: [{ ordinal: 1, state: 'Drawn', taskRef: 'D', groups: [] }],
              })),
              warnings: [],
            },
          ]
        : [],
      adoptedRules: { definition: f3kNdcDefinition, sourceClassId: 'x', sourceVersion: '2', adoptedAt: '2026-09-19T00:00:00Z' },
      parameterBindings: [],
    },
    pairwiseCoOccurrence: [],
  })
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
          id: 'a1b',
          contentHash: 'hash-f3k-v2',
          name: 'RC Hand-Launch Gliders (NDC format)',
          version: '2',
          publishedAt: '2026-02-01T00:00:00Z',
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
      const body = url.includes('hash-f5j-ndc')
        ? f5jNdcDefinition
        : url.includes('hash-x5j')
          ? x5jDefinition
          : f3kNdcDefinition
      return jsonResponse(body)
    }
    if (url.includes('/competitions')) return jsonResponse([])
    if (url.includes('/create-competition')) {
      state.drawn = false
      state.people = 0
      state.competitors = 0
      return jsonResponse('comp-1')
    }
    if (url.includes('/competition-event-log')) {
      return jsonResponse({ id: { value: 'comp-1' }, name: 'Test NDC', streams: [] })
    }
    if (url.includes('/competition-result')) return jsonResponse({ scores: [] })
    if (url.includes('/task-round-result')) return jsonResponse([])
    if (url.includes('/task-round-recording')) {
      return jsonResponse({
        competitionRef: { value: 'comp-1' },
        phaseOrdinal: 0,
        roundOrdinal: 1,
        taskRoundOrdinal: 1,
        taskRef: 'D',
        metrics: [],
        groups: [],
      })
    }
    if (url.includes('/competition')) return jsonResponse(fold())
    if (url.includes('/people')) return jsonResponse([])
    if (url.includes('/register-person')) {
      state.people += 1
      return jsonResponse(`person-${state.people}`)
    }
    if (url.includes('/people?')) {
      // find: the registered people (the orchestrator adopts on a re-run)
      return jsonResponse(
        Array.from({ length: state.people }, (_, i) => ({
          id: { value: `person-${i + 1}` },
          name: i === 0 ? 'Ana Silva' : `Pilot ${i + 1}`,
          email: `p${i + 1}@mfnz.invalid`,
          roles: [],
        })),
      )
    }
    if (url.includes('/register-competitor')) {
      state.competitors += 1
      return jsonResponse(`competitor-${state.competitors}`)
    }
    if (url.includes('/draw-phase')) {
      state.drawn = true
      return jsonResponse('phase-1')
    }
    return jsonResponse('ok')
  }) as unknown as typeof fetch
}

/** A stateful stub over the X5J definition: records captures and amends and
 * serves them back through the event log, so a second orchestrator run sees
 * the committed flag — the deselected-compliance amend path needs a service
 * that remembers what was captured. */
function statefulStub(): typeof fetch {
  const state = {
    people: 0,
    competitors: [] as { id: string; personId: string }[],
    created: false,
    drawn: false,
    roundState: 'Drawn' as 'Drawn' | 'Complete',
    entrySeq: 0,
    entries: new Map<
      string,
      {
        competitor: string
        round: number
        flights: Set<number>
        values: Map<number, Map<string, unknown>>
        amendments: { flightSequence: number; metric: string; newValue: unknown }[]
      }
    >(),
  }
  const fold = () => ({
    competition: {
      id: { value: 'comp-1' },
      name: 'X5J Electric',
      location: 'Somewhere',
      startDate: '2026-09-19',
      endDate: '2026-09-19',
      evaluatorVersion: '1',
      competitors: state.competitors.map((c) => ({
        id: { value: c.id },
        personRef: { value: c.personId },
        competitorNumber: state.competitors.indexOf(c) + 1,
        registeredAt: '2026-09-19T00:00:00Z',
      })),
      phases: state.drawn
        ? [
            {
              type: 'Preliminary',
              ordinal: 0,
              draw: { createdAt: '2026-09-19T00:00:00Z', status: 'Accepted' },
              rounds: Array.from({ length: 4 }, (_, i) => ({
                ordinal: i + 1,
                taskRounds: [
                  {
                    ordinal: 1,
                    state: state.roundState,
                    taskRef: 'D',
                    groups: [
                      {
                        id: { value: 'g1' },
                        ordinal: 1,
                        competitorRefs: state.competitors.map((c) => ({ value: c.id })),
                      },
                    ],
                  },
                ],
              })),
              warnings: [],
            },
          ]
        : [],
      adoptedRules: {
        definition: x5jDefinition,
        sourceClassId: 'x',
        sourceVersion: '2',
        adoptedAt: '2026-09-19T00:00:00Z',
      },
      parameterBindings: [],
    },
    pairwiseCoOccurrence: [],
  })
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, never>
    if (url.includes('/competition-event-log')) {
      const streams = [...state.entries.values()].map((e) => {
        const events: unknown[] = [
          {
            version: 1,
            name: 'entryOpened',
            payload: {
              competitionRef: { value: 'comp-1' },
              phaseOrdinal: 0,
              roundOrdinal: e.round,
              taskRoundOrdinal: 1,
              groupRef: { value: 'g1' },
              competitorRef: { value: e.competitor },
              id: { value: 'stream-1' },
              role: 'Original',
            },
          },
        ]
        let version = 2
        for (const seq of [...e.flights].sort((a, b) => a - b)) {
          events.push({ version: version++, name: 'flightOpened', payload: { sequence: seq } })
          for (const [metric, value] of e.values.get(seq) ?? []) {
            events.push({
              version: version++,
              name: 'measurementCaptured',
              payload: { flightSequence: seq, measurement: { metric, value } },
            })
          }
        }
        for (const a of e.amendments) {
          events.push({
            version: version++,
            name: 'measurementAmended',
            payload: { flightSequence: a.flightSequence, metric: a.metric, amendment: { newValue: a.newValue } },
          })
        }
        return { streamId: 'stream-1', kind: 'entry', events }
      })
      return jsonResponse({ id: { value: 'comp-1' }, name: 'X5J', streams })
    }
    if (url.includes('/competition-result')) return jsonResponse({ scores: [] })
    if (url.includes('/task-round-result')) return jsonResponse([])
    if (url.includes('/task-round-recording')) {
      return jsonResponse({
        competitionRef: { value: 'comp-1' },
        phaseOrdinal: 0,
        roundOrdinal: 1,
        taskRoundOrdinal: 1,
        taskRef: 'D',
        metrics: [],
        groups: [],
      })
    }
    if (url.includes('/capture-measurement')) {
      const e = state.entries.get((body.entryRef as { value: string }).value)
      e?.values.get(Number(body.flightSequence))?.set(String(body.metric), body.value)
      return jsonResponse('ok')
    }
    if (url.includes('/amend-measurement')) {
      const e = state.entries.get((body.entryRef as { value: string }).value)
      e?.values.get(Number(body.flightSequence))?.set(String(body.metric), body.newValue)
      e?.amendments.push({
        flightSequence: Number(body.flightSequence),
        metric: String(body.metric),
        newValue: body.newValue,
      })
      return jsonResponse('ok')
    }
    if (url.includes('/open-entry')) {
      const id = `entry-${++state.entrySeq}`
      state.entries.set(id, {
        competitor: (body.competitorRef as { value: string }).value,
        round: Number(body.roundOrdinal),
        flights: new Set(),
        values: new Map(),
        amendments: [],
      })
      return jsonResponse(id)
    }
    if (url.includes('/open-flight')) {
      const e = state.entries.get((body.entryRef as { value: string }).value)
      const seq = Number(body.sequence)
      e?.flights.add(seq)
      if (e && !e.values.has(seq)) e.values.set(seq, new Map())
      return jsonResponse('ok')
    }
    if (url.includes('/complete-task-round')) {
      state.roundState = 'Complete'
      return jsonResponse('ok')
    }
    if (url.includes('/reopen-task-round')) {
      state.roundState = 'Drawn'
      return jsonResponse('ok')
    }
    if (url.includes('/create-competition')) {
      state.created = true
      return jsonResponse('comp-1')
    }
    if (url.includes('/register-person')) {
      state.people += 1
      return jsonResponse(`person-${state.people}`)
    }
    if (url.includes('/people?')) {
      // find: the registered people (the orchestrator adopts on a re-run)
      return jsonResponse(
        Array.from({ length: state.people }, (_, i) => ({
          id: { value: `person-${i + 1}` },
          name: i === 0 ? 'Ana Silva' : `Pilot ${i + 1}`,
          email: `p${i + 1}@mfnz.invalid`,
          roles: [],
        })),
      )
    }
    if (url.includes('/register-competitor')) {
      const personId = (body.personId as { value: string }).value
      const existing = state.competitors.find((c) => c.personId === personId)
      if (existing) return jsonResponse(existing.id)
      const id = `competitor-${state.competitors.length + 1}`
      state.competitors.push({ id, personId })
      return jsonResponse(id)
    }
    if (url.includes('/draw-phase')) {
      state.drawn = true
      return jsonResponse('phase-1')
    }
    if (url.includes('/competitions')) {
      return jsonResponse(
        state.created
          ? [
              {
                id: { value: 'comp-1' },
                // The fabricated contest identity (date, location, class) —
                // a re-run must find this summary, not create a second.
                name: '2026-09-19 Somewhere X5J',
                location: 'Somewhere',
                startDate: '2026-09-19',
                endDate: '2026-09-19',
                className: 'X5J Electric',
                classContentHash: 'hash-x5j',
                status: 'Recording',
              },
            ]
          : [],
      )
    }
    if (url.includes('/competition')) return jsonResponse(fold())
    if (url.includes('/class-definitions')) {
      return jsonResponse([
        {
          id: 'a2',
          contentHash: 'hash-x5j',
          name: 'X5J Electric',
          faiDesignation: 'X5J',
          version: '1',
          publishedAt: '2026-01-01T00:00:00Z',
        },
      ])
    }
    if (url.includes('/class-definition')) return jsonResponse(x5jDefinition)
    return jsonResponse('ok')
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
        '— pick the NDC class —',
        'RC Hand-Launch Gliders (NDC format) · v2',
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

      expect(screen.getByRole('heading', { name: 'NDC Scoresheet' })).toBeInTheDocument()
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())

      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')
      // The grid derives from the definition: flight-time column headers appear.
      await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))
      expect(screen.getByRole('button', { name: 'Calculate' })).toBeInTheDocument()
      expect(screen.getByText(/Type anywhere, any time/)).toBeInTheDocument()

      // Ten rows by default; the Pilots input in the Contest panel resizes
      // the field (still enabled — nothing has been scored yet). The draft
      // commits on blur — typing '12' never shrinks through '1' first.
      const nameInputs = () => screen.getAllByPlaceholderText('Pilot name')
      expect(nameInputs()).toHaveLength(10)
      const pilotsInput = screen.getByLabelText('Pilots')
      expect(pilotsInput).not.toBeDisabled()
      fireEvent.change(pilotsInput, { target: { value: '12' } })
      expect(nameInputs()).toHaveLength(10)
      fireEvent.blur(pilotsInput)
      expect(nameInputs()).toHaveLength(12)
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
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')
      await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))

      const toggle = screen.getAllByRole('button', { name: 'More' })[0]
      expect(screen.queryByLabelText(/Landed In Safety Area/)).not.toBeInTheDocument()
      await user.click(toggle)
      expect(screen.getByLabelText(/Landed In Safety Area/)).toBeInTheDocument()

      await user.click(screen.getByRole('heading', { name: 'NDC Scoresheet' }))
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
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')
      await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))

      // The covered flag columns are gone from the grid — only flight time remains.
      expect(screen.queryByText('Landed within window')).not.toBeInTheDocument()
      expect(screen.queryByText('Launched in working time')).not.toBeInTheDocument()
      expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0)

      await user.click(screen.getAllByRole('button', { name: 'More' })[0])
      const outside = screen.getByLabelText(/launched outside working time/i)
      expect(outside).not.toBeChecked()
      await user.click(outside)
      expect(screen.getByLabelText(/launched outside working time/i)).toBeChecked()

      // round-level compliance: the flag lands on every flight row of the round
      const stored = JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}')
      expect(stored.cells['r1|p1|f1|launchedInWorkingTime']).toBe('n')
      expect(stored.cells['r1|p1|f2|launchedInWorkingTime']).toBe('n')
      // the cell button shows the mark count, not the list
      expect(
        screen.getAllByRole('button', { name: 'More' })[0].textContent,
      ).toContain('1')

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

  it('a class with no declared penalties still shows the column when its task has optional metrics (X5J)', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/X5J Electric/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-x5j')
      await waitFor(() => expect(screen.getAllByText(/Glide Duration/).length).toBeGreaterThan(0))

      // Zero penalties + four optional metrics → the compliance column
      // renders in every round, and the menu is one flat list of them.
      expect(screen.getAllByText('More')).toHaveLength(4)
      await user.click(screen.getAllByRole('button', { name: 'More' })[0])
      const menu = document.querySelector('.penalty-menu')
      const labels = [...(menu?.querySelectorAll('label') ?? [])].map((l) => l.textContent ?? '')
      expect(labels).toHaveLength(4)
      expect(screen.getByLabelText('Motor restart run time')).toBeInTheDocument()
      expect(screen.getByLabelText('Motor restarted')).toBeInTheDocument()
      expect(screen.getByLabelText('Airborne at round end')).toBeInTheDocument()
      expect(screen.getByLabelText(/not landed within 75/i)).toBeInTheDocument()

      // The value option pre-fills its assumption as the placeholder.
      expect(screen.getByLabelText('Motor restart run time')).toHaveAttribute('placeholder', '0')

      // Ticking a compliance flag writes the exception onto every flight row.
      await user.click(screen.getByLabelText(/not landed within 75/i))
      const stored = JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}')
      expect(stored.cells['r1|p1|f1|landedWithin75m']).toBe('n')
      expect(
        screen.getAllByRole('button', { name: 'More' })[0].textContent,
      ).toContain('1')
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
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')
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
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')
      await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(10))

      // 10 pilots, one <tr> each; 2 flight rows + penalty per round →
      // pilot + mfnz + 4 rounds × (2×flightTime + penalties) = 14 cells.
      const bodyRows = [...document.querySelectorAll('tbody tr')]
      for (const row of bodyRows) {
        expect(row.querySelectorAll('td')).toHaveLength(14)
      }
      expect(document.querySelectorAll('input[placeholder="Pilot name"]')).toHaveLength(10)
      // no rowSpan/colSpan anywhere in the body — nothing can spill
      expect(document.querySelectorAll('tbody td[rowspan], tbody td[colspan]')).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('groups columns by round: each round block ends with its own More head, aligned over its cells', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')
      await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(10))

      // Column-head row: 4 rounds × (F1, F2, More) — each More head
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
        expect(heads[base + 2]).toBe('More')
      }

      // Body order matches: each round block is [flightTime, flightTime, penalties].
      const cells = [...document.querySelectorAll('tbody tr')[0].querySelectorAll('td')]
      expect(cells).toHaveLength(14)
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
      await user.click(screen.getAllByRole('button', { name: 'More' })[0])
      expect(screen.queryByLabelText(/Overfly seconds/i)).not.toBeInTheDocument()
      expect(screen.getByLabelText(/not landed within 75/i)).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a recordedness-gated metric stays a demanded column, never a drop-list entry', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/Thermal Duration Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f5j-ndc')

      // Start height gets real estate — blank resolves at Calculate (the
      // flight zeroes through the gate, 5.5.11.7 e), typed scores normally.
      // One input, no second tick.
      await waitFor(() => expect(screen.getAllByText(/Start height/).length).toBeGreaterThan(0))

      // The compliance menu never offers it: its absence is the gate's false,
      // not an exception the CD records.
      await user.click(screen.getAllByRole('button', { name: 'More' })[0])
      expect(screen.queryByLabelText(/start height/i)).not.toBeInTheDocument()
      expect(screen.getByLabelText(/not landed within 75/i)).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('Calculate is the commit gate: even a complete sheet never auto-runs before the first press; edits re-run after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup()
    const fetchMock = vi.fn(stubFetch() as unknown as (...args: unknown[]) => Promise<Response>)
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const drawCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/draw-phase')).length
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')
      await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))

      // Fill the sheet completely — class, header fields and a pilot name.
      await user.type(screen.getByLabelText(/Location/), 'Somewhere')
      await user.type(screen.getByLabelText(/Date/), '2026-09-19')
      await user.type(screen.getByLabelText(/CD \(signs the commands\)/), 'CD')
      await user.type(screen.getAllByPlaceholderText('Pilot name')[0], 'Ana Silva')

      // A complete sheet still sends nothing on its own: the Calculate press
      // is the only first-run trigger.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(drawCalls()).toBe(0)

      // The explicit commit runs the orchestrator once.
      await user.click(screen.getByRole('button', { name: 'Calculate' }))
      await waitFor(() => expect(drawCalls()).toBe(1))
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Calculating…' })).not.toBeInTheDocument(),
      )

      // After the first good run, an edit re-runs the orchestrator on its
      // own (debounced) — no button press.
      await user.type(screen.getAllByPlaceholderText('Pilot name')[0], ' Jr')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      await waitFor(() => expect(drawCalls()).toBe(2))
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('unticking a compliance option before Calculate leaves no trace', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', stubFetch())
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/X5J Electric/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-x5j')
      await waitFor(() => expect(screen.getAllByText(/Glide Duration/).length).toBeGreaterThan(0))

      // accidental tick…
      await user.click(screen.getAllByRole('button', { name: 'More' })[0])
      await user.click(screen.getByLabelText(/not landed within 75/i))
      expect(
        JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}').cells['r1|p1|f1|landedWithin75m'],
      ).toBe('n')

      // …and the untick undoes it: the cells end blank and the badge clears
      await user.click(screen.getByLabelText(/not landed within 75/i))
      const stored = JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}')
      expect(stored.cells['r1|p1|f1|landedWithin75m']).toBe('')
      expect(screen.getAllByRole('button', { name: 'More' })[0]).toHaveTextContent('...')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('after Calculate, unticking a compliance option re-scores with an amend to the assumption', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup()
    const fetchMock = vi.fn(statefulStub() as unknown as (...args: unknown[]) => Promise<Response>)
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const postsTo = (path: string) =>
      fetchMock.mock.calls
        .filter(([u, init]) => String(u).includes(path) && (init as RequestInit | undefined)?.body)
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/X5J Electric/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-x5j')
      await waitFor(() => expect(screen.getAllByText(/Glide Duration/).length).toBeGreaterThan(0))

      await user.type(screen.getByLabelText(/Location/), 'Somewhere')
      await user.type(screen.getByLabelText(/Date/), '2026-09-19')
      await user.type(screen.getByLabelText(/CD \(signs the commands\)/), 'CD')
      await user.type(screen.getAllByPlaceholderText('Pilot name')[0], 'Ana Silva')
      await user.type(
        document.querySelectorAll('tbody tr')[0].querySelectorAll('input.cell')[2],
        '60',
      )

      // accidental tick of the 75 m exception, then the first Calculate —
      // the flag lands on the entry as recorded false.
      await user.click(screen.getAllByRole('button', { name: 'More' })[0])
      await user.click(screen.getByLabelText(/not landed within 75/i))
      await user.click(screen.getByRole('button', { name: 'Calculate' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(
        postsTo('/capture-measurement').some(
          (b) => b.metric === 'landedWithin75m' && b.value.flag === false,
        ),
      ).toBe(true)

      // unticking re-scores on its own: the amend restores the assumption
      await user.click(screen.getAllByRole('button', { name: 'More' })[0])
      await user.click(screen.getByLabelText(/not landed within 75/i))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      const amends = postsTo('/amend-measurement')
      expect(amends).toHaveLength(1)
      expect(amends[0]).toMatchObject({
        metric: 'landedWithin75m',
        newValue: { kind: 'Flag', flag: true },
        reason: 'Corrected from scoresheet',
      })

      // and the follow-up run is a no-op — blank agrees with the assumption
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(postsTo('/amend-measurement')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('after Calculate, renaming a pilot renames the person on the wire and keeps the competitor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup()
    // A stub that tracks people by name: the first run registers Ana Silva
    // and freezes the field with the accepted draw; a rename must go out as
    // POST /rename-person for the same person — never a second registration.
    const state = {
      created: false,
      drawn: false,
      people: [] as { id: string; name: string }[],
      competitors: [] as { id: string; personId: string }[],
    }
    const fold = () => ({
      competition: {
        id: { value: 'comp-1' },
        name: 'Test NDC',
        location: 'Somewhere',
        startDate: '2026-09-19',
        endDate: '2026-09-19',
        evaluatorVersion: '1',
        competitors: state.competitors.map((c, i) => ({
          id: { value: c.id },
          personRef: { value: c.personId },
          competitorNumber: i + 1,
          registeredAt: '2026-09-19T00:00:00Z',
        })),
        phases: state.drawn
          ? [
              {
                type: 'Preliminary',
                ordinal: 0,
                draw: { createdAt: '2026-09-19T00:00:00Z', status: 'Accepted' },
                rounds: Array.from({ length: 4 }, (_, i) => ({
                  ordinal: i + 1,
                  taskRounds: [
                    {
                      ordinal: 1,
                      state: 'Drawn',
                      taskRef: 'D',
                      groups: [
                        {
                          id: { value: 'g1' },
                          ordinal: 1,
                          competitorRefs: state.competitors.map((c) => ({ value: c.id })),
                        },
                      ],
                    },
                  ],
                })),
                warnings: [],
              },
            ]
          : [],
        adoptedRules: {
          definition: f3kNdcDefinition,
          sourceClassId: 'x',
          sourceVersion: '2',
          adoptedAt: '2026-09-19T00:00:00Z',
        },
        parameterBindings: [],
      },
      pairwiseCoOccurrence: [],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, never>
      if (url.includes('/class-definitions')) {
        return jsonResponse([
          {
            id: 'a1',
            contentHash: 'hash-f3k',
            name: 'RC Hand-Launch Gliders (NDC format)',
            version: '1',
            publishedAt: '2026-01-01T00:00:00Z',
          },
        ])
      }
      if (url.includes('/class-definition')) return jsonResponse(f3kNdcDefinition)
      if (url.includes('/create-competition')) {
        state.created = true
        state.drawn = false
        return jsonResponse('comp-1')
      }
      if (url.includes('/competitions')) {
        return jsonResponse(
          state.created
            ? [
                {
                  id: { value: 'comp-1' },
                  // The fabricated contest identity — the re-run after the
                  // rename finds this summary instead of re-creating.
                  name: '2026-09-19 Somewhere RC Hand-Launch Gliders (NDC format)',
                  location: 'Somewhere',
                  startDate: '2026-09-19',
                  endDate: '2026-09-19',
                  className: 'RC Hand-Launch Gliders (NDC format)',
                  classContentHash: 'hash-f3k',
                  status: 'Recording',
                },
              ]
            : [],
        )
      }
      if (url.includes('/competition-event-log')) {
        return jsonResponse({ id: { value: 'comp-1' }, name: 'Test NDC', streams: [] })
      }
      if (url.includes('/competition-result')) return jsonResponse({ scores: [] })
      if (url.includes('/task-round-result')) return jsonResponse([])
      if (url.includes('/task-round-recording')) {
        return jsonResponse({
          competitionRef: { value: 'comp-1' },
          phaseOrdinal: 0,
          roundOrdinal: 1,
          taskRoundOrdinal: 1,
          taskRef: 'D',
          metrics: [],
          groups: [],
        })
      }
      if (url.includes('/rename-person')) {
        const person = state.people.find((p) => p.id === (body.id as { value: string }).value)
        if (person) person.name = String(body.name)
        return jsonResponse('ok')
      }
      if (url.includes('/register-person')) {
        const person = { id: `person-${state.people.length + 1}`, name: String(body.name) }
        state.people.push(person)
        return jsonResponse(person.id)
      }
      if (url.includes('/people')) {
        return jsonResponse(
          state.people.map((p) => ({
            id: { value: p.id },
            name: p.name,
            email: 'p@mfnz.invalid',
            roles: [],
          })),
        )
      }
      if (url.includes('/register-competitor')) {
        const personId = (body.personId as { value: string }).value
        const id = `competitor-${state.competitors.length + 1}`
        state.competitors.push({ id, personId })
        return jsonResponse(id)
      }
      if (url.includes('/draw-phase')) {
        state.drawn = true
        return jsonResponse('phase-1')
      }
      if (url.includes('/competition')) return jsonResponse(fold())
      return jsonResponse('ok')
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const postsTo = (path: string) =>
      fetchMock.mock.calls
        .filter(([u, i]) => String(u).includes(path) && (i as RequestInit | undefined)?.body)
        .map(([, i]) => JSON.parse(String((i as RequestInit).body)))
    try {
      render(<SheetPage base="http://api.test" />)
      await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
      await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k')

      await user.type(screen.getByLabelText(/Location/), 'Somewhere')
      await user.type(screen.getByLabelText(/Date/), '2026-09-19')
      await user.type(screen.getByLabelText(/CD \(signs the commands\)/), 'CD')
      await user.type(screen.getAllByPlaceholderText('Pilot name')[0], 'Ana Silva')
      await user.click(screen.getByRole('button', { name: 'Calculate' }))
      await waitFor(() => expect(postsTo('/draw-phase')).toHaveLength(1))

      // The organiser corrects the name — the debounced re-score must rename
      // the registered person on the wire, not register a stranger.
      fireEvent.change(screen.getAllByPlaceholderText('Pilot name')[0], {
        target: { value: 'Ana Silva-Ng' },
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      const renames = postsTo('/rename-person')
      expect(renames).toHaveLength(1)
      expect(renames[0]).toMatchObject({ id: { value: 'person-1' }, name: 'Ana Silva-Ng' })
      expect(state.people[0].name).toBe('Ana Silva-Ng')
      // the competitor is untouched — one registration, from the first run
      expect(postsTo('/register-competitor')).toHaveLength(1)
      expect(state.competitors[0]).toMatchObject({ id: 'competitor-1', personId: 'person-1' })
    } finally {
      vi.useRealTimers()
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

  describe('contest date entry', () => {
    it('takes flexible day-first text, commits ISO to the sheet, and refuses a 5-digit year inline', async () => {
      const user = userEvent.setup()
      vi.stubGlobal('fetch', stubFetch())
      try {
        render(<SheetPage base="http://api.test" />)
        await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
        await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')

        const date = screen.getByLabelText(/Date/)
        // 1-2 digit day/month, day-first — the native date widget demanded dd/mm.
        await user.type(date, '5/9/2026')
        fireEvent.blur(date)
        await waitFor(() => expect(date).toHaveValue('2026-09-05'))
        await waitFor(() => {
          const stored = JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}')
          expect(stored.date).toBe('2026-09-05')
        })

        // A five-digit year never reaches the sheet text: inline error, and
        // the last good value stays on the wire.
        fireEvent.change(date, { target: { value: '5/9/20266' } })
        expect(screen.getByText(/Year must be four digits/)).toBeInTheDocument()
        fireEvent.blur(date)
        expect(date).toHaveValue('5/9/20266')
        expect(screen.getByText(/Year must be four digits/)).toBeInTheDocument()
        const stored = JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}')
        expect(stored.date).toBe('2026-09-05')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('offers the calendar picker alongside the text entry: the picked date commits the same ISO', async () => {
      const user = userEvent.setup()
      vi.stubGlobal('fetch', stubFetch())
      try {
        render(<SheetPage base="http://api.test" />)
        await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
        await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')

        // The calendar button opens the browser's native picker.
        const proto = HTMLInputElement.prototype as unknown as { showPicker?: () => void }
        let pickerOpens = 0
        proto.showPicker = () => {
          pickerOpens++
        }
        try {
          await user.click(screen.getByRole('button', { name: /Pick the contest date/ }))
          expect(pickerOpens).toBe(1)
        } finally {
          delete proto.showPicker
        }

        // A stale unparseable draft does not survive a pick: the picked ISO
        // commits, the field normalises to it and the inline error clears.
        await user.type(screen.getByLabelText(/Date/), '5/9/20266')
        expect(screen.getByText(/Year must be four digits/)).toBeInTheDocument()
        fireEvent.change(document.querySelector('input.date-native')!, {
          target: { value: '2026-09-25' },
        })
        const date = screen.getByLabelText(/Date/)
        await waitFor(() => expect(date).toHaveValue('2026-09-25'))
        expect(screen.queryByText(/Year must be four digits/)).not.toBeInTheDocument()
        const stored = JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}')
        expect(stored.date).toBe('2026-09-25')

        // The native input resets after a commit, so picking the same date
        // again still fires.
        fireEvent.change(document.querySelector('input.date-native')!, {
          target: { value: '2026-09-25' },
        })
        expect(
          JSON.parse(localStorage.getItem('ndcscore.sheet.v1') ?? '{}').date,
        ).toBe('2026-09-25')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('normalises a flexible reading on Calculate: the wire sees a valid ISO date', async () => {
      const user = userEvent.setup()
      const fetchMock = vi.fn(stubFetch() as unknown as (...args: unknown[]) => Promise<Response>)
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
      try {
        render(<SheetPage base="http://api.test" />)
        await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
        await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')
        await waitFor(() => expect(screen.getAllByText(/Flight time/).length).toBeGreaterThan(0))

        await user.type(screen.getByLabelText(/Location/), 'Somewhere')
        await user.type(screen.getByLabelText(/Date/), '5/9/2026')
        await user.type(screen.getByLabelText(/CD \(signs the commands\)/), 'CD')
        await user.type(screen.getAllByPlaceholderText('Pilot name')[0], 'Ana Silva')
        await user.click(screen.getByRole('button', { name: 'Calculate' }))
        await waitFor(() =>
          expect(
            fetchMock.mock.calls.some(
              ([u]) => String(u).includes('/create-competition'),
            ),
          ).toBe(true),
        )
        const create = fetchMock.mock.calls.find(([u]) => String(u).includes('/create-competition'))
        const init = (create?.[1] ?? {}) as { body?: string }
        const body = JSON.parse(init.body ?? '{}')
        expect(body).toMatchObject({ startDate: '2026-09-05', endDate: '2026-09-05' })
        // The name on the wire is fabricated from the header — never typed.
        expect(body.name).toBe('2026-09-05 Somewhere RC Hand-Launch Gliders (NDC format)')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('has no contest-name box and no fabricated-name announcement', async () => {
      const user = userEvent.setup()
      vi.stubGlobal('fetch', stubFetch())
      try {
        render(<SheetPage base="http://api.test" />)
        await waitFor(() => expect(screen.getByText(/RC Hand-Launch Gliders/)).toBeInTheDocument())
        await user.selectOptions(screen.getByLabelText(/Class/), 'hash-f3k-v2')

        expect(screen.queryByLabelText(/Contest name/i)).not.toBeInTheDocument()
        await user.type(screen.getByLabelText(/Location/), 'Somewhere')
        await user.type(screen.getByLabelText(/Date/), '5/9/2026')
        // The name is fabricated silently for the wire (calculate tests
        // assert the body) — the organiser never sees it.
        expect(screen.queryByText(/Soarscore calls this contest/)).not.toBeInTheDocument()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
