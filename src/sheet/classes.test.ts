import { describe, expect, it } from 'vitest'
import { isNdcClass, latestPerClass } from './classes'

const row = (
  name: string,
  version: string,
  publishedAt: string,
  faiDesignation?: string,
) => ({ name, version, publishedAt, faiDesignation })

describe('latestPerClass', () => {
  it('keeps only the newest version of each class name', () => {
    const latest = latestPerClass([
      row('F5J NDC', '1', '2026-01-01T00:00:00Z'),
      row('F5J NDC', '2', '2026-02-01T00:00:00Z'),
      row('X5J', '1', '2026-01-01T00:00:00Z'),
    ])
    expect(latest.map((c) => c.version)).toEqual(['2', '1'])
  })

  it('compares versions numerically, not as text', () => {
    const latest = latestPerClass([
      row('F5J NDC', '10', '2026-01-01T00:00:00Z'),
      row('F5J NDC', '9', '2026-02-01T00:00:00Z'),
    ])
    expect(latest).toHaveLength(1)
    expect(latest[0].version).toBe('10')
  })

  it('breaks version ties on publishedAt', () => {
    const latest = latestPerClass([
      row('F5J NDC', '2', '2026-01-01T00:00:00Z'),
      row('F5J NDC', '2', '2026-03-01T00:00:00Z'),
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
