import type { GridColumn } from './schema'
import { applyRounding, type Rounding } from './precision'

/** Stopwatch entry — the domain pairing behind a launch-to-landing stopwatch
 * reading. The overfly ("the overfly", domain glossary) is the exception
 * beyond the task's working time; officials time one total reading, and the
 * flight time is what stayed inside it. Both names are domain vocabulary the
 * adopted class definitions declare — the client branches on the declared
 * pair, never on a class. */
export const FLIGHT_TIME_METRIC = 'flightTime'
export const OVERFLY_METRIC = 'overflySeconds'

export interface StopwatchPair {
  /** The metric whose column shows the stopwatch total (already a time). */
  flightMetric: string
  /** The metric the split owns — never entered directly. */
  overflyMetric: string
}

/** A task uses stopwatch entry when its definition declares the pair: a
 * seconds flightTime alongside a seconds overflySeconds. */
export function stopwatchPair(task: {
  metrics: { name: string; kind: string; unit?: string | null }[]
}): StopwatchPair | undefined {
  const isSeconds = (m: { name: string; kind: string; unit?: string | null }): boolean =>
    m.kind === 'Number' && m.unit === 's'
  const names = new Set(task.metrics.map((m) => m.name))
  if (!names.has(FLIGHT_TIME_METRIC) || !names.has(OVERFLY_METRIC)) return undefined
  const flight = task.metrics.find((m) => m.name === FLIGHT_TIME_METRIC)
  const overfly = task.metrics.find((m) => m.name === OVERFLY_METRIC)
  return flight && overfly && isSeconds(flight) && isSeconds(overfly)
    ? { flightMetric: flight.name, overflyMetric: overfly.name }
    : undefined
}

export interface StopwatchReading {
  /** The in-working-time part, rounded per the flight metric's declaration. */
  flight: number
  /** The excess over working time, rounded per the overfly declaration. */
  overfly: number
}

/** Organiser-language clock text for a seconds reading — 599 → "9:59",
 * 599.9 → "9:59.9", 600 → "10:00", 3661 → "1:01:01" — the way the sheet's
 * stopwatch column and the paper tool read. */
export function formatClock(seconds: number): string {
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`
  const frac = seconds - whole
  return frac > 0 ? `${base}.${Math.round(frac * 10)}` : base
}

/** The rulebook's split of one stopwatch reading at the task's working time:
 * overflySeconds = max(0, total − workingTime) and flightTime =
 * min(total, workingTime), each rounded per its own metric's declared
 * rounding mode and precision (e.g. F3J records 0.1 s HalfUp; F5J/F5L
 * truncate to whole seconds). */
export function splitStopwatch(
  totalSeconds: number,
  workingTimeSeconds: number,
  flight: GridColumn | Pick<GridColumn, 'precision'>,
  overfly: GridColumn | Pick<GridColumn, 'precision'>,
): StopwatchReading {
  return {
    flight: applyRounding(
      Math.min(totalSeconds, workingTimeSeconds),
      flight.precision as Rounding | undefined,
    ),
    overfly: applyRounding(
      Math.max(0, totalSeconds - workingTimeSeconds),
      overfly.precision as Rounding | undefined,
    ),
  }
}
