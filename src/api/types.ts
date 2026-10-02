import type { components } from './schema'

export type ClassDefinition = components['schemas']['ClassDefinition']
export type MetricDefinition = components['schemas']['MetricDefinition']
export type MeasuredValue = components['schemas']['MeasuredValue']
export type MeasuredKind = components['schemas']['MeasuredKind']
export type Parameter = components['schemas']['Parameter']
export type ParameterBindingPoint = components['schemas']['ParameterBindingPoint']
export type ReflightRole = components['schemas']['ReflightRole']
export type PenaltyDefinition = components['schemas']['PenaltyDefinition']
export type PenaltyEffectSpec = components['schemas']['PenaltyEffectSpec']
export type PhaseDefinition = components['schemas']['PhaseDefinition']
export type TaskDefinition = components['schemas']['TaskDefinition']
export type TaskTiming = components['schemas']['TaskTiming']
export type FlightSelection = components['schemas']['FlightSelection']
export type RoundComposition = components['schemas']['RoundComposition']
export type WorkingTimeKind = components['schemas']['WorkingTimeKind']
export type PhaseType = components['schemas']['PhaseType']
export type TaskRoundState = 'Drawn' | 'InProgress' | 'Complete' | 'Annulled'
export type PenaltyScope = components['schemas']['PenaltyScope']
export type DeclaredInstrument = components['schemas']['DeclaredInstrument']

export type CreateCompetition = components['schemas']['CreateCompetition']
export type RegisterPerson = components['schemas']['RegisterPerson']
export type RenamePerson = components['schemas']['RenamePerson']
export type ContactDetails = components['schemas']['ContactDetails']
export type ClubAffiliation = components['schemas']['ClubAffiliation']
export type RegisterCompetitor = components['schemas']['RegisterCompetitor']
export type DrawPhase = components['schemas']['DrawPhase']
export type BindParameter = components['schemas']['BindParameter']
export type OpenEntry = components['schemas']['OpenEntry']
export type OpenFlight = components['schemas']['OpenFlight']
export type CaptureMeasurement = components['schemas']['CaptureMeasurement']
export type AmendMeasurement = components['schemas']['AmendMeasurement']
export type RecordEntryPenalty = components['schemas']['RecordEntryPenalty']
export type AnnulEntry = components['schemas']['AnnulEntry']
export type CompleteTaskRound = components['schemas']['CompleteTaskRound']
export type ReopenTaskRound = components['schemas']['ReopenTaskRound']
export type DeclareInstruments = components['schemas']['DeclareInstruments']

/** Strong-typed id structs cross the wire as {"value": "<guid>"}; plain Guid
 * fields are flat. In query strings every id is a bare GUID string. */
export type Id = { value: string }

export const measuredNumber = (n: number): MeasuredValue => ({ kind: 'Number', number: n })
export const measuredFlag = (f: boolean): MeasuredValue => ({ kind: 'Flag', flag: f })

export function asNumber(mv: MeasuredValue): number | undefined {
  if (mv.kind !== 'Number') return undefined
  return typeof mv.number === 'number' ? mv.number : mv.number != null ? Number(mv.number) : undefined
}

export function asFlag(mv: MeasuredValue): boolean | undefined {
  return mv.kind === 'Flag' ? (mv.flag ?? undefined) : undefined
}

export interface PersonSummary {
  id: Id
  name: string
  email: string
  phone?: string | null
  homeCity?: string | null
  clubName?: string | null
  roles: (string | number)[]
}

export interface Person {
  id: Id
  name: string
  contact: ContactDetails
  club?: ClubAffiliation | null
  roles: (string | number)[]
}

export type PersonRoleName = 'Competitor' | 'Organiser'

/** PersonRole crosses the wire as its numeric value (Competitor = 0,
 * Organiser = 1) — the API has no string-enum converter, so roles read back
 * as numbers too. The label helper accepts either shape. */
export const personRoleValue: Record<PersonRoleName, number> = { Competitor: 0, Organiser: 1 }

export function personRoleLabel(role: string | number): string {
  if (role === 1 || role === 'Organiser') return 'Organiser'
  if (role === 0 || role === 'Competitor') return 'Competitor'
  return String(role)
}

export function holdsRole(roles: (string | number)[], name: PersonRoleName): boolean {
  return roles.some((r) => r === personRoleValue[name] || r === name)
}

export interface CurrentUserView {
  isAuthenticated: boolean
  personId: Id | null
  roles: (string | number)[]
  name: string | null
}

export interface ClassDefinitionSummary {
  /** Plain Guid on this view — flat, unlike the typed id structs. */
  id: string
  contentHash: string
  name: string
  faiDesignation?: string | null
  version: string
  publishedAt: string
  retiredAt?: string | null
}

export interface CompetitionSummary {
  id: Id
  name: string
  location: string
  startDate: string
  endDate: string
  className: string
  classContentHash: string
  status: string
}

export interface DrawWarning {
  code: string
  message: string
}

