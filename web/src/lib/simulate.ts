import { isInjuredReserve } from './types'
import type { Board, Pitcher, StartSlot, WaiverPeriod } from './types'

/**
 * A roster change taking effect at one waiver run.
 *
 * A pickup persists into every later period until a `drop` for the same
 * pitcher, so a plan is a short list of changes rather than a full roster
 * restated for each period.
 */
export interface Move {
  /** `starts_on` of the period the move takes effect in. */
  period: string
  /** `activate` restores an injured-reserve player to a usable slot. */
  action: 'add' | 'drop' | 'activate'
  playerId: string
  /**
   * The move this one paid for, if any.
   *
   * The roster is full, so an add or an activation only happens alongside a
   * drop. The drop is a `Move` in its own right — this only records the pairing
   * so undoing one offers to undo the other.
   */
  pairedWith?: string
}

export interface PlannedStart {
  pitcher: Pitcher
  start: StartSlot
  /** False once a pitcher is on injured reserve — the start cannot be used. */
  usable: boolean
}

export interface PeriodPlan {
  period: WaiverPeriod
  starts: PlannedStart[]
  /** Starts consumed in this period, counting only usable ones. */
  startsUsed: number
  /** Cumulative starts consumed through the end of this period. */
  startsUsedCumulative: number
  /** Season cap left once this period is played. */
  capRemaining: number | null
  /** Distinct days on which at least one start is available. */
  daysCovered: number
  projectedPoints: number
}

/** Which pitchers we hold during a given period, given the moves so far. */
export function rosterDuring(
  board: Board,
  moves: Move[],
  period: WaiverPeriod,
): Set<string> {
  const held = new Set(
    board.pitchers
      .filter((p) => p.ownership === 'mine')
      .map((p) => p.player_id),
  )
  for (const move of moves) {
    // A move applies from its own period onward.
    if (move.period > period.starts_on) continue
    if (move.action === 'drop') held.delete(move.playerId)
    else held.add(move.playerId)
  }
  return held
}

/** Who we have taken off injured reserve by the time a period runs. */
export function activatedBy(moves: Move[], period: WaiverPeriod): Set<string> {
  return new Set(
    moves
      .filter((m) => m.action === 'activate' && m.period <= period.starts_on)
      .map((m) => m.playerId),
  )
}

/**
 * The starts a plan produces, period by period.
 *
 * Only starts falling inside a period count toward it, so a pitcher picked up
 * on Monday contributes his Tuesday start but not one from the week after —
 * that lands in the later period, where he is still held.
 */
export function simulate(board: Board, moves: Move[]): PeriodPlan[] {
  const byId = new Map(board.pitchers.map((p) => [p.player_id, p]))
  let cumulative = 0

  return board.periods.map((period) => {
    const held = rosterDuring(board, moves, period)
    const activated = activatedBy(moves, period)
    const starts: PlannedStart[] = []

    for (const playerId of held) {
      const pitcher = byId.get(playerId)
      if (!pitcher) continue
      const usable =
        !isInjuredReserve(pitcher.roster_status) || activated.has(playerId)
      for (const start of pitcher.starts) {
        if (start.date < period.starts_on) continue
        if (start.date > period.ends_on) continue
        starts.push({ pitcher, start, usable })
      }
    }

    starts.sort(
      (a, b) =>
        a.start.date.localeCompare(b.start.date) ||
        a.pitcher.name.localeCompare(b.pitcher.name),
    )

    const usable = starts.filter((s) => s.usable)
    cumulative += usable.length
    const cap = board.starts_remaining
    return {
      period,
      starts,
      startsUsed: usable.length,
      startsUsedCumulative: cumulative,
      capRemaining: cap === null ? null : cap - cumulative,
      daysCovered: new Set(usable.map((s) => s.start.date)).size,
      projectedPoints: round(
        usable.reduce((sum, s) => sum + expectedPoints(s.pitcher), 0),
      ),
    }
  })
}

/**
 * What one start is worth, preferring recent form.
 *
 * Last-30 leads because a month of starts describes a pitcher's current shape
 * better than a season average that includes April. It falls back through wider
 * windows when a pitcher has not started often enough lately to say anything.
 */
export function expectedPoints(pitcher: Pitcher): number {
  const last30 = pitcher.windows?.last30
  if (last30 && last30.games >= 3) return last30.per_game
  const last60 = pitcher.windows?.last60
  if (last60 && last60.games >= 3) return last60.per_game
  return pitcher.season?.per_game ?? 0
}

/** The window `expectedPoints` actually used, for labelling it in the UI. */
export function formBasis(pitcher: Pitcher): string {
  if ((pitcher.windows?.last30?.games ?? 0) >= 3) return 'last 30d'
  if ((pitcher.windows?.last60?.games ?? 0) >= 3) return 'last 60d'
  return 'season'
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
