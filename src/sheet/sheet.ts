import type {
  ClassDefinition,
  MeasuredValue,
  Parameter,
  ParameterBindingFold,
  TaskTiming,
} from '../api/types'
import { asNumber } from '../api/types'
import { parseCellText } from '../grid/parse'
import { DEFAULT_TAPE, LANDING_METRIC, isValidTapeReading, tapeReadingError, type TapeChoice } from './tapes'
import {
  defaultRounds,
  formatMaxFlightHint,
  formatWindowHint,
  perFlightCaps,
  phaseSetupInfo,
  taskByRef,
  taskGridFor,
  type FlightRowSpec,
  type TaskGridSchema,
} from '../grid/schema'

/** The whole product is one document: the sheet. Header inputs, pilot rows
 * and free cell text — nothing here is a command until Calculate. */
export interface PilotRow {
  name: string
  mfnz: string
  email: string
}

export interface SheetState {
  classContentHash: string | null
  classDefinition: ClassDefinition | null
  location: string
  date: string
  cdName: string
  rounds: number
  /** Provisional tape choice — F3J pre-selected on fresh sheets (owner call).
   * The wire catalogue (`ss_tape-catalogue-on-the-wire`) replaces this source. */
  tapeChoice: TapeChoice
  /** Per-round task choice for catalogue rounds — index is round-1. */
  taskPicks: Record<number, string>
  /** Raw header-block text per parameter name (setup / before-flying / per-round). */
  params: Record<string, string>
  pilots: PilotRow[]
  /** Cell text by sheet key `r<round>|p<pilotRow>|f<flight>|<metric>`. */
  cells: Record<string, string>
}

export const sheetCellKey = (
  roundOrdinal: number,
  pilotRow: number,
  flightSequence: number,
  metric: string,
): string => `r${roundOrdinal}|p${pilotRow}|f${flightSequence}|${metric}`

export const sheetCellParts = (
  key: string,
): { roundOrdinal: number; pilotRow: number; flightSequence: number; metric: string } => {
  const [r, p, f, metric] = key.split('|')
  return {
    roundOrdinal: Number(r.slice(1)),
    pilotRow: Number(p.slice(1)),
    flightSequence: Number(f.slice(1)),
    metric,
  }
}

export function initialSheet(): SheetState {
  return {
    classContentHash: null,
    classDefinition: null,
    location: '',
    date: '',
    cdName: '',
    rounds: 1,
    tapeChoice: DEFAULT_TAPE,
    taskPicks: {},
    params: {},
    pilots: emptyPilots(10),
    cells: {},
  }
}

/** A fresh sheet opens with this many rows, like the paper scoresheet's
 * printed pilot list; the Contest panel's Pilots input resizes the field. */
export const DEFAULT_PILOT_ROWS = 10

export function emptyPilots(n: number): PilotRow[] {
  return Array.from({ length: Math.max(1, n) }, () => ({ name: '', mfnz: '', email: '' }))
}

export type SheetAction =
  | { type: 'setField'; field: 'location' | 'date' | 'cdName'; value: string }
  | { type: 'setRounds'; rounds: number }
  | { type: 'setTapeChoice'; choice: TapeChoice }
  | { type: 'setTaskPick'; roundIndex: number; taskRef: string }
  | { type: 'setParam'; name: string; text: string }
  | { type: 'setPilot'; index: number; patch: Partial<PilotRow> }
  | { type: 'setPilotCount'; count: number }
  | { type: 'setCell'; key: string; text: string }
  | { type: 'classChosen'; contentHash: string; definition: ClassDefinition }
  | { type: 'replace'; state: SheetState }

function pruneCellsBeyond(
    cells: Record<string, string>,
    rounds: number,
  ): Record<string, string> {
    const kept: Record<string, string> = {}
    for (const [key, text] of Object.entries(cells)) {
      if (sheetCellParts(key).roundOrdinal <= rounds) kept[key] = text
    }
    return kept
  }

