import type { StartSlot } from './types'

export type MatchupTier = 'tough' | 'even' | 'soft' | 'unknown'

/**
 * How hard the offense a start faces is, from its league rank in runs.
 *
 * Rank 1 is the best-hitting team in baseball, so a high rank is the soft draw
 * a streamer wants. Thirds of the league rather than percentiles: the rank is
 * already the ordering, and thirds are what a reader can hold in their head.
 */
export function matchupTier(runsRank: number | null): MatchupTier {
  if (runsRank === null) return 'unknown'
  if (runsRank <= 10) return 'tough'
  if (runsRank <= 20) return 'even'
  return 'soft'
}

/** The hardest offense a pitcher faces in a period, which is what bounds his floor. */
export function toughestTier(starts: StartSlot[]): MatchupTier {
  const ranks = starts
    .map((s) => s.opponent_runs_rank)
    .filter((r): r is number => r !== null)
  if (ranks.length === 0) return 'unknown'
  return matchupTier(Math.min(...ranks))
}
