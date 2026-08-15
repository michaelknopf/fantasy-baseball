import { describe, expect, it } from 'vitest'
import { barSegments, isLeading, roundTiming, sideLabel } from './bracket'
import type { PlayoffMatchup, PlayoffRound, PlayoffSide } from './types'

function side(overrides: Partial<PlayoffSide> = {}): PlayoffSide {
  return {
    seed: null,
    team: 'Randy',
    awaiting: null,
    advantage: 0,
    starting_points: null,
    current_points: null,
    earned: null,
    matchup_points: null,
    is_mine: false,
    ...overrides,
  }
}

function round(overrides: Partial<PlayoffRound> = {}): PlayoffRound {
  return {
    label: 'Round 1',
    starts_on: '2026-08-10',
    ends_on: '2026-08-23',
    state: 'live',
    peak_points: null,
    matchups: [],
    ...overrides,
  }
}

describe('barSegments', () => {
  it('splits a bar into the seed spot and what was earned', () => {
    const scored = side({ advantage: 50, earned: 250, matchup_points: 300 })

    // Against a 300 peak the whole bar is full, of which the spot is a sixth.
    const segments = barSegments(scored, 300)

    expect(segments?.spot).toBeCloseTo(16.67)
    expect(segments?.earned).toBeCloseTo(83.33)
    expect(segments?.total).toBe(100)
  })

  it('scales against the round rather than the matchup, so bars compare', () => {
    const scored = side({ advantage: 0, earned: 150, matchup_points: 150 })

    // The same side is half as long once a bigger score sets the round's axis.
    expect(barSegments(scored, 300)?.total).toBe(50)
    expect(barSegments(scored, 150)?.total).toBe(100)
  })

  it('draws nothing for a side that has not scored', () => {
    expect(barSegments(side(), 300)).toBeNull()
  })

  it('draws nothing when the round has no axis to scale against', () => {
    const scored = side({ earned: 10, matchup_points: 10 })

    // A round where nobody has scored has a null peak, not a zero one.
    expect(barSegments(scored, null)).toBeNull()
    expect(barSegments(scored, 0)).toBeNull()
  })
})

describe('isLeading', () => {
  const matchup = (leader: string | null): PlayoffMatchup => ({
    a: side({ team: 'Randy' }),
    b: side({ team: 'MK' }),
    margin: leader === null ? null : 19.75,
    leader,
    is_bye: false,
  })

  it('marks only the named leader', () => {
    const m = matchup('Randy')

    expect(isLeading(m, m.a)).toBe(true)
    expect(isLeading(m, m.b)).toBe(false)
  })

  it('marks nobody when the matchup has no leader', () => {
    const m = matchup(null)

    expect(isLeading(m, m.a)).toBe(false)
    expect(isLeading(m, m.b)).toBe(false)
  })

  it('does not match two unresolved slots against each other', () => {
    // Both teams are null here; a naive equality check would call them equal.
    const m: PlayoffMatchup = {
      a: side({ team: null, awaiting: 'Winner of round 1' }),
      b: side({ team: null, awaiting: 'Loser of round 1' }),
      margin: null,
      leader: null,
      is_bye: false,
    }

    expect(isLeading(m, m.a)).toBe(false)
  })
})

describe('sideLabel', () => {
  it('prefers the team once one is known', () => {
    expect(sideLabel(side({ team: 'MK', awaiting: 'Winner of round 1' }))).toBe('MK')
  })

  it('falls back to what the slot is waiting on', () => {
    expect(sideLabel(side({ team: null, awaiting: 'Winner of Randy / MK' }))).toBe(
      'Winner of Randy / MK',
    )
  })
})

describe('roundTiming', () => {
  it('counts down to the end of a live round', () => {
    expect(roundTiming(round(), '2026-08-15')).toBe('8 days left')
  })

  it('counts down to the start of an upcoming round', () => {
    const next = round({ state: 'upcoming', starts_on: '2026-08-24' })

    expect(roundTiming(next, '2026-08-15')).toBe('starts in 9 days')
  })

  it('says a finished round is final rather than counting days', () => {
    expect(roundTiming(round({ state: 'done' }), '2026-08-30')).toBe('final')
  })

  it('reads singular on the last day', () => {
    expect(roundTiming(round(), '2026-08-22')).toBe('1 day left')
  })

  it('says today rather than counting zero days', () => {
    expect(roundTiming(round(), '2026-08-23')).toBe('ends today')
  })
})
