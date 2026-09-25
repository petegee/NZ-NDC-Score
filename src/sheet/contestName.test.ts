import { describe, expect, it } from 'vitest'
import type { ClassDefinition } from '../api/types'
import { fabricateContestName } from './contestName'

const f5j = {
  name: 'RC Electric Powered Thermal Duration Gliders (NDC format)',
  faiDesignation: 'F5J',
} as unknown as ClassDefinition

const ales = {
  name: 'ALES 200 (NDC format)',
  faiDesignation: '',
} as unknown as ClassDefinition

const noDesignation = { name: 'X5J Electric' } as unknown as ClassDefinition

describe('fabricateContestName — the contest identity Soarscore sees', () => {
  it('reads `<ISO date> <location> <FAI designation>`', () => {
    expect(
      fabricateContestName({ location: 'Matamata', date: '2026-09-25', classDefinition: f5j }),
    ).toBe('2026-09-25 Matamata F5J')
  })

  it('falls back to the class name when no FAI designation is declared', () => {
    expect(
      fabricateContestName({ location: 'Matamata', date: '2026-09-25', classDefinition: ales }),
    ).toBe('2026-09-25 Matamata ALES 200 (NDC format)')
  })

  it('treats a missing designation like an empty one', () => {
    expect(
      fabricateContestName({
        location: 'Matamata',
        date: '2026-09-25',
        classDefinition: noDesignation,
      }),
    ).toBe('2026-09-25 Matamata X5J Electric')
  })

  it('trims the header text the organiser typed', () => {
    expect(
      fabricateContestName({ location: '  Matamata  ', date: ' 2026-09-25 ', classDefinition: f5j }),
    ).toBe('2026-09-25 Matamata F5J')
  })

  it('drops blank parts — the sheet validation refuses the run, the fabrication stays total', () => {
    expect(
      fabricateContestName({ location: '', date: '2026-09-25', classDefinition: f5j }),
    ).toBe('2026-09-25 F5J')
    expect(
      fabricateContestName({ location: 'Matamata', date: '', classDefinition: f5j }),
    ).toBe('Matamata F5J')
  })

  it('is deterministic — the same header fabricates the same name, so a re-calc finds the same competition', () => {
    const once = fabricateContestName({
      location: 'Matamata',
      date: '2026-09-25',
      classDefinition: f5j,
    })
    const again = fabricateContestName({
      location: 'Matamata',
      date: '2026-09-25',
      classDefinition: f5j,
    })
    expect(once).toBe(again)
  })
})
