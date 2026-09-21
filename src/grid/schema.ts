import type {
  ClassDefinition,
  MeasuredKind,
  MeasuredValue,
  MetricDefinition,
  PhaseDefinition,
  TaskDefinition,
  TaskTiming,
  WorkingTimeKind,
} from '../api/types'
import { stopwatchPair, type StopwatchPair } from './stopwatch'

/** The wire form of the domain's NumberOrParam: a literal decimal, or a
 * reference to a class parameter by name. */
export type NumberOrParam = number | { param: string }

export interface GridColumn {
  /** Column identity — always the metric name, never the label. */
  metric: string
  label: string
  kind: MeasuredKind
  unit?: string
  declaredBeforeLaunch: boolean
  precision?: { mode: string; precision: number }
  /** Declared absence semantics: a blank cell resolves to this value. */
  whenNotRecorded?: MeasuredValue
  /** Stopwatch pair membership (derived, never class-branched): `total`
   * columns carry the organiser's single stopwatch reading and are split at
   * the task's working time before capture; `overfly` columns are owned by
   * that split and never take direct entry. */
  stopwatchRole?: 'total' | 'overfly'
}

export interface FlightRowSpec {
  /** The FlightSequence sent on the wire — 1-based. */
  sequence: number
  label: string
  /** `all` without maxLaunches: rows are added on demand (open-flight with no
   * Sequence), never pre-generated. */
  dynamic: boolean
  /** e.g. the "60 s" of an F3K target row. */
  targetLabel?: string
}

export interface TaskGridSchema {
  taskRef: string
  taskName: string
  timing: TaskTiming
  columns: GridColumn[]
  flightRows: FlightRowSpec[]
  /** Flag metrics that invalidate the flight when recorded false: they are
   * referenced by a flightValidWhen comparison `EqualTo flag:true`. The sheet
   * renders them inside the round's infraction drop list (per flight, as the
   * logical negation) instead of one column per flight — real estate. */
  zeroFlightFlags: string[]
  /** The task declares the flightTime + overflySeconds pair: one stopwatch
   * column replaces the two inputs, split client-side at working time. */
  stopwatch?: StopwatchPair
}

export interface PhaseSetupInfo {
  /** Position of this phase in the definition — drawn phase ordinals are
   * 0-based and map to the definition by position. */
  ordinal: number
  type: PhaseDefinition['type']
  rounds: PhaseDefinition['rounds']
  tasks: TaskDefinition[]
}

function humanise(name: string): string {
  const spaced = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
  const [first, ...rest] = spaced.split(' ')
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest.map((w) => w.toLowerCase())].join(' ')
}

function countFromSelection(count: number | string | undefined): number | undefined {
  const n = typeof count === 'string' ? Number(count) : count
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** Flight rows per pilot per task — derived only, never class-branched:
 * timing.maxLaunches when present; else the selection's count (last → 1,
 * lastN/exactlyN/bestN → n, all without maxLaunches → dynamic). */
export function deriveFlightRows(task: TaskDefinition): FlightRowSpec[] {
  const timing = task.timing
  const maxLaunches = timing.maxLaunches
  const literalMax =
    typeof maxLaunches === 'number'
      ? maxLaunches
      : typeof maxLaunches === 'string'
        ? Number(maxLaunches)
        : undefined

  if (typeof literalMax === 'number') {
    return rowsForCount(literalMax, task)
  }

  const selection = task.flights
  switch (selection.$kind) {
    case 'last':
      return rowsForCount(1, task)
    case 'lastN':
    case 'exactlyN':
    case 'bestN': {
      const n = countFromSelection(selection.count)
      return rowsForCount(n ?? 1, task)
    }
    case 'all':
    default:
      return rowsForCount(undefined, task)
  }
}

function rowsForCount(count: number | undefined, task: TaskDefinition): FlightRowSpec[] {
  const targets = 'targetValues' in task.flights ? task.flights.targetValues : undefined
  const targetValues = targets
    ?.map((t) => (typeof t === 'number' ? t : Number(t)))
    .filter((t) => Number.isFinite(t))

  if (count === undefined) {
    return [{ sequence: 1, label: 'Flight 1', dynamic: true }]
  }

  return Array.from({ length: count }, (_, i) => {
    const target = targetValues?.[i]
    const targetLabel =
      target !== undefined
        ? `${target % 1 === 0 ? target : target.toFixed(1)} s target`
        : undefined
    return {
      sequence: i + 1,
      label: targetLabel ? `Flight ${i + 1} (${targetLabel})` : `Flight ${i + 1}`,
      dynamic: false,
      targetLabel,
    }
  })
}

