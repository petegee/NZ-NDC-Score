import type { ClassDefinitionSummary } from '../api/types'

/** NdcScore serves NZMAA NDC organisers only: the adoptable classes are the
 * NZ NDC contest types — everything with NDC in the name, plus X5J,
 * NZ Radian and ALES Radian. Matching is on name or FAI designation,
 * case-insensitive. */
const NDC_CLASS_TOKENS = ['ndc', 'x5j', 'nz radian', 'ales radian'] as const

export function isNdcClass(c: Pick<ClassDefinitionSummary, 'name' | 'faiDesignation'>): boolean {
  const haystack = `${c.name} ${c.faiDesignation ?? ''}`.toLowerCase()
  return NDC_CLASS_TOKENS.some((t) => haystack.includes(t))
}
