"""HTTP client for the Fantrax Beta API."""

import httpx

from fbb.fantrax.auth import FantraxAuth
from fbb.fantrax.models import League

# Base URL for the Fantrax Beta API.
# Endpoint paths are appended to this base.
_BASE_URL = 'https://www.fantrax.com/fxpa/req'


class FantraxClient:
    """
    Client for the Fantrax Beta API.

    Authenticates via a User Secret ID (found on the Fantrax User Profile page).
    See https://github.com/pmurley/go-fantrax for endpoint documentation.
    """

    def __init__(self, auth: FantraxAuth) -> None:
        self._http = httpx.Client(
            base_url=_BASE_URL,
            headers=auth.headers(),
            timeout=30.0,
        )

    def list_leagues(self) -> list[League]:
        """Fetch all leagues for the authenticated user."""
        response = self._http.get('/leagueList')
        response.raise_for_status()
        data = response.json()
        # TODO: parse real response shape once we validate the endpoint
        leagues: list[League] = [League(**item) for item in data]
        return leagues

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._http.close()

    def __enter__(self) -> 'FantraxClient':
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
