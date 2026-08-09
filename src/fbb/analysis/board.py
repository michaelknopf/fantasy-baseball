"""Reshapes a snapshot into the board the web app renders.

The snapshot is organised by how Fantrax serves data; this is organised by the
decision: one row per pitcher, carrying his scheduled starts and the form numbers
you compare across them.
"""

from collections import defaultdict
from datetime import date, timedelta

from pydantic import BaseModel

from fbb.fantrax.models import (
    GameLogEntry,
    LeagueSnapshot,
    TeamStartsBudget,
)
from fbb.fantrax.waivers import WaiverSchedule

# Trailing windows shown beside the season figure. Form matters more than the
# season average for a streaming call, so these are computed from the game log.
_WINDOWS = {'last15': 15, 'last30': 30, 'last60': 60}


class Form(BaseModel):
    """Scoring over one span of games."""

    games: int
    fantasy_points: float
    per_game: float


class StartSlot(BaseModel):
    """One scheduled start."""

    date: date
    label: str
    opponent: str
    is_away: bool
    opposing_pitcher: str | None = None


class Pitcher(BaseModel):
    """A pitcher you could start, whether you hold him or not."""

    player_id: str
    name: str
    mlb_team: str | None = None
    positions: str | None = None
    # 'mine' when on our roster, 'free_agent' when claimable.
    ownership: str
    roster_status: str | None = None
    starts: list[StartSlot] = []
    season: Form | None = None
    windows: dict[str, Form] = {}
    stats: dict[str, str] = {}
    recent_games: list[GameLogEntry] = []


class WaiverPeriod(BaseModel):
    """A span between waiver runs — the unit a claim commits you to.

    `free_agents_known` is false once the period runs past the probable-start
    horizon: our own rotation is scheduled weeks out, but free-agent starts are
    only collected through `collected_through`, so a later period shows what we
    already hold and nothing claimable. Without the flag that reads as "nobody is
    available", which is not what the data says.
    """

    starts_on: date
    ends_on: date
    label: str
    free_agents_known: bool = True


class Rival(BaseModel):
    """A team's standing in the two resources a playoff run spends."""

    team: str
    rank: str | None = None
    starts_remaining: int | None = None
    claim_budget: float | None = None
    is_mine: bool = False


class Board(BaseModel):
    """Everything the app renders."""

    generated_at: date
    collected_through: date
    starts_remaining: int | None = None
    starts_max: int | None = None
    claim_budget: float | None = None
    active_pitcher_slots: int = 6
    periods: list[WaiverPeriod] = []
    pitchers: list[Pitcher] = []
    rivals: list[Rival] = []


