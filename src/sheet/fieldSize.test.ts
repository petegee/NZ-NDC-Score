import { describe, expect, it } from 'vitest'
import type { ClassDefinition, Parameter, ParameterBindingFold } from '../api/types'
import { ApiError } from '../api/wire'
import f3kFixture from '../test/fixtures/85b-nz-f3k-ndc.json'
import f5jFixture from '../test/fixtures/85c-nz-f5j-ndc.json'
import { drawFailureDetail } from './calculate'
import {
  fieldSizeWarnings,
  formatFieldSizeWarning,
  resolveMinPerGroup,
  TOO_FEW_PILOTS_PREFIX,
} from './fieldSize'

const f3k = f3kFixture as unknown as ClassDefinition
const f5j = f5jFixture as unknown as ClassDefinition

const pilots = (names: string[]): { name: string }[] => names.map((name) => ({ name }))

function binding(
  parameterName: string,
  n: number,
  phaseOrdinal: number | null = null,
  roundOrdinal: number | null = null,
): ParameterBindingFold {
  return {
    parameterName,
    boundValue: { kind: 'Number', number: n },
    by: 'CD',
    at: '2026-09-19T00:00:00Z',
    phaseOrdinal,
    roundOrdinal,
  }
}

/** A clone of the F3K definition whose task B minimum is the `{ param }`
 * reference under test, declared by the extra parameter. */
function paramMinDef(extra: Parameter): ClassDefinition {
  const def = structuredClone(f3k) as unknown as ClassDefinition
  const taskB = def.phases[0].tasks.find((t) => t.code === 'B')!
  taskB.group = { minPerGroup: { param: extra.name } }
  def.parameters = [...(def.parameters ?? []), extra]
  return def
}

const minFieldParam: Parameter = {
  name: 'minField',
  kind: 'Number',
  boundAt: 'CompetitionSetup',
  defaultValue: { kind: 'Number', number: 7 },
} as unknown as Parameter

