"""Tests for the playoff bracket and the scores derived from it.

The trap throughout is that a round scores only what is earned inside it. The
season totals are large and the round totals are small, so a formula that lets
the season gap leak in still produces a plausible-looking number.
"""

from datetime import date, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from fbb.analysis.board import BoardBuilder, PlayoffBracket, UnknownPlayoffTeamError
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
