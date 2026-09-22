import type { Api } from '../api/client'
import type {
  ClassDefinition,
  CompetitionScore,
  CompetitionSummary,
  CompetitionView,
  EventLogEvent,
  EventLogStream,
  GroupScore,
  MeasuredValue,
  Person,
  PersonSummary,
  TaskDefinition,
  TaskRoundRecordingView,
} from '../api/types'
import { ApiError } from '../api/wire'

/** A tiny in-memory Soarscore: enough projection + event-store behaviour for
 * the Calculate orchestrator's unit tests — adoption codes, unique email,
 * draw freeze, completion, gaps and the event-log rebuild path. */

/** Metrics a recordedness gate reads (Predicate `$kind: "isRecorded"` in
 * flightValidWhen): their absence is the gate's false — the flight zeroes
 * through the gate (5.5.11.7 e, add-recorded-predicate.md) — it never awaits
 * capture. Pure derivation from the definition, no class branches. */
function recordednessGateMetrics(task: TaskDefinition): Set<string> {
  const refs = new Set<string>()
  const walk = (p: unknown): void => {
    if (!p || typeof p !== 'object') return
    const node = p as { children?: unknown[]; $kind?: string; metricRef?: string }
    if (Array.isArray(node.children)) {
      node.children.forEach(walk)
      return
    }
    if (node.$kind === 'isRecorded' && typeof node.metricRef === 'string') refs.add(node.metricRef)
  }
  walk(task.flightValidWhen)
  return refs
}

interface FakePerson {
  id: string
  name: string
  email: string
}

interface FakeEntry {
  id: string
  competitorId: string
  phaseOrdinal: number
  roundOrdinal: number
  taskRoundOrdinal: number
  groupRef: string
  /** flight sequence → captured metric values (current) */
  flights: Map<number, Map<string, MeasuredValue>>
  /** audit trail: original captured values, updated never */
  originals: Map<number, Map<string, MeasuredValue>>
  amendments: { flightSequence: number; metric: string; newValue: MeasuredValue }[]
  /** recorded infraction types, in order */
  penalties: { infractionType: string; scope: string; by?: string | null }[]
}

interface FakeCompetition {
  id: string
  name: string
  location: string
  date: string
  classContentHash: string
  bindings: { parameterName: string; value: unknown; phaseOrdinal?: number; roundOrdinal?: number }[]
  drawStatus: 'none' | 'drawn' | 'accepted'
  rounds: { ordinal: number; taskRef: string; state: 'Drawn' | 'InProgress' | 'Complete' }[]
  /** roundOrdinal → group member lists (competitor ids) */
  groups: Map<number, string[][]>
  competitors: { id: string; personId: string; number: number }[]
  entries: FakeEntry[]
}

const GROUP_SIZE = 2

export class FakeSoarscore {
  people: FakePerson[] = []
  competitions: FakeCompetition[] = []
  private ids = 0

  private id(): string {
    this.ids += 1
    const n = String(this.ids).padStart(4, '0')
    return `00000000-0000-4000-8000-${n.padEnd(12, '0')}`
  }

  personByName(name: string): FakePerson | undefined {
    return this.people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
  }

  competitionByName(name: string, date: string): FakeCompetition | undefined {
    return this.competitions.find(
      (c) => c.name.toLowerCase() === name.trim().toLowerCase() && c.date === date,
    )
  }

  competitorsOf(competitionId: string): FakeCompetition['competitors'] {
    return this.competitions.find((x) => x.id === competitionId)?.competitors ?? []
  }

  /** Gaps for one task-round, mirroring the service: competitors with no
   * entry, and opened flights awaiting capture — a non-whenNotRecorded metric
   * that no recordedness gate reads (a gate-read metric's absence zeroes the
   * flight instead of pending it). */
  gapCount(definition: ClassDefinition, competitionId: string, roundOrdinal: number): number {
    const c = this.competitions.find((x) => x.id === competitionId)
    const round = c?.rounds.find((r) => r.ordinal === roundOrdinal)
    if (!c || !round) return 0
    const task = definition.phases.flatMap((p) => p.tasks).find((t) => t.code === round.taskRef)
    const gated = task ? recordednessGateMetrics(task) : new Set<string>()
    const required = task?.metrics.filter((m) => !m.whenNotRecorded && !gated.has(m.name)).map((m) => m.name) ?? []
    const entries = c.entries.filter((e) => e.roundOrdinal === roundOrdinal)
    const members = c.groups.get(roundOrdinal) ?? []
    const expected = members.flat()
    let gaps = expected.filter((m) => !entries.some((e) => e.competitorId === m)).length
    for (const e of entries) {
      for (const [, done] of e.flights) {
        gaps += required.filter((m) => !done.has(m)).length
      }
    }
    return gaps
  }

