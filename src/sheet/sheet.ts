import type { ClassDefinition, MeasuredValue, Parameter, PenaltyDefinition } from '../api/types'
import { parseCellText } from '../grid/parse'
import {
  defaultRounds,
  phaseSetupInfo,
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
  contestName: string
  location: string
  date: string
  cdName: string
  rounds: number
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
    contestName: '',
    location: '',
    date: '',
    cdName: '',
    rounds: 1,
    taskPicks: {},
    params: {},
    pilots: emptyPilots(10),
    cells: {},
  }
}

/** A fresh sheet opens with this many rows, like the paper scoresheet's
 * printed pilot list; the Add button appends more. */
export const DEFAULT_PILOT_ROWS = 10

export function emptyPilots(n: number): PilotRow[] {
  return Array.from({ length: Math.max(1, n) }, () => ({ name: '', mfnz: '', email: '' }))
}

export type SheetAction =
  | { type: 'setField'; field: 'contestName' | 'location' | 'date' | 'cdName'; value: string }
  | { type: 'setRounds'; rounds: number }
  | { type: 'setTaskPick'; roundIndex: number; taskRef: string }
  | { type: 'setParam'; name: string; text: string }
  | { type: 'setPilot'; index: number; patch: Partial<PilotRow> }
  | { type: 'addPilot' }
  | { type: 'removePilot'; index: number }
  | { type: 'setCell'; key: string; text: string }
  | { type: 'classChosen'; contentHash: string; definition: ClassDefinition }
  | { type: 'replace'; state: SheetState }

export function sheetReducer(state: SheetState, action: SheetAction): SheetState {
  switch (action.type) {
    case 'setField':
      return { ...state, [action.field]: action.value }
    case 'setRounds': {
      const rounds = Math.max(1, Math.floor(action.rounds) || 1)
      const cells: Record<string, string> = {}
      for (const [key, text] of Object.entries(state.cells)) {
        if (sheetCellParts(key).roundOrdinal <= rounds) cells[key] = text
      }
      return { ...state, rounds, cells }
    }
    case 'setTaskPick':
      return { ...state, taskPicks: { ...state.taskPicks, [action.roundIndex]: action.taskRef } }
    case 'setParam':
      return { ...state, params: { ...state.params, [action.name]: action.text } }
    case 'setPilot': {
      const pilots = state.pilots.map((p, i) => (i === action.index ? { ...p, ...action.patch } : p))
      return { ...state, pilots }
    }
    case 'addPilot':
      return { ...state, pilots: [...state.pilots, { name: '', mfnz: '', email: '' }] }
    case 'removePilot': {
      // Row numbers are cell identity — removing a row re-keys the rows below.
      const cells: Record<string, string> = {}
      for (const [key, text] of Object.entries(state.cells)) {
        const parts = sheetCellParts(key)
        if (parts.pilotRow === action.index + 1) continue
        const shifted =
          parts.pilotRow > action.index + 1
            ? sheetCellKey(parts.roundOrdinal, parts.pilotRow - 1, parts.flightSequence, parts.metric)
            : key
        cells[shifted] = text
      }
      return { ...state, pilots: state.pilots.filter((_, i) => i !== action.index), cells }
    }
    case 'setCell':
      return { ...state, cells: { ...state.cells, [action.key]: action.text } }
    case 'classChosen': {
      const phase = phaseSetupInfo(action.definition, 0)
      return {
        ...state,
        classContentHash: action.contentHash,
        classDefinition: action.definition,
        rounds: state.rounds > 1 ? state.rounds : phase ? defaultRounds(phase) : 1,
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
    if (raw) return { ...initialSheet(), ...(JSON.parse(raw) as Partial<SheetState>) }
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

function effectSummary(p: PenaltyDefinition): string {
  return p.effects
    .map((e) =>
      e.effect === 'DeductPoints'
        ? `−${'points' in e ? e.points : '?'} pts`
        : e.effect.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
    )
    .join(', ')
}

/** The dropdown's options — exactly what the adopted class declares, with a
 * humanised label and the declared effect as a hint. An infraction declared
 * more than once (e.g. per accrual scope) lists once. */
export function penaltyOptions(definition: ClassDefinition): PenaltyOption[] {
  const seen = new Set<string>()
  const out: PenaltyOption[] = []
  for (const p of definition.penalties ?? []) {
    if (seen.has(p.infractionType)) continue
    seen.add(p.infractionType)
    out.push({
      infractionType: p.infractionType,
      label: `${humanisePenalty(p.infractionType)} (${effectSummary(p)})`,
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
  if (!state.contestName.trim()) problems.push('Contest name is required.')
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
    const parse = parseCellText(text, col.kind, col.unit)
    if (!parse.ok && parse.error !== 'blank') {
      cellErrors.push({ key, error: parse.error })
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
    for (const param of paramsBoundAt(definition, 'CompetitionSetup')) {
      const parsed = parseParamInput(param, state.params[param.name] ?? '')
      if (!parsed.ok && !parsed.blank) problems.push(parsed.error)
    }
  }

  return { ok: problems.length === 0, problems, cellErrors }
}
