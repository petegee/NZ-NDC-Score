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

/** The picker offers one row per contest type: when a class has been
 * republished, the older versions are history and only the latest is
 * adoptable. Classes group on name; latest = highest version number,
 * tie-broken by publishedAt (then list order). */
export function latestPerClass<T extends ClassSummaryRow>(classes: T[]): T[] {
  const byName = new Map<string, T>()
  for (const c of classes) {
    const current = byName.get(c.name)
    if (!current || isNewer(c, current)) byName.set(c.name, c)
  }
  return [...byName.values()]
}

type ClassSummaryRow = Pick<ClassDefinitionSummary, 'name' | 'version' | 'publishedAt'>

function isNewer(a: ClassSummaryRow, b: ClassSummaryRow): boolean {
  const byVersion = compareVersions(a.version, b.version)
  if (byVersion !== 0) return byVersion > 0
  return a.publishedAt > b.publishedAt
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
