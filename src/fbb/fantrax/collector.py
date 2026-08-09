"""Collects a full league snapshot from the Fantrax API."""

import re
from datetime import UTC, date, datetime

from fbb.fantrax import payload
from fbb.fantrax.client import FantraxClient
from fbb.fantrax.models import (
    FantasyTeam,
    FreeAgentPitcher,
    GameLogEntry,
    LeagueSnapshot,
    PlayerDetail,
    ProbableStart,
    RosterPlayer,
    RosterSchedule,
    ScheduledStart,
    TeamRoster,
    TeamStartsBudget,
)
from fbb.fantrax.payload import Json
from fbb.fantrax.waivers import DEFAULT_PERIODS_AHEAD, WaiverSchedule

# `getPlayerStats` filter values, taken from the dropdowns the Players page sends.
_STATUS_AVAILABLE = 'ALL_AVAILABLE'
_POS_STARTING_PITCHER = 'POS_015'
_MISC_UPCOMING_STARTS = '7'  # "1-2 starts": only pitchers with a probable start
_PAGE_SIZE = 20

# A scheduled start renders as "OPP<br/>Sun 1:10PM", with a leading "@" when away.
_SCHEDULED_CELL = re.compile(
    r'^(?P<away>@)?(?P<opp>[A-Z0-9]+)<br/>(?P<when>[A-Z][a-z]{2} .+)$'
)

# Once a game starts the same cell becomes a score, "ATH 2<br/>@BOS 1", gaining a
# trailing status once final ("... 7 F"). "@" marks the *home* side (the venue), so
# the pitcher's own team identifies which of the two is the opponent.
_IN_PROGRESS_CELL = re.compile(
    r'^(?P<visitor>[A-Z0-9]+) -?\d+<br/>@(?P<host>[A-Z0-9]+) -?\d+(?P<status> .+)?$'
)

# Roster row `statusId`; the slot cap is 19 active / 5 reserve / 3 IR.
_ROSTER_STATUS = {'1': 'active', '2': 'reserve', '3': 'injured_reserve'}


