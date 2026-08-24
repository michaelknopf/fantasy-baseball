"""Tests for the playoff bracket and the scores derived from it.

The trap throughout is that a round scores only what is earned inside it. The
season totals are large and the round totals are small, so a formula that lets
the season gap leak in still produces a plausible-looking number.
"""

from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from fbb.analysis.board import (
    Board,
    BoardBuilder,
    PlayoffBracket,
    UnknownPlayoffTeamError,
)
from fbb.analysis.cli import _capture_baselines
from fbb.analysis.playoffs import BaselineStore, PlayoffConfig
from fbb.fantrax.models import FantasyTeam, LeagueSnapshot, TeamStartsBudget

_TODAY = datetime(2026, 8, 15, 12, 0)


def _snapshot(now: datetime = _TODAY, **points: float) -> LeagueSnapshot:
    """A snapshot carrying nothing but team totals, which is all a bracket reads."""
    totals = points or {'Randy': 8141.25, 'MK': 7876.50}
    return LeagueSnapshot(
        league_id='test',
        collected_at=now,
        periods_ahead=2,
        collected_through=date(2026, 8, 19),
        teams=[
            FantasyTeam(team_id=name, name=name, is_mine=name == 'MK')
            for name in totals
        ],
        starts_budgets=[
            TeamStartsBudget(team_id=name, team_name=name, fantasy_points=total)
            for name, total in totals.items()
        ],
    )


def _config(body: str, tmp_path: Path) -> PlayoffConfig:
    path = tmp_path / 'playoffs.yaml'
    path.write_text(body)
    return PlayoffConfig.load(path, baselines=None)


def _brackets(body: str, tmp_path: Path, **kwargs: object) -> list[PlayoffBracket]:
    snapshot = kwargs.pop('snapshot', None) or _snapshot()
    assert isinstance(snapshot, LeagueSnapshot)
    return BoardBuilder(snapshot, playoffs=_config(body, tmp_path)).build().playoffs


_ROUND_ONE = """
brackets:
  - key: winners
    label: Winners'
    rounds:
      - label: Round 1
        start: 2026-08-10
        end: 2026-08-23
        matchups:
          - a: {seed: 3, team: Randy, advantage: 50.0, starting_points: 7891.25}
            b: {seed: 6, team: MK, advantage: 0.0, starting_points: 7596.25}
"""


class TestScoring:
    def test_scores_only_the_points_earned_inside_the_round(
        self, tmp_path: Path
    ) -> None:
        """The season total is a baseline to subtract, not part of the contest."""
        matchup = _brackets(_ROUND_ONE, tmp_path)[0].rounds[0].matchups[0]

        # Randy: 8141.25 - 7891.25 = 250.00 earned, plus his 50-point spot.
        assert matchup.a.earned == 250.00
        assert matchup.a.matchup_points == 300.00
        # MK: 7876.50 - 7596.25 = 280.25 earned, with no spot.
        assert matchup.b.earned == 280.25
        assert matchup.b.matchup_points == 280.25

    def test_margin_is_the_difference_of_the_two_matchup_totals(
        self, tmp_path: Path
    ) -> None:
        """Differencing the season totals instead would give 264.75, not 19.75."""
        matchup = _brackets(_ROUND_ONE, tmp_path)[0].rounds[0].matchups[0]

        assert matchup.margin == 19.75
        assert matchup.leader == 'Randy'

    def test_a_spot_leads_by_itself_before_anyone_scores(self, tmp_path: Path) -> None:
        """Nothing earned yet, so the seeded side is exactly its spot ahead."""
        flat = _snapshot(Randy=7891.25, MK=7596.25)
        matchup = (
            _brackets(_ROUND_ONE, tmp_path, snapshot=flat)[0].rounds[0].matchups[0]
        )

        assert matchup.a.earned == 0.0
        assert matchup.margin == 50.0
        assert matchup.leader == 'Randy'

    def test_peak_points_spans_the_round_so_bars_share_an_axis(
        self, tmp_path: Path
    ) -> None:
        rnd = _brackets(_ROUND_ONE, tmp_path)[0].rounds[0]

        assert rnd.peak_points == 300.00

    def test_a_side_without_a_baseline_has_no_score_yet(self, tmp_path: Path) -> None:
        """A round whose start was never captured cannot be scored at all."""
        body = _ROUND_ONE.replace(', starting_points: 7891.25', '')
        matchup = _brackets(body, tmp_path)[0].rounds[0].matchups[0]

        assert matchup.a.matchup_points is None
        assert matchup.margin is None


class TestRoundState:
    @pytest.mark.parametrize(
        ('today', 'expected'),
        [
            (date(2026, 8, 9), 'upcoming'),
            (date(2026, 8, 10), 'live'),
            (date(2026, 8, 23), 'live'),
            (date(2026, 8, 24), 'done'),
        ],
    )
    def test_state_turns_on_the_round_boundaries(
        self, today: date, expected: str, tmp_path: Path
    ) -> None:
        """A round is live through its final day, inclusive."""
        at = datetime(today.year, today.month, today.day, 12, 0)
        brackets = _brackets(_ROUND_ONE, tmp_path, snapshot=_snapshot(at))

        assert brackets[0].rounds[0].state == expected


