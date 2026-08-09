"""CLI for turning a collected snapshot into the web app's data file."""

import json
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from fbb.analysis.board import BoardBuilder
from fbb.fantrax.models import LeagueSnapshot

app = typer.Typer(
    name='board',
    help='Build the streaming board from a snapshot.',
    no_args_is_help=True,
    context_settings={'help_option_names': ['-h', '--help']},
)

console = Console()

SnapshotOption = Annotated[
    Path, typer.Option('--snapshot', help='Snapshot directory to read.')
]
OutOption = Annotated[Path, typer.Option('--out', help='Where to write board.json.')]


@app.command()
def build(
    snapshot: SnapshotOption = Path('snapshots/latest'),
    out: OutOption = Path('web/src/data/board.json'),
) -> None:
    """Derive the board and write it where the web app imports it."""
    loaded = LeagueSnapshot.model_validate_json(
        (snapshot / 'snapshot.json').read_text()
    )
    board = BoardBuilder(loaded).build()

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(json.loads(board.model_dump_json()), indent=2) + '\n')

    mine = sum(1 for p in board.pitchers if p.ownership == 'mine')
    free = sum(1 for p in board.pitchers if p.ownership == 'free_agent')
    counts = f'{mine} on your roster, {free} free agents, {len(board.periods)} periods'
    console.print(f'[green]Wrote {out}[/green] ({counts})')
