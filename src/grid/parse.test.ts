import { describe, expect, it } from 'vitest'
import { formatValue, parseCellText } from './parse'

describe('parseCellText', () => {
  it('parses mm:ss into seconds', () => {
    expect(parseCellText('1:02', 'Number', 's')).toEqual({ ok: true, value: { kind: 'Number', number: 62 } })
  })

  it('parses h:mm:ss', () => {
    expect(parseCellText('1:01:01', 'Number', 's')).toEqual({ ok: true, value: { kind: 'Number', number: 3661 } })
  })

  it('passes bare and decimal seconds through', () => {
    expect(parseCellText('62', 'Number', 's')).toEqual({ ok: true, value: { kind: 'Number', number: 62 } })
    expect(parseCellText('62.5', 'Number', 's')).toEqual({ ok: true, value: { kind: 'Number', number: 62.5 } })
  })

  it('parses metres as plain decimals', () => {
    expect(parseCellText('42.7', 'Number', 'm')).toEqual({ ok: true, value: { kind: 'Number', number: 42.7 } })
  })

  it('passes a bare 0 through as a zero reading, never blank', () => {
    expect(parseCellText('0', 'Number', 'm')).toEqual({ ok: true, value: { kind: 'Number', number: 0 } })
    expect(parseCellText('0', 'Number', 's')).toEqual({ ok: true, value: { kind: 'Number', number: 0 } })
  })

  it('parses flags as y/n words and digits', () => {
    expect(parseCellText('y', 'Flag')).toEqual({ ok: true, value: { kind: 'Flag', flag: true } })
    expect(parseCellText('n', 'Flag')).toEqual({ ok: true, value: { kind: 'Flag', flag: false } })
    expect(parseCellText('TRUE', 'Flag')).toEqual({ ok: true, value: { kind: 'Flag', flag: true } })
  })

  it('refuses junk and blanks', () => {
    expect(parseCellText('abc', 'Number', 'm').ok).toBe(false)
    expect(parseCellText('1:99', 'Number', 's').ok).toBe(false)
    expect(parseCellText('', 'Number', 'm')).toEqual({ ok: false, error: 'blank' })
    expect(parseCellText('maybe', 'Flag').ok).toBe(false)
  })
})

describe('formatValue', () => {
  it('formats flags as y/n', () => {
    expect(formatValue({ kind: 'Flag', flag: true })).toBe('y')
    expect(formatValue({ kind: 'Flag', flag: false })).toBe('n')
  })

  it('formats seconds verbatim (and long flights as h:mm:ss)', () => {
    expect(formatValue({ kind: 'Number', number: 62 }, 's')).toBe('62')
    expect(formatValue({ kind: 'Number', number: 3661 }, 's')).toBe('1:01:01')
  })

  it('formats numbers and strings', () => {
    expect(formatValue({ kind: 'Number', number: 42.7 }, 'm')).toBe('42.7')
    expect(formatValue({ kind: 'Number', number: '412' }, 's')).toBe('412')
  })

  it('formats nothing for undefined', () => {
    expect(formatValue(undefined)).toBe('')
  })
})