export interface CompetitionFold {
  id: Id
  name: string
  location: string
  startDate: string
  endDate: string
  evaluatorVersion: string
  competitors: CompetitorFold[]
  phases: PhaseFold[]
  adoptedRules: {
    definition: ClassDefinition
    sourceClassId: string
    sourceVersion: string
    adoptedAt: string
  }
  parameterBindings: ParameterBindingFold[]
  /** The declared tape set, verbatim from the wire (null until the first
   * declaration). Optional for tolerance of servers predating it. */
  declaredInstruments?: {
    instruments: DeclaredInstrument[]
    by: string
    at: string
  } | null
}

export interface CompetitorFold {
  id: Id
  personRef: Id
  competitorNumber: number
  registeredAt: string
  withdrawnAt?: string | null
}

export interface GroupFold {
  id: Id
  ordinal: number
  competitorRefs: Id[]
  spots?: GroupSpotFold[]
}

export interface GroupSpotFold {
  competitorRef: Id
  spot: number
}

export interface TaskRoundFold {
  ordinal: number
  state: TaskRoundState
  taskRef: string
  groups: GroupFold[]
}

export interface RoundFold {
  ordinal: number
  taskRounds: TaskRoundFold[]
}

export interface PhaseFold {
  type: PhaseType
  ordinal: number
  draw: { createdAt: string; status: string }
  rounds: RoundFold[]
  warnings: DrawWarning[]
}

export interface ParameterBindingFold {
  parameterName: string
  boundValue: MeasuredValue
  by: string
  at: string
  phaseOrdinal?: number | null
  roundOrdinal?: number | null
}

export interface CompetitionView {
  competition: CompetitionFold
  pairwiseCoOccurrence: { competitorA: Id; competitorB: Id; count: number }[]
}

export interface EntrySummary {
  id: Id
  competitionRef: Id
  phaseOrdinal: number
  roundOrdinal: number
  taskRoundOrdinal: number
  groupRef: Id
  competitorRef: Id
  role: ReflightRole
}

export interface FlightGaps {
  sequence: number
  missingMetrics: string[]
  awaitingCapture: string[]
}

export interface EntryGaps {
  entryRef: Id
  competitorRef: Id
  role: ReflightRole
  flights: FlightGaps[]
}

export interface GroupRecording {
  groupRef: Id
  ordinal: number
  expectedCompetitorRefs: Id[]
  notRecordedCompetitorRefs: Id[]
  recordedWithoutFlightCompetitorRefs: Id[]
  metricGaps: EntryGaps[]
  spots: { spot: number; competitorRef: Id }[]
}

export interface TaskRoundRecordingView {
  competitionRef: Id
  phaseOrdinal: number
  roundOrdinal: number
  taskRoundOrdinal: number
  taskRef: string
  metrics: { name: string; whenNotRecorded?: MeasuredValue | null }[]
  groups: GroupRecording[]
}

export interface PendingFlightDiagnostic {
  flightSequence: number
  awaitedMetric: string
}

/** One score term's awarded contribution on one flight, projected verbatim
 * from the engine's own TermContribution (Soarscore per-term-score-breakdown,
 * unblocking ss_per-term-landing-points). Keyed by metricRef, never position:
 * term order is an engine detail (law 3). Raw Score terms only. */
export interface ScoreTermView {
  termIndex: number
  metricRef: string | null
  metricConsumed: number | string
  points: number | string
}

/** One selected flight's per-term breakdown. Per-flight points sum to the
 * flight's score before PerTask-cap correction and RawScore rounding — the
 * deltas stay server-side, so the column never re-derives RawScore. */
export interface FlightScoreView {
  sequence: number
  terms: ScoreTermView[]
}

export interface CompetitorTaskResult {
  competitorRef: Id
  role: ReflightRole
  state: 'Valid' | 'NoResult'
  rawScore: number | string
  preNormalisationScore: number | string
  awaitingCapture: PendingFlightDiagnostic[]
  /** The selected flights' per-term breakdowns, verbatim from the engine.
   * Empty (never null) for NoResult rows — absence, never zero. Optional for
   * tolerance of servers predating the breakdown: absent reads as empty. */
  flights?: FlightScoreView[]
}

export interface GroupScore {
  groupRef: Id
  results: CompetitorTaskResult[]
  winnerRef?: Id | null
  validCount: number
  isAnnulled: boolean
}

export interface CompetitionScore {
  scores: {
    competitorRef: Id
    score: number | string
    disqualified: boolean
    placing?: number | null
  }[]
}

export interface EventLogEvent {
  version: number
  name: string
  summary?: string | null
  payload?: unknown
}

export interface EventLogStream {
  /** Plain Guid — flat. */
  streamId: string
  kind: 'competition' | 'entry'
  label?: string | null
  events: EventLogEvent[]
}

export interface CompetitionEventLog {
  id: Id
  name: string
  streams: EventLogStream[]
}
