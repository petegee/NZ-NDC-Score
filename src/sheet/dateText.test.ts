import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDateText } from './dateText'

describe('parseDateText — the contest date field', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 8, 25))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('blank is ok with an empty ISO (the required-check lives at Calculate)', () => {
    expect(parseDateText('')).toEqual({ ok: true, iso: '' })
    expect(parseDateText('   ')).toEqual({ ok: true, iso: '' })
  })

  it('accepts the ISO form the sheet already holds', () => {
    expect(parseDateText('2026-09-19')).toEqual({ ok: true, iso: '2026-09-19' })
  })

  it('accepts flexible 1-2 digit day and month, day-first (NZ paper-sheet order)', () => {
    expect(parseDateText('5/9/2026')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText('19/9/2026')).toEqual({ ok: true, iso: '2026-09-19' })
    expect(parseDateText('19/09/2026')).toEqual({ ok: true, iso: '2026-09-19' })
    expect(parseDateText('5.9.2026')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText('5-9-2026')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText(' 5 / 9 / 2026 ')).toEqual({ ok: true, iso: '2026-09-05' })
  })

  it('accepts a two-digit year near the present', () => {
    expect(parseDateText('5/9/26')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText('5/9/99')).toEqual({ ok: true, iso: '1999-09-05' })
  })

  it('defaults a missing year to the current one', () => {
    expect(parseDateText('5/9')).toEqual({ ok: true, iso: '2026-09-05' })
  })

  it('accepts month names in either order', () => {
    expect(parseDateText('5 Sep 2026')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText('5 september 2026')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText('Sep 5 2026')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText('5th Sep 2026')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText('5 Sep')).toEqual({ ok: true, iso: '2026-09-05' })
  })

  it('accepts a four-digit year written first', () => {
    expect(parseDateText('2026/9/5')).toEqual({ ok: true, iso: '2026-09-05' })
    expect(parseDateText('2026-9-5')).toEqual({ ok: true, iso: '2026-09-05' })
  })

  it('rejects more than four year digits — the year the native date widget let through', () => {
    expect(parseDateText('5/9/20266')).toEqual({
      ok: false,
      error: 'Year must be four digits (e.g. 2026).',
    })
    expect(parseDateText('20266-09-19')).toEqual({
      ok: false,
      error: 'Year must be four digits (e.g. 2026).',
    })
  })

  it('keeps the four-digit year a four-digit year', () => {
    expect(parseDateText('5/9/026')).toEqual({
      ok: false,
      error: 'Year must be four digits (e.g. 2026).',
    })
  })

  it('keeps the year in a sane range', () => {
    expect(parseDateText('5/9/0999')).toEqual({
      ok: false,
      error: 'Year must be between 1900 and 2100.',
    })
    expect(parseDateText('5/9/9999')).toEqual({
      ok: false,
      error: 'Year must be between 1900 and 2100.',
    })
  })

  it('rejects impossible calendar dates', () => {
    expect(parseDateText('31/2/2026')).toEqual({
      ok: false,
      error: 'Not a real date — check the day and month.',
    })
    expect(parseDateText('29/2/2025')).toEqual({
      ok: false,
      error: 'Not a real date — check the day and month.',
    })
    expect(parseDateText('5/13/2026')).toEqual({
      ok: false,
      error: 'Not a real date — check the day and month.',
    })
  })

  it('accepts the leap day', () => {
    expect(parseDateText('29/2/2024')).toEqual({ ok: true, iso: '2024-02-29' })
  })

  it('rejects text it cannot recognise', () => {
    expect(parseDateText('hello')).toEqual({
      ok: false,
      error: 'Not a recognisable date — try d/m/yyyy (e.g. 5/9/2026).',
    })
    expect(parseDateText('5/Foo/2026')).toEqual({
      ok: false,
      error: 'Not a recognisable date — try d/m/yyyy (e.g. 5/9/2026).',
    })
  })
})