_TWO_ROUNDS = (
    _ROUND_ONE
    + """
      - label: Round 2
        start: 2026-08-24
        end: 2026-09-06
        matchups:
          - a: {seed: 1, team: Randy, advantage: 50.0}
            b: {winner_of: winners.0.0}
"""
)


class TestUnresolvedSlots:
    def test_a_live_round_advances_nobody(self, tmp_path: Path) -> None:
        """Leading a round is not winning it; the slot stays open until it ends."""
        rounds = _brackets(_TWO_ROUNDS, tmp_path)[0].rounds

        assert rounds[0].state == 'live'
        assert rounds[1].matchups[0].b.team is None
        assert rounds[1].matchups[0].b.awaiting == 'Winner of Randy / MK'

    def test_a_finished_round_fills_the_slot_it_feeds(self, tmp_path: Path) -> None:
        after = _snapshot(datetime(2026, 8, 25, 12, 0))
        rounds = _brackets(_TWO_ROUNDS, tmp_path, snapshot=after)[0].rounds

        assert rounds[0].state == 'done'
        assert rounds[1].matchups[0].b.team == 'Randy'
        assert rounds[1].matchups[0].b.awaiting is None

    def test_an_unresolved_slot_has_no_margin(self, tmp_path: Path) -> None:
        rounds = _brackets(_TWO_ROUNDS, tmp_path)[0].rounds

        assert rounds[1].matchups[0].margin is None
        assert rounds[1].matchups[0].leader is None

    def test_slots_fed_by_one_round_are_told_apart(self, tmp_path: Path) -> None:
        """Both would read 'winner of round 2' with no seed to tell them apart."""
        body = (
            _TWO_ROUNDS
            + """
      - label: Championship
        start: 2026-09-07
        end: 2026-09-20
        matchups:
          - a: {winner_of: winners.1.0}
            b: {winner_of: winners.1.1}
"""
        )
        # Round 2 needs a second matchup for the final to draw from two sources.
        body = body.replace(
            '          - a: {seed: 1, team: Randy, advantage: 50.0}\n'
            '            b: {winner_of: winners.0.0}\n',
            '          - a: {seed: 1, team: Randy, advantage: 50.0}\n'
            '            b: {winner_of: winners.0.0}\n'
            '          - a: {seed: 2, team: MK, advantage: 50.0}\n'
            '            b: {winner_of: winners.0.0}\n',
        )
        final = _brackets(body, tmp_path)[0].rounds[2].matchups[0]

        assert final.a.awaiting != final.b.awaiting
        assert 'Randy' in str(final.a.awaiting)
        assert 'MK' in str(final.b.awaiting)

    def test_a_baselined_side_scores_nothing_until_its_round_opens(
        self, tmp_path: Path
    ) -> None:
        """A bye's baseline is known early, but its round has not been played."""
        body = _TWO_ROUNDS.replace(
            'a: {seed: 1, team: Randy, advantage: 50.0}',
            'a: {seed: 1, team: Randy, advantage: 50.0, starting_points: 7891.25}',
        )
        rounds = _brackets(body, tmp_path)[0].rounds

        assert rounds[1].state == 'upcoming'
        assert rounds[1].matchups[0].a.matchup_points is None
        assert rounds[1].peak_points is None


_BYE = """
brackets:
  - key: winners
    label: Winners'
    rounds:
      - label: Round 1
        start: 2026-08-10
        end: 2026-08-23
        matchups:
          - bye: true
            a: {seed: 1, team: Randy}
            b: {seed: 2, team: MK}
"""


class TestByes:
    def test_a_bye_is_not_scored(self, tmp_path: Path) -> None:
        """Both teams sit out, so there is no contest to have a margin."""
        matchup = _brackets(_BYE, tmp_path)[0].rounds[0].matchups[0]

        assert matchup.is_bye
        assert matchup.margin is None
        assert matchup.leader is None


