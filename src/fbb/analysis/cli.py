"""CLI for turning a collected snapshot into the web app's data file."""

import json
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from fbb.analysis.board import BoardBuilder
from fbb.analysis.playoffs import (
    DEFAULT_BASELINE_PATH,
    DEFAULT_CONFIG_PATH,
    BaselineStore,
    PlayoffConfig,
)
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
PlayoffsOption = Annotated[
    Path, typer.Option('--playoffs', help='Bracket file to read.')
]


@app.command()
def build(
    snapshot: SnapshotOption = Path('snapshots/latest'),
    out: OutOption = Path('web/src/data/board.json'),
    playoffs: PlayoffsOption = DEFAULT_CONFIG_PATH,
) -> None:
    """Derive the board and write it where the web app imports it."""
    loaded = LeagueSnapshot.model_validate_json(
        (snapshot / 'snapshot.json').read_text()
    )

    bracket = PlayoffConfig.load(playoffs) if playoffs.exists() else None
    if bracket:
        _capture_baselines(bracket, loaded)

    board = BoardBuilder(loaded, playoffs=bracket).build()

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(json.loads(board.model_dump_json()), indent=2) + '\n')

    mine = sum(1 for p in board.pitchers if p.ownership == 'mine')
    free = sum(1 for p in board.pitchers if p.ownership == 'free_agent')
    counts = (
        f'{mine} pitchers on your roster, {free} free agents, '
        f'{len(board.roster)} roster spots, {len(board.periods)} periods'
    )
    console.print(f'[green]Wrote {out}[/green] ({counts})')


def _capture_baselines(bracket: PlayoffConfig, snapshot: LeagueSnapshot) -> None:
    """Record where each team stood when a round opened.

    A round scores only the points earned inside it, so the totals at its start
    have to be caught while they are still current — they cannot be recovered
    from a later snapshot.
    """
    points = {b.team_name: b.fantasy_points for b in snapshot.starts_budgets}
    store = BaselineStore.load(DEFAULT_BASELINE_PATH)
    today = snapshot.collected_at.date()
    captured = 0

    for key, index, rnd in bracket.rounds_open_by(today):
        for slot, matchup in enumerate(rnd.matchups):
            # A bye is not played, so it has no baseline to catch.
            if matchup.bye:
                continue
            for name, side in (('a', matchup.a), ('b', matchup.b)):
                total = points.get(side.team) if side.team else None
                if side.starting_points is not None or total is None:
                    continue
                if store.record(f'{key}.{index}.{slot}.{name}', total):
                    side.starting_points = total
                    captured += 1

    if captured:
        store.save(DEFAULT_BASELINE_PATH)
        note = f'Captured {captured} starting total(s) to {DEFAULT_BASELINE_PATH}'
        console.print(f'[green]{note}[/green]')
