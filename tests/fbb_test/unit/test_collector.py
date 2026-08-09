"""Tests for parsing Fantrax payloads into the snapshot model.

Payload fixtures are trimmed copies of real API responses; they exist to pin the
field paths the collector depends on, since Fantrax can reshape them silently.
"""

import pytest

from fbb.fantrax.client import FantraxClient
from fbb.fantrax.collector import SnapshotCollector
from fbb.fantrax.models import LeagueSnapshot
from fbb.fantrax.payload import Json

LEAGUE_ID = 'test-league'
TEAM_ID = 'team-1'


class StubClient(FantraxClient):
    """Replays canned payloads instead of calling Fantrax."""

    def __init__(self, responses: dict[str, Json]) -> None:
        self._responses = responses
        self.calls: list[tuple[str, dict[str, str]]] = []

    def call(self, method: str, data: dict[str, str] | None = None) -> Json:
        args = data or {}
        self.calls.append((method, args))
        # The starts cap and the roster come from the same method, split by `view`.
        if method == 'getTeamRosterInfo' and args.get('view') == 'GAMES_PER_POS':
            return self._responses['starts']
        return self._responses[method]


def _roster_payload() -> Json:
    return {
        'tables': [
            {
                'rows': [
                    {
                        'statusId': '1',
                        'posId': '015',
                        'scorer': {
                            'scorerId': 'p1',
                            'name': 'Tarik Skubal',
                            'posShortNames': '<b>SP</b>',
                            'teamShortName': 'LAD',
                        },
                        'cells': [{'content': '1'}, {'content': '2.10'}],
                    },
                    {
                        'statusId': '2',
                        'posId': '0',
                        'scorer': {
                            'scorerId': 'p2',
                            'name': 'Dylan Cease',
                            'posShortNames': 'SP',
                            'teamShortName': 'TOR',
                        },
                        'cells': [],
                    },
                    # Total rows carry no scorer and must be skipped.
                    {'statusId': '1', 'cells': [{'content': 'Totals'}]},
                ]
            }
        ],
        'miscData': {
            'transactionSalaryBudgetInfo': [
                {'key': 'claimBudget', 'value': '228', 'display': '$228'}
            ]
        },
    }


def _starts_payload() -> Json:
    return {
        'teamHeadingInfo': {'rank': {'value': '6th'}, 'fpts': {'value': 7572.5}},
        'scMinMaxData': {
            'tableData': [
                {
                    'scoringCategory': 'Games Started - Pitching (GS)',
                    'total': '62',
                    'max': '125',
                    'remaining': '63',
                    'pace': '86 (-39)',
                }
            ]
        },
    }


def _teams_payload() -> Json:
    return {
        'fantasyTeams': [{'id': TEAM_ID, 'name': 'MK', 'shortName': 'MK'}],
        'myTeamIds': [TEAM_ID],
    }


def _free_agents_payload() -> Json:
    return {
        'paginatedResultSet': {'totalNumPages': 1, 'pageNumber': 1},
        'statsTable': [
            {
                'scorer': {
                    'scorerId': 'fa1',
                    'name': 'J.T. Ginn',
                    'posShortNames': '<b>SP</b>',
                    'teamShortName': 'ATH',
                },
                'cells': [
                    {'content': '59'},
                    {'content': 'FA'},
                    {'content': '@BOS<br/>Sun 10:35AM'},
                ],
            }
        ],
    }


@pytest.fixture
def collector() -> SnapshotCollector:
    client = StubClient(
        {
            'getFantasyTeams': _teams_payload(),
            'getTeamRosterInfo': _roster_payload(),
            'starts': _starts_payload(),
            'getPlayerStats': _free_agents_payload(),
        }
    )
    return SnapshotCollector(client, LEAGUE_ID)


@pytest.fixture
def snapshot(collector: SnapshotCollector) -> LeagueSnapshot:
    return collector.collect()


def test_parses_starts_cap(snapshot: LeagueSnapshot) -> None:
    budget = snapshot.starts_budgets[0]
    assert budget.starts_used == 62
    assert budget.starts_max == 125
    assert budget.starts_remaining == 63
    assert budget.pace == '86 (-39)'
    assert budget.rank == '6th'


def test_claim_budget_comes_from_the_roster_view(snapshot: LeagueSnapshot) -> None:
    """The cap view omits budget, so it must be read off the default roster payload."""
    assert snapshot.starts_budgets[0].claim_budget == 228.0


def test_parses_roster_status_and_skips_total_rows(snapshot: LeagueSnapshot) -> None:
    players = snapshot.rosters[0].players
    assert [p.name for p in players] == ['Tarik Skubal', 'Dylan Cease']
    assert players[0].roster_status == 'active'
    assert players[1].roster_status == 'reserve'


def test_strips_position_markup(snapshot: LeagueSnapshot) -> None:
    assert snapshot.rosters[0].players[0].positions == 'SP'


def test_parses_probable_start_with_home_away(snapshot: LeagueSnapshot) -> None:
    pitcher = snapshot.free_agent_pitchers[0]
    assert pitcher.name == 'J.T. Ginn'
    assert pitcher.rank == 59
    assert pitcher.next_start is not None
    assert pitcher.next_start.opponent == 'BOS'
    assert pitcher.next_start.is_away is True
    assert pitcher.next_start.when == 'Sun 10:35AM'


def test_retains_raw_payloads_for_offline_analysis(
    collector: SnapshotCollector,
) -> None:
    collector.collect()
    assert set(collector.raw) == {
        'getFantasyTeams',
        'rosters',
        'gamesPerPos',
        'freeAgents',
    }
