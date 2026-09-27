import { describe, expect, it } from 'vitest'
import { isNdcClass, latestPerClass } from './classes'

const row = (
  name: string,
  version: string,
  publishedAt: string,
  faiDesignation?: string,
) => ({ name, version, publishedAt, faiDesignation })

describe('latestPerClass', () => {
  it('keeps only the latest-published version of each class name', () => {
    const latest = latestPerClass([
      row('F5J NDC', '1', '2026-01-01T00:00:00Z'),
      row('F5J NDC', '2', '2026-02-01T00:00:00Z'),
      row('X5J', '1', '2026-01-01T00:00:00Z'),
    ])
    expect(latest.map((c) => c.version)).toEqual(['2', '1'])
  })

  it('picks by publishedAt, not by version text (real seed version strings)', () => {
    // Regression: "NZMAA Section 5 Soaring, October 2024 Rev 3.0" vs
    // "… March 2024" — free-text versions the old semver comparison
    // returned NaN on, so the older March row (published first) won.
    const latest = latestPerClass([
      row(
        'RC Electric Powered Thermal Duration Gliders (NDC format)',
        'NZMAA Section 5 Soaring, March 2024',
        '2026-09-26T22:55:38.3113102+00:00',
      ),
      row(
        'RC Electric Powered Thermal Duration Gliders (NDC format)',
        'NZMAA Section 5 Soaring, October 2024 Rev 3.0',
        '2026-09-27T00:45:42.5342772+00:00',
      ),
    ])
    expect(latest).toHaveLength(1)
    expect(latest[0].version).toContain('October 2024')
  })

  it('keeps the last-published row even if it appears first in the list', () => {
    const latest = latestPerClass([
      row('F5J NDC', '2', '2026-03-01T00:00:00Z'),
      row('F5J NDC', '1', '2026-01-01T00:00:00Z'),
    ])
    expect(latest[0].publishedAt).toBe('2026-03-01T00:00:00Z')
  })
})

describe('isNdcClass', () => {
  it('matches on name or FAI designation, case-insensitive', () => {
    expect(isNdcClass(row('RC Electric Gliders (NDC format)', '1', 'x'))).toBe(true)
    expect(isNdcClass(row('RC Electric Gliders', '1', 'x', 'f5j-ndc'))).toBe(true)
    expect(isNdcClass(row('F3F', '1', 'x'))).toBe(false)
  })
})