  api(definition: ClassDefinition): Api {
    const comp = (id: string): FakeCompetition => {
      const c = this.competitions.find((x) => x.id === id)
      if (!c) throw new ApiError(404, 'competition.notFound', 'no such competition', [])
      return c
    }
    const entry = (entryRef: string): FakeEntry => {
      const e = this.competitions.flatMap((c) => c.entries).find((x) => x.id === entryRef)
      if (!e) throw new ApiError(404, 'entry.notFound', 'no such entry', [])
      return e
    }

    const fold = (c: FakeCompetition): CompetitionView => ({
      competition: {
        id: { value: c.id },
        name: c.name,
        location: c.location,
        startDate: c.date,
        endDate: c.date,
        evaluatorVersion: '1',
        competitors: c.competitors.map((k) => ({
          id: { value: k.id },
          personRef: { value: k.personId },
          competitorNumber: k.number,
          registeredAt: '2026-09-19T00:00:00Z',
        })),
        phases:
          c.drawStatus === 'none'
            ? []
            : [
                {
                  type: 'Preliminary',
                  ordinal: 0,
                  draw: { createdAt: '2026-09-19T00:00:00Z', status: c.drawStatus },
                  rounds: c.rounds.map((r) => ({
                    ordinal: r.ordinal,
                    taskRounds: [
                      {
                        ordinal: 1,
                        state: r.state,
                        taskRef: r.taskRef,
                        groups: (c.groups.get(r.ordinal) ?? []).map((members, gi) => ({
                          id: { value: `${c.id}-g${r.ordinal}-${gi}` },
                          ordinal: gi + 1,
                          competitorRefs: members.map((m) => ({ value: m })),
                        })),
                      },
                    ],
                  })),
                  warnings: [],
                },
              ],
        adoptedRules: {
          definition,
          sourceClassId: definition.name,
          sourceVersion: definition.version,
          adoptedAt: '2026-09-19T00:00:00Z',
        },
        parameterBindings: c.bindings.map((b) => ({
          parameterName: b.parameterName,
          boundValue: b.value as never,
          by: 'CD',
          at: '2026-09-19T00:00:00Z',
          phaseOrdinal: b.phaseOrdinal ?? null,
          roundOrdinal: b.roundOrdinal ?? null,
        })),
      },
      pairwiseCoOccurrence: [],
    })

    const taskRefFor = (c: FakeCompetition, roundOrdinal: number): string =>
      c.rounds.find((r) => r.ordinal === roundOrdinal)?.taskRef ?? ''
    const taskFor = (taskRef: string): TaskDefinition | undefined =>
      definition.phases.flatMap((p) => p.tasks).find((t) => t.code === taskRef)
    const awaitingMetrics = (taskRef: string): { declared: string[]; awaiting: string[] } => {
      const task = taskFor(taskRef)
      if (!task) return { declared: [], awaiting: [] }
      const gated = recordednessGateMetrics(task)
      // MissingMetrics is the recorded fact (every absent declared metric);
      // AwaitingCapture is the subset scoring awaits — a declared
      // non-assumption that no recordedness gate reads, the same carve-outs
      // TaskRoundRecording applies (metric-absence-semantics.md WI-3,
      // add-recorded-predicate.md WI-3). Neither list is a verdict.
      return {
        declared: task.metrics.map((m) => m.name),
        awaiting: task.metrics
          .filter((m) => !m.whenNotRecorded && !gated.has(m.name))
          .map((m) => m.name),
      }
    }

    return {
      findPeople: async (query) => ({
        value: this.people
          .filter(
            (p) =>
              (query.email !== undefined && p.email === query.email) ||
              (query.name !== undefined && p.name.toLowerCase().includes(query.name.toLowerCase())),
          )
          .map(
            (p): PersonSummary => ({ id: { value: p.id }, name: p.name, email: p.email, roles: [] }),
          ),
        warnings: [],
      }),
      registerPerson: async (body) => {
        if (this.people.some((p) => p.email === body.contact.email)) {
          throw new ApiError(409, 'eventStore.uniqueConstraintViolation', 'duplicate email', [])
        }
        const person: FakePerson = { id: this.id(), name: body.name, email: body.contact.email }
        this.people.push(person)
        return { value: person.id, warnings: [] }
      },
      getPerson: async (id) => {
        const p = this.people.find((x) => x.id === id)
        if (!p) throw new ApiError(404, 'person.notFound', 'no such person', [])
        return {
          value: { id: { value: p.id }, name: p.name, contact: { email: p.email }, roles: [] } as Person,
          warnings: [],
        }
      },

      findCompetitions: async (query) => ({
        value: this.competitions
          .filter(
            (c) =>
              (!query.onOrAfter || c.date >= query.onOrAfter) &&
              (!query.classContentHash || c.classContentHash === query.classContentHash),
          )
          .map(
            (c): CompetitionSummary => ({
              id: { value: c.id },
              name: c.name,
              location: c.location,
              startDate: c.date,
              endDate: c.date,
              className: definition.name,
              classContentHash: c.classContentHash,
              status: 'Recording',
            }),
          ),
        warnings: [],
      }),
      createCompetition: async (body) => {
        const c: FakeCompetition = {
          id: this.id(),
          name: body.name,
          location: body.location,
          date: body.startDate,
          classContentHash: body.classContentHash,
          bindings: [],
          drawStatus: 'none',
          rounds: [],
          groups: new Map(),
          competitors: [],
          entries: [],
        }
        this.competitions.push(c)
        return { value: c.id, warnings: [] }
      },
      getCompetition: async (id) => ({ value: fold(comp(id)), warnings: [] }),
      getCompetitionEventLog: async (id) => {
        const c = comp(id)
        const streams: EventLogStream[] = c.entries.map((e) => {
          const events: EventLogEvent[] = [
            {
              version: 1,
              name: 'entryOpened',
              payload: {
                competitionRef: { value: c.id },
                phaseOrdinal: e.phaseOrdinal,
                roundOrdinal: e.roundOrdinal,
                taskRoundOrdinal: e.taskRoundOrdinal,
                groupRef: { value: e.groupRef },
                competitorRef: { value: e.competitorId },
                id: { value: e.id },
                role: 'Original',
              },
            },
          ]
          let version = 2
          for (const [seq, values] of [...e.originals.entries()].sort((a, b) => a[0] - b[0])) {
            events.push({ version: version++, name: 'flightOpened', payload: { sequence: seq } })
            for (const [metric, value] of values) {
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
              payload: {
                flightSequence: a.flightSequence,
                metric: a.metric,
                amendment: { newValue: a.newValue },
              },
            })
          }
          for (const p of e.penalties) {
            events.push({
              version: version++,
              name: 'penaltyRecorded',
              payload: { penalty: { infractionType: p.infractionType, scope: p.scope, by: p.by } },
            })
          }
          return { streamId: e.id, kind: 'entry' as const, events }
        })
        return { value: { id: { value: c.id }, name: c.name, streams }, warnings: [] }
      },

      bindParameter: async (body) => {
        const c = comp(body.competitionRef)
        const param = (definition.parameters ?? []).find((p) => p.name === body.parameterName)
        if (param?.boundAt === 'CompetitionSetup' && c.drawStatus === 'accepted') {
          throw new ApiError(400, 'competition.parameter.frozen', 'frozen after draw acceptance', [])
        }
        if (body.phaseOrdinal != null && body.roundOrdinal != null) {
          const round = c.rounds.find((r) => r.ordinal === body.roundOrdinal)
          if (!round) {
            throw new ApiError(400, 'competition.parameter.roundNotFound', 'round not drawn', [])
          }
          if (round.state !== 'Drawn') {
            throw new ApiError(400, 'competition.parameter.roundFrozen', 'round frozen', [])
          }
          if (c.entries.some((e) => e.roundOrdinal === body.roundOrdinal)) {
            throw new ApiError(400, 'competition.parameter.roundInProgress', 'round in progress', [])
          }
        }
        c.bindings.push({
          parameterName: body.parameterName,
          value: body.value,
          phaseOrdinal:
            body.phaseOrdinal != null ? Number(body.phaseOrdinal) : undefined,
          roundOrdinal: body.roundOrdinal != null ? Number(body.roundOrdinal) : undefined,
        })
        return { value: c.id, warnings: [] }
      },

      registerCompetitor: async (competitionId, personId) => {
        const c = comp(competitionId)
        if (c.competitors.some((k) => k.personId === personId)) {
          throw new ApiError(409, 'competition.competitor.alreadyRegistered', 'already registered', [])
        }
        const k = { id: this.id(), personId, number: c.competitors.length + 1 }
        c.competitors.push(k)
        return { value: k.id, warnings: [] }
      },

      drawPhase: async (competitionId, rounds, taskRefs) => {
        const c = comp(competitionId)
        if (c.drawStatus !== 'none') {
          throw new ApiError(409, 'eventStore.streamAlreadyExists', 'already drawn', [])
        }
        const catalogue = definition.phases[0]?.rounds?.kind === 'ChooseFromCatalogue'
        const fixed = definition.phases[0]?.tasks[0]?.code ?? ''
        c.rounds = Array.from({ length: rounds }, (_, i) => ({
          ordinal: i + 1,
          taskRef: catalogue ? (taskRefs?.[i] ?? '') : fixed,
          state: 'Drawn' as const,
        }))
        c.drawStatus = 'drawn'
        // The draw assigns groups: round-robin chunks of the registered field.
        const ids = c.competitors.map((k) => k.id)
        for (const r of c.rounds) {
          const groups: string[][] = []
          for (let i = 0; i < ids.length; i += GROUP_SIZE) groups.push(ids.slice(i, i + GROUP_SIZE))
          c.groups.set(r.ordinal, groups)
        }
        return { value: c.id, warnings: [] }
      },
      acceptDraw: async (competitionId) => {
        comp(competitionId).drawStatus = 'accepted'
        return { value: competitionId, warnings: [] }
      },

      openEntry: async (body) => {
        const c = comp(body.competitionRef)
        const existing = c.entries.find(
          (e) =>
            e.competitorId === body.competitorRef &&
            e.phaseOrdinal === body.phaseOrdinal &&
            e.roundOrdinal === body.roundOrdinal &&
            e.taskRoundOrdinal === body.taskRoundOrdinal,
        )
        if (existing) throw new ApiError(409, 'openEntry.alreadyOpen', 'already open', [])
        const e: FakeEntry = {
          id: this.id(),
          competitorId: body.competitorRef,
          phaseOrdinal: body.phaseOrdinal,
          roundOrdinal: body.roundOrdinal,
          taskRoundOrdinal: body.taskRoundOrdinal,
          groupRef: body.groupRef,
          flights: new Map(),
          originals: new Map(),
          amendments: [],
          penalties: [],
        }
        c.entries.push(e)
        const round = c.rounds.find((r) => r.ordinal === body.roundOrdinal)
        if (round && round.state === 'Drawn') round.state = 'InProgress'
        return { value: e.id, warnings: [] }
      },
      openFlight: async (entryRef, sequence) => {
        const e = entry(entryRef)
        const seq = sequence ?? Math.max(0, ...[...e.flights.keys()]) + 1
        if (e.flights.has(seq)) {
          throw new ApiError(409, 'openFlight.duplicateSequence', 'duplicate launch', [])
        }
        e.flights.set(seq, new Map())
        e.originals.set(seq, new Map())
        return { value: e.id, warnings: [] }
      },
      captureMeasurement: async (body) => {
        const e = entry(body.entryRef)
        const metrics = e.flights.get(body.flightSequence)
        if (!metrics) throw new ApiError(400, 'entry.flightNotOpen', 'flight not open', [])
        if (metrics.has(body.metric)) {
          throw new ApiError(400, 'entry.measurement.alreadyRecorded', 'already recorded', [])
        }
        metrics.set(body.metric, body.value)
        e.originals.get(body.flightSequence)?.set(body.metric, body.value)
        return { value: e.id, warnings: [] }
      },
      amendMeasurement: async (body) => {
        const e = entry(body.entryRef)
        if (!body.reason) {
          throw new ApiError(400, 'entry.amend.reasonRequired', 'reason required', [])
        }
        const metrics = e.flights.get(body.flightSequence)
        if (metrics && metrics.has(body.metric)) metrics.set(body.metric, body.newValue)
        e.amendments.push({
          flightSequence: body.flightSequence,
          metric: body.metric,
          newValue: body.newValue,
        })
        return { value: e.id, warnings: [] }
      },

      getTaskRoundRecording: async (query) => {
        const c = comp(query.competitionRef)
        const round = c.rounds.find((r) => r.ordinal === query.roundOrdinal)
        if (!round) throw new ApiError(404, 'taskRound.notFound', 'no such task-round', [])
        const groups = c.groups.get(query.roundOrdinal) ?? []
        const entries = c.entries.filter(
          (e) =>
            e.roundOrdinal === query.roundOrdinal &&
            e.taskRoundOrdinal === query.taskRoundOrdinal,
        )
        const required = awaitingMetrics(taskRefFor(c, query.roundOrdinal))
        const view: TaskRoundRecordingView = {
          competitionRef: { value: c.id },
          phaseOrdinal: query.phaseOrdinal,
          roundOrdinal: query.roundOrdinal,
          taskRoundOrdinal: query.taskRoundOrdinal,
          taskRef: round.taskRef,
          metrics: [],
          groups: groups.map((members, gi) => {
            const groupRef = `${c.id}-g${query.roundOrdinal}-${gi}`
            const inGroup = entries.filter((e) => e.groupRef === groupRef)
            return {
              groupRef: { value: groupRef },
              ordinal: gi + 1,
              expectedCompetitorRefs: members.map((m) => ({ value: m })),
              notRecordedCompetitorRefs: members
                .filter((m) => !inGroup.some((e) => e.competitorId === m))
                .map((m) => ({ value: m })),
              recordedWithoutFlightCompetitorRefs: [],
              metricGaps: inGroup.map((e) => ({
                entryRef: { value: e.id },
                competitorRef: { value: e.competitorId },
                role: 'Original' as const,
                flights: [...e.flights.entries()]
                  .map(([sequence, done]) => {
                    const absent = required.declared.filter((m) => !done.has(m))
                    return {
                      sequence,
                      missingMetrics: absent,
                      awaitingCapture: absent.filter((m) => required.awaiting.includes(m)),
                    }
                  })
                  .filter((f) => f.awaitingCapture.length > 0),
              })),
              spots: [],
            }
          }),
        }
        return { value: view, warnings: [] }
      },

      completeTaskRound: async (body) => {
        const c = comp(body.competitionRef)
        const round = c.rounds.find((r) => r.ordinal === body.roundOrdinal)
        if (!round) throw new ApiError(400, 'taskRound.notFound', 'no such task-round', [])
        round.state = 'Complete'
        return { value: c.id, warnings: [] }
      },
      reopenTaskRound: async (body) => {
        const c = comp(body.competitionRef)
        const round = c.rounds.find((r) => r.ordinal === body.roundOrdinal)
        if (!round) throw new ApiError(400, 'taskRound.notFound', 'no such task-round', [])
        if (!body.reason) {
          throw new ApiError(400, 'taskRound.reopen.reasonRequired', 'reason required', [])
        }
        round.state = 'Drawn'
        return { value: c.id, warnings: [] }
      },

      findEntries: async () => ({ value: [], warnings: [] }),
      scoreTaskRound: async (): Promise<ApiResult<GroupScore[]>> => ({ value: [], warnings: [] }),
      scoreCompetition: async (): Promise<ApiResult<CompetitionScore>> => ({
        value: { scores: [] },
        warnings: [],
      }),
      findClassDefinitions: async () => ({ value: [], warnings: [] }),
      getClassDefinition: async () => ({ value: definition, warnings: [] }),
      declareInstruments: async () => ({ value: '', warnings: [] }),
      recordEntryPenalty: async (body) => {
        const e = entry(body.entryRef)
        if (e.penalties.some((p) => p.infractionType === body.infractionType)) {
          throw new ApiError(400, 'entry.penalty.duplicate', 'already recorded', [])
        }
        if (!definition.penalties?.some((d) => d.infractionType === body.infractionType)) {
          throw new ApiError(400, 'recordPenalty.infractionTypeNotDeclared', 'not declared', [])
        }
        e.penalties.push({ infractionType: body.infractionType, scope: body.scope, by: body.by })
        return { value: e.id, warnings: [] }
      },
      annulEntry: async () => ({ value: '', warnings: [] }),
    } satisfies Api
  }
}

type ApiResult<T> = { value: T; warnings: never[] }
