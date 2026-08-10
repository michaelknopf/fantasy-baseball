import { THIN_SAMPLE, startsInPeriod } from './rows'
import type { Move } from './simulate'
import { isInjuredReserve } from './types'
import type { Board, RosterRole, WaiverPeriod } from './types'

/**
 * Whether a plan is legal, kept apart from what a plan produces.
 *
 * `simulate` answers "how many starts does this get me"; this answers "am I
 * allowed to do it". The roster is full at 27 of 27, so every add costs a drop,
 * and an activation costs one too — taking a player off injured reserve empties
 * a slot no healthy player can occupy and fills a real one.
 */

export type BlockReason =
  | { kind: 'roster-full'; message: string }
  | { kind: 'no-ir-slot'; message: string }

export interface RosterState {
  /** Players we hold and can field, by id. */
  active: Set<string>
  /** Players on injured reserve who have not been activated. */
  injured: Set<string>
  /** Filled slots against the total we hold. */
  used: number
  capacity: number
}

export interface DropCandidate {
  playerId: string
  name: string
  role: RosterRole
  mlbTeam: string | null
  /** Season rate, or null when too thin to state. */
  perGame: number | null
  games: number
  injured: boolean
  /** Starts this player would forfeit in the period being planned. */
  forfeits: number
}

export interface CandidateGroup {
  role: RosterRole | 'injured'
  label: string
  candidates: DropCandidate[]
  /** Hitters collapse behind a toggle; pitchers never do. */
  collapsible: boolean
}

/** Where the roster stands once the plan's moves through this period are applied. */
export function rosterStateDuring(
  board: Board,
  moves: Move[],
  period: WaiverPeriod,
): RosterState {
  const active = new Set<string>()
  const injured = new Set<string>()
  for (const entry of board.roster) {
    if (isInjuredReserve(entry.roster_status)) injured.add(entry.player_id)
    else active.add(entry.player_id)
  }

  const applicable = moves.filter((m) => m.period <= period.starts_on)
  for (const move of applicable) {
    if (move.action === 'drop') {
      active.delete(move.playerId)
      injured.delete(move.playerId)
    } else if (move.action === 'activate') {
      injured.delete(move.playerId)
      active.add(move.playerId)
    } else {
      active.add(move.playerId)
    }
  }

  const capacity = board.slots
    ? board.slots.active + board.slots.reserve
    : active.size
  return { active, injured, used: active.size, capacity }
}

/** Why a move cannot be made yet, or null when it can. */
export function blockedReason(
  state: RosterState,
  action: Move['action'],
): BlockReason | null {
  if (action === 'drop') return null
  if (state.used < state.capacity) return null
  return {
    kind: action === 'activate' ? 'no-ir-slot' : 'roster-full',
    message:
      action === 'activate'
        ? `Activating fills an active slot, and all ${state.capacity} are taken. Drop someone first.`
        : `All ${state.capacity} roster spots are taken. Drop someone first.`,
  }
}

/**
 * Who could be dropped, grouped by role.
 *
 * Grouped rather than one ranked list because the rates are not comparable: a
 * starter at 22 points a start and a hitter at 3 a game are both ordinary, and
 * sorting them together would put every hitter at the bottom as if they were
 * the obvious cuts.
 */
export function dropCandidates(
  board: Board,
  state: RosterState,
  period: WaiverPeriod,
): CandidateGroup[] {
  const starts = new Map(
    board.pitchers.map((p) => [p.player_id, startsInPeriod(p, period).length]),
  )

  const candidates: DropCandidate[] = board.roster
    .filter((e) => state.active.has(e.player_id) || state.injured.has(e.player_id))
    .map((e) => ({
      playerId: e.player_id,
      name: e.name,
      role: e.role,
      mlbTeam: e.mlb_team,
      perGame:
        (e.season?.games ?? 0) >= THIN_SAMPLE ? (e.season?.per_game ?? null) : null,
      games: e.season?.games ?? 0,
      injured: state.injured.has(e.player_id),
      forfeits: starts.get(e.player_id) ?? 0,
    }))

  const group = (
    role: CandidateGroup['role'],
    label: string,
    pick: (c: DropCandidate) => boolean,
    collapsible = false,
  ): CandidateGroup => ({
    role,
    label,
    collapsible,
    // Weakest first: the list is a ranking of who you would give up soonest.
    candidates: candidates
      .filter(pick)
      .sort((a, b) => (a.perGame ?? -1) - (b.perGame ?? -1)),
  })

  return [
    group('injured', 'On injured reserve', (c) => c.injured),
    group('starter', 'Starting pitchers', (c) => !c.injured && c.role === 'starter'),
    group('reliever', 'Relievers', (c) => !c.injured && c.role === 'reliever'),
    group('hitter', 'Hitters', (c) => !c.injured && c.role === 'hitter', true),
  ].filter((g) => g.candidates.length > 0)
}

export interface LedgerEntry {
  move: Move
  blocked: BlockReason | null
}

/**
 * The plan replayed in order, marking any move that has become illegal.
 *
 * Recomputed whole on every change rather than invalidated incrementally — it
 * is 7 periods against 27 players — and a move that stops being legal is shown
 * struck through rather than removed, so undoing the drop that paid for it does
 * not silently swallow the add.
 */
export function validateLedger(board: Board, moves: Move[]): LedgerEntry[] {
  // Within a period, drops settle first: a drop and the add it pays for happen
  // as one transaction, so charging the add against the pre-drop roster would
  // block a move that is in fact legal.
  const ordered = [...moves].sort(
    (a, b) =>
      a.period.localeCompare(b.period) || rank(a.action) - rank(b.action),
  )
  const entries: LedgerEntry[] = []
  const applied: Move[] = []

  for (const move of ordered) {
    const period = board.periods.find((p) => p.starts_on === move.period)
    if (!period) {
      entries.push({ move, blocked: null })
      continue
    }
    const state = rosterStateDuring(board, applied, period)
    entries.push({ move, blocked: blockedReason(state, move.action) })
    applied.push(move)
  }
  return entries
}

function rank(action: Move['action']): number {
  return action === 'drop' ? 0 : 1
}