/** Under stopwatch entry the flightTime column carries the one reading the
 * organiser takes — it keeps its humanised Flight time label; the split owns
 * the overfly metric, which never gets real estate. */
export function deriveColumns(task: TaskDefinition): GridColumn[] {
  const pair = stopwatchPair(task)
  return task.metrics.map((m: MetricDefinition) => ({
    metric: m.name,
    label: humanise(m.name),
    kind: m.kind,
    unit: m.unit ?? undefined,
    declaredBeforeLaunch: m.declaredBeforeLaunch ?? false,
    precision: m.precision
      ? { mode: String(m.precision.mode), precision: Number(m.precision.precision) }
      : undefined,
    whenNotRecorded: m.whenNotRecorded ?? undefined,
    stopwatchRole: pair
      ? m.name === pair.flightMetric
        ? ('total' as const)
        : m.name === pair.overflyMetric
          ? ('overfly' as const)
          : undefined
      : undefined,
  }))
}

/** Flag metrics whose recorded-false invalidates the flight: collected from
 * the flightValidWhen predicate tree — every comparison of a metric against
 * flag `true` with EqualTo. Pure derivation, no class branches. */
export function zeroFlightFlagMetrics(validWhen: TaskDefinition['flightValidWhen']): string[] {
  const found = new Set<string>()
  const walk = (p: unknown): void => {
    if (!p || typeof p !== 'object') return
    const node = p as { children?: unknown[]; op?: string; leftMetricRef?: string; rightValue?: { kind?: string; flag?: boolean } }
    if (Array.isArray(node.children)) {
      node.children.forEach(walk)
      return
    }
    if (node.op === 'EqualTo' && node.leftMetricRef && node.rightValue?.kind === 'Flag' && node.rightValue.flag) {
      found.add(node.leftMetricRef)
    }
  }
  walk(validWhen)
  return [...found]
}

export function deriveTaskGrid(task: TaskDefinition): TaskGridSchema {
  return {
    taskRef: task.code,
    taskName: task.name,
    timing: task.timing,
    columns: deriveColumns(task),
    flightRows: deriveFlightRows(task),
    zeroFlightFlags: zeroFlightFlagMetrics(task.flightValidWhen),
    stopwatch: stopwatchPair(task),
  }
}

export function taskByRef(definition: ClassDefinition, taskRef: string): TaskDefinition | undefined {
  return definition.phases.flatMap((p) => p.tasks).find((t) => t.code === taskRef)
}

/** The definition's task grid for a drawn task-round. Drawn phase ordinals
 * are 0-based; definition phases map to them by position. */
export function taskGridFor(definition: ClassDefinition, taskRef: string): TaskGridSchema | undefined {
  const task = taskByRef(definition, taskRef)
  return task ? deriveTaskGrid(task) : undefined
}

export function phaseSetupInfo(definition: ClassDefinition, phaseOrdinal: number): PhaseSetupInfo | undefined {
  const phase = definition.phases[phaseOrdinal]
  if (!phase) return undefined
  return { ordinal: phaseOrdinal, type: phase.type, rounds: phase.rounds, tasks: phase.tasks }
}

export function phaseSetupInfos(definition: ClassDefinition): PhaseSetupInfo[] {
  return definition.phases.map((phase, i) => ({
    ordinal: i,
    type: phase.type,
    rounds: phase.rounds,
    tasks: phase.tasks,
  }))
}

/** The round count the draw step defaults to: the phase's maxRounds when
 * declared, else 1. */
export function defaultRounds(phase: PhaseSetupInfo): number {
  const max = phase.rounds?.maxRounds
  const n = typeof max === 'number' ? max : typeof max === 'string' ? Number(max) : undefined
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 1
}

export function workingTimeView(
  timing: TaskTiming,
): { kind: WorkingTimeKind; seconds?: NumberOrParam; param?: string } {
  const wt = timing.workingTime as NumberOrParam | null | undefined
  if (wt === undefined || wt === null) return { kind: timing.kind }
  if (typeof wt === 'number') return { kind: timing.kind, seconds: wt }
  if (typeof wt === 'object' && 'param' in wt) {
    return { kind: timing.kind, param: wt.param }
  }
  return { kind: timing.kind }
}
