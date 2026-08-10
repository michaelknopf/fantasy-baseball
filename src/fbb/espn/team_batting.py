"""Season batting lines for all 30 MLB teams, used to grade pitching matchups.

Fantrax has no team-level endpoint, so this comes from ESPN's public stats API.
Team abbreviations happen to match Fantrax's exactly, so the join needs no mapping.
"""

from typing import cast

import httpx

from fbb.fantrax.models import TeamBatting
from fbb.fantrax.payload import Json, rows, strings

_URL = (
    'https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/statistics/byteam'
)
_TIMEOUT = 20.0


class TeamBattingClient:
    """Fetches and parses ESPN's team batting table."""

    def __init__(self, season: int) -> None:
        self._season = season

    def fetch(self) -> list[TeamBatting]:
        payload = self._get()
        labels = self._labels(payload)
        return [self._team(team, labels) for team in rows(payload, 'teams')]

    def _get(self) -> Json:
        params = {
            'region': 'us',
            'lang': 'en',
            'contentorigin': 'espn',
            'sort': 'team.batting.runs:desc',
            'limit': '32',
            'season': str(self._season),
            'seasontype': '2',
        }
        response = httpx.get(
            _URL,
            params=params,
            timeout=_TIMEOUT,
            headers={'accept': 'application/json'},
        )
        response.raise_for_status()
        return cast(Json, response.json())

    @staticmethod
    def _labels(payload: Json) -> list[str]:
        """Column names for the batting category, which the rows omit."""
        for category in rows(payload, 'categories'):
            if category.get('name') == 'batting':
                return strings(category, 'labels')
        raise ValueError('ESPN payload has no batting category')

    def _team(self, team: Json, labels: list[str]) -> TeamBatting:
        identity = self._batting(team, 'team')
        batting = self._category(team)
        values = dict(zip(labels, self._floats(batting, 'values'), strict=False))
        ranks = dict(zip(labels, strings(batting, 'ranks'), strict=False))

        games = int(values['GP'])
        runs = int(values['R'])
        return TeamBatting(
            abbreviation=str(identity.get('abbreviation') or ''),
            name=str(identity.get('displayName') or ''),
            games=games,
            runs=runs,
            runs_per_game=runs / games,
            runs_rank=int(ranks['R']),
            ops=values['OPS'],
            ops_rank=int(ranks['OPS']),
            avg=values['AVG'],
            home_runs=int(values['HR']),
            strikeouts=int(values['SO']),
            strikeouts_rank=int(ranks['SO']),
        )

    @staticmethod
    def _batting(source: Json, key: str) -> Json:
        value = source.get(key)
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _category(team: Json) -> Json:
        for category in rows(team, 'categories'):
            if category.get('name') == 'batting':
                return category
        return {}

    @staticmethod
    def _floats(source: Json, key: str) -> list[float]:
        value = source.get(key)
        if not isinstance(value, list):
            return []
        return [float(item) for item in value if isinstance(item, (int, float))]
