import type {
  ClassDefinition,
  Parameter,
  ParameterBindingFold,
} from '../api/types'
import { asNumber } from '../api/types'
import { taskByRef } from '../grid/schema'
import { parseParamInput, sheetRoundGrids } from './sheet'

/** One round whose task's resolvable `group.minPerGroup` exceeds the named
 * field — the draw will refuse it. Purely definition-driven (law 3): the
 * source of truth is each visible round's `taskRef` → `TaskDefinition.group`
 * (`GroupConstraint.minPerGroup`, a `NumberOrParam` narrowed locally exactly
 * like `workingTimeView`). */
export interface FieldSizeWarning {
  roundOrdinal: number
  taskRef: string
  min: number
  pilotCount: number
}

/** Friendly prefix for an arrived `drawPhase.fieldTooSmall` refusal — the
 * engine `code: detail` stays visible underneath (law 1). */
export const TOO_FEW_PILOTS_PREFIX = 'Too few pilots for the draw — '

export function formatFieldSizeWarning(w: FieldSizeWarning): string {
  return `Round ${w.roundOrdinal} (${w.taskRef}) needs at least ${w.min} pilots to draw — the sheet names ${w.pilotCount}. Add pilots or the draw will be refused.`
}

/** Narrow one task's `group.minPerGroup` (`NumberOrParam`, typed `unknown`
 * by the generated client): a number literal as-is, a numeric string via
 * `Number`, a `{ param }` reference via that round's scoped binding → an
 * unscoped binding → the sheet's parameter text → the declared default (the
 * same chain as `resolveWorkingTime`). Anything unresolvable (unbound, no
 * default, non-numeric) is `undefined` — skip the hint for that round. */
export function resolveMinPerGroup(
  raw: unknown,
  params: Parameter[],
  paramText: Record<string, string>,
  bindings: ParameterBindingFold[],
  phaseOrdinal: number,
  roundOrdinal: number,
): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'string') {
    if (raw.trim() === '') return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  if (raw && typeof raw === 'object' && 'param' in raw) {
    const name = (raw as { param: unknown }).param
    if (typeof name !== 'string' || name === '') return undefined
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
  return undefined
}

/** Per-round field-size warnings, strictest first: each visible round's
 * `taskRef` (via `sheetRoundGrids`) → its task's `group.minPerGroup`, warned
 * when the resolvable minimum exceeds the named-sheet-row count (the count
 * the orchestrator will draw with). Unresolvable minima and satisfied rounds
 * produce nothing; the engine error still rules. */
export function fieldSizeWarnings(
  definition: ClassDefinition,
  rounds: number,
  taskPicks: Record<number, string>,
  pilots: { name: string }[],
  paramText: Record<string, string>,
  bindings: ParameterBindingFold[] = [],
  phaseOrdinal = 0,
): FieldSizeWarning[] {
  const pilotCount = pilots.filter((p) => p.name.trim()).length
  const params = definition.parameters ?? []
  const out: FieldSizeWarning[] = []
  for (const rg of sheetRoundGrids(definition, rounds, taskPicks)) {
    const task = taskByRef(definition, rg.taskRef)
    const min = resolveMinPerGroup(
      task?.group?.minPerGroup,
      params,
      paramText,
      bindings,
      phaseOrdinal,
      rg.roundOrdinal,
    )
    if (min === undefined || !(pilotCount < min)) continue
    out.push({ roundOrdinal: rg.roundOrdinal, taskRef: rg.taskRef, min, pilotCount })
  }
  out.sort((a, b) => b.min - a.min || a.roundOrdinal - b.roundOrdinal)
  return out
}
