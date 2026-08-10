import { describe, expect, it } from 'vitest'
import { distribution, magnitude, magnitudeClass } from './magnitude'

/** 0..99, so a value equals roughly its own percentile. */
const HUNDRED = Array.from({ length: 100 }, (_, i) => i)

describe('distribution', () => {
  it('drops nulls and non-numbers rather than sorting them as zero', () => {
    const d = distribution([3, null, 1, undefined, NaN, 2], 'high-good')
    expect(d.sorted).toEqual([1, 2, 3])
  })
})

describe('magnitude', () => {
  const high = distribution(HUNDRED, 'high-good')

  it('places values in five bands at the percentile cuts', () => {
    expect(magnitude(5, high)?.step).toBe(1)
    expect(magnitude(25, high)?.step).toBe(2)
    expect(magnitude(50, high)?.step).toBe(3)
    expect(magnitude(75, high)?.step).toBe(4)
    expect(magnitude(95, high)?.step).toBe(5)
  })

  it('inverts the step for a stat where low is good', () => {
    const low = distribution(HUNDRED, 'low-good')
    // A low ERA is the good end, so the smallest value earns the top step.
    expect(magnitude(5, low)?.step).toBe(5)
    expect(magnitude(95, low)?.step).toBe(1)
    expect(magnitude(50, low)?.step).toBe(3)
  })

  it('reports percentile as size, unaffected by direction', () => {
    const low = distribution(HUNDRED, 'low-good')
    expect(magnitude(5, low)?.percentile).toBeCloseTo(
      magnitude(5, high)?.percentile ?? -1,
    )
  })

  it('carries the whole grade in the step, so no channel can disagree', () => {
    const low = distribution(HUNDRED, 'low-good')
    // The fill and the bar both read `step`, so a value cannot be painted as
    // strong while its bar says weak.
    expect(magnitude(5, high)?.step).toBe(1)
    expect(magnitude(5, low)?.step).toBe(5)
  })

  it('gives tied values the same step', () => {
    const tied = distribution([5, 5, 5, 5, 1, 9], 'high-good')
    const steps = [5, 5, 5].map((v) => magnitude(v, tied)?.step)
    expect(new Set(steps).size).toBe(1)
  })

  it('returns null for a missing value or an empty column', () => {
    expect(magnitude(null, high)).toBeNull()
    expect(magnitude(1, distribution([], 'high-good'))).toBeNull()
  })
})

describe('magnitudeClass', () => {
  it('names a class per step, and nothing when ungraded', () => {
    const high = distribution(HUNDRED, 'high-good')
    expect(magnitudeClass(magnitude(95, high))).toBe('mag-5')
    expect(magnitudeClass(null)).toBe('')
  })
})
