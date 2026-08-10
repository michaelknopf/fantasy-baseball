import { describe, expect, it } from 'vitest'
import { affordableStarters, burn, burnWith, daysBetween } from './burn'
import { IR_STATUS } from './types'
import type { Board, RosterEntry } from './types'

function entry(
  name: string,
  role: RosterEntry['role'],
  roster_status = 'owned',
): RosterEntry {
  return {
    player_id: name,
    name,
    mlb_team: 'ATL',
    positions: role === 'hitter' ? '1B' : role === 'starter' ? 'SP' : 'RP',
    role,
    roster_status,
    season: null,
    windows: {},
  }
}

function board(roster: RosterEntry[], startsRemaining: number | null): Board {
  return {
    generated_at: '2026-08-09',
    collected_through: '2026-08-14',
    starts_remaining: startsRemaining,
    starts_max: 125,
    claim_budget: 100,
    active_pitcher_slots: 6,
    periods: [
      {
        starts_on: '2026-08-10',
        ends_on: '2026-08-12',
        label: 'Mon 8/10',
        free_agents_known: true,
      },
    ],
    pitchers: [],
    rivals: [],
    slots: null,
    roster,
  }
}

describe('daysBetween', () => {
  it('counts both ends, so a single day is one', () => {
    expect(daysBetween('2026-08-10', '2026-08-10')).toBe(1)
    expect(daysBetween('2026-08-10', '2026-08-11')).toBe(2)
  })

  it('spans the playoff run', () => {
    expect(daysBetween('2026-08-10', '2026-09-20')).toBe(42)
  })
})

describe('burn', () => {
  const eight = Array.from({ length: 8 }, (_, i) => entry(`SP${i}`, 'starter'))

  it('projects from rotation turns, not from scheduled starts', () => {
    const b = burn(board(eight, 63), '2026-09-20')
    // 42 days × 6/7 = 36 team games; ÷ 5 = 7.2 turns each; × 8 arms = 58.
    expect(b.gameDays).toBe(36)
    expect(b.startsPerStarter).toBe(7.2)
    expect(b.projected).toBe(58)
    expect(b.capRemaining).toBe(5)
  })

  it('excludes injured reserve from the count but reports it', () => {
    const roster = [...eight.slice(0, 6), entry('Hurt', 'starter', IR_STATUS)]
    const b = burn(board(roster, 63), '2026-09-20')
    expect(b.starters).toBe(6)
    expect(b.shelved).toBe(1)
    expect(b.projected).toBe(43)
  })

  it('ignores relievers and hitters, who never consume a start', () => {
    const roster = [
      ...eight,
      entry('RP', 'reliever'),
      entry('Bat', 'hitter'),
    ]
    expect(burn(board(roster, 63), '2026-09-20').projected).toBe(58)
  })

  it('goes negative when the rotation alone overruns the cap', () => {
    expect(burn(board(eight, 40), '2026-09-20').capRemaining).toBe(-18)
  })

  it('reports no cap rather than zero when the league does not say', () => {
    expect(burn(board(eight, null), '2026-09-20').capRemaining).toBeNull()
  })

  it('measures from the first waiver run, not from today', () => {
    // The snapshot is 8/09 but the first period opens 8/10, and a start cannot
    // be spent before then.
    expect(burn(board(eight, 63), '2026-09-20').days).toBe(42)
  })
})

describe('burnWith', () => {
  it('rescales the same span to a different rotation size', () => {
    const b = burn(board([entry('SP', 'starter')], 63), '2026-09-20')
    expect(burnWith(b, 8)).toBe(58)
    expect(burnWith(b, 6)).toBe(43)
  })
})

describe('affordableStarters', () => {
  it('rounds down, since a partial arm still takes every turn', () => {
    const b = burn(board([entry('SP', 'starter')], 63), '2026-09-20')
    // 63 / 7.2 = 8.75 — the ninth arm would not fit.
    expect(affordableStarters(b, 63)).toBe(8)
  })

  it('reports nothing without a cap', () => {
    const b = burn(board([entry('SP', 'starter')], null), '2026-09-20')
    expect(affordableStarters(b, null)).toBeNull()
  })
})