function pruneCellsBeyondPilots(
    cells: Record<string, string>,
    pilots: number,
  ): Record<string, string> {
    const kept: Record<string, string> = {}
    for (const [key, text] of Object.entries(cells)) {
      if (sheetCellParts(key).pilotRow <= pilots) kept[key] = text
    }
    return kept
  }

export function sheetReducer(state: SheetState, action: SheetAction): SheetState {
  switch (action.type) {
    case 'setField':
      return { ...state, [action.field]: action.value }
    case 'setRounds': {
      const rounds = Math.max(1, Math.floor(action.rounds) || 1)
      return { ...state, rounds, cells: pruneCellsBeyond(state.cells, rounds) }
    }
    case 'setTapeChoice':
      return { ...state, tapeChoice: action.choice }
    case 'setTaskPick':
      return { ...state, taskPicks: { ...state.taskPicks, [action.roundIndex]: action.taskRef } }
    case 'setParam':
      return { ...state, params: { ...state.params, [action.name]: action.text } }
    case 'setPilot': {
      const pilots = state.pilots.map((p, i) => (i === action.index ? { ...p, ...action.patch } : p))
      return { ...state, pilots }
    }
    case 'setPilotCount': {
      // The field size is decided up front (Contest panel) and cannot change
      // once the sheet is scored — the draw freezes it service-side anyway.
      // Row numbers are cell identity: shrinking drops every cell below the
      // line (the same rule as setRounds), growing lays blank rows back on.
      const count = Math.max(1, Math.floor(action.count) || 1)
      const pilots =
        count <= state.pilots.length
          ? state.pilots.slice(0, count)
          : [...state.pilots, ...emptyPilots(count - state.pilots.length)]
      return { ...state, pilots, cells: pruneCellsBeyondPilots(state.cells, count) }
    }
    case 'setCell':
      return { ...state, cells: { ...state.cells, [action.key]: action.text } }
    case 'classChosen': {
      // Adopting a class re-templates the whole sheet from the definition —
      // columns, tasks, penalties, and the round count with them. A count
      // kept from the previous class silently under-draws, and the service
      // can only refuse counts above the new class's maximum, never the
      // stale-below case. Cells beyond the new count go with it (the same
      // rule as setRounds); task picks are class-specific codes.
      const phase = phaseSetupInfo(action.definition, 0)
      const rounds = phase ? defaultRounds(phase) : 1
      return {
        ...state,
        classContentHash: action.contentHash,
        classDefinition: action.definition,
        rounds,
        taskPicks: {},
        cells: pruneCellsBeyond(state.cells, rounds),
      }
    }
    case 'replace':
      return action.state
  }
}

const SHEET_STORAGE_KEY = 'ndcscore.sheet.v1'

export function loadSheet(): SheetState {
  try {
    const raw = localStorage.getItem(SHEET_STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<SheetState> & { contestName?: string }
      // The contest name field is gone (bug #4): a draft saved before the
      // change must not resurrect the removed field.
      delete saved.contestName
      // Drafts saved before the provisional tape choice, or with the removed
      // distances-only option, fall back to the F3J default (owner call).
      // Tape-measure is Reading == UpTo identity, so old distance entries on
      // the cm grid revalidate as tape-measure readings.
      if (saved.tapeChoice === undefined || saved.tapeChoice === null) saved.tapeChoice = DEFAULT_TAPE
      return { ...initialSheet(), ...saved }
    }
  } catch {
    // unreadable draft — start fresh
  }
  return initialSheet()
}

