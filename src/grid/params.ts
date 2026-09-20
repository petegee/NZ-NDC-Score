import type { ClassDefinition, MeasuredValue, ParameterBindingFold } from '../api/types'
import type { NumberOrParam } from './schema'

export type BindingMap = ReadonlyMap<string, MeasuredValue>

export function bindingMap(bindings: ParameterBindingFold[] | undefined): BindingMap {
  return new Map((bindings ?? []).map((b) => [b.parameterName, b.boundValue]))
}

export interface ParamInfo {
  name: string
  kind: 'Number' | 'Flag' | undefined
  unit?: string
  defaultValue?: MeasuredValue
  allowedValues: MeasuredValue[]
  boundAt: 'CompetitionSetup' | 'BeforeFlying' | 'PerRound'
}

export function parametersOf(definition: ClassDefinition): ParamInfo[] {
  return (definition.parameters ?? []).map((p) => ({
    name: p.name,
    kind: p.kind,
    unit: p.unit ?? undefined,
    defaultValue: p.defaultValue ?? undefined,
    allowedValues: p.allowedValues ?? [],
    boundAt: p.boundAt ?? 'CompetitionSetup',
  }))
}

export type ParamResolution =
  | { state: 'bound'; value: MeasuredValue }
  | { state: 'default'; value: MeasuredValue }
  | { state: 'unbound' }

export function resolveParam(name: string, definition: ClassDefinition, bound: BindingMap): ParamResolution {
  const fromBinding = bound.get(name)
  if (fromBinding) return { state: 'bound', value: fromBinding }
  const info = parametersOf(definition).find((p) => p.name === name)
  if (info?.defaultValue) return { state: 'default', value: info.defaultValue }
  return { state: 'unbound' }
}

/** Resolve a NumberOrParam against bindings: literal → itself; ref → the
 * bound value's number when bound, otherwise the named param is unbound. */
export function resolveNumberOrParam(
  v: NumberOrParam,
  bound: BindingMap,
): { state: 'resolved'; value: number } | { state: 'unbound'; param: string } {
  if (typeof v === 'number') return { state: 'resolved', value: v }
  const mv = bound.get(v.param)
  const n = mv?.kind === 'Number' ? mv.number : undefined
  const num = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : undefined
  if (num !== undefined && Number.isFinite(num)) return { state: 'resolved', value: num }
  return { state: 'unbound', param: v.param }
}
