import type { Api } from '../api/client'
import type {
  ClassDefinition,
  CompetitionView,
  MeasuredValue,
  TaskRoundRecordingView,
} from '../api/types'
import { asNumber, measuredNumber } from '../api/types'
import { ApiError } from '../api/wire'
import { applyRounding } from '../grid/precision'
import { parseCellText } from '../grid/parse'
import type { GridColumn } from '../grid/schema'
import { formatClock, splitStopwatch } from '../grid/stopwatch'
import { fabricateContestName } from './contestName'
import {
  chainCommands,
  captureReducer,
  cellKey as wireCellKey,
  cellParts,
  type CaptureAction,
  type CaptureState,
  type PendingCommand,
  type TaskRoundRef,
} from './capture'
import { runOne } from './queue'
import { rebuildFromEventLog } from './rebuild'
import {
  parseParamInput,
  paramsBoundAt,
  paramConsumedByTask,
  parsePenaltyText,
  PENALTIES_METRIC,
  phaseRoundsKind,
  phaseTasks,
  resolveWorkingTime,
  sheetCellKey,
  sheetPenaltyKey,
  sheetRoundGrids,
  validateSheet,
  visibleFlightRows,
  type SheetState,
} from './sheet'

/** Reasons the orchestrator writes on the organiser's behalf — the wire
 * keeps them mandatory, the organiser never types one. */
export const CORRECTION_REASON = 'Corrected from scoresheet'
export const REOPEN_REASON = 'Reopened for a scoresheet correction'

/** Per-pilot placeholder email for unknown pilots: deterministic (same name
 * → same address → idempotent re-runs) and unique (the projection's email
 * index arbitrates; the shared literal would 409 on the second pilot). */
export function placeholderEmail(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pilot'
  return `unknown+${slug}@mfnz.invalid`
}

export interface CalcProgress {
  step: string
  label: string
  status: 'ok' | 'warn' | 'error'
  detail?: string
  warnings?: { code: string; message: string }[]
}

export interface CalcScheduleEntry {
  phaseOrdinal: number
  roundOrdinal: number
  taskRoundOrdinal: number
  taskRef: string
  state: string
}

export interface CalcReport {
  ok: boolean
  competitionId: string | null
  steps: CalcProgress[]
  problems: string[]
  cellErrors: { key: string; error: string }[]
  counts: { captured: number; amended: number; unchanged: number; failed: number; skippedNotDrawn: number; skippedNotRegistered: number; penalties: number }
  schedule: CalcScheduleEntry[]
  names: Record<string, string>
  /** Sheet pilot row (1-based) → competitor id. */
  rowCompetitors: Record<string, string>
}

/** The identity mapping the previous successful run established (sheet
 * row → competitor, and the name each competitor's row carried then). It is
 * the orchestration memory between two runs of one page session — the wire
 * stays the only store; nothing here is score arithmetic. */
export type CalcPrior = Pick<CalcReport, 'competitionId' | 'rowCompetitors' | 'names'>

export type ProgressSink = (p: CalcProgress) => void

/** Command ids stay unique across page reloads (time-based start). */
let commandIdSeq = Math.floor(Date.now() / 1000)
const nextCommandId = (): number => ++commandIdSeq

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'network.unreachable'
}

function errorDetail(error: unknown): string {
  return error instanceof ApiError
    ? `${error.code}: ${error.detail}`
    : String((error as Error)?.message ?? error)
}

/** Capture-side identity comparison: is the sheet text the same measurement
 * the service already stores? The value *sent* is never rounded here (the
 * service owns rounding); this only decides capture vs amend vs skip, by
 * applying the metric's declared rounding to both sides — the same modes the
 * service applies on capture (Truncate/HalfUp/Ceiling over 1/precision). */
export function sameMeasurement(
  stored: MeasuredValue | undefined,
  parsed: MeasuredValue,
  column?: GridColumn,
): boolean {
  if (!stored || stored.kind !== parsed.kind) return false
  if (parsed.kind === 'Flag') return stored.flag === parsed.flag
  const x = Number(stored.number)
  const y = Number(parsed.number)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return x === y
  const spec = column?.precision
  if (!spec) return x === y
  return applyRounding(x, spec) === applyRounding(y, spec)
}

interface PumpCounts {
  captured: number
  amended: number
  unchanged: number
  failed: number
  skippedNotDrawn: number
  skippedNotRegistered: number
  penalties: number
}

interface RebuiltCells {
  entries: CaptureState['entries']
  cells: CaptureState['cells']
}

/** A loud, non-blocking notice about one stopwatch reading — emitted per
 * Calculate run, never a refusal and never a value change. */
export interface StopwatchNotice {
  label: string
  detail: string
}

/** One stopwatch cell: the organiser's single launch-to-landing reading for a
 * flightTime + overflySeconds task. The rulebook's split runs here, at the
 * task's working time, before any command is queued — overfly =
 * max(0, total − workingTime) per the overfly metric's declaration (whole
 * seconds), flight = min(total, workingTime) per the flight metric's
 * declaration (e.g. F3J 0.1 s HalfUp, F5J/F5L whole seconds). A zero overfly
 * is the declared absence (whenNotRecorded) — it is not captured, but a
 * previously captured overfly that the corrected reading erases is amended
 * to the assumed value: absence cannot unrecord an event, an explicit value
 * can. All other metrics are untouched.
 *
 * Returns a notice when the reading reaches the working-time horn with no
 * overfly surviving the declared rounding (the paper flyaway ambiguity:
 * "600 means the model never landed") — the organiser is told, the reading
 * is never refused or reinterpreted, and the engine still rules. */
