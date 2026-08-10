/**
 * One number to rank a start by, combining form with the matchup.
 *
 * Two stages, because the inputs are different kinds of thing. The three form
 * windows measure one quantity at different recencies — they correlate ~0.81 on
 * this board, carrying about 1.15 independent measurements between them — so
 * they collapse into a single weighted mean rather than voting as three terms.
 * The matchup is genuinely new information, and multiplies that form.
 */

import type { Pitcher, StartSlot } from './types'

/**
 * Recency weights over the three windows. They sum to 1, so `form` stays in
 * fantasy points per start and can be read directly against a raw FP/G column.
 */
const RECENCY = { last30: 0.5, last60: 0.3, season: 0.2 } as const

/** Below this a window is noise, and its weight is redistributed. */
const THIN_SAMPLE = 3

/**
 * How far the matchup can swing a start, either way.
 *
 * Opponent offense spans about ±8% around league average while pitcher form
 * spans ±35%, so a weight that let the matchup outrank form would recommend
 * weak pitchers in soft spots. At 0.15 the full range is a 30% swing: decisive
 * among the middle of the pool, where streaming decisions actually live, and
 * never enough to lift a 10-point arm over a 20-point one.
 */
const MATCHUP_SWING = 0.15

/** Teams in MLB, so a rank can be put on a signed scale. */
const TEAMS = 30

export interface Score {
  /** Recency-weighted fantasy points per start, before the matchup. */
  form: number
  /** −1 (hardest matchup) to +1 (softest). */
  matchup: number
  /** `form` adjusted by the matchup — the number to rank on. */
  value: number
}

/**
 * Scores one scheduled start.
 *
 * Returns null when a pitcher has no window with enough games behind it: a
 * single good outing is not evidence, and ranking on it puts noise at the top.
 */
export function score(pitcher: Pitcher, start: StartSlot | undefined): Score | null {
  const form = formOf(pitcher)
  if (form === null) return null

  const matchup = matchupOf(start)
  return {
    form: round(form),
    matchup: round(matchup),
    // Multiplicative: a soft matchup is worth more to a good pitcher than a
    // weak one, where a flat bonus would credit both equally.
    value: round(form * (1 + MATCHUP_SWING * matchup)),
  }
}

/**
 * The three windows as one recency-weighted number.
 *
 * A window short of `THIN_SAMPLE` games drops out and its weight is spread over
 * the rest, so a pitcher back from injury is scored on what he has rather than
 * being dragged toward zero by an empty last-30.
 */
export function formOf(pitcher: Pitcher): number | null {
  const parts: [number, number][] = []
  for (const [key, weight] of Object.entries(RECENCY)) {
    const window =
      key === 'season' ? pitcher.season : (pitcher.windows?.[key] ?? null)
    if (window && window.games >= THIN_SAMPLE) parts.push([window.per_game, weight])
  }
  if (parts.length === 0) return null

  const total = parts.reduce((sum, [, w]) => sum + w, 0)
  return parts.reduce((sum, [value, w]) => sum + value * w, 0) / total
}

/**
 * How favourable the opposing offense is, −1 (hardest) to +1 (softest).
 *
 * Runs and strikeouts are weighted equally: runs matter more per unit, but the
 * strikeout axis is spread wider, and the two roughly cancel.
 *
 * Both are carried because they are close to uncorrelated (−0.07 on this board),
 * so each says something the other cannot. Toronto is the case that justifies
 * it: a weak offense that rarely strikes out, which a runs-only view would call
 * a soft matchup and a strikeout pitcher would find frustrating.
 */
export function matchupOf(start: StartSlot | undefined): number {
  if (!start) return 0
  const axes: number[] = []

  // Rank 1 is the best offense, so a high rank is the soft matchup a streamer
  // wants — hence the rank maps directly, not inverted.
  if (start.opponent_runs_rank !== null) axes.push(signed(start.opponent_runs_rank))
  // Rank 1 strikes out most, which helps us, so this axis is flipped.
  if (start.opponent_strikeouts_rank !== null) {
    axes.push(-signed(start.opponent_strikeouts_rank))
  }

  if (axes.length === 0) return 0
  return axes.reduce((sum, a) => sum + a, 0) / axes.length
}

/** A 1–30 rank onto −1…+1, with the median team at zero. */
function signed(rank: number): number {
  return ((rank - 1) / (TEAMS - 1)) * 2 - 1
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
