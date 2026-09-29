/**
 * PROVISIONAL local tape catalogue — delete when
 * `kanban/blocked/ss_tape-catalogue-on-the-wire.md` lands.
 *
 * Source of truth is SoarScore2's seed corpus
 * (`tools/Soarscore.SeedData/json/tapes/`, TapeCorpus.ExpectedCount = 4):
 * - tape-nz-f3j-side.json (verbatim copy in ./tapes/)
 * - tape-measure.json (verbatim copy in ./tapes/)
 * F3B side intentionally omitted — no NDC F3B events in NZ (owner call).
 *
 * Catalogue JSON shape is `{name, unit, marks[{upTo,reading}], offTapeReading?}`
 * and maps to the wire `ReadingScale` as `offTapeReading -> offScaleReading`
 * with `readingSet` derived (marks' readings + off-tape). No `version` in the
 * JSON — provenance here is the corpus count + copy date, not a version field.
 */
import f3jJson from './tapes/tape-nz-f3j-side.json'
import measureJson from './tapes/tape-measure.json'
import type { DeclaredInstrument } from '../api/types'
import { LANDING_METRIC } from '../grid/schema'

export { LANDING_METRIC }

export const F3J_INSTRUMENT = 'NZ F3J side' as const
export const MEASURE_INSTRUMENT = 'Tape measure' as const

export type TapeChoice = typeof F3J_INSTRUMENT | typeof MEASURE_INSTRUMENT

export const TAPE_CHOICES: TapeChoice[] = [F3J_INSTRUMENT, MEASURE_INSTRUMENT]

/** F3J is the default — most resolution; tape-measure is the fallback. */
export const DEFAULT_TAPE: TapeChoice = F3J_INSTRUMENT

interface TapeJson {
  name: string
  unit: string
  marks: { upTo: number; reading: number }[]
  offTapeReading?: number | null
}

function asTape(json: TapeJson): { unit: string; marks: { upTo: number; reading: number }[]; offTapeReading: number | null } {
  return {
    unit: json.unit,
    marks: json.marks,
    offTapeReading: json.offTapeReading ?? null,
  }
}

const TAPES: Record<TapeChoice, ReturnType<typeof asTape>> = {
  [F3J_INSTRUMENT]: asTape(f3jJson as TapeJson),
  [MEASURE_INSTRUMENT]: asTape(measureJson as TapeJson),
}

export function tapeUnit(choice: TapeChoice): string {
  return TAPES[choice].unit
}

/** Reading set = marks' readings + off-tape reading (when present). Rendered by the picker; capture enforces exact membership. */
export function readingSetFor(choice: TapeChoice): number[] {
  const tape = TAPES[choice]
  const set = tape.marks.map((m) => m.reading)
  if (tape.offTapeReading !== null && !set.includes(tape.offTapeReading)) {
    set.push(tape.offTapeReading)
  }
  return [...set].sort((a, b) => a - b)
}

/**
 * Exact set-membership check — what `captureMeasurement.readingNotOnScale`
 * enforces. Tape-measure is the 15 m x 100 cm grid plus explicit 0, so this
 * is NOT a range check: 0.015 is in range but off-scale and must bounce
 * client-side before it reaches the wire.
 */
export function isValidTapeReading(choice: TapeChoice, value: number): boolean {
  if (!Number.isFinite(value)) return false
  if (choice === F3J_INSTRUMENT) {
    return readingSetFor(choice).includes(value)
  }
  // Tape measure: 0 (off-tape) or 0.01..15.00 on the cm grid.
  const EPS = 1e-9
  if (Math.abs(value) < EPS) return true
  if (value < 0.01 - EPS || value > 15 + EPS) return false
  const cents = value * 100
  return Math.abs(cents - Math.round(cents)) < 1e-6
}

export function tapeReadingError(choice: TapeChoice, value: number): string | null {
  if (isValidTapeReading(choice, value)) return null
  if (choice === F3J_INSTRUMENT) return `not on the ${choice} scale (${readingSetFor(choice).join(', ')})`
  return `not on the ${choice} scale (0 or 0.01–15.00 to the cm)`
}

/** Full scale payload for `POST /declare-instruments` — the declaration's `scale` field is just data the client posts. */
export function toDeclaredInstrument(choice: TapeChoice, metric: string = LANDING_METRIC): DeclaredInstrument {
  const tape = TAPES[choice]
  return {
    instrument: choice,
    metric,
    scale: {
      unit: tape.unit,
      marks: tape.marks.map((m) => ({ upTo: m.upTo, reading: m.reading })),
      offScaleReading: tape.offTapeReading,
    },
  }
}