function splitStopwatchCell(
  rg: ReturnType<typeof sheetRoundGrids>[number],
  col: GridColumn,
  total: MeasuredValue,
  key: string,
  competitorId: string,
  flightSequence: number,
  roundState: string,
  phaseOrdinal: number,
  roundOrdinal: number,
  fold: CompetitionView,
  sheet: SheetState,
  rebuilt: RebuiltCells,
  captureState: CaptureState,
  counts: PumpCounts,
  cellErrors: { key: string; error: string }[],
  nextCommandId: () => number,
  needReopen: () => void,
): StopwatchNotice | undefined {
  const pair = rg.grid.stopwatch
  const overflyCol = rg.grid.columns.find((c) => c.stopwatchRole === 'overfly')
  if (!pair || !overflyCol) {
    cellErrors.push({ key, error: 'stopwatch column without its overfly metric' })
    counts.failed++
    return undefined
  }
  const workingTime = resolveWorkingTime(
    rg.grid.timing,
    rg.perRoundParams,
    sheet.params,
    fold.competition.parameterBindings,
    phaseOrdinal,
    roundOrdinal,
  )
  if (workingTime === undefined) {
    cellErrors.push({
      key,
      error: `no working time to split the stopwatch reading against (declare it in the task or bind the parameter)`,
    })
    counts.failed++
    return undefined
  }
  const seconds = asNumber(total)
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    cellErrors.push({ key, error: 'not a stopwatch time' })
    counts.failed++
    return undefined
  }
  const split = splitStopwatch(seconds, workingTime, col, overflyCol)
  // The flyaway reading (`f5j-flight-time-cap-at-959`): a total that reaches
  // the horn leaves no overfly once the declared rounding applies, so the
  // engine sees a perfect in-window flight and cannot tell "never landed"
  // from "landed exactly on the limit" — max flight time and landing points
  // is a state the rulebook does not allow. Definition-derived (the pair,
  // the working time, the flight metric's granularity), never class-branched.
  const hornNotice =
    seconds >= workingTime && split.overfly === 0
      ? {
          label: `stopwatch ${formatClock(seconds)} reaches the ${formatClock(workingTime)} working time with no overfly`,
          detail: `A stopwatch at the horn is paper shorthand for "the model never landed", but the engine cannot tell a flyaway from a landing exactly on the limit and will score any landing entered for this flight. If the model landed inside the window, enter the reading as at most ${formatClock(workingTime - (col.precision?.precision ?? 1))}; if it flew away, do not enter landing points (the flyaway reading is pending with Soarscore).`,
        }
      : undefined
  const flightValue = measuredNumber(split.flight)
  const overflyValue = measuredNumber(split.overfly)
  const flightCommitted = rebuilt.cells[wireCellKey(competitorId, flightSequence, pair.flightMetric)]
  const overflyCommitted = rebuilt.cells[wireCellKey(competitorId, flightSequence, pair.overflyMetric)]
  const assumed = overflyCol.whenNotRecorded
  // A zero excess means the declared absence — blank is already the truth.
  const overflyAssumed =
    assumed !== undefined && sameMeasurement(assumed, overflyValue, overflyCol)
  const overflyTarget = overflyAssumed && assumed ? assumed : overflyValue
  const flightUnchanged = sameMeasurement(flightCommitted?.value, flightValue, col)
  const overflyUnchanged = overflyAssumed
    ? !overflyCommitted || sameMeasurement(overflyCommitted.value, assumed, overflyCol)
    : sameMeasurement(overflyCommitted?.value, overflyValue, overflyCol)
  if (flightUnchanged && overflyUnchanged) {
    counts.unchanged++
    return hornNotice
  }
  if (roundState === 'Complete' && ((flightCommitted && !flightUnchanged) || (overflyCommitted && !overflyUnchanged))) {
    needReopen()
  }
  captureState.queue.push(
    ...chainCommands(
      wireCellKey(competitorId, flightSequence, pair.flightMetric),
      competitorId,
      flightSequence,
      pair.flightMetric,
      flightValue,
      captureState.entries,
      nextCommandId,
      flightCommitted ? { reason: CORRECTION_REASON } : undefined,
    ),
  )
  if (!overflyUnchanged) {
    captureState.queue.push(
      ...chainCommands(
        wireCellKey(competitorId, flightSequence, pair.overflyMetric),
        competitorId,
        flightSequence,
        pair.overflyMetric,
        overflyTarget,
        captureState.entries,
        nextCommandId,
        overflyCommitted ? { reason: CORRECTION_REASON } : undefined,
      ),
    )
  }
  return hornNotice
}

/** Runs one task-round group's queued commands to a terminal state through
 * the production queue reducer — adoption, retry and per-cell blocking all
 * behave exactly as they did under write-through. */
