import { describe, expect, it } from 'vitest'
import { rosterDuring, simulate } from './simulate'
import type { Board, Pitcher } from './types'

function pitcher(over: Partial<Pitcher> & { player_id: string }): Pitcher {
  return {
    name: over.player_id,
    mlb_team: 'XXX',
    positions: 'SP',
    ownership: 'free_agent',
    roster_status: null,
    starts: [],
    season: { games: 20, fantasy_points: 400, per_game: 20 },
    windows: {},
    stats: {},
    recent_games: [],
    ...over,
  }
}

const BOARD: Board = {
  generated_at: '2026-08-09',
  collected_through: '2026-08-14',
  starts_remaining: 10,
  starts_max: 125,
  claim_budget: 228,
  active_pitcher_slots: 6,
  periods: [
    {
      starts_on: '2026-08-10',
      ends_on: '2026-08-12',
      label: 'Mon 8/10',
      free_agents_known: true,
    },
    {
      starts_on: '2026-08-13',
      ends_on: '2026-08-14',
      label: 'Thu 8/13',
      free_agents_known: true,
    },
  ],
  pitchers: [
    pitcher({
      player_id: 'mine1',
      ownership: 'mine',
      roster_status: 'reserve',
      starts: [
        {
          date: '2026-08-10',
          label: 'Mon 8/10',
          opponent: 'KC',
          is_away: false,
          opposing_pitcher: null,
        },
      ],
    }),
    pitcher({
      player_id: 'hurt',
      ownership: 'mine',
      roster_status: 'injured_reserve',
      starts: [
        {
          date: '2026-08-11',
          label: 'Tue 8/11',
          opponent: 'KC',
          is_away: false,
          opposing_pitcher: null,
        },
      ],
    }),
    pitcher({
      player_id: 'fa1',
      starts: [
        {
          date: '2026-08-11',
          label: 'Tue 8/11',
          opponent: 'BOS',
          is_away: true,
          opposing_pitcher: null,
        },
        {
          date: '2026-08-14',
          label: 'Fri 8/14',
          opponent: 'NYY',
          is_away: false,
          opposing_pitcher: null,
        },
      ],
    }),
  ],
  rivals: [],
}

describe('rosterDuring', () => {
  it('starts from who we already hold', () => {
    const held = rosterDuring(BOARD, [], BOARD.periods[0]!)
    expect(held).toEqual(new Set(['mine1', 'hurt']))
  })

  it('keeps a pickup in later periods without restating it', () => {
    const moves = [
      { period: '2026-08-10', action: 'add' as const, playerId: 'fa1' },
    ]
    expect(rosterDuring(BOARD, moves, BOARD.periods[1]!)).toContain('fa1')
  })

  it('ignores a move that has not taken effect yet', () => {
    const moves = [
      { period: '2026-08-13', action: 'add' as const, playerId: 'fa1' },
    ]
    expect(rosterDuring(BOARD, moves, BOARD.periods[0]!)).not.toContain(
      'fa1',
    )
  })

  it('drops a pitcher from the period the drop lands in', () => {
    const moves = [
      { period: '2026-08-13', action: 'drop' as const, playerId: 'mine1' },
    ]
    expect(rosterDuring(BOARD, moves, BOARD.periods[0]!)).toContain('mine1')
    expect(rosterDuring(BOARD, moves, BOARD.periods[1]!)).not.toContain(
      'mine1',
    )
  })
})

describe('simulate', () => {
  it('counts only starts falling inside each period', () => {
    const moves = [
      { period: '2026-08-10', action: 'add' as const, playerId: 'fa1' },
    ]
    const [first, second] = simulate(BOARD, moves)
    // fa1 starts 8/11 (period 1) and 8/14 (period 2).
    expect(first!.startsUsed).toBe(2) // mine1 + fa1
    expect(second!.startsUsed).toBe(1) // fa1's second start
  })

  it('excludes injured-reserve starts, which cannot be used', () => {
    const [first] = simulate(BOARD, [])
    expect(first!.starts.some((s) => s.pitcher.player_id === 'hurt')).toBe(
      true,
    )
    expect(first!.startsUsed).toBe(1) // only mine1 counts
  })

  it('tracks the cap cumulatively across periods', () => {
    const moves = [
      { period: '2026-08-10', action: 'add' as const, playerId: 'fa1' },
    ]
    const [first, second] = simulate(BOARD, moves)
    expect(first!.startsUsedCumulative).toBe(2)
    expect(first!.capRemaining).toBe(8)
    expect(second!.startsUsedCumulative).toBe(3)
    expect(second!.capRemaining).toBe(7)
  })

  it('counts distinct days, not starts, as coverage', () => {
    const moves = [
      { period: '2026-08-10', action: 'add' as const, playerId: 'fa1' },
    ]
    const [first] = simulate(BOARD, moves)
    // 8/10 and 8/11 — two different days.
    expect(first!.daysCovered).toBe(2)
  })
})
