"""Root CLI entry point for fbb."""

import typer

from fbb.analysis.cli import app as board_app
from fbb.fantrax.cli import app as fantrax_app
from fbb.strategy.cli import app as strategy_app

app = typer.Typer(
    name='fbb',
    help='Fantasy baseball tools for Fantrax league management.',
    no_args_is_help=True,
    context_settings={'help_option_names': ['-h', '--help']},
)

app.add_typer(fantrax_app, name='fantrax')
app.add_typer(board_app, name='board')
app.add_typer(strategy_app, name='strategy')

if __name__ == '__main__':
    app()