describe('fieldSizeWarnings', () => {
  it('warns the exact organiser copy for a single-pilot F3K task-B round', () => {
    const warnings = fieldSizeWarnings(f3k, 1, { 0: 'B' }, pilots(['Ana Silva']), {})
    expect(warnings).toEqual([{ roundOrdinal: 1, taskRef: 'B', min: 5, pilotCount: 1 }])
    expect(formatFieldSizeWarning(warnings[0])).toBe(
      'Round 1 (B) needs at least 5 pilots to draw — the sheet names 1. Add pilots or the draw will be refused.',
    )
  })

  it('stays silent when the field satisfies every round (F3K and F5J fixtures)', () => {
    expect(
      fieldSizeWarnings(f3k, 1, { 0: 'B' }, pilots(['A', 'B', 'C', 'D', 'E']), {}),
    ).toEqual([])
    // F5J task D carries minPerGroup 6.
    expect(
      fieldSizeWarnings(f5j, 1, {}, pilots(['A', 'B', 'C', 'D', 'E', 'F']), {}),
    ).toEqual([])
  })

  it('warns the F5J minimum of 6 against five pilots', () => {
    const warnings = fieldSizeWarnings(f5j, 1, {}, pilots(['A', 'B', 'C', 'D', 'E']), {})
    expect(warnings).toEqual([{ roundOrdinal: 1, taskRef: 'D', min: 6, pilotCount: 5 }])
  })

  it('lists one line per violating round, strictest first', () => {
    const def = structuredClone(f3k) as unknown as ClassDefinition
    def.phases[0].tasks.find((t) => t.code === 'D')!.group = { minPerGroup: 8 }
    const warnings = fieldSizeWarnings(
      def,
      2,
      { 0: 'B', 1: 'D' },
      pilots(['A', 'B', 'C', 'D']),
      {},
    )
    expect(warnings.map((w) => w.roundOrdinal)).toEqual([2, 1])
    expect(warnings.map((w) => w.min)).toEqual([8, 5])
  })

  it('resolves a numeric-string minimum', () => {
    const def = structuredClone(f3k) as unknown as ClassDefinition
    def.phases[0].tasks.find((t) => t.code === 'B')!.group = { minPerGroup: '6' }
    expect(fieldSizeWarnings(def, 1, { 0: 'B' }, pilots(['A', 'B', 'C', 'D', 'E']), {})).toEqual([
      { roundOrdinal: 1, taskRef: 'B', min: 6, pilotCount: 5 },
    ])
  })

  it('resolves a { param } minimum from sheet text, then the declared default', () => {
    const def = paramMinDef(minFieldParam)
    const one = pilots(['Ana Silva'])
    expect(fieldSizeWarnings(def, 1, { 0: 'B' }, one, { minField: '6' })).toEqual([
      { roundOrdinal: 1, taskRef: 'B', min: 6, pilotCount: 1 },
    ])
    expect(fieldSizeWarnings(def, 1, { 0: 'B' }, one, {})).toEqual([
      { roundOrdinal: 1, taskRef: 'B', min: 7, pilotCount: 1 },
    ])
  })

  it('prefers the scoped binding, then the unscoped one', () => {
    const def = paramMinDef(minFieldParam)
    const one = pilots(['Ana Silva'])
    const scoped = fieldSizeWarnings(def, 1, { 0: 'B' }, one, {}, [binding('minField', 4, 0, 1)])
    expect(scoped).toEqual([{ roundOrdinal: 1, taskRef: 'B', min: 4, pilotCount: 1 }])
    const unscoped = fieldSizeWarnings(
      def,
      1,
      { 0: 'B' },
      one,
      {},
      [binding('minField', 9), binding('minField', 4, 0, 2)],
    )
    expect(unscoped).toEqual([{ roundOrdinal: 1, taskRef: 'B', min: 9, pilotCount: 1 }])
  })

  it('skips rounds whose minimum is unresolvable', () => {
    // No such parameter declared anywhere.
    const def = structuredClone(f3k) as unknown as ClassDefinition
    def.phases[0].tasks.find((t) => t.code === 'B')!.group = {
      minPerGroup: { param: 'nope' },
    }
    expect(fieldSizeWarnings(def, 1, { 0: 'B' }, pilots(['Ana Silva']), {})).toEqual([])
    // Declared but unbound with no default and blank sheet text.
    const noDefault: Parameter = { name: 'minField', kind: 'Number' } as unknown as Parameter
    expect(
      fieldSizeWarnings(paramMinDef(noDefault), 1, { 0: 'B' }, pilots(['Ana Silva']), {}),
    ).toEqual([])
  })
})

describe('resolveMinPerGroup', () => {
  it('passes literals through and rejects non-numeric shapes', () => {
    expect(resolveMinPerGroup(5, [], {}, [], 0, 1)).toBe(5)
    expect(resolveMinPerGroup('6', [], {}, [], 0, 1)).toBe(6)
    expect(resolveMinPerGroup('abc', [], {}, [], 0, 1)).toBeUndefined()
    expect(resolveMinPerGroup('', [], {}, [], 0, 1)).toBeUndefined()
    expect(resolveMinPerGroup(null, [], {}, [], 0, 1)).toBeUndefined()
    expect(resolveMinPerGroup(undefined, [], {}, [], 0, 1)).toBeUndefined()
  })
})

describe('drawFailureDetail', () => {
  const refusal =
    "Round 1 ('B'): the eligible field (1) is smaller than the class's minimum group size (5)."
  it('prefixes drawPhase.fieldTooSmall while keeping the verbatim code: detail', () => {
    const detail = drawFailureDetail(new ApiError(409, 'drawPhase.fieldTooSmall', refusal, []))
    expect(detail.startsWith(TOO_FEW_PILOTS_PREFIX)).toBe(true)
    expect(detail).toContain(`drawPhase.fieldTooSmall: ${refusal}`)
  })

  it('leaves every other failure verbatim', () => {
    expect(drawFailureDetail(new ApiError(409, 'eventStore.streamAlreadyExists', 'already drawn', []))).toBe(
      'eventStore.streamAlreadyExists: already drawn',
    )
    expect(drawFailureDetail(new Error('boom'))).toBe('boom')
  })
})
