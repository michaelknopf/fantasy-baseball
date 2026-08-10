import { describe, expect, it } from 'vitest'
import { formOf, matchupOf, score } from './score'
import type { Form, Pitcher, StartSlot } from './types'

function form(per_game: number, games = 10): Form {
  return { games, fantasy_points: per_game * games, per_game }
}

function pitcher(overrides: Partial<Pitcher> = {}): Pitcher {
  return {
    player_id: 'p',
    name: 'Test',
    mlb_team: 'ATL',
    positions: 'SP',
    ownership: 'free_agent',
    roster_status: null,
    rostered_pct: null,
    owned_by: null,
    starts: [],
    season: form(20),
    windows: { last30: form(20), last60: form(20) },
    stats: {},
    recent_games: [],
    ...overrides,
  }
}

function slot(overrides: Partial<StartSlot> = {}): StartSlot {
  return {
    date: '2026-08-10',
    label: 'Mon',
    opponent: 'KC',
    is_away: false,
    opposing_pitcher: null,
    opponent_runs_per_game: 4.5,
    opponent_runs_rank: 15,
    opponent_ops: null,
    opponent_strikeouts_rank: 15,
    ...overrides,
  }
}

describe('formOf', () => {
  it('weights recent windows over the season', () => {
    const p = pitcher({
      windows: { last30: form(30), last60: form(20) },
      season: form(10),
    })
    // 0.5·30 + 0.3·20 + 0.2·10 = 23
    expect(formOf(p)).toBe(23)
  })

  it('collapses to the same number when every window agrees', () => {
    expect(formOf(pitcher())).toBe(20)
  })

  it('redistributes weight rather than counting a thin window as zero', () => {
    const p = pitcher({
      windows: { last30: form(30, 1), last60: form(20) },
      season: form(10),
    })
    // last30 drops out; 0.3 and 0.2 renormalise to 0.6/0.4 → 16
    expect(formOf(p)).toBe(16)
  })

  it('returns null when no window has enough games', () => {
    const p = pitcher({
      windows: { last30: form(30, 1) },
      season: form(10, 2),
    })
    expect(formOf(p)).toBeNull()
  })
})

describe('matchupOf', () => {
  it('is near zero for a median opponent', () => {
    // With 30 teams the midpoint falls between ranks 15 and 16, so no pair is
    // exactly neutral — being within a few percent is the real contract.
    expect(
      matchupOf(slot({ opponent_runs_rank: 15, opponent_strikeouts_rank: 16 })),
    ).toBeCloseTo(0, 1)
  })

  it('is positive against a weak, strikeout-prone offense', () => {
    // Rank 30 in runs is the worst offense; rank 1 in K is the most strikeouts.
    expect(matchupOf(slot({ opponent_runs_rank: 30, opponent_strikeouts_rank: 1 }))).toBe(1)
  })

  it('is negative against a strong offense that makes contact', () => {
    expect(matchupOf(slot({ opponent_runs_rank: 1, opponent_strikeouts_rank: 30 }))).toBe(-1)
  })

  it('lets one axis overturn the other', () => {
    // The Angels' real shape: 26th in runs, so runs alone call it a soft spot —
    // but 29th in strikeouts, because they put the ball in play. Netting them
    // turns a apparent gift into a slightly below-average matchup, which is the
    // whole reason the second axis is carried.
    const runsOnly = matchupOf(
      slot({ opponent_runs_rank: 26, opponent_strikeouts_rank: null }),
    )
    const both = matchupOf(
      slot({ opponent_runs_rank: 26, opponent_strikeouts_rank: 29 }),
    )
    expect(runsOnly).toBeGreaterThan(0.7)
    expect(both).toBeLessThan(0)
  })

  it('stacks both axes when they agree', () => {
    // Pittsburgh: third-best offense that also strikes out least — bad twice.
    expect(
      matchupOf(slot({ opponent_runs_rank: 3, opponent_strikeouts_rank: 30 })),
    ).toBeLessThan(-0.85)
    // Toronto: weak offense that also strikes out often — the board's best spot.
    expect(
      matchupOf(slot({ opponent_runs_rank: 29, opponent_strikeouts_rank: 2 })),
    ).toBeGreaterThan(0.85)
  })

  it('falls back to neutral when the opponent line is missing', () => {
    expect(matchupOf(undefined)).toBe(0)
    expect(
      matchupOf(slot({ opponent_runs_rank: null, opponent_strikeouts_rank: null })),
    ).toBe(0)
  })

  it('uses whichever axis it has', () => {
    expect(matchupOf(slot({ opponent_runs_rank: 30, opponent_strikeouts_rank: null }))).toBe(1)
  })
})

describe('score', () => {
  it('leaves form essentially untouched in a neutral matchup', () => {
    const s = score(
      pitcher(),
      slot({ opponent_runs_rank: 15, opponent_strikeouts_rank: 16 }),
    )
    expect(s?.value).toBeCloseTo(20, 0)
  })

  it('swings 15% at the extremes', () => {
    const soft = score(pitcher(), slot({ opponent_runs_rank: 30, opponent_strikeouts_rank: 1 }))
    const hard = score(pitcher(), slot({ opponent_runs_rank: 1, opponent_strikeouts_rank: 30 }))
    expect(soft?.value).toBe(23)
    expect(hard?.value).toBe(17)
  })

  it('never lets a matchup lift a weak arm over a strong one', () => {
    const weakSoftSpot = score(
      pitcher({ windows: { last30: form(12), last60: form(12) }, season: form(12) }),
      slot({ opponent_runs_rank: 30, opponent_strikeouts_rank: 1 }),
    )
    const strongHardSpot = score(
      pitcher({ windows: { last30: form(20), last60: form(20) }, season: form(20) }),
      slot({ opponent_runs_rank: 1, opponent_strikeouts_rank: 30 }),
    )
    expect(weakSoftSpot?.value).toBeLessThan(strongHardSpot?.value ?? 0)
  })

  it('scales the matchup with form, rather than adding a flat bonus', () => {
    const soft = slot({ opponent_runs_rank: 30, opponent_strikeouts_rank: 1 })
    const good = score(pitcher({ windows: { last30: form(30), last60: form(30) }, season: form(30) }), soft)
    const weak = score(pitcher({ windows: { last30: form(10), last60: form(10) }, season: form(10) }), soft)
    expect((good?.value ?? 0) - 30).toBeCloseTo(4.5, 1)
    expect((weak?.value ?? 0) - 10).toBeCloseTo(1.5, 1)
  })

  it('declines to score a pitcher with no usable window', () => {
    expect(score(pitcher({ windows: {}, season: form(10, 1) }), slot())).toBeNull()
  })
})
