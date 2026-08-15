"""CLI subcommands for collecting Fantrax data."""

import time
from pathlib import Path
from typing import Annotated

import typer
from playwright.sync_api import BrowserContext, sync_playwright
from rich.console import Console
from rich.table import Table

from fbb.fantrax.auth import DEFAULT_COOKIE_PATH, REQUIRED_COOKIES, FantraxSession
from fbb.fantrax.client import FantraxClient
from fbb.fantrax.collector import SnapshotCollector
from fbb.fantrax.models import LeagueSnapshot
from fbb.fantrax.snapshot import SnapshotWriter
from fbb.fantrax.waivers import DEFAULT_PERIODS_AHEAD

app = typer.Typer(
    name='fantrax',
    help='Collect data from Fantrax.',
    no_args_is_help=True,
    context_settings={'help_option_names': ['-h', '--help']},
)

console = Console()

DEFAULT_LEAGUE_ID = 'vbh2q8ffmng9ekc0'

LOGIN_TIMEOUT_SECONDS = 300.0


def _fantrax_cookies(context: BrowserContext) -> dict[str, str]:
    return {
        str(c.get('name')): str(c.get('value'))
        for c in context.cookies()
        if 'fantrax.com' in str(c.get('domain'))
    }


LeagueOption = Annotated[str, typer.Option('--league', help='Fantrax league ID.')]
OutOption = Annotated[Path, typer.Option('--out', help='Directory for snapshots.')]
PeriodsOption = Annotated[
    int,
    typer.Option(
        '--periods',
        min=1,
        help='Waiver periods ahead to collect free-agent starts for.',
    ),
]


@app.command()
def login(league: LeagueOption = DEFAULT_LEAGUE_ID) -> None:
    """Open a browser, wait for you to log in, and save the session cookies."""
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(f'https://www.fantrax.com/fantasy/league/{league}/team/roster')

        console.print('[bold]Log in to Fantrax in the browser window.[/bold]')
        console.print('Waiting for you to finish logging in...')

        # Fantrax redirects to its login page client-side, so the roster URL matches
        # before authentication happens. The session cookies are the only reliable
        # signal that the login actually went through.
        deadline = time.monotonic() + LOGIN_TIMEOUT_SECONDS
        while True:
            cookies = _fantrax_cookies(context)
            if all(cookies.get(name) for name in REQUIRED_COOKIES):
                break
            if time.monotonic() > deadline:
                browser.close()
                console.print(
                    '[red]Timed out waiting for login; no cookies saved.[/red]'
                )
                raise typer.Exit(1)
            page.wait_for_timeout(1_000)

        browser.close()

    FantraxSession.save(cookies)
    console.print(f'[green]Saved session cookies to {DEFAULT_COOKIE_PATH}[/green]')


@app.command()
def collect(
    league: LeagueOption = DEFAULT_LEAGUE_ID,
    out: OutOption = Path('snapshots'),
    periods: PeriodsOption = DEFAULT_PERIODS_AHEAD,
) -> None:
    """Collect a full league snapshot and write it to disk."""
    session = FantraxSession.load()
    with FantraxClient(session, league) as client:
        collector = SnapshotCollector(client, league, periods_ahead=periods)
        console.print('Collecting league data...')
        snapshot = collector.collect()

    run_dir = SnapshotWriter(out).write(snapshot, collector.raw)

    _print_starts_table(snapshot)
    window = (
        f'{snapshot.periods_ahead} waiver period(s) ahead, '
        f'through {snapshot.collected_through:%a %b %-d}'
    )
    counts = (
        f'{len(snapshot.rosters)} rosters, '
        f'{len(snapshot.free_agent_pitchers)} free-agent starts'
    )
    console.print(f'\nFree agents collected for {window}')
    console.print(f'[green]Wrote snapshot to {run_dir}[/green] ({counts})')


def _print_starts_table(snapshot: LeagueSnapshot) -> None:
    table = Table(title='Pitching starts remaining')
    for column in ('Rank', 'Team', 'Used', 'Max', 'Left', 'Pace', 'Budget'):
        table.add_column(column)

    ordered = sorted(
        snapshot.starts_budgets, key=lambda b: b.starts_remaining or 0, reverse=True
    )
    for budget in ordered:
        mine = next(
            (t.is_mine for t in snapshot.teams if t.team_id == budget.team_id), False
        )
        name = (
            f'[bold cyan]{budget.team_name}[/bold cyan]' if mine else budget.team_name
        )
        table.add_row(
            budget.rank or '',
            name,
            str(budget.starts_used or ''),
            str(budget.starts_max or ''),
            f'[bold]{budget.starts_remaining}[/bold]'
            if budget.starts_remaining
            else '',
            budget.pace or '',
            f'${budget.claim_budget:.0f}' if budget.claim_budget is not None else '',
        )
    console.print(table)
