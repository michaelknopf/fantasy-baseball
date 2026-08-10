"""Parsed view of a Fantrax league snapshot.

These models cover the fields playoff decisions actually turn on. The collector
also keeps every raw payload, so analysis can reach anything not modelled here.
"""

from datetime import date, datetime

from pydantic import BaseModel


class FantasyTeam(BaseModel):
    """One of the ten teams in the league."""

    team_id: str
    name: str
    short_name: str | None = None
    is_mine: bool = False


class TeamStartsBudget(BaseModel):
    """A team's pitching-starts cap and remaining claim budget.

    `starts_remaining` is the season-long lever: the cap spans the regular season
    and playoffs, so an unspent balance is available for the playoff rounds.
    """

    team_id: str
    team_name: str
    rank: str | None = None
    fantasy_points: float | None = None
    starts_used: int | None = None
    starts_max: int | None = None
    starts_remaining: int | None = None
    pace: str | None = None
    claim_budget: float | None = None


class RosterPlayer(BaseModel):
    """A player on a fantasy roster."""

    player_id: str
    name: str
    positions: str | None = None
    mlb_team: str | None = None
    roster_status: str | None = None
    slot_position_id: str | None = None
    stats: dict[str, str] = {}


class ScheduledStart(BaseModel):
    """A day on which a rostered pitcher is the probable starter.

    With daily lineup moves, this is what decides a slot: a starter only scores on
    the day he pitches, so knowing those days is what turns free slot-days into
    streaming opportunities.
    """

    date: date
    label: str  # as Fantrax renders it, e.g. 'Mon 8/10'
    opponent: str
    is_away: bool
    opposing_pitcher: str | None = None


class RosterSchedule(BaseModel):
    """When each pitcher on a roster is scheduled to start."""

    player_id: str
    name: str
    positions: str | None = None
    starts: list[ScheduledStart] = []


class TeamRoster(BaseModel):
    """A team's full roster."""

    team_id: str
    team_name: str
    players: list[RosterPlayer] = []
    schedules: list[RosterSchedule] = []


class ProbableStart(BaseModel):
    """A pitcher's next scheduled start.

    `in_progress` marks a game already underway, where Fantrax reports a live score
    instead of a start time — the start is no longer claimable.
    """

    opponent: str
    is_away: bool
    when: str
    in_progress: bool = False


class FreeAgentPitcher(BaseModel):
    """
    An unowned starting pitcher on one probable-start date.

    One entry per pitcher-date: a pitcher probable twice in the collected window
    appears twice, under different `start_date` values.
    """

    player_id: str
    name: str
    positions: str | None = None
    mlb_team: str | None = None
    rank: int | None = None
    start_date: str | None = None
    next_start: ProbableStart | None = None
    stats: dict[str, str] = {}


class GameLogEntry(BaseModel):
    """One game a player appeared in, with the fantasy points it produced."""

    date: str | None = None
    team: str | None = None
    opponent: str | None = None
    score: str | None = None
    fantasy_points: float | None = None
    stats: dict[str, str] = {}


class PlayerDetail(BaseModel):
    """Per-player depth: every game this season, with its full stat line.

    Trailing windows (last 30 days, last 60, and so on) are not stored: each entry
    is dated and carries its own stat line, so any window is a sum over these rows.
    Deriving them offline beats fetching them, since Fantrax only serves full stat
    lines for date ranges on a handful of players at a time.
    """

    player_id: str
    name: str
    game_log: list[GameLogEntry] = []
    # Share of Fantrax leagues rostering him, and who holds him in ours. Roster
    # rows omit both, so our own pitchers would have nothing to compare against.
    rostered_pct: str | None = None
    owned_by: str | None = None


class TeamBatting(BaseModel):
    """An MLB team's season batting line, used to grade a pitcher's matchup.

    Ranks are 1 = best offense, so a high `runs_rank` is a soft opponent. Sourced
    from ESPN rather than Fantrax, which exposes no team-level stats.
    """

    abbreviation: str
    name: str
    games: int
    runs: int
    runs_per_game: float
    runs_rank: int
    ops: float
    ops_rank: int
    avg: float
    home_runs: int
    strikeouts: int
    strikeouts_rank: int


class LeagueSnapshot(BaseModel):
    """Everything collected in one run.

    `collected_through` is the last date free-agent starts were gathered for: the day
    before the waiver deadline that closes the `periods_ahead` window.
    """

    league_id: str
    collected_at: datetime
    periods_ahead: int
    collected_through: date
    teams: list[FantasyTeam] = []
    starts_budgets: list[TeamStartsBudget] = []
    rosters: list[TeamRoster] = []
    free_agent_pitchers: list[FreeAgentPitcher] = []
    player_details: list[PlayerDetail] = []
    team_batting: list[TeamBatting] = []
