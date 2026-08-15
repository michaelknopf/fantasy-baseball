"""Session cookies for the Fantrax web API."""

import json
from pathlib import Path

DEFAULT_COOKIE_PATH = Path('.fantrax_cookies.json')

# Fantrax ties a session to `ui`/`uig`/`FX_RM`; `cf_clearance` satisfies Cloudflare.
# Everything else the browser holds is ad tracking and is deliberately not persisted.
REQUIRED_COOKIES = ('ui', 'uig', 'FX_RM')


class MissingCookiesError(RuntimeError):
    """Raised when the cookie file is absent or lacks the session cookies."""


class FantraxSession:
    """Cookie jar for the Fantrax web API, captured from a logged-in browser."""

    def __init__(self, cookies: dict[str, str]) -> None:
        missing = [name for name in REQUIRED_COOKIES if not cookies.get(name)]
        if missing:
            names = ', '.join(missing)
            msg = f'Cookie file is missing required cookies: {names}.'
            raise MissingCookiesError(
                f'{msg} Re-run `fbb fantrax login` to refresh them.'
            )
        self._cookies = cookies

    @classmethod
    def load(cls, path: Path = DEFAULT_COOKIE_PATH) -> 'FantraxSession':
        """Load cookies previously captured by `fbb fantrax login`."""
        if not path.exists():
            raise MissingCookiesError(
                f'No cookie file at {path}. Run `fbb fantrax login` first.'
            )
        raw: dict[str, str] = json.loads(path.read_text())
        return cls(raw)

    @classmethod
    def save(cls, cookies: dict[str, str], path: Path = DEFAULT_COOKIE_PATH) -> None:
        """Persist cookies, keeping only the ones the API actually needs."""
        keep = (*REQUIRED_COOKIES, 'cf_clearance', 'fsuid')
        subset = {k: v for k, v in cookies.items() if k in keep}
        path.write_text(json.dumps(subset, indent=2) + '\n')

    @property
    def cookies(self) -> dict[str, str]:
        return self._cookies
