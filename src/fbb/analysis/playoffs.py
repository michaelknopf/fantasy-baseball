"""The playoff bracket, which Fantrax does not serve.

Seeds, pairings, round dates and seed spots are maintained by hand in
`playoffs.yaml`. Baselines captured at a round's open are written to a separate
sidecar so the hand-edited file keeps its comments and ordering.
"""

import re
from collections.abc import ItemsView, Mapping
from datetime import date
from pathlib import Path
from typing import Self, cast

import yaml
from pydantic import BaseModel, model_validator

DEFAULT_CONFIG_PATH = Path('playoffs.yaml')
DEFAULT_BASELINE_PATH = Path('playoffs.baselines.yaml')

# <bracket key>.<round index>.<matchup index>, both zero-based.
_REF = re.compile(r'^(?P<bracket>[a-z0-9_]+)\.(?P<round>\d+)\.(?P<matchup>\d+)$')


class PlayoffConfigError(ValueError):
    """Raised when the bracket file cannot be trusted."""


def _read_yaml(path: Path) -> dict[str, object]:
    """Parse a YAML mapping, narrowing the loader's `Any` at this one boundary."""
    loaded: object = yaml.safe_load(path.read_text())
    if loaded is None:
        return {}
    mapping = _as_mapping(loaded)
    if mapping is None:
        raise PlayoffConfigError(f'{path} should hold a mapping, not {type(loaded)}')
    return mapping


def _as_mapping(data: object) -> dict[str, object] | None:
    """A str-keyed copy of `data`, or None when it is not a mapping at all."""
    if not isinstance(data, Mapping):
        return None
    pairs = cast(ItemsView[object, object], data.items())
    return {str(key): value for key, value in pairs}


class SlotRef(BaseModel):
    """A pointer at the matchup whose result fills a slot."""

    bracket: str
    round_index: int
    matchup_index: int
    take_winner: bool

    @classmethod
    def parse(cls, raw: str, *, take_winner: bool) -> Self:
        found = _REF.match(raw.strip())
        if not found:
            expected = '<bracket>.<round>.<matchup>'
            raise PlayoffConfigError(
                f'{raw!r} is not a matchup reference (expected "{expected}")'
            )
        return cls(
            bracket=found['bracket'],
            round_index=int(found['round']),
            matchup_index=int(found['matchup']),
            take_winner=take_winner,
        )

    @property
    def key(self) -> str:
        return f'{self.bracket}.{self.round_index}.{self.matchup_index}'


class Side(BaseModel):
    """One half of a matchup: a named team, or a slot waiting on another result."""

    seed: int | None = None
    team: str | None = None
    advantage: float = 0.0
    starting_points: float | None = None
    feeds_from: SlotRef | None = None

    @model_validator(mode='before')
    @classmethod
    def _resolve_reference(cls, data: object) -> object:
        """Fold `winner_of` / `loser_of` shorthand into a parsed reference."""
        raw = _as_mapping(data)
        if raw is None:
            return data
        winner = raw.pop('winner_of', None)
        loser = raw.pop('loser_of', None)
        if winner and loser:
            raise PlayoffConfigError(
                'a slot takes either winner_of or loser_of, not both'
            )
        if winner or loser:
            raw['feeds_from'] = SlotRef.parse(
                str(winner or loser), take_winner=bool(winner)
            )
        return raw

    @model_validator(mode='after')
    def _needs_an_occupant(self) -> Self:
        if not self.team and not self.feeds_from:
            raise PlayoffConfigError('a slot needs either a team or a reference')
        return self


class Matchup(BaseModel):
    a: Side
    b: Side
    bye: bool = False


class Round(BaseModel):
    label: str
    start: date
    end: date
    matchups: list[Matchup] = []

    @model_validator(mode='after')
    def _ordered(self) -> Self:
        if self.end < self.start:
            raise PlayoffConfigError(f'{self.label} ends before it starts')
        return self


class Bracket(BaseModel):
    key: str
    label: str
    rounds: list[Round] = []


class PlayoffConfig(BaseModel):
    """The whole bracket, as written on disk."""

    brackets: list[Bracket] = []

    @model_validator(mode='after')
    def _references_resolve(self) -> Self:
        known = {
            f'{bracket.key}.{r}.{m}'
            for bracket in self.brackets
            for r, rnd in enumerate(bracket.rounds)
            for m, _ in enumerate(rnd.matchups)
        }
        for bracket in self.brackets:
            for rnd in bracket.rounds:
                for matchup in rnd.matchups:
                    for side in (matchup.a, matchup.b):
                        ref = side.feeds_from
                        if ref and ref.key not in known:
                            raise PlayoffConfigError(
                                f'{rnd.label} points at {ref.key}, which does not exist'
                            )
        return self

    @classmethod
    def load(
        cls,
        path: Path = DEFAULT_CONFIG_PATH,
        baselines: Path | None = DEFAULT_BASELINE_PATH,
    ) -> Self:
        """Read the bracket, with any captured baselines merged over it."""
        if not path.exists():
            raise PlayoffConfigError(f'No bracket file at {path}.')
        config = cls.model_validate(_read_yaml(path))
        if baselines and baselines.exists():
            config.apply_baselines(BaselineStore.load(baselines))
        return config

    def apply_baselines(self, store: 'BaselineStore') -> None:
        """Fill in any slot the store has a baseline for, leaving the rest alone."""
        for bracket in self.brackets:
            for r, rnd in enumerate(bracket.rounds):
                for m, matchup in enumerate(rnd.matchups):
                    for slot, side in (('a', matchup.a), ('b', matchup.b)):
                        captured = store.get(f'{bracket.key}.{r}.{m}.{slot}')
                        if captured is not None and side.starting_points is None:
                            side.starting_points = captured


class BaselineStore:
    """Season totals recorded when a round opened.

    Kept apart from `playoffs.yaml` because writing that file back through the
    YAML dumper would strip its comments and reorder its keys.
    """

    def __init__(self, points: dict[str, float] | None = None) -> None:
        self._points = dict(points or {})

    @classmethod
    def load(cls, path: Path = DEFAULT_BASELINE_PATH) -> 'BaselineStore':
        if not path.exists():
            return cls()
        return cls({key: float(str(value)) for key, value in _read_yaml(path).items()})

    def get(self, key: str) -> float | None:
        return self._points.get(key)

    def record(self, key: str, points: float) -> bool:
        """Note a baseline, unless one is already held. True when it was new."""
        if key in self._points:
            return False
        self._points[key] = points
        return True

    def save(self, path: Path = DEFAULT_BASELINE_PATH) -> None:
        header = (
            '# Season totals captured when each round opened. Generated —\n'
            '# edit playoffs.yaml instead.\n'
        )
        body = yaml.safe_dump(self._points, default_flow_style=False, sort_keys=True)
        temp = path.with_suffix(f'{path.suffix}.tmp')
        temp.write_text(header + body)
        temp.replace(path)