async function pumpGroup(
  api: Api,
  state: CaptureState,
  deps: { competitionId: string; cdName: string; counts: PumpCounts },
): Promise<void> {
  let st = state
  const dispatch = (action: CaptureAction) => {
    if (action.type === 'commandSucceeded') {
      const cmd = st.queue.find((c) => c.id === action.id)
      if (cmd?.kind === 'capture') deps.counts.captured++
      if (cmd?.kind === 'amend') deps.counts.amended++
      if (cmd?.kind === 'penalty') deps.counts.penalties++
    }
    if (action.type === 'commandFailed') deps.counts.failed++
    st = captureReducer(st, action)
  }
  const max = st.queue.length * 4 + 16
  let iterations = 0
  while (st.queue.length > 0 && iterations++ < max) {
    const head = st.queue[0]
    if (!head) break
    await runOne(st, head, {
      api,
      competitionId: deps.competitionId,
      cdName: deps.cdName,
      dispatch,
      refetchFold: async () => {},
      delay: sleep,
    })
  }
}

/** Gaps that scoring actually waits on: pilots with no entry, and flights
 * whose awaitingCapture list is non-empty (absence with a declared
 * whenNotRecorded value resolves itself and is not a gap). The detail names
 * them — who, which flight, which metrics — so "N gap(s)" is never the
 * organiser's only clue; names come from the report's names map, metric
 * labels from the round's columns (raw names as fallback). */
function recordingGaps(
  recording: TaskRoundRecordingView,
  names: Record<string, string>,
  metricLabel: (metric: string) => string,
): { count: number; detail: string } {
  const parts: string[] = []
  let count = 0
  for (const group of recording.groups) {
    for (const ref of group.notRecordedCompetitorRefs) {
      count++
      parts.push(`${names[ref.value] ?? `competitor ${ref.value}`} has no entry`)
    }
    for (const entry of group.metricGaps) {
      const who = names[entry.competitorRef.value] ?? `competitor ${entry.competitorRef.value}`
      for (const flight of entry.flights) {
        if (flight.awaitingCapture.length === 0) continue
        count++
        parts.push(`${who} flight ${flight.sequence}: ${flight.awaitingCapture.map(metricLabel).join(', ')} not captured`)
      }
    }
  }
  return { count, detail: parts.join('; ') }
}

