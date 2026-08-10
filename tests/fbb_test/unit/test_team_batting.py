"""Tests for parsing ESPN's team batting table.

ESPN returns stats as positional arrays whose meaning lives in a separate labels
list, so these pin the alignment between the two.
"""

from typing import Any

import httpx
import pytest

from fbb.espn.team_batting import TeamBattingClient

_LABELS = [
    'GP',
    'AB',
    'R',
    'H',
    '2B',
    '3B',
    'HR',
    'RBI',
    'TB',
    'BB',
    'SO',
    'SB',
    'AVG',
    'OBP',
    'SLG',
    'OPS',
]


def _payload() -> dict[str, Any]:
    return {
        'categories': [{'name': 'batting', 'labels': _LABELS}],
        'teams': [
            {
                'team': {
                    'abbreviation': 'WSH',
                    'displayName': 'Washington Nationals',
                },
                'categories': [
                    {
                        'name': 'batting',
                        'values': [
                            119.0,
                            4077.0,
                            636.0,
                            1021.0,
                            208.0,
                            25.0,
                            170.0,
                            607.0,
                            1789.0,
                            422.0,
                            989.0,
                            128.0,
                            0.25042924,
                            0.32729653,
                            0.43880305,
                            0.7660996,
                        ],
                        'ranks': [
                            '1',
                            '2',
                            '1',
                            '3',
                            '5',
                            '3',
                            '1',
                            '1',
                            '17',
                            '9',
                            '16',
                            '1',
                            '6',
                            '6',
                            '1',
                            '2',
                        ],
                    }
                ],
            }
        ],
    }


def _respond(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> None:
    """Serves `body` from `httpx.get`, with a request attached so
    `raise_for_status` works."""

    def fake_get(url: str, **_kwargs: object) -> httpx.Response:
        return httpx.Response(200, json=body, request=httpx.Request('GET', url))

    monkeypatch.setattr(httpx, 'get', fake_get)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TeamBattingClient:
    _respond(monkeypatch, _payload())
    return TeamBattingClient(2026)


def test_aligns_stats_with_their_labels(client: TeamBattingClient) -> None:
    (team,) = client.fetch()
    assert team.abbreviation == 'WSH'
    assert team.runs == 636
    assert team.home_runs == 170
    assert team.strikeouts == 989
    assert team.ops == pytest.approx(0.7661, abs=1e-4)


def test_derives_runs_per_game(client: TeamBattingClient) -> None:
    (team,) = client.fetch()
    assert team.runs_per_game == pytest.approx(636 / 119)


def test_keeps_ranks_where_one_is_the_best_offense(
    client: TeamBattingClient,
) -> None:
    # A high rank is the soft matchup, so the direction matters downstream.
    (team,) = client.fetch()
    assert team.runs_rank == 1
    assert team.ops_rank == 2
    assert team.strikeouts_rank == 16


def test_rejects_a_payload_without_the_batting_labels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _respond(monkeypatch, {'categories': [], 'teams': []})
    with pytest.raises(ValueError, match='no batting category'):
        TeamBattingClient(2026).fetch()
