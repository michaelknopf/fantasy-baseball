"""Collects a full league snapshot from the Fantrax API."""

import re
from datetime import UTC, datetime

from fbb.fantrax import payload
from fbb.fantrax.client import FantraxClient
from fbb.fantrax.models import (
    FantasyTeam,
    FreeAgentPitcher,
    LeagueSnapshot,
    ProbableStart,
    RosterPlayer,
    TeamRoster,
    TeamStartsBudget,
)
from fbb.fantrax.payload import Json

# `getPlayerStats` filter values, taken from the dropdowns the Players page sends.
_STATUS_AVAILABLE = 'ALL_AVAILABLE'
_POS_STARTING_PITCHER = 'POS_015'
_MISC_UPCOMING_STARTS = '7'  # "1-2 starts": only pitchers with a probable start
_PAGE_SIZE = 20

# Fantrax renders the next start as "OPP<br/>Sun 1:10PM", with a leading "@" when away.
_OPPONENT_CELL = re.compile(r'^(?P<away>@)?(?P<opp>[A-Z0-9]+)<br/>(?P<when>.*)$')

# Roster row `statusId`; the slot cap is 19 active / 5 reserve / 3 IR.
_ROSTER_STATUS = {'1': 'active', '2': 'reserve', '3': 'injured_reserve'}


class SnapshotCollector:
    """
    Pulls every piece of data a playoff-streaming decision needs.

    Fantrax exposes one RPC endpoint; each concern below is one method call on it.
    Raw payloads are retained alongside the parsed view so later analysis can reach
    fields this parser doesn't model yet.
    """

    def __init__(self, client: FantraxClient, league_id: str) -> None:
        self._client = client
        self._league_id = league_id
        self.raw: dict[str, object] = {}
        self._rosters_raw: dict[str, Json] = {}

    def collect(self) -> LeagueSnapshot:
        teams = self._fantasy_teams()
        # Rosters first: the starts view lacks the claim budget, so `_starts_budget`
        # reads it back out of the roster payload cached here.
        rosters = [self._roster(t) for t in teams]
        budgets = [self._starts_budget(t) for t in teams]
        return LeagueSnapshot(
            league_id=self._league_id,
            collected_at=datetime.now(UTC),
            teams=teams,
            starts_budgets=budgets,
            rosters=rosters,
            free_agent_pitchers=self._free_agent_pitchers(),
        )

    def _fantasy_teams(self) -> list[FantasyTeam]:
        data = self._client.call('getFantasyTeams')
        self.raw['getFantasyTeams'] = data
        my_ids = set(payload.strings(data, 'myTeamIds'))
        return [
            FantasyTeam(
                team_id=str(team.get('id', '')),
                name=payload.text(team, 'name') or '',
                short_name=payload.text(team, 'shortName'),
                is_mine=str(team.get('id', '')) in my_ids,
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

        players: list[RosterPlayer] = []
        for table in payload.rows(data, 'tables'):
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
                        stats=_cell_contents(row),
                    )
                )
        return TeamRoster(team_id=team.team_id, team_name=team.name, players=players)

    def _free_agent_pitchers(self) -> list[FreeAgentPitcher]:
        """
        Available starting pitchers with a probable start, swept date by date.

        The unfiltered query only returns the current day's probables, which is far
        less than a two-week round needs. Each date is a separate query, so one entry
        is produced per pitcher-date: a pitcher starting twice appears twice.
        """
        collected: list[FreeAgentPitcher] = []
        for date in self._probable_start_dates():
            rows = self._free_agent_page(date)
            if not rows:
                # MLB publishes probables ~12 days out; past the horizon every
                # later date is empty too, so stop rather than keep querying.
                break
            collected.extend(self._free_agent(row, date) for row in rows)
        return collected

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

    def _free_agent_page(self, date: str) -> list[Json]:
        """Every available probable starter on one date, following pagination."""
        rows: list[Json] = []
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

            total_pages = payload.number(
                payload.obj(data, 'paginatedResultSet'), 'totalNumPages'
            )
            if total_pages is None or page >= int(total_pages):
                break
            page += 1
        return rows

    def _free_agent(self, row: Json, date: str) -> FreeAgentPitcher:
        scorer = payload.obj(row, 'scorer')
        contents = _cell_contents(row)
        return FreeAgentPitcher(
            player_id=payload.text(scorer, 'scorerId') or '',
            name=payload.text(scorer, 'name') or '',
            positions=_strip_markup(payload.text(scorer, 'posShortNames')),
            mlb_team=payload.text(scorer, 'teamShortName'),
            rank=_as_int(contents[0] if contents else None),
            start_date=date,
            next_start=self._probable_start(contents),
            stats=contents,
        )

    @staticmethod
    def _probable_start(contents: list[str]) -> ProbableStart | None:
        for cell in contents:
            match = _OPPONENT_CELL.match(cell)
            if match:
                return ProbableStart(
                    opponent=match.group('opp'),
                    is_away=bool(match.group('away')),
                    when=match.group('when'),
                )
        return None

    def _store(self, section: str, key: str, data: Json) -> None:
        """Retain a raw payload so offline analysis can reach unmodelled fields."""
        bucket = self.raw.setdefault(section, {})
        if isinstance(bucket, dict):
            bucket[key] = data


def _cell_contents(row: Json) -> list[str]:
    return [payload.text(cell, 'content') or '' for cell in payload.rows(row, 'cells')]


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
