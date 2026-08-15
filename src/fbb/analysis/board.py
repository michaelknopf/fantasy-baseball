"""Reshapes a snapshot into the board the web app renders.

The snapshot is organised by how Fantrax serves data; this is organised by the
decision: one row per pitcher, carrying his scheduled starts and the form numbers
you compare across them.
"""

from collections import Counter, defaultdict
from datetime import date, timedelta

from pydantic import BaseModel

from fbb.analysis.playoffs import Matchup as ConfiguredMatchup
from fbb.analysis.playoffs import PlayoffConfig, SlotRef
from fbb.analysis.playoffs import Round as ConfiguredRound
from fbb.analysis.playoffs import Side as ConfiguredSide
from fbb.fantrax.models import (
    GameLogEntry,
    LeagueSnapshot,
    TeamRoster,
    TeamStartsBudget,
)
from fbb.fantrax.waivers import WaiverSchedule


class UnknownPlayoffTeamError(ValueError):
    """A bracket names a team the snapshot does not have.

    Fantrax team names are user-editable, so a rename would otherwise leave the
    matchup silently blank instead of pointing at the line to fix.
    """


# Trailing windows shown beside the season figure. Form matters more than the
# season average for a streaming call, so these are computed from the game log.
_WINDOWS = {'last15': 15, 'last30': 30, 'last60': 60}


class Form(BaseModel):
    """Scoring over one span of games."""

    games: int
    fantasy_points: float
    per_game: float


class StartSlot(BaseModel):
    """One scheduled start, with the quality of the offense it faces.

    `opponent_runs_rank` is 1 for the best-hitting team in baseball, so a high rank
    is the soft matchup a streamer wants.
    """

    date: date
    label: str
    opponent: str
    is_away: bool
    opposing_pitcher: str | None = None
    opponent_runs_per_game: float | None = None
    opponent_runs_rank: int | None = None
    opponent_ops: float | None = None
    opponent_strikeouts_rank: int | None = None


class Pitcher(BaseModel):
    """A pitcher you could start, whether you hold him or not."""

    player_id: str
    name: str
    mlb_team: str | None = None
    positions: str | None = None
    # 'mine' when on our roster, 'free_agent' when claimable.
    ownership: str
    # 'available' when unowned, otherwise 'injured reserve' or 'owned' — Fantrax's
    # active/reserve split is a lineup detail, not a fact about the pitcher.
    roster_status: str | None = None
    rostered_pct: str | None = None
    owned_by: str | None = None
    starts: list[StartSlot] = []
    season: Form | None = None
    windows: dict[str, Form] = {}
    stats: dict[str, str] = {}
    recent_games: list[GameLogEntry] = []


class RosterEntry(BaseModel):
    """A player occupying one of our roster spots.

    Every spot, not just the pitchers: the roster is full, so an add has to name
    someone to drop, and a hitter is as droppable as an arm. `season` and
    `windows` come from the game log rather than the roster row, whose stats are
    only today's.
    """

    player_id: str
    name: str
    mlb_team: str | None = None
    positions: str | None = None
    role: str  # 'starter' | 'reliever' | 'hitter'
    roster_status: str | None = None
    season: Form | None = None
    windows: dict[str, Form] = {}


class RosterSlots(BaseModel):
    """How many spots of each kind we hold, and how many are filled.

    Capacities are counted from the roster rather than configured, which is only
    valid because the roster is full — Fantrax does not report the limits.
    """

    active: int = 0
    reserve: int = 0
    injured_reserve: int = 0

    @property
    def total(self) -> int:
        return self.active + self.reserve + self.injured_reserve


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


class PlayoffSide(BaseModel):
    """One team in a playoff matchup.

    Only points scored inside the round count, so `matchup_points` — not the
    season total — is what the round is decided on. `team` is None while the slot
    is still waiting on the matchup that feeds it.
    """

    seed: int | None = None
    team: str | None = None
    awaiting: str | None = None  # 'Winner of Randy / MK'
    advantage: float = 0.0
    starting_points: float | None = None
    current_points: float | None = None
    earned: float | None = None
    matchup_points: float | None = None
    is_mine: bool = False


class PlayoffMatchup(BaseModel):
    """A pairing, and who is ahead in it."""

    a: PlayoffSide
    b: PlayoffSide
    # Positive when `a` leads. None until both sides are known and scoring.
    margin: float | None = None
    leader: str | None = None
    is_bye: bool = False


