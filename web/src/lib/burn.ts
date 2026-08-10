/**
 * What the rotation costs if we never stream.
 *
 * The probable-start feed only runs a week or so out, so counting scheduled
 * starts answers "what happens next week", not "do I have enough starts to
 * reach the final". That question is rotation arithmetic instead: a starter
 * takes the ball every fifth team game, and a team plays six days in seven.
 */

import { isInjuredReserve } from './types'
import type { Board, RosterEntry } from './types'

/** Days a team plays in a week. The seventh is the league's scheduled off day. */
const GAME_DAYS_PER_WEEK = 6 / 7

/** A rotation turn. Skipped starts and doubleheaders roughly cancel out. */
const ROTATION_SIZE = 5

export interface Burn {
  /** Calendar days from the first waiver run through the final. */
  days: number
  /** Team games those days hold, at six per seven. */
  gameDays: number
  /** Turns one starter gets in that span. */
  startsPerStarter: number
  /** Starters we hold who can take a turn — injured reserve excluded. */
  starters: number
  /** Starters we hold who cannot, because they are on injured reserve. */
  shelved: number
  /** Starts the rotation burns unattended. */
  projected: number
  /**
   * Cap left once it has — the starts left over to stream with.
   *
   * Negative means the rotation alone overruns the cap, so the decision becomes
   * which of our own starts to sit rather than who to add.
   */
  capRemaining: number | null
}

/**
 * The rotation's own burn between two dates.
 *
 * `finalOn` is the last day of the playoff run, which Fantrax does not report —
 * it is ours to supply, and every number here scales with it.
 */
export function burn(board: Board, finalOn: string): Burn {
  const opensOn = board.periods[0]?.starts_on ?? board.generated_at
  const days = daysBetween(opensOn, finalOn)
  const gameDays = days * GAME_DAYS_PER_WEEK
  const startsPerStarter = gameDays / ROTATION_SIZE

  const held = board.roster.filter((e) => e.role === 'starter')
  const starters = held.filter((e) => !isInjuredReserve(e.roster_status))
  const projected = Math.round(starters.length * startsPerStarter)
  const cap = board.starts_remaining

  return {
    days,
    gameDays: round(gameDays),
    startsPerStarter: round(startsPerStarter),
    starters: starters.length,
    shelved: held.length - starters.length,
    projected,
    capRemaining: cap === null ? null : cap - projected,
  }
}

/**
 * The same burn with a different rotation size, for "what if I carried one
 * fewer arm". Streaming adds starters, so the count is the lever, not the dates.
 */
export function burnWith(base: Burn, starters: number): number {
  return Math.round(starters * base.startsPerStarter)
}

/** Starters we could carry before the cap runs out, rounded down. */
export function affordableStarters(base: Burn, cap: number | null): number | null {
  if (cap === null || base.startsPerStarter === 0) return null
  return Math.floor(cap / base.startsPerStarter)
}

/** Inclusive of both ends: 8/10 through 8/11 is two days, not one. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

/** The starters this projection counts, so the figure can be shown its inputs. */
export function projectedStarters(board: Board): RosterEntry[] {
  return board.roster.filter(
    (e) => e.role === 'starter' && !isInjuredReserve(e.roster_status),
  )
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