class TestConfigErrors:
    def test_an_unknown_team_name_fails_loudly(self, tmp_path: Path) -> None:
        """Fantrax names are user-editable, so a rename must not blank the row."""
        body = _ROUND_ONE.replace('team: Randy', 'team: Randall')

        with pytest.raises(UnknownPlayoffTeamError, match='Randall'):
            _brackets(body, tmp_path)

    # Pydantic wraps a validator's own error in a ValidationError, so these
    # assert on the message rather than the class it was raised as.
    def test_a_reference_to_a_missing_matchup_fails(self, tmp_path: Path) -> None:
        body = _TWO_ROUNDS.replace('winner_of: winners.0.0', 'winner_of: winners.9.9')

        with pytest.raises(ValidationError, match='winners.9.9'):
            _config(body, tmp_path)

    def test_a_slot_needs_an_occupant(self, tmp_path: Path) -> None:
        body = _ROUND_ONE.replace('{seed: 6, team: MK, advantage: 0.0', '{seed: 6')

        with pytest.raises(ValidationError, match='needs either a team'):
            _config(body, tmp_path)

    def test_a_round_cannot_end_before_it_starts(self, tmp_path: Path) -> None:
        body = _ROUND_ONE.replace('end: 2026-08-23', 'end: 2026-08-01')

        with pytest.raises(ValidationError, match='ends before'):
            _config(body, tmp_path)

    def test_a_malformed_reference_is_rejected(self, tmp_path: Path) -> None:
        body = _TWO_ROUNDS.replace('winner_of: winners.0.0', 'winner_of: nonsense')

        with pytest.raises(ValidationError, match='not a matchup reference'):
            _config(body, tmp_path)


class TestCapture:
    """Capture reads the built board, not the config it was built from."""

    @staticmethod
    def _captured(config: PlayoffConfig, board: Board, tmp_path: Path) -> BaselineStore:
        """Capture into a sidecar under `tmp_path`, then read it back."""
        path = tmp_path / 'baselines.yaml'
        with patch('fbb.analysis.cli.DEFAULT_BASELINE_PATH', path):
            _capture_baselines(config, board)
        return BaselineStore.load(path)

    def test_captures_a_team_that_advanced_into_the_round(self, tmp_path: Path) -> None:
        """The bug: a `winner_of` slot names no team until the builder resolves it.

        Walking the config instead skips every advanced team silently, which left
        two rounds unscorable and never wrote a baseline at all.
        """
        after = _snapshot(datetime(2026, 8, 25, 12, 0))
        config = _config(_TWO_ROUNDS, tmp_path)
        board = BoardBuilder(after, playoffs=config).build()

        store = self._captured(config, board, tmp_path)

        # Randy won round 1, so his round 2 slot banks his total on arrival.
        assert store.get('winners.1.0.b') == 8141.25

    def test_does_not_capture_a_round_that_has_not_opened(self, tmp_path: Path) -> None:
        """Recording early would freeze a baseline weeks before the round runs."""
        config = _config(_TWO_ROUNDS, tmp_path)
        board = BoardBuilder(_snapshot(), playoffs=config).build()

        store = self._captured(config, board, tmp_path)

        assert store.get('winners.1.0.a') is None

    def test_does_not_capture_a_bye(self, tmp_path: Path) -> None:
        """A bye is not played, so it has no baseline to catch."""
        config = _config(_BYE, tmp_path)
        board = BoardBuilder(_snapshot(), playoffs=config).build()

        store = self._captured(config, board, tmp_path)

        assert store.get('winners.0.0.a') is None

    def test_a_second_build_cannot_move_the_goalposts(self, tmp_path: Path) -> None:
        """Round totals are only knowable live, so the first capture is final."""
        after = _snapshot(datetime(2026, 8, 25, 12, 0))
        config = _config(_TWO_ROUNDS, tmp_path)
        self._captured(config, BoardBuilder(after, playoffs=config).build(), tmp_path)

        # A later snapshot with the teams further along must not overwrite it.
        later = _snapshot(datetime(2026, 8, 26, 12, 0), Randy=9000.00, MK=8500.00)
        store = self._captured(
            config, BoardBuilder(later, playoffs=config).build(), tmp_path
        )

        assert store.get('winners.1.0.b') == 8141.25


class TestBaselineStore:
    def test_records_a_baseline_once_and_never_overwrites(self) -> None:
        """A second capture would silently move the goalposts mid-round."""
        store = BaselineStore()

        assert store.record('winners.0.0.a', 7891.25)
        assert not store.record('winners.0.0.a', 8000.00)
        assert store.get('winners.0.0.a') == 7891.25

    def test_survives_a_round_trip_through_disk(self, tmp_path: Path) -> None:
        path = tmp_path / 'baselines.yaml'
        store = BaselineStore()
        store.record('winners.0.0.a', 7891.25)
        store.save(path)

        assert BaselineStore.load(path).get('winners.0.0.a') == 7891.25

    def test_a_captured_baseline_fills_a_blank_in_the_config(
        self, tmp_path: Path
    ) -> None:
        """The sidecar exists so the hand-edited file keeps its comments."""
        config_path = tmp_path / 'playoffs.yaml'
        config_path.write_text(_ROUND_ONE.replace(', starting_points: 7891.25', ''))
        baselines = tmp_path / 'baselines.yaml'
        store = BaselineStore()
        store.record('winners.0.0.a', 7891.25)
        store.save(baselines)

        config = PlayoffConfig.load(config_path, baselines=baselines)

        assert config.brackets[0].rounds[0].matchups[0].a.starting_points == 7891.25
