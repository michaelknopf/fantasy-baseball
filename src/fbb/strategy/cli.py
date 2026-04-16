"""Strategy CLI subcommands for roster management and lineup optimization."""

import typer
from rich.console import Console

app = typer.Typer(
    name='strategy',
    help='Roster strategy and lineup optimization.',
    no_args_is_help=True,
    context_settings={'help_option_names': ['-h', '--help']},
)

console = Console()


@app.command()
def roster() -> None:
    """Analyze current roster and suggest moves."""
    console.print('[bold]Roster analysis coming soon.[/bold]')
