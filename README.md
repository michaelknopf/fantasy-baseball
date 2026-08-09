# fbb — Fantrax playoff data collector

Phase 1 of a two-phase tool. This half collects data from Fantrax and writes it to disk.
Phase 2 (analysis) reads those files and never touches the network.

## Usage

```bash
uv sync
uv run playwright install chromium   # once, for the login step

uv run fbb fantrax login             # opens a browser; log in, then it saves cookies
uv run fbb fantrax collect           # pure HTTP, no browser
```

`login` is the only step that needs a browser. It waits for you to authenticate, then
writes the session cookies to `.fantrax_cookies.json` (gitignored). Cookies last about a
year, so in practice you re-run it only when `collect` starts failing.

Each `collect` run writes a timestamped directory under `snapshots/`, with
`snapshots/latest` symlinked to the most recent:

```
snapshots/2026-08-09T16-23-24Z/
  snapshot.json   # parsed, typed view
  raw.json        # every raw API payload, verbatim
```

`raw.json` exists so Phase 2 can reach fields the parser doesn't model yet without
re-collecting. Prefer adding a field to the parser over reading `raw.json` directly, but
the escape hatch is there.

## What gets collected

- **Starts remaining, for all ten teams** — the season-long pitching-starts cap
  (`total`, `max`, `remaining`, `pace`). The cap spans the regular season *and* the
  playoffs, so an unspent balance carries into the playoff rounds.
- **Each team's claim budget** — remaining FA bidding dollars.
- **All ten rosters** — every player, with roster status (active / reserve / injured
  reserve), lineup slot, positions, MLB team, and the stat row Fantrax renders.
- **Free-agent starting pitchers, swept across every upcoming date** — opponent,
  home/away, start time, and the date, plus their stat row. One entry per
  pitcher-date, so a pitcher probable twice appears twice.

## The API

Fantrax's web app talks to a single RPC endpoint. There is no REST surface and no
documented API; the shapes below were recovered by watching the app's own traffic.

```
POST https://www.fantrax.com/fxpa/req?leagueId=<league>
{"msgs":[{"method":"<method>","data":{...}}],"uiv":3,"refUrl":"...","dt":0,"at":0,"tz":"...","v":"185.1.8"}
```

Authentication is by cookie (`ui`, `uig`, `FX_RM`, plus Cloudflare's `cf_clearance`).
Errors come back as HTTP 200 with a `pageError` in the envelope, not as a status code.

| Method | Purpose |
| --- | --- |
| `getFantasyTeams` | Team IDs and names; `myTeamIds` identifies yours |
| `getTeamRosterInfo` | A team's roster. Accepts any `teamId`, so all ten are readable |
| `getTeamRosterInfo` + `view: GAMES_PER_POS` | The starts cap, under `scMinMaxData` |
| `getPlayerStats` | Player search; the filters below select streamable pitchers |

One quirk worth knowing: **the claim budget is only on the default roster view**, not the
`GAMES_PER_POS` view, even though the starts cap is only on the latter. The collector
fetches both per team and merges them.

### Selecting streamable pitchers

`getPlayerStats` takes these filters:

| Field | Value | Meaning |
| --- | --- | --- |
| `statusOrTeamFilter` | `ALL_AVAILABLE` | Unowned players only |
| `posOrGroup` | `POS_015` | Starting pitchers |
| `miscDisplayType` | `7` | "1-2 starts" — only pitchers with a probable start |
| `datePlaying` | `2026-08-10` | Probable starters on one date |

The next start arrives as a rendered cell — `LAD<br/>Sun 1:10PM`, or `@BOS<br/>...` when
away — which the collector parses into opponent, home/away, and time.

**`datePlaying` is not optional in practice.** Without it the query returns only the
current day's probables (17 pitchers), which is nowhere near enough to plan a two-week
round. The collector therefore issues one query per date and merges the results — 90
unique pitchers across 177 pitcher-dates in a representative run.

The sweep stops at the first empty date. MLB publishes probable starters only ~12 days
out, so the tail is genuinely empty rather than truncated, and querying past it would
just burn requests. Cost is roughly one request per populated date.

## Layout

| Module | Responsibility |
| --- | --- |
| `auth.py` | Loads and saves session cookies |
| `client.py` | The `fxpa/req` envelope and error handling |
| `payload.py` | Typed narrowing helpers for Fantrax's loose JSON |
| `collector.py` | Turns API calls into a snapshot |
| `models.py` | The parsed snapshot shape |
| `snapshot.py` | Writes a run to disk |
