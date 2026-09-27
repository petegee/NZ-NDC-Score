import type { ClassDefinitionSummary } from '../api/types'

/** NdcScore serves NZMAA NDC organisers only: the adoptable classes are the
 * NZ NDC contest types — everything with NDC in the name, plus X5J,
 * NZ Radian, ALES Radian and NZ Thermal 2 Metre (Class H), which the NZMAA
 * flies in the NDC series without an NDC-branded rulebook variant. Matching
 * is on name or FAI designation, case-insensitive. */
const NDC_CLASS_TOKENS = ['ndc', 'x5j', 'nz radian', 'ales radian', 'thermal 2 metre'] as const

export function isNdcClass(c: Pick<ClassDefinitionSummary, 'name' | 'faiDesignation'>): boolean {
  const haystack = `${c.name} ${c.faiDesignation ?? ''}`.toLowerCase()
  return NDC_CLASS_TOKENS.some((t) => haystack.includes(t))
}

/** The picker offers one row per contest type: when a class has been
 * republished, the older versions are history and only the latest is
 * adoptable. Classes group on name; latest = latest publishedAt —
 * publishedAt is an ISO 8601 timestamp, so text order is time order.
 * (Version strings are free text like "NZMAA Section 5 Soaring, October
 * 2024 Rev 3.0" and cannot be compared.) */
export function latestPerClass<T extends ClassSummaryRow>(classes: T[]): T[] {
  const byName = new Map<string, T>()
  for (const c of classes) {
    const current = byName.get(c.name)
    if (!current || c.publishedAt > current.publishedAt) byName.set(c.name, c)
  }
  return [...byName.values()]
}

type ClassSummaryRow = Pick<ClassDefinitionSummary, 'name' | 'version' | 'publishedAt'>
