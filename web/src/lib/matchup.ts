import { matchupOf } from './score'
import type { StartSlot } from './types'

export type MatchupTier = 'tough' | 'even' | 'soft' | 'unknown'

/** Where a matchup stops being a coin flip, on the −1…+1 scale. */
const EDGE = 0.33

/**
 * How favourable a start's matchup is, as a word.
 *
 * Reads the same two-axis figure the score does, rather than runs alone: a row
 * labelled "soft" while the score marked it down would be two answers to one
 * question. The Angels are the case — 26th in runs, but they rarely strike out.
 */
export function matchupTier(start: StartSlot | undefined): MatchupTier {
  if (!start) return 'unknown'
  if (start.opponent_runs_rank === null && start.opponent_strikeouts_rank === null) {
    return 'unknown'
  }
  const value = matchupOf(start)
  if (value <= -EDGE) return 'tough'
  if (value >= EDGE) return 'soft'
  return 'even'
}

/** The hardest offense a pitcher faces in a period, which is what bounds his floor. */
export function toughestTier(starts: StartSlot[]): MatchupTier {
  const rated = starts.filter(
    (s) => s.opponent_runs_rank !== null || s.opponent_strikeouts_rank !== null,
  )
  if (rated.length === 0) return 'unknown'
  const hardest = rated.reduce((worst, s) =>
    matchupOf(s) < matchupOf(worst) ? s : worst,
  )
  return matchupTier(hardest)
}
