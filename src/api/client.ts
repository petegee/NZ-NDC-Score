import { request, type ApiResult, type FetchLike, type QueryParams } from './wire'
import type { components } from './schema'
import type {
  AmendMeasurement,
  AnnulEntry,
  BindParameter,
  CaptureMeasurement,
  ClassDefinition,
  ClassDefinitionSummary,
  CompetitionEventLog,
  CompetitionScore,
  CompetitionSummary,
  CompetitionView,
  CreateCompetition,
  EntrySummary,
  GroupScore,
  Person,
  PersonSummary,
  RegisterPerson,
  TaskRoundRecordingView,
  PenaltyScope,
  ReflightRole,
} from './types'

export interface OpenEntryInput {
  competitionRef: string
  phaseOrdinal: number
  roundOrdinal: number
  taskRoundOrdinal: number
  groupRef: string
  competitorRef: string
  role?: ReflightRole
  countsForRoundOrdinal?: number
  reason?: string
}

export interface CaptureMeasurementInput {
  entryRef: string
  flightSequence: number
  metric: string
  value: CaptureMeasurement['value']
  instrument?: string
}

export interface AmendMeasurementInput {
  entryRef: string
  flightSequence: number
  metric: string
  newValue: AmendMeasurement['newValue']
  reason: string
  by: string
  instrument?: string
  changeInstrument?: boolean
}

export interface RecordEntryPenaltyInput {
  entryRef: string
  infractionType: string
  scope: PenaltyScope
  by?: string
}

export interface DeclareInstrumentsInput {
  competitionRef: string
  instruments: components['schemas']['DeclaredInstrument'][]
  by: string
}

export interface Api {
  registerPerson(body: RegisterPerson): Promise<ApiResult<string>>
  renamePerson(personId: string, name: string): Promise<ApiResult<string>>
  findPeople(query: { email?: string; name?: string }): Promise<ApiResult<PersonSummary[]>>
  getPerson(id: string): Promise<ApiResult<Person>>

  findClassDefinitions(query: { name?: string; activeOnly?: boolean }): Promise<
    ApiResult<ClassDefinitionSummary[]>
  >
  getClassDefinition(contentHash: string): Promise<ApiResult<ClassDefinition>>

  findCompetitions(query: {
    onOrAfter?: string
    classContentHash?: string
  }): Promise<ApiResult<CompetitionSummary[]>>
  getCompetition(id: string): Promise<ApiResult<CompetitionView>>
  getCompetitionEventLog(
    id: string,
    includePayload?: boolean,
  ): Promise<ApiResult<CompetitionEventLog>>

  createCompetition(body: CreateCompetition): Promise<ApiResult<string>>
  registerCompetitor(competitionId: string, personId: string): Promise<ApiResult<string>>
  drawPhase(
    competitionId: string,
    rounds: number,
    taskRefs?: string[],
  ): Promise<ApiResult<string>>
  acceptDraw(competitionId: string): Promise<ApiResult<string>>
  bindParameter(
    body: Omit<BindParameter, 'competitionRef'> & { competitionRef: string },
  ): Promise<ApiResult<string>>
  declareInstruments(body: DeclareInstrumentsInput): Promise<ApiResult<string>>

  openEntry(body: OpenEntryInput): Promise<ApiResult<string>>
  openFlight(entryRef: string, sequence?: number): Promise<ApiResult<string>>
  captureMeasurement(body: CaptureMeasurementInput): Promise<ApiResult<string>>
  amendMeasurement(body: AmendMeasurementInput): Promise<ApiResult<string>>
  recordEntryPenalty(body: RecordEntryPenaltyInput): Promise<ApiResult<string>>
  annulEntry(body: Omit<AnnulEntry, 'entryRef'> & { entryRef: string }): Promise<ApiResult<string>>
  completeTaskRound(body: {
    competitionRef: string
    phaseOrdinal: number
    roundOrdinal: number
    taskRoundOrdinal: number
  }): Promise<ApiResult<string>>
  reopenTaskRound(body: {
    competitionRef: string
    phaseOrdinal: number
    roundOrdinal: number
    taskRoundOrdinal: number
    reason: string
  }): Promise<ApiResult<string>>

  findEntries(query: {
    competitionRef: string
    phaseOrdinal?: number
    roundOrdinal?: number
    taskRoundOrdinal?: number
    groupRef?: string
    competitorRef?: string
  }): Promise<ApiResult<EntrySummary[]>>

  getTaskRoundRecording(query: {
    competitionRef: string
    phaseOrdinal: number
    roundOrdinal: number
    taskRoundOrdinal: number
    groupRef?: string
  }): Promise<ApiResult<TaskRoundRecordingView>>

  scoreTaskRound(query: {
    competitionRef: string
    phaseOrdinal: number
    roundOrdinal: number
    taskRoundOrdinal: number
    groupRef?: string
  }): Promise<ApiResult<GroupScore[]>>

  scoreCompetition(competitionRef: string): Promise<ApiResult<CompetitionScore>>
}

