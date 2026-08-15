/** Turning a playoff matchup into the widths and words the card renders. */

import type { PlayoffMatchup, PlayoffRound, PlayoffSide } from '@/lib/types'

/** How a side's bar is split between its seed spot and what it earned. */
export interface BarSegments {
  /** Percentages of the round's peak score, so every bar shares one axis. */
  spot: number
  earned: number
  total: number
}

/**
 * The two segments of a side's bar.
 *
 * Scaled against the round's best score rather than each matchup's own, so a
 * bar's length means the same thing everywhere on the page. A round with no
 * scores yet has no axis to scale against, so nothing is drawn.
 */
export function barSegments(
  side: PlayoffSide,
  peak: number | null,
): BarSegments | null {
  if (side.matchup_points === null || !peak || peak <= 0) return null
  const scale = (value: number) => Math.max(0, (value / peak) * 100)
  return {
    spot: scale(side.advantage),
    earned: scale(side.earned ?? 0),
    total: scale(side.matchup_points),
  }
}

/** Whether a side is the one currently ahead. */
export function isLeading(matchup: PlayoffMatchup, side: PlayoffSide): boolean {
  return matchup.leader !== null && side.team !== null && matchup.leader === side.team
}

/**
 * What to call a side when it has no team yet.
 *
 * A slot fed by an unfinished matchup shows what it is waiting on rather than
 * the current leader — leading a round is not winning it.
 */
export function sideLabel(side: PlayoffSide): string {
  return side.team ?? side.awaiting ?? 'To be decided'
}

/** How the round reads in the header: live, finished, or still ahead of us. */
export function roundTiming(round: PlayoffRound, today: string): string | null {
  const days = daysBetween(today, round.state === 'upcoming' ? round.starts_on : round.ends_on)
  if (round.state === 'done') return 'final'
  if (round.state === 'upcoming') {
    if (days <= 0) return 'starts today'
    return `starts in ${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (days <= 0) return 'ends today'
  return `${days} ${days === 1 ? 'day' : 'days'} left`
}

/** Whole days from `from` to `to`, both ISO dates. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** The margin as the leader's own gain, so the sign never has to be read. */
export function marginOf(matchup: PlayoffMatchup): number | null {
  return matchup.margin === null ? null : Math.abs(matchup.margin)
}
