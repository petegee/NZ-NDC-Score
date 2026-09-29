import { describe, expect, it } from 'vitest'
import {
  F3J_INSTRUMENT,
  MEASURE_INSTRUMENT,
  isValidTapeReading,
  readingSetFor,
  toDeclaredInstrument,
} from './tapes'

describe('provisional tapes (wire follow-up: ss_tape-catalogue-on-the-wire)', () => {
  it('F3J reading set is the 23 marks plus off-tape 0', () => {
    const set = readingSetFor(F3J_INSTRUMENT)
    expect(set).toContain(0)
    expect(set).toContain(100)
    expect(set).toContain(30)
    expect(set.length).toBe(24)
  })

  it('F3J accepts exact marks and 0, rejects in-between values', () => {
    expect(isValidTapeReading(F3J_INSTRUMENT, 0)).toBe(true)
    expect(isValidTapeReading(F3J_INSTRUMENT, 100)).toBe(true)
    expect(isValidTapeReading(F3J_INSTRUMENT, 99.5)).toBe(false)
    expect(isValidTapeReading(F3J_INSTRUMENT, 50.5)).toBe(false)
  })

  it('tape-measure accepts the cm grid plus 0, rejects off-grid in-range values', () => {
    expect(isValidTapeReading(MEASURE_INSTRUMENT, 0)).toBe(true)
    expect(isValidTapeReading(MEASURE_INSTRUMENT, 0.01)).toBe(true)
    expect(isValidTapeReading(MEASURE_INSTRUMENT, 15)).toBe(true)
    expect(isValidTapeReading(MEASURE_INSTRUMENT, 7.42)).toBe(true)
    // In range but not on scale — must bounce client-side, not at declaration.
    expect(isValidTapeReading(MEASURE_INSTRUMENT, 0.015)).toBe(false)
    expect(isValidTapeReading(MEASURE_INSTRUMENT, 15.01)).toBe(false)
    expect(isValidTapeReading(MEASURE_INSTRUMENT, -1)).toBe(false)
  })

  it('declare payload carries the full scale with offScaleReading mapping', () => {
    const declared = toDeclaredInstrument(F3J_INSTRUMENT)
    expect(declared.instrument).toBe(F3J_INSTRUMENT)
    expect(declared.metric).toBe('landingDistance')
    expect(declared.scale.unit).toBe('m')
    expect(declared.scale.marks.length).toBe(23)
    expect(declared.scale.offScaleReading).toBe(0)
  })
})
