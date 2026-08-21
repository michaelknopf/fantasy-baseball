import { describe, expect, it } from 'vitest'
import {
  blockedReason,
  dropCandidates,
  rosterStateDuring,
  validateLedger,
} from './roster'
import type { Move } from './simulate'
import type { Board, Pitcher, RosterEntry, StartSlot, WaiverPeriod } from './types'
import { IR_STATUS } from './types'

const PERIODS: WaiverPeriod[] = [
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
]

function entry(
  player_id: string,
  role: RosterEntry['role'],
  perGame: number,
  status: string | null = 'owned',
): RosterEntry {
  return {
    player_id,
    name: player_id,
    mlb_team: 'XXX',
    positions: null,
    role,
    roster_status: status,
    season: { games: 20, fantasy_points: perGame * 20, per_game: perGame },
    windows: {},
  }
}

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

function pitcher(player_id: string, starts: StartSlot[]): Pitcher {
  return {
    player_id,
    name: player_id,
    mlb_team: 'XXX',
    positions: 'SP',
    ownership: 'mine',
    roster_status: 'owned',
    rostered_pct: null,
    owned_by: null,
    starts,
    season: null,
    windows: {},
    stats: {},
    recent_games: [],
  }
}

/** Three active spots and one on IR, so capacity is 3 and it is full. */
const BOARD: Board = {
  generated_at: '2026-08-09',
  synced_at: '2026-08-09T12:00:00-07:00',
  collected_through: '2026-08-14',
  starts_remaining: 63,
  starts_max: 125,
  claim_budget: 228,
  active_pitcher_slots: 6,
  periods: PERIODS,
  pitchers: [pitcher('ace', [start('2026-08-11')]), pitcher('hurt', [])],
  rivals: [],
  slots: { active: 2, reserve: 1, injured_reserve: 1 },
  roster: [
    entry('ace', 'starter', 30),
    entry('arm', 'reliever', 8),
    entry('bat', 'hitter', 3),
    entry('hurt', 'starter', 28, IR_STATUS),
  ],
}

describe('rosterStateDuring', () => {
  it('counts the full roster against capacity before any move', () => {
    const state = rosterStateDuring(BOARD, [], PERIODS[0]!)
    expect(state.used).toBe(3)
    expect(state.capacity).toBe(3)
    expect(state.injured).toEqual(new Set(['hurt']))
  })

  it('treats an activation as filling an active slot, not freeing one', () => {
    const moves: Move[] = [
      { period: '2026-08-10', action: 'activate', playerId: 'hurt' },
    ]
    const state = rosterStateDuring(BOARD, moves, PERIODS[0]!)
    expect(state.used).toBe(4)
    expect(state.injured.has('hurt')).toBe(false)
  })

  it('ignores moves from a later period', () => {
    const moves: Move[] = [
      { period: '2026-08-13', action: 'drop', playerId: 'bat' },
    ]
    expect(rosterStateDuring(BOARD, moves, PERIODS[0]!).used).toBe(3)
    expect(rosterStateDuring(BOARD, moves, PERIODS[1]!).used).toBe(2)
  })
})

describe('blockedReason', () => {
  const full = () => rosterStateDuring(BOARD, [], PERIODS[0]!)

  it('blocks an add on a full roster', () => {
    expect(blockedReason(full(), 'add')?.kind).toBe('roster-full')
  })

  it('blocks an activation on a full roster, since IR does not pay for itself', () => {
    expect(blockedReason(full(), 'activate')?.kind).toBe('no-ir-slot')
  })

  it('never blocks a drop', () => {
    expect(blockedReason(full(), 'drop')).toBeNull()
  })

  it('allows an add once a drop has made room', () => {
    const moves: Move[] = [
      { period: '2026-08-10', action: 'drop', playerId: 'bat' },
    ]
    const state = rosterStateDuring(BOARD, moves, PERIODS[0]!)
    expect(blockedReason(state, 'add')).toBeNull()
  })
})

describe('dropCandidates', () => {
  it('groups by role rather than ranking incomparable rates together', () => {
    const groups = dropCandidates(
      BOARD,
      rosterStateDuring(BOARD, [], PERIODS[0]!),
      PERIODS[0]!,
    )
    expect(groups.map((g) => g.role)).toEqual([
      'injured',
      'starter',
      'reliever',
      'hitter',
    ])
  })

  it('ranks weakest first inside a group', () => {
    const b: Board = {
      ...BOARD,
      roster: [
        entry('good', 'starter', 30),
        entry('weak', 'starter', 12),
        entry('mid', 'starter', 20),
      ],
      slots: { active: 3, reserve: 0, injured_reserve: 0 },
    }
    const groups = dropCandidates(b, rosterStateDuring(b, [], PERIODS[0]!), PERIODS[0]!)
    const starters = groups.find((g) => g.role === 'starter')
    expect(starters?.candidates.map((c) => c.playerId)).toEqual([
      'weak',
      'mid',
      'good',
    ])
  })

  it('says how many starts a drop forfeits in the period being planned', () => {
    const groups = dropCandidates(
      BOARD,
      rosterStateDuring(BOARD, [], PERIODS[0]!),
      PERIODS[0]!,
    )
    const ace = groups
      .flatMap((g) => g.candidates)
      .find((c) => c.playerId === 'ace')
    expect(ace?.forfeits).toBe(1)
  })

  it('collapses hitters but never pitchers', () => {
    const groups = dropCandidates(
      BOARD,
      rosterStateDuring(BOARD, [], PERIODS[0]!),
      PERIODS[0]!,
    )
    expect(groups.find((g) => g.role === 'hitter')?.collapsible).toBe(true)
    expect(groups.find((g) => g.role === 'starter')?.collapsible).toBe(false)
  })

  it('leaves a dropped player out of later candidate lists', () => {
    const moves: Move[] = [
      { period: '2026-08-10', action: 'drop', playerId: 'bat' },
    ]
    const state = rosterStateDuring(BOARD, moves, PERIODS[0]!)
    const ids = dropCandidates(BOARD, state, PERIODS[0]!).flatMap((g) =>
      g.candidates.map((c) => c.playerId),
    )
    expect(ids).not.toContain('bat')
  })
})

describe('validateLedger', () => {
  it('accepts a drop paying for an add in the same period', () => {
    const moves: Move[] = [
      { period: '2026-08-10', action: 'drop', playerId: 'bat' },
      { period: '2026-08-10', action: 'add', playerId: 'fa' },
    ]
    expect(validateLedger(BOARD, moves).every((e) => !e.blocked)).toBe(true)
  })

  it('settles a drop before the move it pays for, whatever order they are listed in', () => {
    const moves: Move[] = [
      { period: '2026-08-10', action: 'activate', playerId: 'hurt' },
      { period: '2026-08-10', action: 'drop', playerId: 'arm' },
    ]
    expect(validateLedger(BOARD, moves).every((e) => !e.blocked)).toBe(true)
  })

  it('flags an add left unpaid once its drop is undone', () => {
    const moves: Move[] = [
      { period: '2026-08-10', action: 'add', playerId: 'fa' },
    ]
    const [entry] = validateLedger(BOARD, moves)
    expect(entry?.blocked?.kind).toBe('roster-full')
  })

  it('carries a freed slot forward into a later period', () => {
    const moves: Move[] = [
      { period: '2026-08-10', action: 'drop', playerId: 'bat' },
      { period: '2026-08-13', action: 'add', playerId: 'fa' },
    ]
    expect(validateLedger(BOARD, moves).every((e) => !e.blocked)).toBe(true)
  })
})
