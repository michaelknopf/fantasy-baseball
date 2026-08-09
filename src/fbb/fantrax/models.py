"""Parsed view of a Fantrax league snapshot.

These models cover the fields playoff decisions actually turn on. The collector
also keeps every raw payload, so analysis can reach anything not modelled here.
"""

from datetime import date, datetime
from typing import Any

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
    stats: list[Any] = []


class TeamRoster(BaseModel):
    """A team's full roster."""

    team_id: str
    team_name: str
    players: list[RosterPlayer] = []


class ProbableStart(BaseModel):
    """A pitcher's next scheduled start."""

    opponent: str
    is_away: bool
    when: str


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
    stats: list[Any] = []


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
