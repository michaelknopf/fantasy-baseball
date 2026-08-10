import { describe, expect, it } from 'vitest'
import { magnitude } from './magnitude'
import { pitcherRows, ramps, startsInPeriod } from './rows'
import type { Board, Pitcher, StartSlot, WaiverPeriod } from './types'

function start(date: string): StartSlot {
  return {
    date,
    label: date,
    opponent: 'KC',
    is_away: false,
    opposing_pitcher: null,
    opponent_runs_per_game: null,
    opponent_runs_rank: null,
    opponent_ops: null,
    opponent_strikeouts_rank: null,
  }
}

function pitcher(over: Partial<Pitcher> & { player_id: string }): Pitcher {
  return {
    name: over.player_id,
    mlb_team: 'XXX',
    positions: 'SP',
    ownership: 'free_agent',
    roster_status: null,
    rostered_pct: null,
    owned_by: null,
    starts: [],
    season: null,
    windows: {},
    stats: {},
    recent_games: [],
    ...over,
  }
}

/** A pitcher whose rate stats rest on a stated number of games. */
function season(
  player_id: string,
  games: number,
  stats: Record<string, string>,
): Pitcher {
  return pitcher({
    player_id,
    stats,
    season: { games, fantasy_points: games * 20, per_game: 20 },
  })
}

const PERIOD: WaiverPeriod = {
  starts_on: '2026-08-10',
  ends_on: '2026-08-12',
  label: 'Mon 8/10',
  free_agents_known: true,
}

function board(pitchers: Pitcher[]): Board {
  return {
    generated_at: '2026-08-09',
    collected_through: '2026-08-14',
    starts_remaining: 63,
    starts_max: 125,
    claim_budget: 228,
    active_pitcher_slots: 6,
    periods: [PERIOD],
    pitchers,
    rivals: [],
    slots: null,
    roster: [],
  }
}

describe('startsInPeriod', () => {
  it('keeps only starts inside the window, inclusive of both ends', () => {
    const p = pitcher({
      player_id: 'a',
      starts: [start('2026-08-09'), start('2026-08-10'), start('2026-08-12'), start('2026-08-13')],
    })
    expect(startsInPeriod(p, PERIOD).map((s) => s.date)).toEqual([
      '2026-08-10',
      '2026-08-12',
    ])
  })
})

describe('pitcherRows', () => {
  const rows = () =>
    board([
      pitcher({
        player_id: 'starting',
        starts: [start('2026-08-11')],
        windows: { last30: { games: 5, fantasy_points: 100, per_game: 20 } },
      }),
      pitcher({
        player_id: 'idle',
        starts: [start('2026-08-20')],
        windows: { last30: { games: 5, fantasy_points: 200, per_game: 40 } },
      }),
      pitcher({
        player_id: 'ours',
        ownership: 'mine',
        starts: [start('2026-08-10')],
        windows: { last30: { games: 5, fantasy_points: 50, per_game: 10 } },
      }),
    ])

  it('drops pitchers with no start in the period, however good', () => {
    const ids = pitcherRows(rows(), PERIOD).map((r) => r.pitcher.player_id)
    expect(ids).not.toContain('idle')
    expect(ids).toContain('starting')
  })

  it('filters to one side of the ownership split when asked', () => {
    const ids = pitcherRows(rows(), PERIOD, { ownership: 'mine' }).map(
      (r) => r.pitcher.player_id,
    )
    expect(ids).toEqual(['ours'])
  })

  it('sorts a thin sample below a graded one rather than on top', () => {
    const b = board([
      pitcher({
        player_id: 'hot-once',
        starts: [start('2026-08-11')],
        windows: { last30: { games: 1, fantasy_points: 40, per_game: 40 } },
      }),
      pitcher({
        player_id: 'steady',
        starts: [start('2026-08-11')],
        windows: { last30: { games: 6, fantasy_points: 120, per_game: 20 } },
      }),
    ])
    expect(pitcherRows(b, PERIOD)[0]?.pitcher.player_id).toBe('steady')
  })

  it('matches the search on name', () => {
    const ids = pitcherRows(rows(), PERIOD, { query: 'OUR' }).map(
      (r) => r.pitcher.player_id,
    )
    expect(ids).toEqual(['ours'])
  })
})

describe('ramps', () => {
  it('excludes thin samples from the spread the grading is measured against', () => {
    const b = board([
      pitcher({
        player_id: 'a',
        windows: { last30: { games: 5, fantasy_points: 50, per_game: 10 } },
      }),
      pitcher({
        player_id: 'b',
        windows: { last30: { games: 5, fantasy_points: 100, per_game: 20 } },
      }),
      pitcher({
        player_id: 'one-off',
        windows: { last30: { games: 1, fantasy_points: 99, per_game: 99 } },
      }),
    ])
    expect(ramps(b).last30.sorted).toEqual([10, 20])
  })

  it('keeps a one-start ERA out of the spread', () => {
    const b = board([
      season('a', 20, { ERA: '3.00' }),
      season('b', 20, { ERA: '4.00' }),
      season('one-off', 1, { ERA: '12.00' }),
    ])
    expect(ramps(b).era.sorted).toEqual([3, 4])
  })

  it('grades a low ERA as the good end', () => {
    const b = board([
      season('a', 20, { ERA: '1.90' }),
      season('b', 20, { ERA: '4.50' }),
      season('c', 20, { ERA: '6.10' }),
    ])
    const r = ramps(b)
    const best = magnitude(1.9, r.era)?.step ?? 0
    const worst = magnitude(6.1, r.era)?.step ?? 0
    expect(best).toBeGreaterThan(worst)
  })
})