class BoardBuilder:
    """Derives the board from a collected snapshot."""

    def __init__(self, snapshot: LeagueSnapshot, horizon_days: int = 21) -> None:
        self._snapshot = snapshot
        self._horizon = horizon_days
        self._details = {d.player_id: d for d in snapshot.player_details}
        self._today = snapshot.collected_at.date()

    def build(self) -> Board:
        mine = self._my_roster_id()
        budget = self._my_budget()
        return Board(
            generated_at=self._today,
            collected_through=self._snapshot.collected_through,
            starts_remaining=budget.starts_remaining if budget else None,
            starts_max=budget.starts_max if budget else None,
            claim_budget=budget.claim_budget if budget else None,
            periods=self._periods(),
            pitchers=self._pitchers(mine),
            rivals=self._rivals(),
        )

    def _my_roster_id(self) -> str | None:
        for team in self._snapshot.teams:
            if team.is_mine:
                return team.team_id
        return None

    def _my_budget(self) -> TeamStartsBudget | None:
        team_id = self._my_roster_id()
        for budget in self._snapshot.starts_budgets:
            if budget.team_id == team_id:
                return budget
        return None

    def _periods(self) -> list[WaiverPeriod]:
        """Waiver periods spanning the horizon, each ending the day before the next run."""
        schedule = WaiverSchedule()
        deadlines = schedule.next_deadlines(
            self._snapshot.collected_at.replace(tzinfo=None), count=8
        )
        periods: list[WaiverPeriod] = []
        for start, following in zip(deadlines, deadlines[1:], strict=False):
            if start > self._today + timedelta(days=self._horizon):
                break
            periods.append(
                WaiverPeriod(
                    starts_on=start,
                    ends_on=following - timedelta(days=1),
                    label=f'{start:%a %-m/%-d}',
                    free_agents_known=start <= self._snapshot.collected_through,
                )
            )
        return periods

    def _pitchers(self, my_team_id: str | None) -> list[Pitcher]:
        pitchers: dict[str, Pitcher] = {}

        for roster in self._snapshot.rosters:
            if roster.team_id != my_team_id:
                continue
            statuses = {p.player_id: p for p in roster.players}
            for schedule in roster.schedules:
                player = statuses.get(schedule.player_id)
                if not self._is_pitcher(schedule.positions, player):
                    continue
                pitchers[schedule.player_id] = Pitcher(
                    player_id=schedule.player_id,
                    name=schedule.name,
                    mlb_team=player.mlb_team if player else None,
                    positions=schedule.positions,
                    ownership='mine',
                    roster_status=player.roster_status if player else None,
                    starts=[
                        StartSlot(
                            date=s.date,
                            label=s.label,
                            opponent=s.opponent,
                            is_away=s.is_away,
                            opposing_pitcher=s.opposing_pitcher,
                        )
                        for s in schedule.starts
                    ],
                    stats=player.stats if player else {},
                )

        # Free agents arrive as one row per probable start; fold them into one
        # pitcher carrying all of his starts.
        starts_by_player: dict[str, list[StartSlot]] = defaultdict(list)
        for entry in self._snapshot.free_agent_pitchers:
            if entry.next_start is None or entry.start_date is None:
                continue
            if entry.next_start.in_progress:
                continue  # already underway, so no longer claimable
            starts_by_player[entry.player_id].append(
                StartSlot(
                    date=date.fromisoformat(entry.start_date),
                    label=date.fromisoformat(entry.start_date).strftime('%a %-m/%-d'),
                    opponent=entry.next_start.opponent,
                    is_away=entry.next_start.is_away,
                )
            )
            if entry.player_id not in pitchers:
                pitchers[entry.player_id] = Pitcher(
                    player_id=entry.player_id,
                    name=entry.name,
                    mlb_team=entry.mlb_team,
                    positions=entry.positions,
                    ownership='free_agent',
                    stats=entry.stats,
                )

        for player_id, starts in starts_by_player.items():
            pitcher = pitchers[player_id]
            if pitcher.ownership == 'free_agent':
                pitcher.starts = sorted(starts, key=lambda s: s.date)

        for pitcher in pitchers.values():
            self._attach_form(pitcher)
        return sorted(pitchers.values(), key=lambda p: p.name)

    @staticmethod
    def _is_pitcher(positions: str | None, player: object) -> bool:
        return bool(positions and ('SP' in positions or 'RP' in positions))

    def _attach_form(self, pitcher: Pitcher) -> None:
        detail = self._details.get(pitcher.player_id)
        if detail is None:
            return
        appearances = [g for g in detail.game_log if self._played(g)]
        pitcher.season = self._form(appearances)
        pitcher.windows = {
            name: self._form(self._within(appearances, days))
            for name, days in _WINDOWS.items()
        }
        pitcher.recent_games = appearances[:10]
        # Free agents already carry a real season line; our own rows carry today's
        # zeroes, so the derived totals replace them.
        if pitcher.ownership == 'mine':
            pitcher.stats = {**pitcher.stats, **self._season_totals(appearances)}

    @staticmethod
    def _season_totals(games: list[GameLogEntry]) -> dict[str, str]:
        """
        Season ERA and strikeouts, summed from the game log.

        Roster rows carry only the current day's stats — all zeroes before a game
        — so a rostered pitcher's season line has to be rebuilt from his games.
        """
        outs = 0.0
        earned = 0
        strikeouts = 0
        for game in games:
            innings = game.stats.get('IP') or '0'
            whole, _, fraction = innings.partition('.')
            try:
                outs += int(whole) * 3 + int(fraction or 0)
                earned += int(game.stats.get('ER') or 0)
                strikeouts += int(game.stats.get('K') or 0)
            except ValueError:
                continue
        if outs == 0:
            return {}
        return {
            'ERA': f'{earned * 27 / outs:.2f}',
            'K': str(strikeouts),
            'IP': f'{outs / 3:.1f}',
        }

    @staticmethod
    def _played(game: GameLogEntry) -> bool:
        """Rows exist for scheduled games not yet played; they score nothing."""
        innings = game.stats.get('IP') or '0'
        return innings not in ('0', '0.0', '')

    def _within(self, games: list[GameLogEntry], days: int) -> list[GameLogEntry]:
        cutoff = self._today - timedelta(days=days)
        return [g for g in games if (d := self._game_date(g)) and d >= cutoff]

    def _game_date(self, game: GameLogEntry) -> date | None:
        """Game log dates are 'Aug 9' — the season's year is the snapshot's."""
        if not game.date:
            return None
        try:
            parsed = date(
                self._today.year,
                _MONTHS[game.date.split()[0]],
                int(game.date.split()[1]),
            )
        except (KeyError, IndexError, ValueError):
            return None
        return parsed

    @staticmethod
    def _form(games: list[GameLogEntry]) -> Form:
        points = sum(g.fantasy_points or 0.0 for g in games)
        count = len(games)
        return Form(
            games=count,
            fantasy_points=round(points, 2),
            per_game=round(points / count, 2) if count else 0.0,
        )

    def _rivals(self) -> list[Rival]:
        """Every team's starts and budget, for context on how much edge we hold."""
        mine = self._my_roster_id()
        return [
            Rival(
                team=b.team_name,
                rank=b.rank,
                starts_remaining=b.starts_remaining,
                claim_budget=b.claim_budget,
                is_mine=b.team_id == mine,
            )
            for b in sorted(
                self._snapshot.starts_budgets,
                key=lambda b: b.starts_remaining or 0,
                reverse=True,
            )
        ]


_MONTHS = {
    'Jan': 1,
    'Feb': 2,
    'Mar': 3,
    'Apr': 4,
    'May': 5,
    'Jun': 6,
    'Jul': 7,
    'Aug': 8,
    'Sep': 9,
    'Oct': 10,
    'Nov': 11,
    'Dec': 12,
}
