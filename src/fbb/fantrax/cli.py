"""Fantrax CLI subcommands for interacting with the Fantrax Beta API."""

import typer
from rich.console import Console

from fbb.fantrax.auth import FantraxAuth
from fbb.fantrax.client import FantraxClient

app = typer.Typer(
    name='fantrax',
    help='Interact with the Fantrax API.',
    no_args_is_help=True,
    context_settings={'help_option_names': ['-h', '--help']},
)

console = Console()


@app.command()
def leagues() -> None:
    """List your Fantrax leagues."""
    # pydantic-settings populates fields from env vars; mypy doesn't know this
    auth = FantraxAuth()  # type: ignore[call-arg]
    with FantraxClient(auth) as client:
        results = client.list_leagues()
    for league in results:
        console.print(
            f'[bold]{league.name}[/bold] ({league.sport}) — {league.league_id}'
        )