class PlayoffRound(BaseModel):
    """One round of a bracket.

    `peak_points` is the best matchup score in the round, so every bar on the
    page can share one axis and lengths mean the same thing across matchups.
    """

    label: str
    starts_on: date
    ends_on: date
    state: str  # 'done' | 'live' | 'upcoming'
    peak_points: float | None = None
    matchups: list[PlayoffMatchup] = []


class PlayoffBracket(BaseModel):
    key: str
    label: str
    rounds: list[PlayoffRound] = []


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
    slots: RosterSlots | None = None
    roster: list[RosterEntry] = []
    playoffs: list[PlayoffBracket] = []


class BoardBuilder:
    """Derives the board from a collected snapshot."""

    def __init__(
        self,
        snapshot: LeagueSnapshot,
        horizon_days: int = 21,
        playoffs: PlayoffConfig | None = None,
    ) -> None:
        self._snapshot = snapshot
        self._horizon = horizon_days
        self._playoff_config = playoffs
        self._details = {d.player_id: d for d in snapshot.player_details}
        self._batting = {t.abbreviation: t for t in snapshot.team_batting}
        self._points = {b.team_name: b.fantasy_points for b in snapshot.starts_budgets}
        self._today = snapshot.collected_at.date()

    def build(self) -> Board:
        budget = self._my_budget()
        roster = self._my_roster()
        return Board(
            generated_at=self._today,
            collected_through=self._snapshot.collected_through,
            starts_remaining=budget.starts_remaining if budget else None,
            starts_max=budget.starts_max if budget else None,
            claim_budget=budget.claim_budget if budget else None,
            periods=self._periods(),
            pitchers=self._pitchers(roster),
            rivals=self._rivals(),
            slots=self._slots(roster),
            roster=self._roster(roster),
            playoffs=self._playoffs(),
        )

    def _my_roster_id(self) -> str | None:
        for team in self._snapshot.teams:
            if team.is_mine:
                return team.team_id
        return None

    def _my_roster(self) -> TeamRoster | None:
        team_id = self._my_roster_id()
        for roster in self._snapshot.rosters:
            if roster.team_id == team_id:
                return roster
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

    def _slot(
        self,
        date: date,
        label: str,
        opponent: str,
        is_away: bool,
        opposing_pitcher: str | None = None,
    ) -> StartSlot:
        """A start with the opposing offense's season line already joined on."""
        batting = self._batting.get(opponent)
        return StartSlot(
            date=date,
            label=label,
            opponent=opponent,
            is_away=is_away,
            opposing_pitcher=opposing_pitcher,
            opponent_runs_per_game=batting.runs_per_game if batting else None,
            opponent_runs_rank=batting.runs_rank if batting else None,
            opponent_ops=batting.ops if batting else None,
            opponent_strikeouts_rank=batting.strikeouts_rank if batting else None,
        )

    def _pitchers(self, roster: TeamRoster | None) -> list[Pitcher]:
        pitchers: dict[str, Pitcher] = {}

        if roster is not None:
            # Keyed off the roster rather than the schedules, which only cover
            # starters — relievers have no scheduled starts but are still ours,
            # and the drop picker needs them.
            schedules = {s.player_id: s for s in roster.schedules}
            for player in roster.players:
                if not _is_pitcher(player.positions):
                    continue
                schedule = schedules.get(player.player_id)
                pitchers[player.player_id] = Pitcher(
                    player_id=player.player_id,
                    name=player.name,
                    mlb_team=player.mlb_team,
                    positions=player.positions,
                    ownership='mine',
                    roster_status=_simplify_status(player.roster_status),
                    starts=[
                        self._slot(
                            date=s.date,
                            label=s.label,
                            opponent=s.opponent,
                            is_away=s.is_away,
                            opposing_pitcher=s.opposing_pitcher,
                        )
                        for s in (schedule.starts if schedule else [])
                    ],
                    stats=player.stats,
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
                self._slot(
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

    def _slots(self, roster: TeamRoster | None) -> RosterSlots | None:
        if roster is None:
            return None
        counts = Counter(p.roster_status for p in roster.players)
        return RosterSlots(
            active=counts['active'],
            reserve=counts['reserve'],
            injured_reserve=counts['injured_reserve'],
        )

    def _roster(self, roster: TeamRoster | None) -> list[RosterEntry]:
        """Every spot we hold, since any of them can be the one we give up."""
        if roster is None:
            return []
        entries: list[RosterEntry] = []
        for player in roster.players:
            role = _role(player.positions)
            appearances = self._appearances(player.player_id, role)
            entries.append(
                RosterEntry(
                    player_id=player.player_id,
                    name=player.name,
                    mlb_team=player.mlb_team,
                    positions=player.positions,
                    role=role,
                    roster_status=_simplify_status(player.roster_status),
                    season=self._form(appearances),
                    windows={
                        name: self._form(self._within(appearances, days))
                        for name, days in _WINDOWS.items()
                    },
                )
            )
        return entries

    def _appearances(self, player_id: str, role: str) -> list[GameLogEntry]:
        """The games a player actually played.

        Hitter logs carry no innings at all, so the innings filter that separates
        a pitcher's appearances from his unplayed scheduled rows would discard
        every hitter game. Scoring stands in for it there.
        """
        detail = self._details.get(player_id)
        if detail is None:
            return []
        if role == 'hitter':
            return [g for g in detail.game_log if g.fantasy_points is not None]
        return [g for g in detail.game_log if self._played(g)]

    def _attach_form(self, pitcher: Pitcher) -> None:
        detail = self._details.get(pitcher.player_id)
        if detail is None:
            return
        appearances = self._appearances(pitcher.player_id, _role(pitcher.positions))
        pitcher.season = self._form(appearances)
        pitcher.windows = {
            name: self._form(self._within(appearances, days))
            for name, days in _WINDOWS.items()
        }
        pitcher.recent_games = appearances[:10]
        # Derived from the game log for everyone: our own roster rows carry only
        # today's zeroes, and WHIP is never returned by Fantrax at all.
        pitcher.stats = {**pitcher.stats, **self._season_totals(appearances)}
        pitcher.rostered_pct = detail.rostered_pct
        pitcher.owned_by = detail.owned_by

    @staticmethod
    def _season_totals(games: list[GameLogEntry]) -> dict[str, str]:
        """
        Season rate stats, summed from the game log.

        Roster rows carry only the current day's stats — all zeroes before a game
        — so a rostered pitcher's line has to be rebuilt from his games. WHIP is
        computed here for everyone, since Fantrax never returns it directly.
        """
        outs = 0.0
        earned = walks = hits = strikeouts = 0
        for game in games:
            innings = game.stats.get('IP') or '0'
            whole, _, fraction = innings.partition('.')
            try:
                outs += int(whole) * 3 + int(fraction or 0)
                earned += int(game.stats.get('ER') or 0)
                walks += int(game.stats.get('BB') or 0)
                hits += int(game.stats.get('H') or 0)
                strikeouts += int(game.stats.get('K') or 0)
            except ValueError:
                continue
        if outs == 0:
            return {}
        innings_pitched = outs / 3
        return {
            'ERA': f'{earned * 9 / innings_pitched:.2f}',
            'WHIP': f'{(hits + walks) / innings_pitched:.2f}',
            'K': str(strikeouts),
            'IP': f'{innings_pitched:.1f}',
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

    def _playoffs(self) -> list[PlayoffBracket]:
        """The bracket, with each matchup scored against its own round."""
        if not self._playoff_config:
            return []

        my_team = self._my_team_name()
        # Later rounds read the results of earlier ones to fill their slots, so
        # rounds are walked in order and finished matchups carried forward. Only
        # a round that has ended settles anything: whoever leads a live matchup
        # has not won it yet, and advancing them would put a team in the next
        # round that may never get there.
        settled: dict[str, PlayoffMatchup] = {}
        brackets: list[PlayoffBracket] = []

        for bracket in self._playoff_config.brackets:
            rounds: list[PlayoffRound] = []
            for index, rnd in enumerate(bracket.rounds):
                state = self._round_state(rnd.start, rnd.end)
                matchups = [
                    self._playoff_matchup(source, my_team, settled)
                    for source in rnd.matchups
                ]
                if state == 'done':
                    for slot, built in enumerate(matchups):
                        settled[f'{bracket.key}.{index}.{slot}'] = built
                scores = [
                    side.matchup_points
                    for built in matchups
                    for side in (built.a, built.b)
                    if side.matchup_points is not None
                ]
                rounds.append(
                    PlayoffRound(
                        label=rnd.label,
                        starts_on=rnd.start,
                        ends_on=rnd.end,
                        state=state,
                        peak_points=max(scores) if scores else None,
                        matchups=matchups,
                    )
                )
            brackets.append(
                PlayoffBracket(key=bracket.key, label=bracket.label, rounds=rounds)
            )
        return brackets

    def _round_state(self, starts_on: date, ends_on: date) -> str:
        if self._today < starts_on:
            return 'upcoming'
        return 'done' if self._today > ends_on else 'live'

    def _playoff_matchup(
        self,
        source: ConfiguredMatchup,
        my_team: str | None,
        settled: dict[str, PlayoffMatchup],
    ) -> PlayoffMatchup:
        a = self._playoff_side(source.a, my_team, settled)
        b = self._playoff_side(source.b, my_team, settled)
        margin: float | None = None
        leader: str | None = None
        if (
            not source.bye
            and a.matchup_points is not None
            and b.matchup_points is not None
        ):
            margin = round(a.matchup_points - b.matchup_points, 2)
            if margin:
                leader = (a if margin > 0 else b).team
        return PlayoffMatchup(a=a, b=b, margin=margin, leader=leader, is_bye=source.bye)

    def _playoff_side(
        self,
        side: ConfiguredSide,
        my_team: str | None,
        settled: dict[str, PlayoffMatchup],
    ) -> PlayoffSide:
        team, awaiting = self._occupant(side, settled)
        current = self._points.get(team) if team else None
        earned: float | None = None
        matchup_points: float | None = None
        if current is not None and side.starting_points is not None:
            earned = round(current - side.starting_points, 2)
            matchup_points = round(earned + side.advantage, 2)
        return PlayoffSide(
            seed=side.seed,
            team=team,
            awaiting=awaiting,
            advantage=side.advantage,
            starting_points=side.starting_points,
            current_points=current,
            earned=earned,
            matchup_points=matchup_points,
            is_mine=bool(team and team == my_team),
        )

    def _occupant(
        self, side: ConfiguredSide, settled: dict[str, PlayoffMatchup]
    ) -> tuple[str | None, str | None]:
        """The team in a slot, or a label naming what it is waiting on."""
        if side.team:
            if side.team not in self._points:
                known = ', '.join(sorted(self._points))
                raise UnknownPlayoffTeamError(
                    f'{side.team!r} is not a team in this league. Known teams: {known}'
                )
            return side.team, None

        ref = side.feeds_from
        if not ref:
            return None, None

        verb = 'Winner' if ref.take_winner else 'Loser'
        feeder = settled.get(ref.key)
        if feeder:
            decided = feeder.leader if ref.take_winner else _trailer(feeder)
            if decided:
                return decided, None

        # The feeding round has not finished, so name where the team will come
        # from — reading its current leader would advance a team that has not
        # actually won yet.
        return None, f'{verb} of {self._feeder_label(ref)}'

    def _feeder_label(self, ref: SlotRef) -> str:
        """What to call the matchup a pending slot is waiting on.

        Both contenders named when both are known ('Randy / MK'); otherwise the
        round itself, since half a pairing reads as though the other side were
        already settled.
        """
        source = self._configured_matchup(ref)
        if not source:
            return 'an earlier round'
        rnd = self._configured_round(ref)
        if source.a.team and source.b.team:
            return f'{source.a.team} / {source.b.team}'
        return rnd.label.lower() if rnd else 'an earlier round'

    def _configured_round(self, ref: SlotRef) -> ConfiguredRound | None:
        for bracket in self._playoff_config.brackets if self._playoff_config else []:
            if bracket.key == ref.bracket and ref.round_index < len(bracket.rounds):
                return bracket.rounds[ref.round_index]
        return None

    def _configured_matchup(self, ref: SlotRef) -> ConfiguredMatchup | None:
        rnd = self._configured_round(ref)
        if rnd and ref.matchup_index < len(rnd.matchups):
            return rnd.matchups[ref.matchup_index]
        return None

    def _my_team_name(self) -> str | None:
        for team in self._snapshot.teams:
            if team.is_mine:
                return team.name
        return None


def _trailer(matchup: PlayoffMatchup) -> str | None:
    """The side that is behind, once a leader is settled."""
    if not matchup.leader:
        return None
    return matchup.b.team if matchup.leader == matchup.a.team else matchup.a.team


def _is_pitcher(positions: str | None) -> bool:
    return bool(positions and ('SP' in positions or 'RP' in positions))


def _role(positions: str | None) -> str:
    """Which pool a player competes in, since scoring rates are not comparable across them.

    A reliever's 7-11 points a game and a starter's 25 measure different jobs, and
    a hitter's 3 is a third thing again — ranking drop candidates mixes them into
    nonsense unless they stay in separate groups.
    """
    if not positions:
        return 'hitter'
    if 'SP' in positions:
        return 'starter'
    if 'RP' in positions:
        return 'reliever'
    return 'hitter'


def _simplify_status(status: str | None) -> str | None:
    """
    Collapse Fantrax's roster slots to what matters here.

    Active and reserve differ only in whether a lineup move has been made yet;
    with daily moves either can start, so the distinction is noise. Injured
    reserve is different in kind — those starts cannot be used at all.
    """
    if status == 'injured_reserve':
        return 'injured reserve'
    return 'owned' if status else None


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
