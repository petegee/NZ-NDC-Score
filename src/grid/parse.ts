import type { MeasuredValue } from '../api/types'

export type CellParse =
  | { ok: true; value: MeasuredValue }
  | { ok: false; error: string }
  | { ok: false; error: 'blank' }

/** Parse cell text into a MeasuredValue — capture, not arithmetic. Time
 * metrics (unit s) accept mm:ss / h:mm:ss / bare (decimal) seconds; other
 * numbers pass through as decimals; the service applies metric precision. */
export function parseCellText(text: string, kind: 'Number' | 'Flag', unit?: string): CellParse {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, error: 'blank' }

  if (kind === 'Flag') {
    const lowered = trimmed.toLowerCase()
    if (['y', 'yes', 'true', '1', 't'].includes(lowered)) return { ok: true, value: { kind: 'Flag', flag: true } }
    if (['n', 'no', 'false', '0', 'f'].includes(lowered)) return { ok: true, value: { kind: 'Flag', flag: false } }
    return { ok: false, error: `not a flag: y/n` }
  }

  if (unit === 's') {
    const clock = trimmed.match(/^(\d+):([0-5]\d)(?:\.(\d+))?$/)
    if (clock) {
      const seconds = Number(clock[1]) * 60 + Number(clock[2]) + (clock[3] ? Number(`0.${clock[3]}`) : 0)
      return { ok: true, value: { kind: 'Number', number: seconds } }
    }
    const longClock = trimmed.match(/^(\d+):([0-5]\d):([0-5]\d)$/)
    if (longClock) {
      const seconds = Number(longClock[1]) * 3600 + Number(longClock[2]) * 60 + Number(longClock[3])
      return { ok: true, value: { kind: 'Number', number: seconds } }
    }
  }

  const n = Number(trimmed)
  if (!Number.isFinite(n)) {
    return { ok: false, error: unit === 's' ? 'not mm:ss or seconds' : 'not a number' }
  }
  return { ok: true, value: { kind: 'Number', number: n } }
}

/** Display text for a committed value — verbatim number, clock-style seconds
 * when the metric is a time (e.g. 62 → "62", 3661 → "1:01:01"). */
export function formatValue(value: MeasuredValue | undefined, unit?: string): string {
  if (!value) return ''
  if (value.kind === 'Flag') return value.flag ? 'y' : 'n'
  const n = typeof value.number === 'number' ? value.number : value.number != null ? Number(value.number) : NaN
  if (Number.isNaN(n)) return ''
  if (unit === 's' && Number.isInteger(n) && n >= 3600) {
    const h = Math.floor(n / 3600)
    const m = Math.floor((n % 3600) / 60)
    const s = n % 60
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return String(n)
}
