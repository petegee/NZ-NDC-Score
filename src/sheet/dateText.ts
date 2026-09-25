/** Parse the contest date field's free text into the ISO yyyy-mm-dd the
 * Soarscore wire carries (`format: "date"`). Forgiving, day-first (the NZ
 * paper-sheet order): 1-2 digit day/month, two-digit years near the present,
 * month names, a defaulted current year. The year stays a real four-digit
 * year — the native date widget used to let six digits through and the
 * service refused the command downstream. */

export type DateTextParse =
  | { ok: true; iso: string }
  | { ok: false; error: string }

const MIN_YEAR = 1900
const MAX_YEAR = 2100

const YEAR_DIGITS = 'Year must be four digits (e.g. 2026).'
const YEAR_RANGE = `Year must be between ${MIN_YEAR} and ${MAX_YEAR}.`
const NOT_REAL = 'Not a real date — check the day and month.'
const NOT_RECOGNISED = 'Not a recognisable date — try d/m/yyyy (e.g. 5/9/2026).'

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

export function parseDateText(text: string): DateTextParse {
  const t = text.trim()
  if (t === '') return { ok: true, iso: '' }

  const numeric = t.match(/^(\d+)\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d+)$/)
  if (numeric) {
    const first = numeric[1]
    const middle = numeric[2]
    const last = numeric[3]
    if (first.length === 4) return build(Number(first), Number(middle), Number(last))
    if (first.length > 2 || last.length > 4) return { ok: false, error: YEAR_DIGITS }
    const year = expandYear(last)
    if (typeof year === 'string') return { ok: false, error: year }
    return build(year, Number(middle), Number(first))
  }

  const dayMonth = t.match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})$/)
  if (dayMonth) {
    return build(currentYear(), Number(dayMonth[2]), Number(dayMonth[1]))
  }

  const dayNamed = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:[\s,]+(\d+))?$/i)
  if (dayNamed) {
    return named(dayNamed[1], dayNamed[2], dayNamed[3])
  }

  const namedDay = t.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,]+(\d+))?$/i)
  if (namedDay) {
    return named(namedDay[2], namedDay[1], namedDay[3])
  }

  return { ok: false, error: NOT_RECOGNISED }
}

function named(day: string, monthName: string, year: string | undefined): DateTextParse {
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()]
  if (month === undefined) return { ok: false, error: NOT_RECOGNISED }
  const y = year === undefined || year === '' ? currentYear() : expandYear(year)
  if (typeof y === 'string') return { ok: false, error: y }
  return build(y, month, Number(day))
}

/** A one- or two-digit year sits near the present; anything else must be a
 * full four-digit year. */
function expandYear(text: string): number | string {
  if (text.length <= 2) {
    const n = Number(text)
    return n <= 68 ? 2000 + n : 1900 + n
  }
  if (text.length === 4) return Number(text)
  return YEAR_DIGITS
}

function currentYear(): number {
  return new Date().getFullYear()
}

function build(year: number, month: number, day: number): DateTextParse {
  if (month < 1 || month > 12) return { ok: false, error: NOT_REAL }
  if (year < MIN_YEAR || year > MAX_YEAR) return { ok: false, error: YEAR_RANGE }
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return { ok: false, error: NOT_REAL }
  }
  const pad = (n: number): string => String(n).padStart(2, '0')
  return { ok: true, iso: `${year}-${pad(month)}-${pad(day)}` }
}
