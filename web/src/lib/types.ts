/** Shapes written by `fbb board build`. */

export type Ownership = 'mine' | 'free_agent'

export interface Form {
  games: number
  fantasy_points: number
  per_game: number
}

export interface StartSlot {
  /** ISO date, e.g. '2026-08-10'. */
  date: string
  label: string
  opponent: string
  is_away: boolean
  opposing_pitcher: string | null
  opponent_runs_per_game: number | null
  /** 1 = best offense in baseball, so a high rank is a soft matchup. */
  opponent_runs_rank: number | null
  opponent_ops: number | null
  opponent_strikeouts_rank: number | null
}

export interface GameLogEntry {
  date: string | null
  team: string | null
  opponent: string | null
  score: string | null
  fantasy_points: number | null
  stats: Record<string, string>
}

export interface Pitcher {
  player_id: string
  name: string
  mlb_team: string | null
  positions: string | null
  ownership: Ownership
  roster_status: string | null
  starts: StartSlot[]
  season: Form | null
  windows: Record<string, Form>
  stats: Record<string, string>
  recent_games: GameLogEntry[]
}

export interface WaiverPeriod {
  starts_on: string
  ends_on: string
  label: string
  /** False past the probable-start horizon: free agents aren't known that far out. */
  free_agents_known: boolean
}

export interface Rival {
  team: string
  rank: string | null
  starts_remaining: number | null
  claim_budget: number | null
  is_mine: boolean
}

export interface Board {
  generated_at: string
  collected_through: string
  starts_remaining: number | null
  starts_max: number | null
  claim_budget: number | null
  active_pitcher_slots: number
  periods: WaiverPeriod[]
  pitchers: Pitcher[]
  rivals: Rival[]
}