export function saveSheet(state: SheetState): void {
  try {
    localStorage.setItem(SHEET_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage unavailable — in-memory only
  }
}

// --- grid shape (derived only — law 3) ---

export interface SheetRoundGrid {
  roundOrdinal: number
  taskRef: string
  grid: TaskGridSchema
  /** PerRound parameters this round's task consumes (name suffix convention). */
  perRoundParams: Parameter[]
}

export function phaseRoundsKind(definition: ClassDefinition): string {
  return phaseSetupInfo(definition, 0)?.rounds?.kind ?? 'FixedSequence'
}

export function phaseTasks(definition: ClassDefinition): { code: string; name: string }[] {
  return phaseSetupInfo(definition, 0)?.tasks ?? []
}

export function paramsBoundAt(definition: ClassDefinition, at: Parameter['boundAt']): Parameter[] {
  return (definition.parameters ?? []).filter((p) => (p.boundAt ?? 'CompetitionSetup') === at)
}

/** `workingTime.B` consumes rounds whose task is `B`; a bare name consumes every round. */
export function paramConsumedByTask(param: Parameter, taskRef: string): boolean {
  const dot = param.name.lastIndexOf('.')
  return dot < 0 || param.name.slice(dot + 1) === taskRef
}

function perRoundParamsFor(definition: ClassDefinition, taskRef: string): Parameter[] {
  return paramsBoundAt(definition, 'PerRound').filter((p) => paramConsumedByTask(p, taskRef))
}

/** Resolve a `{ param }` reference through the bound value (this round's
 * scoped binding, then an unscoped one), then the sheet's parameter input
 * (declared default and blank rules apply). Shared by working-time and
 * max-flight resolution — one chain, never class-branched. */
function resolveParamReference(
  name: string,
  params: Parameter[],
  paramText: Record<string, string>,
  bindings: ParameterBindingFold[],
  phaseOrdinal: number,
  roundOrdinal: number,
): number | undefined {
  const sameParam = (b: ParameterBindingFold): boolean => b.parameterName === name
  const scoped = bindings.find(
    (b) => sameParam(b) && b.phaseOrdinal === phaseOrdinal && b.roundOrdinal === roundOrdinal,
  )
  const unscoped = bindings.find(
    (b) => sameParam(b) && b.phaseOrdinal == null && b.roundOrdinal == null,
  )
  for (const bound of [scoped?.boundValue, unscoped?.boundValue]) {
    if (!bound) continue
    const n = asNumber(bound)
    if (n !== undefined && Number.isFinite(n) && n > 0) return n
  }
  const param = params.find((p) => p.name === name)
  if (!param) return undefined
  const parsed = parseParamInput(param, paramText[name] ?? '')
  if (!parsed.ok) return undefined
  const n = asNumber(parsed.value)
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined
}

/** Resolve one raw `NumberOrParam` (literal, numeric string, or `{ param }`)
 * to seconds. Unresolvable (unbound param, no default, non-positive) yields
 * undefined — the caller shows no hint and the engine still rules. */
function resolveNumberOrParam(
  raw: unknown,
  params: Parameter[],
  paramText: Record<string, string>,
  bindings: ParameterBindingFold[],
  phaseOrdinal: number,
  roundOrdinal: number,
): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : undefined
  if (typeof raw === 'string') {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  if (typeof raw === 'object' && 'param' in raw) {
    const name = (raw as { param: unknown }).param
    if (typeof name !== 'string') return undefined
    return resolveParamReference(name, params, paramText, bindings, phaseOrdinal, roundOrdinal)
  }
  return undefined
}
/** The task's effective working time in seconds — what the stopwatch split
 * divides at. A declared literal is used as-is; a parameter reference
 * resolves from the bound value (this round's scoped binding, then an
 * unscoped one), then the sheet's parameter input (declared default and
 * blank rules apply). A working time that resolves to nothing usable leaves
 * the split undefined — the capture step reports it per cell. */
export function resolveWorkingTime(
  timing: TaskTiming,
  params: Parameter[],
  paramText: Record<string, string>,
  bindings: ParameterBindingFold[],
  phaseOrdinal: number,
  roundOrdinal: number,
): number | undefined {
  return resolveNumberOrParam(
    timing.workingTime as unknown,
    params,
    paramText,
    bindings,
    phaseOrdinal,
    roundOrdinal,
  )
}

/** The task's effective max flight in seconds — the most restrictive
 * resolvable per-flight rate cap (`perFlightCaps`). Unresolvable caps are
 * skipped; none resolvable yields undefined (no hint, engine still rules). */
export function resolveMaxFlight(
  taskRef: string,
  definition: ClassDefinition,
  params: Parameter[],
  paramText: Record<string, string>,
  bindings: ParameterBindingFold[],
  phaseOrdinal: number,
  roundOrdinal: number,
): number | undefined {
  const task = taskByRef(definition, taskRef)
  if (!task) return undefined
  let best: number | undefined
  for (const cap of perFlightCaps(task)) {
    const n = resolveNumberOrParam(cap as unknown, params, paramText, bindings, phaseOrdinal, roundOrdinal)
    if (n !== undefined && (best === undefined || n < best)) best = n
  }
  return best
}

/** The round header's faint time hint — the working-time window plus the
 * max flight, e.g. "10 min window · 2 min max" (F3K task G: 600 s window,
 * 120 s per-flight rate cap). The window is the same value the stopwatch
 * split divides at; the max is the most restrictive resolvable per-flight
 * rate cap. Each side resolves from the round's per-round params plus the
 * sheet's parameter text and declared defaults only — the competition
 * fold's parameter bindings are unavailable on the static grid before
 * Calculate, so scoped/unscoped bindings are skipped here (documented
 * choice). A side that resolves to nothing usable shows nothing; neither
 * side resolvable yields no hint. Display only (law 2); derived, never
 * class-branched (law 3). */
export function roundTimeHint(
  definition: ClassDefinition,
  rg: SheetRoundGrid,
  paramText: Record<string, string>,
): string | undefined {
  const window = resolveWorkingTime(rg.grid.timing, rg.perRoundParams, paramText, [], 0, rg.roundOrdinal)
  const max = resolveMaxFlight(rg.taskRef, definition, rg.perRoundParams, paramText, [], 0, rg.roundOrdinal)
  const parts: string[] = []
  if (window !== undefined) parts.push(formatWindowHint(window))
  if (max !== undefined) parts.push(formatMaxFlightHint(max))
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function sheetRoundGrids(
  definition: ClassDefinition,
  rounds: number,
  taskPicks: Record<number, string>,
): SheetRoundGrid[] {
  const phase = phaseSetupInfo(definition, 0)
  if (!phase) return []
  const catalogue = phaseRoundsKind(definition) === 'ChooseFromCatalogue'
  const tasks = phase.tasks
  const out: SheetRoundGrid[] = []
  for (let i = 0; i < rounds; i++) {
    const taskRef = catalogue
      ? taskPicks[i] ?? tasks[i % Math.max(tasks.length, 1)]?.code ?? ''
      : tasks[0]?.code ?? ''
    const grid = taskRef ? taskGridFor(definition, taskRef) : undefined
    if (!grid) continue
    out.push({
      roundOrdinal: i + 1,
      taskRef,
      grid,
      perRoundParams: perRoundParamsFor(definition, taskRef),
    })
  }
  return out
}

/** Flight rows visible for one pilot in one round: fixed rows always; for a
 * dynamic (`all`-without-maxLaunches) task, a row appears when the previous
 * flight row for that pilot carries any text. */
export function visibleFlightRows(
  grid: TaskGridSchema,
  roundOrdinal: number,
  pilotRow: number,
  cells: Record<string, string>,
): FlightRowSpec[] {
  const hasText = (sequence: number) =>
    Object.entries(cells).some(([key, text]) => {
      if (!text.trim()) return false
      const parts = sheetCellParts(key)
      return (
        parts.roundOrdinal === roundOrdinal &&
        parts.pilotRow === pilotRow &&
        parts.flightSequence === sequence
      )
    })
  const rows: FlightRowSpec[] = []
  const base = grid.flightRows
  const dynamic = base.some((r) => r.dynamic)
  const limit = dynamic ? 20 : base.length
  for (let i = 0; i < limit; i++) {
    const spec = base[i] ?? { sequence: i + 1, label: `Flight ${i + 1}`, dynamic: true }
    if (i === 0 || !dynamic || hasText(i)) rows.push(spec)
    else break
  }
  return rows
}

// --- penalties (one column per round, multi-select from the class) ---

/** The virtual metric under which a round's penalty text is stored — not a
 * measured column, never captured as a measurement. */
export const PENALTIES_METRIC = 'penalties'

/** The cell key for a round's penalty column: flight sequence is 1 — the
 * column spans every flight row. */
export const sheetPenaltyKey = (roundOrdinal: number, pilotRow: number): string =>
  sheetCellKey(roundOrdinal, pilotRow, 1, PENALTIES_METRIC)

/** The wire form: comma-separated infraction types. */
export function parsePenaltyText(text: string): string[] {
  const seen = new Set<string>()
  for (const part of text.split(',')) {
    const t = part.trim()
    if (t) seen.add(t)
  }
  return [...seen]
}

export interface PenaltyOption {
  infractionType: string
  label: string
}

/** The dropdown's options — exactly what the adopted class declares, with a
 * humanised label. An infraction declared more than once (e.g. per accrual
 * scope) lists once. */
export function penaltyOptions(definition: ClassDefinition): PenaltyOption[] {
  const seen = new Set<string>()
  const out: PenaltyOption[] = []
  for (const p of definition.penalties ?? []) {
    if (seen.has(p.infractionType)) continue
    seen.add(p.infractionType)
    out.push({
      infractionType: p.infractionType,
      label: humanisePenalty(p.infractionType),
    })
  }
  return out
}

function humanisePenalty(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

// --- parameter text helpers ---

export function paramPlaceholder(param: Parameter): string {
  const d = param.defaultValue
  if (!d) return param.kind === 'Flag' ? 'n' : param.kind === 'Number' ? '0' : ''
  return d.kind === 'Number' ? String(d.number ?? '') : d.flag ? 'y' : 'n'
}

export type ParamParse =
  | { ok: true; value: MeasuredValue }
  | { ok: false; error: string }
  | { ok: false; error: 'blank'; default: MeasuredValue | null }

/** Parse a parameter input. Blank falls back to the declared default; a
 * declared allowedValues list is enforced when present. */
export function parseParamInput(
  param: Parameter,
  text: string,
): { ok: true; value: MeasuredValue } | { ok: false; error: string; blank: boolean } {
  const kind = param.kind ?? 'Number'
  const parse = parseCellText(text, kind, param.unit ?? undefined)
  if (!parse.ok) {
    if (parse.error === 'blank') {
      const d = param.defaultValue
      if (d) return { ok: true, value: d }
      // No declared default: the sheet resolves the parameter's kind to its
      // zero value — a flag is off, a number is 0 — so NDC sheets bind
      // without typing (e.g. carryPenalties=n, flyoffSize=0).
      if (kind === 'Flag') return { ok: true, value: { kind: 'Flag', flag: false } }
      if (kind === 'Number') return { ok: true, value: { kind: 'Number', number: 0 } }
      return { ok: false, error: `${param.name} is required`, blank: true }
    }
    return { ok: false, error: `${param.name}: ${parse.error}`, blank: false }
  }
  const allowed = param.allowedValues ?? []
  if (allowed.length > 0) {
    const match = allowed.some((a) =>
      a.kind !== parse.value.kind
        ? false
        : a.kind === 'Flag'
          ? a.flag === parse.value.flag
          : Number(a.number) === Number(parse.value.number),
    )
    if (!match) {
      return {
        ok: false,
        error: `${param.name} must be one of: ${allowed
          .map((a) => (a.kind === 'Flag' ? (a.flag ? 'y' : 'n') : String(a.number)))
          .join(', ')}`,
        blank: false,
      }
    }
  }
  return { ok: true, value: parse.value }
}

// --- validation ---

export interface CellParseProblem {
  key: string
  error: string
}

export interface SheetValidation {
  ok: boolean
  problems: string[]
  cellErrors: CellParseProblem[]
}

export function validateSheet(state: SheetState): SheetValidation {
  const problems: string[] = []
  const cellErrors: CellParseProblem[] = []
  const definition = state.classDefinition

  if (!definition || !state.classContentHash) problems.push('Pick the adopted class first.')
  if (!state.location.trim()) problems.push('Location is required.')
  if (!state.date.trim()) problems.push('Date is required.')
  if (!state.cdName.trim()) problems.push('CD name is required (it signs the commands).')

  const pilots = state.pilots.map((p, i) => ({ row: p, index: i })).filter((p) => p.row.name.trim())
  if (pilots.length === 0) problems.push('At least one pilot row needs a name.')
  const seen = new Map<string, number>()
  for (const { row, index } of pilots) {
    const key = row.name.trim().toLowerCase()
    const first = seen.get(key)
    if (first !== undefined) problems.push(`Pilot name duplicated on rows ${first + 1} and ${index + 1}.`)
    else seen.set(key, index)
  }

  const roundGrids = definition ? sheetRoundGrids(definition, state.rounds, state.taskPicks) : []
  for (const [key, text] of Object.entries(state.cells)) {
    if (!text.trim()) continue
    const parts = sheetCellParts(key)
    const rg = roundGrids.find((r) => r.roundOrdinal === parts.roundOrdinal)
    if (!rg) continue
    const col = rg.grid.columns.find((c) => c.metric === parts.metric)
    if (!col) continue
    // The stopwatch split owns the overfly metric — direct entry is stale
    // data from before the stopwatch column (or a hand edit) and is refused
    // with a pointer, never silently ignored.
    if (col.stopwatchRole === 'overfly') {
      cellErrors.push({
        key,
        error: `${col.label} is split from the stopwatch reading — clear this cell`,
      })
      continue
    }
    const parse = parseCellText(text, col.kind, col.unit)
    if (!parse.ok && parse.error !== 'blank') {
      cellErrors.push({ key, error: parse.error })
      continue
    }
    // Provisional tape gate: landing readings must be exact members of the
    // chosen tape's reading set (what the server enforces as
    // `captureMeasurement.readingNotOnScale`) — readings only, never points.
    if (parse.ok && parts.metric === LANDING_METRIC && col.kind === 'Number') {
      const n = Number(parse.value.number)
      if (Number.isFinite(n) && !isValidTapeReading(state.tapeChoice, n)) {
        cellErrors.push({ key, error: tapeReadingError(state.tapeChoice, n) ?? 'not on the tape scale' })
      }
    }
  }
  if (definition) {
    const declared = new Set((definition.penalties ?? []).map((p) => p.infractionType))
    for (const [key, text] of Object.entries(state.cells)) {
      if (!text.trim()) continue
      const parts = sheetCellParts(key)
      if (parts.metric !== PENALTIES_METRIC) continue
      if (!roundGrids.some((r) => r.roundOrdinal === parts.roundOrdinal)) continue
      for (const t of parsePenaltyText(text)) {
        if (!declared.has(t)) problems.push(`Round ${parts.roundOrdinal}, row ${parts.pilotRow}: "${t}" is not an infraction declared by the adopted class.`)
      }
    }
  }
  for (const rg of roundGrids) {
    for (const param of rg.perRoundParams) {
      const parsed = parseParamInput(param, state.params[param.name] ?? '')
      if (!parsed.ok && !parsed.blank) problems.push(parsed.error)
    }
  }
  if (definition) {
    for (const param of [
      ...paramsBoundAt(definition, 'CompetitionSetup'),
      ...paramsBoundAt(definition, 'BeforeFlying'),
    ]) {
      const parsed = parseParamInput(param, state.params[param.name] ?? '')
      if (!parsed.ok && !parsed.blank) problems.push(parsed.error)
    }
  }

  return { ok: problems.length === 0, problems, cellErrors }
}
