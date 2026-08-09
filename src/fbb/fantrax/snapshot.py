"""Writes collected data to disk as a self-contained snapshot."""

import json
from pathlib import Path
from typing import Any

from fbb.fantrax.models import LeagueSnapshot


class SnapshotWriter:
    """
    Persists one collection run into its own timestamped directory.

    Raw payloads are written alongside the parsed snapshot so that analysis can be
    re-run, and the parser extended, without touching the network again.
    """

    def __init__(self, root: Path) -> None:
        self._root = root

    def write(self, snapshot: LeagueSnapshot, raw: dict[str, Any]) -> Path:
        stamp = snapshot.collected_at.strftime('%Y-%m-%dT%H-%M-%SZ')
        run_dir = self._root / stamp
        run_dir.mkdir(parents=True, exist_ok=True)

        (run_dir / 'snapshot.json').write_text(
            snapshot.model_dump_json(indent=2) + '\n'
        )
        (run_dir / 'raw.json').write_text(json.dumps(raw, indent=2, default=str) + '\n')

        latest = self._root / 'latest'
        latest.unlink(missing_ok=True)
        latest.symlink_to(run_dir.name)
        return run_dir
