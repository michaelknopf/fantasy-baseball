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

describe('score column', () => {
  it('ranks by the composite rather than raw last-30 when they disagree', () => {
    const soft = (date: string): StartSlot => ({
      ...start(date),
      opponent_runs_rank: 30,
      opponent_strikeouts_rank: 1,
    })
    const tough = (date: string): StartSlot => ({
      ...start(date),
      opponent_runs_rank: 1,
      opponent_strikeouts_rank: 30,
    })
    const b = board([
      pitcher({
        player_id: 'slightly-better-arm',
        starts: [tough('2026-08-11')],
        windows: { last30: { games: 6, fantasy_points: 126, per_game: 21 } },
        season: { games: 20, fantasy_points: 420, per_game: 21 },
      }),
      pitcher({
        player_id: 'great-draw',
        starts: [soft('2026-08-11')],
        windows: { last30: { games: 6, fantasy_points: 120, per_game: 20 } },
        season: { games: 20, fantasy_points: 400, per_game: 20 },
      }),
    ])
    expect(pitcherRows(b, PERIOD, { sort: 'last30' })[0]?.pitcher.player_id).toBe(
      'slightly-better-arm',
    )
    // 21 × 0.85 = 17.9 against 20 × 1.15 = 23 — the draw overturns a 1-point gap.
    expect(pitcherRows(b, PERIOD, { sort: 'score' })[0]?.pitcher.player_id).toBe(
      'great-draw',
    )
  })

  it('sorts an unscorable pitcher last rather than treating him as zero', () => {
    const b = board([
      pitcher({
        player_id: 'thin',
        starts: [start('2026-08-11')],
        windows: { last30: { games: 1, fantasy_points: 99, per_game: 99 } },
      }),
      pitcher({
        player_id: 'real',
        starts: [start('2026-08-11')],
        windows: { last30: { games: 6, fantasy_points: 60, per_game: 10 } },
        season: { games: 20, fantasy_points: 200, per_game: 10 },
      }),
    ])
    const ids = pitcherRows(b, PERIOD, { sort: 'score' }).map((r) => r.pitcher.player_id)
    expect(ids).toEqual(['real', 'thin'])
  })

  it('grades the score cell on form alone, so a shade never shifts with the period', () => {
    const b = board([
      pitcher({
        player_id: 'a',
        season: { games: 20, fantasy_points: 200, per_game: 10 },
        windows: { last30: { games: 6, fantasy_points: 60, per_game: 10 } },
      }),
      pitcher({
        player_id: 'b',
        season: { games: 20, fantasy_points: 600, per_game: 30 },
        windows: { last30: { games: 6, fantasy_points: 180, per_game: 30 } },
      }),
    ])
    const sorted = ramps(b).score.sorted
    expect(sorted).toHaveLength(2)
    expect(sorted[0]).toBeCloseTo(10)
    expect(sorted[1]).toBeCloseTo(30)
  })
})

describe('planned ownership', () => {
  const b = () =>
    board([
      pitcher({
        player_id: 'keeping',
        ownership: 'mine',
        starts: [start('2026-08-11')],
        season: { games: 20, fantasy_points: 400, per_game: 20 },
        windows: { last30: { games: 6, fantasy_points: 120, per_game: 20 } },
      }),
      pitcher({
        player_id: 'dropping',
        ownership: 'mine',
        starts: [start('2026-08-11')],
        season: { games: 20, fantasy_points: 300, per_game: 15 },
        windows: { last30: { games: 6, fantasy_points: 90, per_game: 15 } },
      }),
      pitcher({
        player_id: 'adding',
        ownership: 'free_agent',
        starts: [start('2026-08-11')],
        season: { games: 20, fantasy_points: 500, per_game: 25 },
        windows: { last30: { games: 6, fantasy_points: 150, per_game: 25 } },
      }),
    ])

  /** After planning: drop 'dropping', add 'adding'. */
  const held = new Set(['keeping', 'adding'])

  it('moves a planned add into my rotation', () => {
    const ids = pitcherRows(b(), PERIOD, { ownership: 'mine', held }).map(
      (r) => r.pitcher.player_id,
    )
    expect(ids).toContain('adding')
  })

  it('takes a planned add out of the claimable pool', () => {
    const ids = pitcherRows(b(), PERIOD, { ownership: 'free_agent', held }).map(
      (r) => r.pitcher.player_id,
    )
    expect(ids).not.toContain('adding')
  })

  it('keeps a pitcher being dropped in my rotation, to be struck through', () => {
    // He is on the roster until the waiver run, and the starts being given up
    // are the whole point of the decision — vanishing would hide them.
    const ids = pitcherRows(b(), PERIOD, { ownership: 'mine', held }).map(
      (r) => r.pitcher.player_id,
    )
    expect(ids).toContain('dropping')
  })

  it('does not move a dropped pitcher into the claimable pool', () => {
    const ids = pitcherRows(b(), PERIOD, { ownership: 'free_agent', held }).map(
      (r) => r.pitcher.player_id,
    )
    expect(ids).not.toContain('dropping')
  })

  it('falls back to the snapshot when no plan is supplied', () => {
    const ids = pitcherRows(b(), PERIOD, { ownership: 'mine' }).map(
      (r) => r.pitcher.player_id,
    )
    expect(ids).toEqual(expect.arrayContaining(['keeping', 'dropping']))
    expect(ids).not.toContain('adding')
  })
})
