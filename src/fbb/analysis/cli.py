"""CLI for turning a collected snapshot into the web app's data file."""

import json
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from fbb.analysis.board import Board, BoardBuilder
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
    board = BoardBuilder(loaded, playoffs=bracket).build()

    # A round's opening totals are only knowable while they are still current —
    # Fantrax serves no history — so they are caught here and the board rebuilt
    # to score against them.
    if bracket and _capture_baselines(bracket, board):
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


def _capture_baselines(bracket: PlayoffConfig, board: Board) -> bool:
    """Record where each team stood when a round opened. True if anything was new.

    Reads the built board rather than the config: a slot fed by `winner_of` names
    no team until the builder resolves it, so capturing off the config silently
    skips every team that advanced into a round.
    """
    store = BaselineStore.load(DEFAULT_BASELINE_PATH)
    captured: dict[str, float] = {}

    for built in board.playoffs:
        for r, rnd in enumerate(built.rounds):
            if rnd.state == 'upcoming':
                continue
            for m, matchup in enumerate(rnd.matchups):
                if matchup.is_bye:  # not played, so it has no baseline to catch
                    continue
                for slot, side in (('a', matchup.a), ('b', matchup.b)):
                    if side.starting_points is not None or side.team is None:
                        continue
                    if side.current_points is None:
                        continue
                    key = f'{built.key}.{r}.{m}.{slot}'
                    if store.record(key, side.current_points):
                        captured[key] = side.current_points

    if not captured:
        return False

    # Saved only after the whole walk: `_occupant` raises on a renamed team, and
    # `record` is write-once, so a mid-walk save could permanently freeze half a
    # round against totals nothing can recover.
    store.save(DEFAULT_BASELINE_PATH)
    bracket.apply_baselines(store)
    note = f'Captured {len(captured)} starting total(s) to {DEFAULT_BASELINE_PATH}'
    console.print(f'[green]{note}[/green]')
    return True
