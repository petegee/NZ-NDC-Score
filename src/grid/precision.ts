export interface Rounding {
  mode: string
  precision: number
}

/** Apply a metric's declared rounding (Truncate/HalfUp/Ceiling over the
 * declared granularity, e.g. 0.1 s or 1 s) — the same modes the service
 * applies on capture, so a split value and a service-rounded capture agree. */
export function applyRounding(value: number, precision?: Rounding): number {
  if (!precision) return value
  const granularity = Number(precision.precision)
  if (!Number.isFinite(granularity) || granularity <= 0) return value
  const factor = 1 / granularity
  // kill float dust before the mode applies (the service computes in decimal)
  const q = Number((value * factor).toPrecision(12))
  const scaled =
    precision.mode === 'Ceiling'
      ? Math.ceil(q)
      : precision.mode === 'HalfUp'
        ? Math.round(q)
        : Math.trunc(q)
  return scaled / factor
}