class SnapshotCollector:
    """
    Pulls every piece of data a playoff-streaming decision needs.

    Fantrax exposes one RPC endpoint; each concern below is one method call on it.
    Raw payloads are retained alongside the parsed view so later analysis can reach
    fields this parser doesn't model yet.
    """

    def __init__(
        self,
        client: FantraxClient,
        league_id: str,
        periods_ahead: int = DEFAULT_PERIODS_AHEAD,
        schedule: WaiverSchedule | None = None,
        now: datetime | None = None,
    ) -> None:
        self._client = client
        self._league_id = league_id
        self._periods_ahead = periods_ahead
        self._schedule = schedule or WaiverSchedule()
        # Local time, because waiver deadlines are league-local wall-clock times.
        self._now = now or datetime.now()
        self.raw: dict[str, object] = {}
        self._rosters_raw: dict[str, Json] = {}
        self._my_team_ids: set[str] = set()

    def collect(self) -> LeagueSnapshot:
        teams = self._fantasy_teams()
        # Rosters first: the starts view lacks the claim budget, so `_starts_budget`
        # reads it back out of the roster payload cached here.
        rosters = [self._roster(t) for t in teams]
        for team in teams:
            team.is_mine = team.team_id in self._my_team_ids
        budgets = [self._starts_budget(t) for t in teams]
        collect_through = self._schedule.collection_end(self._now, self._periods_ahead)
        free_agents = self._free_agent_pitchers(collect_through)
        return LeagueSnapshot(
            league_id=self._league_id,
            collected_at=datetime.now(UTC),
            periods_ahead=self._periods_ahead,
            collected_through=collect_through,
            teams=teams,
            starts_budgets=budgets,
            rosters=rosters,
            free_agent_pitchers=free_agents,
            player_details=self._player_details(free_agents, rosters),
        )

    def _fantasy_teams(self) -> list[FantasyTeam]:
        data = self._client.call('getFantasyTeams')
        self.raw['getFantasyTeams'] = data
        return [
            FantasyTeam(
                team_id=str(team.get('id', '')),
                name=payload.text(team, 'name') or '',
                short_name=payload.text(team, 'shortName'),
            )
            for team in payload.rows(data, 'fantasyTeams')
        ]

    def _starts_budget(self, team: FantasyTeam) -> TeamStartsBudget:
        """Pitching-starts cap and claim budget for one team."""
        data = self._client.call(
            'getTeamRosterInfo', {'teamId': team.team_id, 'view': 'GAMES_PER_POS'}
        )
        self._store('gamesPerPos', team.team_id, data)

        started = self._games_started_row(data)
        heading = payload.obj(data, 'teamHeadingInfo')
        return TeamStartsBudget(
            team_id=team.team_id,
            team_name=team.name,
            rank=payload.text(payload.obj(heading, 'rank'), 'value'),
            fantasy_points=payload.number(payload.obj(heading, 'fpts'), 'value'),
            starts_used=_as_int(payload.text(started, 'total')),
            starts_max=_as_int(payload.text(started, 'max')),
            starts_remaining=_as_int(payload.text(started, 'remaining')),
            pace=payload.text(started, 'pace'),
            # The cap view omits budget; it rides on the default roster view.
            claim_budget=self._claim_budget(self._rosters_raw.get(team.team_id, {})),
        )

    @staticmethod
    def _games_started_row(data: Json) -> Json:
        """The 'Games Started - Pitching (GS)' row of the scoring-category cap table."""
        for row in payload.rows(payload.obj(data, 'scMinMaxData'), 'tableData'):
            if 'Games Started' in (payload.text(row, 'scoringCategory') or ''):
                return row
        return {}

    @staticmethod
    def _claim_budget(roster_data: Json) -> float | None:
        misc = payload.obj(roster_data, 'miscData')
        for entry in payload.rows(misc, 'transactionSalaryBudgetInfo'):
            if payload.text(entry, 'key') == 'claimBudget':
                return _as_float(payload.text(entry, 'value'))
        return None

    def _roster(self, team: FantasyTeam) -> TeamRoster:
        data = self._client.call('getTeamRosterInfo', {'teamId': team.team_id})
        self._store('rosters', team.team_id, data)
        self._rosters_raw[team.team_id] = data
        # `getFantasyTeams` does not say which team is ours, but every roster
        # response does.
        self._my_team_ids.update(payload.strings(data, 'myTeamIds'))

        players: list[RosterPlayer] = []
        for table in payload.rows(data, 'tables'):
            columns = _column_names(payload.obj(table, 'header'))
            for row in payload.rows(table, 'rows'):
                scorer = payload.obj(row, 'scorer')
                player_id = payload.text(scorer, 'scorerId')
                if not player_id:
                    continue  # spacer and total rows carry no player
                players.append(
                    RosterPlayer(
                        player_id=player_id,
                        name=payload.text(scorer, 'name') or '',
                        positions=_strip_markup(payload.text(scorer, 'posShortNames')),
                        mlb_team=payload.text(scorer, 'teamShortName'),
                        roster_status=_ROSTER_STATUS.get(
                            payload.text(row, 'statusId') or ''
                        ),
                        slot_position_id=payload.text(row, 'posId'),
                        stats=_labelled(columns, _cell_contents(row)),
                    )
                )
        return TeamRoster(
            team_id=team.team_id,
            team_name=team.name,
            players=players,
            schedules=self._schedules(team),
        )

    def _schedules(self, team: FantasyTeam) -> list[RosterSchedule]:
        """
        When each of a team's pitchers is next scheduled to start.

        The default roster view shows only today's game, but lineups move daily, so
        a slot is only worth a starter on the day he actually pitches. This view lays
        the roster out as a day-per-column grid and flags the probable starter.
        """
        data = self._client.call(
            'getTeamRosterInfo', {'teamId': team.team_id, 'view': 'SCHEDULE_FULL'}
        )
        self._store('schedules', team.team_id, data)

        schedules: list[RosterSchedule] = []
        for table in payload.rows(data, 'tables'):
            columns = _column_names(payload.obj(table, 'header'))
            for row in payload.rows(table, 'rows'):
                scorer = payload.obj(row, 'scorer')
                player_id = payload.text(scorer, 'scorerId')
                if not player_id:
                    continue
                starts = self._scheduled_starts(row, columns)
                if starts:
                    schedules.append(
                        RosterSchedule(
                            player_id=player_id,
                            name=payload.text(scorer, 'name') or '',
                            positions=_strip_markup(
                                payload.text(scorer, 'posShortNames')
                            ),
                            starts=starts,
                        )
                    )
        return schedules

    def _scheduled_starts(self, row: Json, columns: list[str]) -> list[ScheduledStart]:
        """Day cells flagged `pitcher`, which marks this player as the starter."""
        starts: list[ScheduledStart] = []
        for index, cell in enumerate(payload.rows(row, 'cells')):
            if cell.get('pitcher') is not True or index >= len(columns):
                continue
            matchup = (payload.text(cell, 'content') or '').split('<br/>')[0]
            opponent = matchup.lstrip('@')
            # The cell's popover names the pitcher the opposing team will start.
            opposing = payload.obj(payload.obj(cell, 'popOver'), 'scorer')
            starts.append(
                ScheduledStart(
                    date=self._column_date(columns[index]),
                    label=columns[index],
                    opponent=opponent,
                    is_away=matchup.startswith('@'),
                    opposing_pitcher=payload.text(opposing, 'name'),
                )
            )
        return starts

    def _column_date(self, label: str) -> date:
        """
        Resolve a column label like 'Mon 8/10' to a real date.

        Fantrax labels columns without a year, and the grid can run past New Year,
        so the year is taken from the collection date and rolled forward when the
        month goes backwards.
        """
        match = re.search(r'(\d{1,2})/(\d{1,2})', label)
        if not match:
            return self._now.date()
        month, day = int(match.group(1)), int(match.group(2))
        today = self._now.date()
        year = today.year + 1 if month < today.month else today.year
        return date(year, month, day)

    def _free_agent_pitchers(self, collect_through: date) -> list[FreeAgentPitcher]:
        """
        Available starting pitchers with a probable start, swept date by date.

        The unfiltered query only returns the current day's probables, far less than
        a waiver period needs. Each date is a separate query, so one entry is produced
        per pitcher-date: a pitcher starting twice appears twice.
        """
        collected: list[FreeAgentPitcher] = []
        for day in self._probable_start_dates():
            if date.fromisoformat(day) > collect_through:
                break
            columns, rows = self._free_agent_page(day)
            collected.extend(self._free_agent(row, day, columns) for row in rows)
        return collected

    def _player_details(
        self, free_agents: list[FreeAgentPitcher], rosters: list[TeamRoster]
    ) -> list[PlayerDetail]:
        """
        Recent games and trailing-window stat lines, per player.

        Covers every free-agent starter plus your own roster. Other teams' players are
        deliberately skipped: you cannot acquire them, so their game logs inform no
        move. One request per player for the log, plus one per trailing window.
        """
        wanted: dict[str, str] = {p.player_id: p.name for p in free_agents}
        for roster in rosters:
            if roster.team_id in self._my_team_ids:
                wanted.update({p.player_id: p.name for p in roster.players})

        return [
            PlayerDetail(
                player_id=player_id,
                name=name,
                game_log=self._game_log(player_id),
            )
            for player_id, name in wanted.items()
        ]

    def _game_log(self, player_id: str) -> list[GameLogEntry]:
        """Every game this season, most recent first."""
        data = self._client.call(
            'getPlayerProfile', {'playerId': player_id, 'tab': 'GAME_LOG_FANTASY'}
        )
        self._store('gameLogs', player_id, data)

        section = payload.obj(payload.obj(data, 'sectionContent'), 'GAME_LOG_FANTASY')
        entries: list[GameLogEntry] = []
        for table in payload.rows(section, 'tables'):
            columns = _column_names(payload.obj(table, 'header'))
            for row in payload.rows(table, 'rows'):
                labelled = _labelled(columns, _cell_contents(row))
                entries.append(
                    GameLogEntry(
                        date=labelled.get('Date'),
                        team=labelled.get('Team'),
                        opponent=labelled.get('Opp'),
                        score=labelled.get('Score'),
                        fantasy_points=_as_float(labelled.get('FPts')),
                        stats=labelled,
                    )
                )
        return entries

    def _probable_start_dates(self) -> list[str]:
        """The dates Fantrax offers, from today forward."""
        data = self._client.call(
            'getPlayerStats',
            {
                'statusOrTeamFilter': _STATUS_AVAILABLE,
                'posOrGroup': _POS_STARTING_PITCHER,
                'miscDisplayType': _MISC_UPCOMING_STARTS,
                'view': 'STATS',
            },
        )
        self._store('freeAgents', 'dateList', data)
        offered = payload.rows(payload.obj(data, 'displayedLists'), 'datePlayingDates')
        return [
            date
            for entry in offered
            if (date := payload.text(entry, 'id')) and date != 'ALL'
        ]

    def _free_agent_page(self, date: str) -> tuple[list[str], list[Json]]:
        """Every available probable starter on one date, with its column labels."""
        rows: list[Json] = []
        columns: list[str] = []
        page = 1
        while True:
            data = self._client.call(
                'getPlayerStats',
                {
                    'statusOrTeamFilter': _STATUS_AVAILABLE,
                    'posOrGroup': _POS_STARTING_PITCHER,
                    'miscDisplayType': _MISC_UPCOMING_STARTS,
                    'datePlaying': date,
                    'pageNumber': str(page),
                    'maxResultsPerPage': str(_PAGE_SIZE),
                    'view': 'STATS',
                },
            )
            self._store('freeAgents', f'{date}:page{page}', data)

            batch = payload.rows(data, 'statsTable')
            if not batch:
                break
            rows.extend(batch)
            columns = columns or _column_names(payload.obj(data, 'tableHeader'))

            total_pages = payload.number(
                payload.obj(data, 'paginatedResultSet'), 'totalNumPages'
            )
            if total_pages is None or page >= int(total_pages):
                break
            page += 1
        return columns, rows

    def _free_agent(self, row: Json, date: str, columns: list[str]) -> FreeAgentPitcher:
        scorer = payload.obj(row, 'scorer')
        contents = _cell_contents(row)
        mlb_team = payload.text(scorer, 'teamShortName')
        return FreeAgentPitcher(
            player_id=payload.text(scorer, 'scorerId') or '',
            name=payload.text(scorer, 'name') or '',
            positions=_strip_markup(payload.text(scorer, 'posShortNames')),
            mlb_team=mlb_team,
            rank=_as_int(contents[0] if contents else None),
            start_date=date,
            next_start=self._probable_start(contents, mlb_team),
            stats=_labelled(columns, contents),
        )

    @staticmethod
    def _probable_start(
        contents: list[str], mlb_team: str | None
    ) -> ProbableStart | None:
        for cell in contents:
            scheduled = _SCHEDULED_CELL.match(cell)
            if scheduled:
                return ProbableStart(
                    opponent=scheduled.group('opp'),
                    is_away=bool(scheduled.group('away')),
                    when=scheduled.group('when'),
                )
            live = _IN_PROGRESS_CELL.match(cell)
            if live:
                visitor, host = live.group('visitor'), live.group('host')
                is_away = visitor == mlb_team
                status = (live.group('status') or '').strip()
                return ProbableStart(
                    opponent=host if is_away else visitor,
                    is_away=is_away,
                    when='final' if status else 'in progress',
                    in_progress=True,
                )
        return None

    def _store(self, section: str, key: str, data: Json) -> None:
        """Retain a raw payload so offline analysis can reach unmodelled fields."""
        bucket = self.raw.setdefault(section, {})
        if isinstance(bucket, dict):
            bucket[key] = data


def _cell_contents(row: Json) -> list[str]:
    return [payload.text(cell, 'content') or '' for cell in payload.rows(row, 'cells')]


def _column_names(header: Json) -> list[str]:
    """Short column labels, e.g. ['Rk', 'Sta', 'Age', ...]."""
    return [
        payload.text(cell, 'shortName') or '' for cell in payload.rows(header, 'cells')
    ]


def _labelled(columns: list[str], values: list[str]) -> dict[str, str]:
    """
    Pair stat values with their column labels.

    Fantrax returns stats as bare positional arrays whose meaning lives in a separate
    header, and the schema differs per table. Without this the numbers are unreadable
    once the raw payload is out of reach.
    """
    return dict(zip(columns, values, strict=False))


def _strip_markup(value: str | None) -> str | None:
    """Fantrax wraps a player's primary position in <b> tags."""
    if value is None:
        return None
    return re.sub(r'<[^>]+>', '', value).strip() or None


def _as_int(value: str | None) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _as_float(value: str | None) -> float | None:
    try:
        return float(str(value).replace('$', '').replace(',', '').strip())
    except (TypeError, ValueError):
        return None
