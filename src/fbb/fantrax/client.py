"""HTTP client for the Fantrax web API."""

import time
from typing import Any

import httpx

from fbb.fantrax.auth import FantraxSession
from fbb.fantrax.payload import Json, JsonValue, obj, rows

_URL = 'https://www.fantrax.com/fxpa/req'

# Fantrax rejects requests that don't look like its Angular app. `v` is the client
# build the app reported when this was captured; it has tolerated drift so far, but
# an unexplained ERROR_INVALID_REQUEST across every method is the sign to re-capture.
_UI_VERSION = 3
_APP_VERSION = '185.1.8'

# Fantrax throttles bursts of profile lookups ("you're viewing player profiles too
# quickly"). A small gap between requests avoids tripping it; the backoff is the
# recovery path when it trips anyway.
_MIN_INTERVAL_SECONDS = 0.4
_BACKOFF_SECONDS = 20.0
_MAX_RETRIES = 4

_USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
)


class FantraxApiError(RuntimeError):
    """Raised when Fantrax returns an error in the response envelope."""


class FantraxRateLimited(FantraxApiError):
    """Raised when Fantrax asks us to slow down."""


class FantraxClient:
    """
    Client for Fantrax's `fxpa/req` RPC endpoint.

    Every operation is a POST to the same URL; the `method` field inside the
    envelope selects the operation. Authentication is by session cookie.
    """

    def __init__(
        self,
        session: FantraxSession,
        league_id: str,
        min_interval: float = _MIN_INTERVAL_SECONDS,
    ) -> None:
        self._league_id = league_id
        self._min_interval = min_interval
        self._last_request = 0.0
        self._http = httpx.Client(
            cookies=session.cookies,
            timeout=30.0,
            headers={
                'Content-Type': 'application/json',
                'User-Agent': _USER_AGENT,
                'Referer': f'https://www.fantrax.com/fantasy/league/{league_id}/team/roster',
            },
        )

    def call(self, method: str, data: dict[str, str] | None = None) -> Json:
        """
        Invoke a single API method and return its unwrapped `data` payload.

        Retries when Fantrax asks us to slow down, backing off further each attempt.
        """
        for attempt in range(_MAX_RETRIES):
            try:
                return self._call_once(method, data)
            except FantraxRateLimited:
                if attempt == _MAX_RETRIES - 1:
                    raise
                time.sleep(_BACKOFF_SECONDS * (attempt + 1))
        raise FantraxRateLimited(f'{method}: gave up after {_MAX_RETRIES} attempts')

    def _call_once(self, method: str, data: dict[str, str] | None = None) -> Json:
        self._wait_for_slot()
        request: dict[str, Any] = {
            'msgs': [
                {
                    'method': method,
                    'data': {'leagueId': self._league_id, **(data or {})},
                }
            ],
            'uiv': _UI_VERSION,
            'refUrl': f'https://www.fantrax.com/fantasy/league/{self._league_id}/team/roster',
            'dt': 0,
            'at': 0,
            'tz': 'America/Los_Angeles',
            'v': _APP_VERSION,
        }
        response: httpx.Response = self._http.post(
            _URL, params={'leagueId': self._league_id}, json=request
        )
        response.raise_for_status()
        decoded: JsonValue = response.json()
        envelope: Json = decoded if isinstance(decoded, dict) else {}

        responses = rows(envelope, 'responses')
        if not responses:
            raise FantraxApiError(f'{method}: empty response envelope')

        # A bad method name, stale session, or throttle surfaces here, not as HTTP.
        error = obj(responses[0], 'pageError') or obj(envelope, 'pageError')
        if error:
            text = str(error.get('text', error))
            if 'too quickly' in text or 'slow down' in text:
                raise FantraxRateLimited(f'{method}: {text}')
            raise FantraxApiError(f'{method}: {text}')

        return obj(responses[0], 'data')

    def _wait_for_slot(self) -> None:
        """Keep a minimum gap between requests; Fantrax throttles rapid bursts."""
        elapsed = time.monotonic() - self._last_request
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request = time.monotonic()

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> 'FantraxClient':
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
