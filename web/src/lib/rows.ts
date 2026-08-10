import { distribution } from './magnitude'
import type { Distribution } from './magnitude'
import type { Board, Form, Pitcher, StartSlot, WaiverPeriod } from './types'

/** Fewer than this and a rate is noise, so it is shown but never graded. */
export const THIN_SAMPLE = 3

export interface PitcherRow {
  pitcher: Pitcher
  /** Only the starts falling inside the selected period. */
  starts: StartSlot[]
}

/** One graded column's spread, computed once for the whole board. */
export interface Ramps {
  last30: Distribution
  last60: Distribution
  season: Distribution
  era: Distribution
  whip: Distribution
}

export type SortKey = 'last30' | 'last60' | 'season' | 'starts' | 'name'

export function startsInPeriod(
  pitcher: Pitcher,
  period: WaiverPeriod,
): StartSlot[] {
  return pitcher.starts.filter(
    (s) => s.date >= period.starts_on && s.date <= period.ends_on,
  )
}

/**
 * The pitchers worth showing for one waiver period.
 *
 * A pitcher with no start inside the period cannot help during it, however good
 * he is, so the period is the filter rather than a column.
 */
export function pitcherRows(
  board: Board,
  period: WaiverPeriod,
  opts: {
    ownership?: Pitcher['ownership']
    query?: string
    sort?: SortKey
    limit?: number
  } = {},
): PitcherRow[] {
  const query = opts.query?.trim().toLowerCase() ?? ''
  const sort = opts.sort ?? 'last30'

  const rows = board.pitchers
    .filter((p) => !opts.ownership || p.ownership === opts.ownership)
    .filter((p) => !query || p.name.toLowerCase().includes(query))
    .map((p) => ({ pitcher: p, starts: startsInPeriod(p, period) }))
    .filter((r) => r.starts.length > 0)
    .sort((a, b) => compare(a, b, sort))

  return opts.limit === undefined ? rows : rows.slice(0, opts.limit)
}

/**
 * How each column is spread, measured across every pitcher on the board.
 *
 * Deliberately not per-period: a number that changed shade when you switched
 * periods would be reporting the field it happens to be in, not the pitcher.
 */
export function ramps(board: Board): Ramps {
  const rate = (p: Pitcher, key: 'last30' | 'last60') =>
    graded(p.windows?.[key]?.games, p.windows?.[key]?.per_game)
  return {
    last30: distribution(board.pitchers.map((p) => rate(p, 'last30')), 'high-good'),
    last60: distribution(board.pitchers.map((p) => rate(p, 'last60')), 'high-good'),
    season: distribution(
      board.pitchers.map((p) => graded(p.season?.games, p.season?.per_game)),
      'high-good',
    ),
    era: distribution(
      board.pitchers.map((p) => graded(p.season?.games, numeric(p.stats.ERA))),
      'low-good',
    ),
    whip: distribution(
      board.pitchers.map((p) => graded(p.season?.games, numeric(p.stats.WHIP))),
      'low-good',
    ),
  }
}

/** A rate only counts toward the spread once it rests on enough games. */
function graded(
  games: number | undefined,
  value: number | null | undefined,
): number | null {
  return (games ?? 0) >= THIN_SAMPLE ? (value ?? null) : null
}

export function numeric(raw: string | undefined): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function compare(a: PitcherRow, b: PitcherRow, sort: SortKey): number {
  switch (sort) {
    case 'name':
      return a.pitcher.name.localeCompare(b.pitcher.name)
    case 'starts':
      return (
        b.starts.length - a.starts.length ||
        (a.starts[0]?.date ?? '').localeCompare(b.starts[0]?.date ?? '')
      )
    case 'season':
      return rank(b.pitcher.season) - rank(a.pitcher.season)
    default:
      return rank(b.pitcher.windows?.[sort]) - rank(a.pitcher.windows?.[sort])
  }
}

/** Sorts a thin sample to the bottom rather than letting one hot start lead. */
function rank(form: Form | null | undefined): number {
  if (!form || form.games < THIN_SAMPLE) return -1
  return form.per_game
}