/** Ids are nested {"value": "<guid>"} structs in JSON bodies — every caller
 * here passes bare strings and the nesting happens in exactly one place. */
const id = (value: string) => ({ value })

function unwrapId(result: ApiResult<unknown>): ApiResult<string> {
  const v = result.value as { value?: unknown } | string
  const guid = typeof v === 'string' ? v : typeof v.value === 'string' ? v.value : undefined
  if (!guid) {
    throw new Error(`Expected a typed id response, got ${JSON.stringify(result.value)}`)
  }
  return { value: guid, warnings: result.warnings }
}

export function createApi(base: string, fetchImpl: FetchLike = fetch): Api {
  const call = <T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { query?: QueryParams; body?: unknown } = {},
  ): Promise<ApiResult<T>> => request<T>(fetchImpl, base, method, path, opts)

  return {
    registerPerson: async (body) => unwrapId(await call('POST', '/register-person', { body })),
    renamePerson: async (personId, name) =>
      unwrapId(await call('POST', '/rename-person', { body: { id: id(personId), name } })),
    findPeople: async (query) =>
      call('GET', '/people', { query: { email: query.email, name: query.name } }),
    getPerson: async (personId) => call('GET', '/person', { query: { id: personId } }),

    findClassDefinitions: async (query) =>
      call('GET', '/class-definitions', {
        query: { name: query.name, activeOnly: query.activeOnly },
      }),
    getClassDefinition: async (contentHash) =>
      call('GET', '/class-definition', { query: { contentHash } }),

    findCompetitions: async (query) =>
      call('GET', '/competitions', {
        query: { onOrAfter: query.onOrAfter, classContentHash: query.classContentHash },
      }),
    getCompetition: async (competitionId) =>
      call('GET', '/competition', { query: { id: competitionId } }),
    getCompetitionEventLog: async (competitionId, includePayload = false) =>
      call('GET', '/competition-event-log', { query: { id: competitionId, includePayload } }),

    createCompetition: async (body) => unwrapId(await call('POST', '/create-competition', { body })),
    registerCompetitor: async (competitionId, personId) =>
      unwrapId(
        await call('POST', '/register-competitor', {
          body: { competitionId: id(competitionId), personId: id(personId) },
        }),
      ),
    drawPhase: async (competitionId, rounds, taskRefs) =>
      unwrapId(
        await call('POST', '/draw-phase', {
          body: { competitionId: id(competitionId), rounds, taskRefs },
        }),
      ),
    acceptDraw: async (competitionId) =>
      unwrapId(await call('POST', '/accept-draw', { body: { competitionId: id(competitionId) } })),
    bindParameter: async ({ competitionRef, ...rest }) =>
      unwrapId(await call('POST', '/bind-parameter', { body: { competitionRef: id(competitionRef), ...rest } })),
    declareInstruments: async ({ competitionRef, instruments, by }) =>
      unwrapId(
        await call('POST', '/declare-instruments', {
          body: { competitionRef: id(competitionRef), instruments, by },
        }),
      ),

    openEntry: async ({ competitionRef, groupRef, competitorRef, ...rest }) =>
      unwrapId(
        await call('POST', '/open-entry', {
          body: { competitionRef: id(competitionRef), groupRef: id(groupRef), competitorRef: id(competitorRef), ...rest },
        }),
      ),
    openFlight: async (entryRef, sequence) =>
      unwrapId(await call('POST', '/open-flight', { body: { entryRef: id(entryRef), sequence } })),
    captureMeasurement: async ({ entryRef, ...rest }) =>
      unwrapId(await call('POST', '/capture-measurement', { body: { entryRef: id(entryRef), ...rest } })),
    amendMeasurement: async ({ entryRef, ...rest }) =>
      unwrapId(await call('POST', '/amend-measurement', { body: { entryRef: id(entryRef), ...rest } })),
    recordEntryPenalty: async ({ entryRef, ...rest }) =>
      unwrapId(await call('POST', '/record-entry-penalty', { body: { entryRef: id(entryRef), ...rest } })),
    annulEntry: async ({ entryRef, ...rest }) =>
      unwrapId(await call('POST', '/annul-entry', { body: { entryRef: id(entryRef), ...rest } })),
    completeTaskRound: async ({ competitionRef, ...rest }) =>
      unwrapId(await call('POST', '/complete-task-round', { body: { competitionRef: id(competitionRef), ...rest } })),
    reopenTaskRound: async ({ competitionRef, ...rest }) =>
      unwrapId(await call('POST', '/reopen-task-round', { body: { competitionRef: id(competitionRef), ...rest } })),

    findEntries: async (query) => call('GET', '/entries', { query }),
    getTaskRoundRecording: async (query) => call('GET', '/task-round-recording', { query }),
    scoreTaskRound: async (query) => call('GET', '/task-round-result', { query }),
    scoreCompetition: async (competitionRef) =>
      call('GET', '/competition-result', { query: { competitionRef } }),
  }
}
