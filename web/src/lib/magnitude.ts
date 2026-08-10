/**
 * Grades a number against the pitchers on the board, for painting it.
 *
 * Absolute thresholds don't survive a stat changing units — 22 is a fine start
 * for a pitcher and a terrible ERA — so every column is ranked against its own
 * column instead. The five steps are percentile bands, which makes the paint
 * mean the same thing everywhere: step 5 is the top sixth of this column.
 */

/** Band edges, in percentile. A value at 90 is step 5; at 50, step 3. */
const CUTS = [15, 38, 62, 85]

export type Direction = 'high-good' | 'low-good'

/** A column's sorted values, kept so any number can be placed against them. */
export interface Distribution {
  sorted: number[]
  direction: Direction
}

export interface Magnitude {
  /** 1 (worst sixth) to 5 (best sixth). Also drives the non-colour channel. */
  step: number
  percentile: number
}

export function distribution(
  values: readonly (number | null | undefined)[],
  direction: Direction,
): Distribution {
  const sorted = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b)
  return { sorted, direction }
}

export function magnitude(
  value: number | null | undefined,
  dist: Distribution,
): Magnitude | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (dist.sorted.length === 0) return null

  const percentile = percentileOf(value, dist.sorted)
  // Flip the step rather than the percentile: the cuts stay readable as
  // "top 15%", and the reported percentile keeps meaning "how large".
  const raw = stepOf(percentile)
  const step = dist.direction === 'low-good' ? 6 - raw : raw
  return { step, percentile }
}

export function magnitudeClass(m: Magnitude | null): string {
  return m ? `mag-${m.step}` : ''
}

/**
 * Where a value falls in the column, 0–100.
 *
 * Ties take the midpoint of the run they belong to, so equal values always get
 * equal steps — ranking them by position would paint one of two identical 3.20
 * ERAs darker than the other.
 */
function percentileOf(value: number, sorted: number[]): number {
  let below = 0
  let equal = 0
  for (const v of sorted) {
    if (v < value) below++
    else if (v === value) equal++
  }
  return ((below + equal / 2) / sorted.length) * 100
}

function stepOf(percentile: number): number {
  let step = 1
  for (const cut of CUTS) {
    if (percentile >= cut) step++
  }
  return step
}