export async function runCalculate(
  api: Api,
  sheet: SheetState,
  onProgress?: ProgressSink,
  prior?: CalcPrior,
): Promise<CalcReport> {
  const steps: CalcProgress[] = []
  const problems: string[] = []
  const cellErrors: { key: string; error: string }[] = []
  const counts: PumpCounts = { captured: 0, amended: 0, unchanged: 0, failed: 0, skippedNotDrawn: 0, skippedNotRegistered: 0, penalties: 0 }
  const schedule: CalcScheduleEntry[] = []
  const names: Record<string, string> = {}
  /** Sheet pilot row (1-based) → competitor id — lets the results table read
   * key-metric cells back for each competitor (the fold is the truth). */
  const rowCompetitors: Record<string, string> = {}
  const report: CalcReport = {
    ok: false,
    competitionId: null,
    steps,
    problems,
    cellErrors,
    counts,
    schedule,
    names,
    rowCompetitors,
  }
  const emit: ProgressSink = (p) => {
    steps.push(p)
    onProgress?.(p)
  }

  // --- 1 · local validation ---
  const validation = validateSheet(sheet)
  problems.push(...validation.problems)
  cellErrors.push(...validation.cellErrors)
  if (!validation.ok || validation.cellErrors.length > 0) {
    emit({
      step: 'validate',
      label: 'The sheet has problems',
      status: 'error',
      detail: [...validation.problems, ...validation.cellErrors.map((c) => `${c.key}: ${c.error}`)].join(' · '),
    })
    return report
  }
  const definition = sheet.classDefinition as ClassDefinition
  const cdName = sheet.cdName.trim()
  const namedPilots = sheet.pilots
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.name.trim())

  // --- 2 · find-or-create competition ---
  // The contest has no name field on the sheet (bug #4): the identity is
  // fabricated from the header — date, location, adopted class — in one
  // place (`fabricateContestName`). The same header fabricates the same
  // name, so a re-calc finds the same competition; a second same-day event
  // at the same venue and class collides and is reported, never guessed.
  emit({ step: 'competition', label: 'Finding or creating the contest…', status: 'ok' })
  const contestName = fabricateContestName({
    location: sheet.location,
    date: sheet.date,
    classDefinition: definition,
  })
  let competitionId: string
  try {
    const found = await api.findCompetitions({
      onOrAfter: sheet.date,
      classContentHash: sheet.classContentHash ?? '',
    })
    const wanted = contestName.toLowerCase()
    const matches = found.value.filter(
      (c) => c.name.trim().toLowerCase() === wanted && c.startDate === sheet.date,
    )
    if (matches.length > 1) {
      // Soarscore's read is the truth: it already holds more than one
      // contest with the sheet's fabricated identity (a second same-day
      // event). The client cannot tell them apart and must never silently
      // pick one — the run stops here.
      emit({
        step: 'competition',
        label: `${matches.length} contests are already named "${contestName}" starting ${sheet.date}`,
        status: 'error',
        detail: `Soarscore holds ${matches.length} of them (${matches
          .map((c) => `${c.id.value} · ${c.status}`)
          .join(', ')}), and the sheet cannot tell them apart. Rename one on the wire, or run this sheet against a different location, date or class.`,
      })
      return report
    }
    competitionId = matches[0]
      ? matches[0].id.value
      : (
          await api.createCompetition({
            name: contestName,
            location: sheet.location.trim(),
            startDate: sheet.date,
            endDate: sheet.date,
            classContentHash: sheet.classContentHash ?? '',
          })
        ).value
  } catch (error) {
    emit({ step: 'competition', label: 'Find-or-create competition failed', status: 'error', detail: errorDetail(error) })
    return report
  }
  report.competitionId = competitionId
  emit({ step: 'competition', label: 'Contest ready', status: 'ok', detail: competitionId })

  // --- 3 · fold + setup bindings (before any draw freeze) ---
  let fold: CompetitionView
  try {
    fold = (await api.getCompetition(competitionId)).value
  } catch (error) {
    emit({ step: 'competition', label: 'Reading the contest failed', status: 'error', detail: errorDetail(error) })
    return report
  }

  let bindingsChanged = false
  // BeforeFlying parameters (e.g. Radian's roundDuration) bind after setup
  // but before any entry opens — the service refuses openEntry with
  // openEntry.parameterUnbound while the task's working time is unresolved.
  for (const param of [...paramsBoundAt(definition, 'CompetitionSetup'), ...paramsBoundAt(definition, 'BeforeFlying')]) {
    if (fold.competition.parameterBindings.some((b) => b.parameterName === param.name)) continue
    const parsed = parseParamInput(param, sheet.params[param.name] ?? '')
    if (!parsed.ok) {
      problems.push(parsed.error)
      continue
    }
    try {
      await api.bindParameter({
        competitionRef: competitionId,
        parameterName: param.name,
        value: parsed.value,
        by: cdName,
      })
      bindingsChanged = true
      emit({ step: 'bindings', label: `Bound ${param.name}`, status: 'ok' })
    } catch (error) {
      emit({ step: 'bindings', label: `Binding ${param.name} failed`, status: 'error', detail: errorDetail(error) })
      return report
    }
  }
  if (bindingsChanged) fold = (await api.getCompetition(competitionId)).value

  // --- 4 · find-or-register persons and competitors ---
  emit({ step: 'pilots', label: 'Registering the field…', status: 'ok' })
  const personByRow = new Map<number, string>()
  // Prior identity: the last successful run mapped sheet rows to
  // competitors. A row is a position on the sheet, not a name (law 4 —
  // overtype and recalculate, the organiser is never asked): when the sheet
  // renames a row, the same pilot keeps their competitor, draw spot and
  // committed cells, and the person record is renamed on the wire. The
  // prior mapping outranks any name match — a name match to a stranger must
  // never re-bind a flown row, and two rows renamed at once (a swap through
  // intermediate names) is only resolvable this way.
  const priorByRow = new Map<number, { personId: string; priorName?: string }>()
  if (prior && prior.competitionId === competitionId) {
    for (const [rowStr, competitorId] of Object.entries(prior.rowCompetitors)) {
      const index = Number(rowStr) - 1
      const competitor = fold.competition.competitors.find((c) => c.id.value === competitorId)
      if (!competitor || !sheet.pilots[index]?.name.trim()) continue
      priorByRow.set(index, { personId: competitor.personRef.value, priorName: prior.names[competitorId] })
    }
    // Competitors the sheet no longer names (a blanked row mid-retype)
    // keep their last sheet name for display instead of a raw id.
    for (const [id, name] of Object.entries(prior.names)) names[id] = name
  }
  const renameFailed: string[] = []
  try {
    /** Rows whose name resolves to nobody — deferred so a single renamed
     * row can be recovered by elimination before anything registers. */
    const orphans: { index: number; name: string; email: string; mfnz: string }[] = []
    for (const { row, index } of namedPilots) {
      const name = row.name.trim()
      const known = priorByRow.get(index)
      if (known) {
        // The row keeps its competitor identity; a changed name renames the
        // same person (never a no-op rename — the sheet text is compared to
        // what this row last sent).
        const same =
          known.priorName !== undefined &&
          known.priorName.trim().toLowerCase() === name.toLowerCase()
        if (!same) {
          try {
            await api.renamePerson(known.personId, name)
          } catch (error) {
            renameFailed.push(`${name} (${errorDetail(error)})`)
            continue
          }
        }
        personByRow.set(index, known.personId)
        continue
      }
      const found = await api.findPeople({ name })
      const exact = found.value.find((p) => p.name.trim().toLowerCase() === name.toLowerCase())
      if (exact) {
        personByRow.set(index, exact.id.value)
        names[exact.id.value] = exact.name
        continue
      }
      orphans.push({ index, name, email: row.email.trim(), mfnz: row.mfnz.trim() })
    }
    // A renamed row without prior identity — the page was reloaded and the
    // report mapping (session memory) is gone. When exactly one named row
    // matches nobody and exactly one drawn competitor matches no row, the
    // two are the same pilot under a corrected name; anything more ambiguous
    // (several renames, or a rename mixed with a genuinely new pilot) is not
    // guessable and falls through to registration.
    if (orphans.length === 1) {
      const claimed = new Set<string>()
      const competitorByPerson = new Map(
        fold.competition.competitors.map((c) => [c.personRef.value, c.id.value] as const),
      )
      for (const personId of personByRow.values()) {
        const cid = competitorByPerson.get(personId)
        if (cid) claimed.add(cid)
      }
      const unclaimed = fold.competition.competitors.filter((c) => !claimed.has(c.id.value))
      if (unclaimed.length === 1) {
        const orphan = orphans[0]
        const target = unclaimed[0]
        try {
          await api.renamePerson(target.personRef.value, orphan.name)
          personByRow.set(orphan.index, target.personRef.value)
          orphans.length = 0
        } catch (error) {
          renameFailed.push(`${orphan.name} (${errorDetail(error)})`)
          orphans.length = 0
        }
      }
    }
    for (const orphan of orphans) {
      const email = orphan.email || placeholderEmail(orphan.name)
      try {
        const created = await api.registerPerson({
          name: orphan.name,
          contact: { email },
          club: orphan.mfnz ? { clubName: '', membershipNumber: orphan.mfnz } : null,
        })
        personByRow.set(orphan.index, created.value)
        names[created.value] = orphan.name
      } catch (error) {
        if (error instanceof ApiError && error.code === 'eventStore.uniqueConstraintViolation') {
          const byEmail = await api.findPeople({ email })
          const match = byEmail.value.find((p) => p.name.trim().toLowerCase() === orphan.name.toLowerCase())
          if (match) {
            personByRow.set(orphan.index, match.id.value)
            names[match.id.value] = match.name
            continue
          }
        }
        throw error
      }
    }
    const competitorByPerson = new Map(
      fold.competition.competitors.map((c) => [c.personRef.value, c.id.value] as const),
    )
    let competitorsChanged = false
    const fieldFrozen: string[] = []
    for (const { index } of namedPilots) {
      const personId = personByRow.get(index)
      if (!personId || competitorByPerson.has(personId)) continue
      try {
        await api.registerCompetitor(competitionId, personId)
        competitorsChanged = true
      } catch (error) {
        const code = errorCode(error)
        if (code === 'competition.field.frozen') {
          // Registration closes at draw acceptance (the first Calculate
          // accepts immediately) — a pilot added afterwards is refused by the
          // service. Absorb it the way corrections are absorbed: warn, keep
          // everyone else moving; their cells stay uncommitted sheet text.
          fieldFrozen.push(sheet.pilots[index].name.trim())
          continue
        }
        if (
          code !== 'competition.competitor.alreadyRegistered' &&
          code !== 'eventStore.uniqueConstraintViolation'
        ) {
          throw error
        }
        competitorsChanged = true
      }
    }
    if (competitorsChanged) fold = (await api.getCompetition(competitionId)).value
    emit({ step: 'pilots', label: `Field of ${fold.competition.competitors.length} ready`, status: 'ok' })
    if (fieldFrozen.length > 0) {
      emit({
        step: 'pilots',
        label: `${fieldFrozen.join(', ')} not registered — the field froze when the draw was accepted`,
        status: 'warn',
        detail:
          'competition.field.frozen — adding competitors to an accepted draw needs a Soarscore capability that does not exist yet; their cells are skipped.',
      })
    }
    if (renameFailed.length > 0) {
      emit({
        step: 'pilots',
        label: `Rename refused: ${renameFailed.join('; ')}`,
        status: 'warn',
        detail:
          'The row keeps the wire name it had; its cells are skipped and the next edit retries the rename. Results keep showing the last name the sheet sent.',
      })
    }
  } catch (error) {
    emit({ step: 'pilots', label: 'Registering the field failed', status: 'error', detail: errorDetail(error) })
    return report
  }

  // Row → competitor mapping for the capture step (the fold is the truth).
  const competitorByRow = new Map<number, string>()
  const competitorByPerson = new Map(
    fold.competition.competitors.map((c) => [c.personRef.value, c.id.value] as const),
  )
  for (const { index } of namedPilots) {
    const personId = personByRow.get(index)
    const competitorId = personId ? competitorByPerson.get(personId) : undefined
    if (competitorId) {
      competitorByRow.set(index, competitorId)
      names[competitorId] = sheet.pilots[index].name.trim()
      rowCompetitors[String(index + 1)] = competitorId
    }
  }
  // The reverse read for the deselected-compliance reconciliation: committed
  // wire keys name the competitor, and its sheet cell is addressed by row.
  const rowByCompetitor = new Map<string, number>()
  for (const [index, competitorId] of competitorByRow) rowByCompetitor.set(competitorId, index + 1)

  // --- 5 · draw or adopt the drawn schedule ---
  const roundsKind = phaseRoundsKind(definition)
  const tasks = phaseTasks(definition)
  const pickFor = (i: number): string =>
    sheet.taskPicks[i] ?? tasks[i % Math.max(tasks.length, 1)]?.code ?? ''
  try {
    if (fold.competition.phases.length === 0) {
      const taskRefs =
        roundsKind === 'ChooseFromCatalogue'
          ? Array.from({ length: sheet.rounds }, (_, i) => pickFor(i))
          : undefined
      const drawn = await api.drawPhase(competitionId, sheet.rounds, taskRefs)
      try {
        await api.acceptDraw(competitionId)
      } catch (acceptError) {
        emit({
          step: 'draw',
          label: 'Accepting the draw was refused (continuing)',
          status: 'warn',
          detail: errorDetail(acceptError),
        })
      }
      fold = (await api.getCompetition(competitionId)).value
      emit({ step: 'draw', label: `Drawn ${sheet.rounds} round(s)`, status: 'ok', warnings: drawn.warnings })
    } else {
      const phase = fold.competition.phases[0]
      if (phase.rounds.length !== sheet.rounds) {
        // The drawn fold is the truth and no wire verb extends or trims it —
        // but a count difference no longer dead-ends the evening: the drawn
        // rounds keep processing, the mismatch is named loudly.
        emit({
          step: 'draw',
          label: `The drawn schedule has ${phase.rounds.length} round(s); the sheet claims ${sheet.rounds}`,
          status: 'warn',
          detail:
            sheet.rounds > phase.rounds.length
              ? `Round(s) ${phase.rounds.length + 1}–${sheet.rounds} are not drawn — extending a drawn fold needs a Soarscore capability that does not exist yet; their cells are skipped.`
              : 'The drawn schedule is the truth — the extra drawn round(s) are skipped, never annulled, from here on.',
        })
      }
      const grids = sheetRoundGrids(definition, sheet.rounds, sheet.taskPicks)
      for (const round of phase.rounds) {
        const expected = grids.find((g) => g.roundOrdinal === round.ordinal)?.taskRef
        const drawnRef = round.taskRounds[0]?.taskRef
        if (expected && drawnRef && expected !== drawnRef) {
          emit({
            step: 'draw',
            label: 'The sheet disagrees with the drawn schedule',
            status: 'error',
            detail: `Round ${round.ordinal} is drawn as task ${drawnRef}; the sheet claims ${expected}. The drawn schedule is the truth — fix the sheet.`,
          })
          return report
        }
      }
      emit({ step: 'draw', label: `Adopting the drawn schedule (${phase.rounds.length} round(s))`, status: 'ok' })
    }
  } catch (error) {
    emit({ step: 'draw', label: 'Draw failed', status: 'error', detail: errorDetail(error) })
    return report
  }

  // --- 6 · per-round parameter bindings ---
  const phase = fold.competition.phases[0]
  for (const round of phase.rounds) {
    const taskRef = round.taskRounds[0]?.taskRef
    if (!taskRef) continue
    const taskRound = round.taskRounds[0]
    for (const param of paramsBoundAt(definition, 'PerRound')) {
      if (!paramConsumedByTask(param, taskRef)) continue
      const scopedBound = fold.competition.parameterBindings.some(
        (b) =>
          b.parameterName === param.name &&
          b.phaseOrdinal === phase.ordinal &&
          b.roundOrdinal === round.ordinal,
      )
      const unscopedBound = fold.competition.parameterBindings.some(
        (b) => b.parameterName === param.name && b.phaseOrdinal == null && b.roundOrdinal == null,
      )
      if (scopedBound || unscopedBound) continue
      const parsed = parseParamInput(param, sheet.params[param.name] ?? '')
      if (!parsed.ok) {
        emit({ step: 'bindings', label: parsed.error, status: 'warn' })
        continue
      }
      const bind = (scoped: boolean) =>
        api.bindParameter({
          competitionRef: competitionId,
          parameterName: param.name,
          value: parsed.value,
          by: cdName,
          ...(scoped ? { phaseOrdinal: phase.ordinal, roundOrdinal: round.ordinal } : {}),
        })
      try {
        await bind(true)
        emit({ step: 'bindings', label: `Bound ${param.name} for round ${round.ordinal}`, status: 'ok' })
      } catch (error) {
        if (taskRound.state === 'Drawn' && errorCode(error) !== 'competition.parameter.notConsumedByTask') {
          emit({ step: 'bindings', label: `Binding ${param.name} failed`, status: 'error', detail: errorDetail(error) })
          return report
        }
        try {
          await bind(false)
            emit({
            step: 'bindings',
            label: `Bound ${param.name} (unscoped — round ${round.ordinal} already flying)`,
            status: 'warn',
          })
        } catch (fallbackError) {
          emit({ step: 'bindings', label: `Binding ${param.name} failed`, status: 'error', detail: errorDetail(fallbackError) })
          return report
        }
      }
    }
  }
  // The per-round binds landed; the fold's rounds/tasks are unchanged, and
  // the capture step refetches only the event log it needs.

  // --- 7 · capture: rebuild, diff, capture or amend, complete ---
  const grids = sheetRoundGrids(definition, sheet.rounds, sheet.taskPicks)
  emit({ step: 'capture', label: 'Capturing the sheet…', status: 'ok' })
  let log
  try {
    log = (await api.getCompetitionEventLog(competitionId, true)).value
  } catch (error) {
    emit({ step: 'capture', label: 'Reading the event log failed', status: 'error', detail: errorDetail(error) })
    return report
  }

  for (const round of phase.rounds) {
    const rg = grids.find((g) => g.roundOrdinal === round.ordinal)
    for (const taskRound of round.taskRounds) {
      schedule.push({
        phaseOrdinal: phase.ordinal,
        roundOrdinal: round.ordinal,
        taskRoundOrdinal: taskRound.ordinal,
        taskRef: taskRound.taskRef,
        state: taskRound.state,
      })
      if (!rg) {
        emit({
          step: 'capture',
          label: `Round ${round.ordinal} is not on the sheet — skipped`,
          status: 'warn',
        })
        continue
      }
      if (taskRound.state === 'Annulled') {
        emit({ step: 'capture', label: `Round ${round.ordinal} is annulled — skipped`, status: 'warn' })
        continue
      }
      const notDrawnHere = new Set<string>()
      const notRegisteredHere = new Set<string>()
      // No competitor behind a named row — usually the field froze before the
      // pilot could register. Never silent: their typed cells are counted and
      // warned per round, and stay uncommitted sheet text.
      for (const { index } of namedPilots) {
        if (competitorByRow.has(index)) continue
        for (const flightRow of visibleFlightRows(rg.grid, round.ordinal, index + 1, sheet.cells)) {
          for (const col of rg.grid.columns) {
            if (col.stopwatchRole === 'overfly') continue
            const key = sheetCellKey(round.ordinal, index + 1, flightRow.sequence, col.metric)
            if ((sheet.cells[key] ?? '').trim()) counts.skippedNotRegistered++
          }
        }
        notRegisteredHere.add(sheet.pilots[index].name.trim())
      }
      let needReopen = false
      let reopened = false
      for (const group of taskRound.groups) {
        const coordinate: TaskRoundRef = {
          phaseOrdinal: phase.ordinal,
          roundOrdinal: round.ordinal,
          taskRoundOrdinal: taskRound.ordinal,
          groupRef: group.id.value,
          taskRef: taskRound.taskRef,
        }
        const rebuilt = rebuildFromEventLog(log, coordinate)
        const captureState: CaptureState = {
          active: coordinate,
          entries: rebuilt.entries,
          cells: rebuilt.cells,
          queue: [],
        }
        for (const { index } of namedPilots) {
          const competitorId = competitorByRow.get(index)
          if (!competitorId) continue
          const inGroup = group.competitorRefs.some((c) => c.value === competitorId)
          for (const flightRow of visibleFlightRows(rg.grid, round.ordinal, index + 1, sheet.cells)) {
            for (const col of rg.grid.columns) {
              const key = sheetCellKey(round.ordinal, index + 1, flightRow.sequence, col.metric)
              const text = sheet.cells[key] ?? ''
              if (!inGroup) {
                if (text.trim()) {
                  counts.skippedNotDrawn++
                  notDrawnHere.add(sheet.pilots[index].name.trim())
                }
                continue
              }
              // The stopwatch split owns the overfly metric — it is never
              // captured directly (validation refuses text in its cells).
              if (col.stopwatchRole === 'overfly') continue
              if (!text.trim()) continue
              const parsed = parseCellText(text.trim(), col.kind, col.unit)
              if (!parsed.ok) {
                cellErrors.push({ key, error: parsed.error })
                counts.failed++
                continue
              }
              if (col.stopwatchRole === 'total') {
                const horn = splitStopwatchCell(
                  rg,
                  col,
                  parsed.value,
                  key,
                  competitorId,
                  flightRow.sequence,
                  taskRound.state,
                  phase.ordinal,
                  round.ordinal,
                  fold,
                  sheet,
                  rebuilt,
                  captureState,
                  counts,
                  cellErrors,
                  nextCommandId,
                  () => {
                    needReopen = true
                  },
                )
                if (horn) {
                  emit({
                    step: 'capture',
                    label: `Round ${round.ordinal}: ${sheet.pilots[index].name.trim()} flight ${flightRow.sequence} — ${horn.label}`,
                    status: 'warn',
                    detail: horn.detail,
                  })
                }
                continue
              }
              const wireKey = wireCellKey(competitorId, flightRow.sequence, col.metric)
              const committed = rebuilt.cells[wireKey]
              if (sameMeasurement(committed?.value, parsed.value, col)) {
                counts.unchanged++
                continue
              }
              if (committed && taskRound.state === 'Complete') needReopen = true
              const amend = committed ? { reason: CORRECTION_REASON } : undefined
              const commands: PendingCommand[] = chainCommands(
                wireKey,
                competitorId,
                flightRow.sequence,
                col.metric,
                parsed.value,
                captureState.entries,
                nextCommandId,
                amend,
              )
              captureState.queue.push(...commands)
            }
          }
        // Penalties — one round-level cell, diffed against what the event log
        // shows recorded on the entry. Additive only: penalties are events,
        // and the service has no un-record.
        if (inGroup) {
          const penaltyKey = sheetPenaltyKey(round.ordinal, index + 1)
          const wanted = parsePenaltyText(sheet.cells[penaltyKey] ?? '')
          const committed = rebuilt.entries[competitorId]?.penalties ?? []
          const committedTypes = committed.map((p) => p.infractionType)
          const missing = wanted.filter((t) => !committedTypes.includes(t))
          const offSheet = committedTypes.filter((t) => !wanted.includes(t))
          if (offSheet.length > 0) {
            emit({
              step: 'capture',
              label: `Round ${round.ordinal}: ${sheet.pilots[index].name.trim()} has committed penalty(s) not on the sheet: ${offSheet.join(', ')}`,
              status: 'warn',
              detail: 'Penalties are events — they cannot be un-recorded from the sheet.',
            })
          }
          if (missing.length > 0) {
            if (taskRound.state === 'Complete') needReopen = true
            const wireKey = wireCellKey(competitorId, 1, PENALTIES_METRIC)
            if (!captureState.entries[competitorId]?.entryId) {
              captureState.queue.push({
                kind: 'open-entry',
                id: nextCommandId(),
                cellKey: wireKey,
                competitorId,
                attempt: 0,
              })
            }
            for (const infractionType of missing) {
              captureState.queue.push({
                kind: 'penalty',
                id: nextCommandId(),
                cellKey: wireKey,
                competitorId,
                infractionType,
                attempt: 0,
              })
            }
          }
        }
        }
        // Deselected compliance — the organiser unticked a More-list option
        // (or cleared its value): the sheet cell is blank, and blank on an
        // assumed metric is the declared whenNotRecorded assumption. A
        // captured value has no un-record on the wire — the engine's
        // assumption insertion triggers on absence alone and a recorded value
        // always wins — so the only way back is the same explicit amend the
        // stopwatch split uses for a corrected-away overfly: amend to the
        // assumed value under the auto reason, never the organiser's. The
        // walk reads the committed cells the event log shows, not the sheet's
        // visible rows, so a deselected option comes back even when its
        // flight row collapsed with it. The stopwatch pair stays owned by the
        // split (a cleared reading is not an undo).
        const groupCompetitors = new Set(group.competitorRefs.map((c) => c.value))
        const assumedByMetric = new Map(
          rg.grid.columns
            .filter((c) => c.whenNotRecorded !== undefined && c.stopwatchRole === undefined)
            .map((c) => [c.metric, c] as const),
        )
        for (const [wireKey, cell] of Object.entries(rebuilt.cells)) {
          const parts = cellParts(wireKey)
          if (!groupCompetitors.has(parts.competitorId)) continue
          const row = rowByCompetitor.get(parts.competitorId)
          if (row === undefined) continue
          const col = assumedByMetric.get(parts.metric)
          if (!col) continue
          const sheetKey = sheetCellKey(round.ordinal, row, parts.flightSequence, parts.metric)
          if ((sheet.cells[sheetKey] ?? '').trim()) continue
          const assumed = col.whenNotRecorded as MeasuredValue
          if (sameMeasurement(cell.value, assumed, col)) {
            counts.unchanged++
            continue
          }
          if (taskRound.state === 'Complete') needReopen = true
          captureState.queue.push(
            ...chainCommands(
              wireKey,
              parts.competitorId,
              parts.flightSequence,
              parts.metric,
              assumed,
              captureState.entries,
              nextCommandId,
              { reason: CORRECTION_REASON },
            ),
          )
        }
      await pumpGroup(api, captureState, { competitionId, cdName, counts })
      }
      if (notDrawnHere.size > 0) {
        emit({
          step: 'capture',
          label: `Round ${round.ordinal}: ${[...notDrawnHere].join(', ')} not drawn into this round`,
          status: 'warn',
          detail: 'The drawn schedule is immutable for this MVP — their cells are skipped.',
        })
      }
      if (notRegisteredHere.size > 0) {
        emit({
          step: 'capture',
          label: `Round ${round.ordinal}: ${[...notRegisteredHere].join(', ')} not registered — cells skipped`,
          status: 'warn',
          detail: 'The field froze when the draw was accepted; their numbers stay uncommitted sheet text.',
        })
      }
      if (needReopen && taskRound.state === 'Complete') {
        try {
          await api.reopenTaskRound({
            competitionRef: competitionId,
            phaseOrdinal: phase.ordinal,
            roundOrdinal: round.ordinal,
            taskRoundOrdinal: taskRound.ordinal,
            reason: REOPEN_REASON,
          })
          reopened = true
        } catch (error) {
          emit({
            step: 'capture',
            label: `Reopening round ${round.ordinal} failed`,
            status: 'warn',
            detail: errorDetail(error),
          })
        }
      }
      if (taskRound.state !== 'Complete' || reopened) {
        try {
          const recording = (
            await api.getTaskRoundRecording({
              competitionRef: competitionId,
              phaseOrdinal: phase.ordinal,
              roundOrdinal: round.ordinal,
              taskRoundOrdinal: taskRound.ordinal,
            })
          ).value
          const labelForMetric = (metric: string): string =>
            rg.grid.columns.find((c) => c.metric === metric)?.label ?? metric
          const { count: gaps, detail: gapDetail } = recordingGaps(recording, names, labelForMetric)
          if (gaps > 0) {
            emit({
              step: 'complete',
              label: `Round ${round.ordinal} left open — ${gaps} gap(s)`,
              status: 'warn',
              detail: gapDetail,
            })
          } else {
            await api.completeTaskRound({
              competitionRef: competitionId,
              phaseOrdinal: phase.ordinal,
              roundOrdinal: round.ordinal,
              taskRoundOrdinal: taskRound.ordinal,
            })
            emit({ step: 'complete', label: `Round ${round.ordinal} complete`, status: 'ok' })
          }
        } catch (error) {
          emit({
            step: 'complete',
            label: `Completing round ${round.ordinal} was refused`,
            status: 'warn',
            detail: errorDetail(error),
          })
        }
      }
    }
  }

  // --- 8 · refresh schedule states for the results block ---
  try {
    const fresh = (await api.getCompetition(competitionId)).value
    schedule.length = 0
    for (const round of fresh.competition.phases[0]?.rounds ?? []) {
      for (const taskRound of round.taskRounds) {
        schedule.push({
          phaseOrdinal: fresh.competition.phases[0].ordinal,
          roundOrdinal: round.ordinal,
          taskRoundOrdinal: taskRound.ordinal,
          taskRef: taskRound.taskRef,
          state: taskRound.state,
        })
      }
    }
  } catch {
    // schedule from the earlier fold is good enough for display
  }

  report.ok = counts.failed === 0 && cellErrors.length === 0
  emit({
    step: 'done',
    label: report.ok ? 'Sheet calculated' : 'Calculated with errors',
    status: report.ok ? 'ok' : 'warn',
    detail: [
      `${counts.captured} captured`,
      `${counts.amended} amended`,
      `${counts.unchanged} unchanged`,
      counts.penalties ? `${counts.penalties} penalty(s) recorded` : '',
      counts.skippedNotDrawn ? `${counts.skippedNotDrawn} not drawn this round` : '',
      counts.skippedNotRegistered ? `${counts.skippedNotRegistered} not registered (field frozen)` : '',
      counts.failed ? `${counts.failed} failed` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  })
  return report
}
