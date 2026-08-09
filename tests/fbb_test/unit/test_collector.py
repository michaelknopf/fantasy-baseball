"""Tests for parsing Fantrax payloads into the snapshot model.

Payload fixtures are trimmed copies of real API responses; they exist to pin the
field paths the collector depends on, since Fantrax can reshape them silently.
"""

from datetime import date, datetime

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
        if method == 'getPlayerStats':
            date = args.get('datePlaying')
            return _free_agents_payload(date) if date else _date_list_payload()
        return self._responses[method]


def _roster_payload() -> Json:
    return {
        'tables': [
            {
                'header': {
                    'cells': [{'shortName': 'Age'}, {'shortName': 'FPts'}]
                },
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


def _date_list_payload() -> Json:
    """Fantrax offers a month of dates; the waiver window decides how many are used."""
    return {
        'displayedLists': {
            'datePlayingDates': [
                {'id': 'ALL', 'name': 'All'},
                *(
                    {'id': f'2026-08-{day:02d}', 'name': f'Aug {day}'}
                    for day in range(9, 26)
                ),
            ]
        }
    }


def _free_agents_payload(date: str) -> Json:
    """A probable starter on 8/9 and 8/10; other dates return nobody."""
    by_date: dict[str, list[Json]] = {
        '2026-08-09': [
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
                    {'content': '3.41'},
                ],
            }
        ],
        '2026-08-10': [
            {
                'scorer': {
                    'scorerId': 'fa2',
                    'name': 'Kumar Rocker',
                    'posShortNames': '<b>SP</b>',
                    'teamShortName': 'TEX',
                },
                'cells': [
                    {'content': '85'},
                    {'content': 'FA'},
                    {'content': 'BAL<br/>Mon 6:38PM'},
                    {'content': '4.02'},
                ],
            }
        ],
        # A game already underway reports a live score rather than a start time.
        '2026-08-11': [
            {
                'scorer': {
                    'scorerId': 'fa3',
                    'name': 'J.T. Ginn',
                    'posShortNames': '<b>SP</b>',
                    'teamShortName': 'ATH',
                },
                'cells': [
                    {'content': '57'},
                    {'content': 'FA'},
                    {'content': 'ATH 2<br/>@BOS 1'},
                    {'content': '3.88'},
                ],
            }
        ],
    }
    return {
        'paginatedResultSet': {'totalNumPages': 1, 'pageNumber': 1},
        'tableHeader': {
            'cells': [
                {'shortName': 'Rk'},
                {'shortName': 'Sta'},
                {'shortName': 'Opp'},
                {'shortName': 'ERA'},
            ]
        },
        'statsTable': by_date.get(date, []),
    }


@pytest.fixture
def client() -> StubClient:
    return StubClient(
        {
            'getFantasyTeams': _teams_payload(),
            'getTeamRosterInfo': _roster_payload(),
            'starts': _starts_payload(),
        }
    )


@pytest.fixture
def collector(client: StubClient) -> SnapshotCollector:
    # Sunday 8/9: waiver deadlines fall Mon 10, Thu 13, Sat 15, so two periods
    # ahead collects through Fri 14.
    return SnapshotCollector(client, LEAGUE_ID, now=datetime(2026, 8, 9, 10, 0))


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


def test_labels_stats_with_their_column_names(snapshot: LeagueSnapshot) -> None:
    """Bare positional stats are meaningless once the raw payload is out of reach."""
    assert snapshot.rosters[0].players[0].stats == {'Age': '1', 'FPts': '2.10'}
    assert snapshot.free_agent_pitchers[0].stats['Rk'] == '59'
    assert snapshot.free_agent_pitchers[0].stats['ERA'] == '3.41'


def test_parses_probable_start_with_home_away(snapshot: LeagueSnapshot) -> None:
    pitcher = snapshot.free_agent_pitchers[0]
    assert pitcher.name == 'J.T. Ginn'
    assert pitcher.rank == 59
    assert pitcher.start_date == '2026-08-09'
    assert pitcher.next_start is not None
    assert pitcher.next_start.opponent == 'BOS'
    assert pitcher.next_start.is_away is True
    assert pitcher.next_start.when == 'Sun 10:35AM'

    home = snapshot.free_agent_pitchers[1]
    assert home.start_date == '2026-08-10'
    assert home.next_start is not None
    assert home.next_start.is_away is False


def test_parses_a_start_already_in_progress(snapshot: LeagueSnapshot) -> None:
    """A live score names both sides; the pitcher's own team picks out the opponent."""
    live = next(p for p in snapshot.free_agent_pitchers if p.start_date == '2026-08-11')
    assert live.mlb_team == 'ATH'
    assert live.next_start is not None
    assert live.next_start.opponent == 'BOS'
    # "@" marks the venue, so in "ATH 2 / @BOS 1" the ATH pitcher is visiting.
    assert live.next_start.is_away is True
    assert live.next_start.in_progress is True


def _swept_dates(client: StubClient) -> list[str]:
    return [
        args['datePlaying']
        for method, args in client.calls
        if method == 'getPlayerStats' and 'datePlaying' in args
    ]


def test_sweeps_through_the_day_before_the_closing_deadline(
    client: StubClient, collector: SnapshotCollector
) -> None:
    """From Sun 8/9, two periods ahead ends on Fri 8/14 — the day before Sat's deadline."""
    snapshot = collector.collect()
    assert snapshot.collected_through == date(2026, 8, 14)
    assert _swept_dates(client) == [f'2026-08-{d:02d}' for d in range(9, 15)]


def test_periods_ahead_narrows_the_window(client: StubClient) -> None:
    """One period ahead stops before Thursday's deadline, so it ends Wed 8/12."""
    collector = SnapshotCollector(
        client, LEAGUE_ID, periods_ahead=1, now=datetime(2026, 8, 9, 10, 0)
    )
    snapshot = collector.collect()
    assert snapshot.collected_through == date(2026, 8, 12)
    assert _swept_dates(client) == [
        '2026-08-09',
        '2026-08-10',
        '2026-08-11',
        '2026-08-12',
    ]


def test_empty_dates_inside_the_window_are_still_swept(
    client: StubClient, collector: SnapshotCollector
) -> None:
    """A date with no probables must not cut the sweep short."""
    snapshot = collector.collect()
    # 8/12 and 8/13 have no probables, yet 8/14 is still collected.
    assert [p.start_date for p in snapshot.free_agent_pitchers] == [
        '2026-08-09',
        '2026-08-10',
        '2026-08-11',
    ]
    assert '2026-08-14' in _swept_dates(client)


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
