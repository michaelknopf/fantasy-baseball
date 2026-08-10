"""Tests for reshaping a snapshot into the board.

The traps here are all shape mismatches between what Fantrax serves and what the
board assumes: hitter logs carry no innings, relievers have no schedule entry,
and roster rows carry only the current day's stats.
"""

from datetime import date, datetime

from fbb.analysis.board import Board, BoardBuilder, _role, _simplify_status
from fbb.fantrax.models import (
    FantasyTeam,
    GameLogEntry,
    LeagueSnapshot,
    PlayerDetail,
    RosterPlayer,
    RosterSchedule,
    ScheduledStart,
    TeamRoster,
)

_TODAY = datetime(2026, 8, 9, 12, 0)


def _hitter_log(games: int, points: float) -> list[GameLogEntry]:
    """A hitter's log: no `IP` key at all, which is what breaks a naive filter."""
    return [
        GameLogEntry(
            date=f'Aug {day}',
            fantasy_points=points,
            stats={'AB': '4', 'H': '1'},
        )
        for day in range(1, games + 1)
    ]


def _pitcher_log(started: int, scheduled: int) -> list[GameLogEntry]:
    """A pitcher's log, including the zero-inning rows for games not yet played."""
    played = [
        GameLogEntry(
            date=f'Aug {day}',
            fantasy_points=20.0,
            stats={'IP': '6.0', 'ER': '2', 'BB': '1', 'H': '5', 'K': '7'},
        )
        for day in range(1, started + 1)
    ]
    upcoming = [
        GameLogEntry(date=f'Aug {day}', fantasy_points=None, stats={'IP': '0'})
        for day in range(started + 1, started + scheduled + 1)
    ]
    return played + upcoming


def _snapshot() -> LeagueSnapshot:
    players = [
        RosterPlayer(
            player_id='hitter',
            name='Freddie Freeman',
            positions='1B',
            mlb_team='LAD',
            roster_status='active',
            stats={'FP/G': '0.5'},  # today only — the roster row lies
        ),
        RosterPlayer(
            player_id='starter',
            name='Dylan Cease',
            positions='SP',
            mlb_team='SD',
            roster_status='reserve',
        ),
        RosterPlayer(
            player_id='reliever',
            name='Bryan Baker',
            positions='RP',
            mlb_team='BAL',
            roster_status='active',
        ),
        RosterPlayer(
            player_id='hurt',
            name='Blake Snell',
            positions='SP',
            mlb_team='LAD',
            roster_status='injured_reserve',
        ),
    ]
    schedules = [
        RosterSchedule(
            player_id='starter',
            name='Dylan Cease',
            positions='SP',
            starts=[
                ScheduledStart(
                    date=date(2026, 8, 11),
                    label='Tue 8/11',
                    opponent='COL',
                    is_away=False,
                )
            ],
        )
    ]
    details = [
        PlayerDetail(
            player_id='hitter', name='Freddie Freeman', game_log=_hitter_log(8, 3.0)
        ),
        PlayerDetail(
            player_id='starter', name='Dylan Cease', game_log=_pitcher_log(4, 2)
        ),
        PlayerDetail(
            player_id='reliever', name='Bryan Baker', game_log=_pitcher_log(6, 0)
        ),
        PlayerDetail(player_id='hurt', name='Blake Snell', game_log=[]),
    ]
    return LeagueSnapshot(
        league_id='L1',
        collected_at=_TODAY,
        periods_ahead=2,
        collected_through=date(2026, 8, 12),
        teams=[FantasyTeam(team_id='T1', name='Mine', is_mine=True)],
        rosters=[
            TeamRoster(
                team_id='T1', team_name='Mine', players=players, schedules=schedules
            )
        ],
        player_details=details,
    )


def _board() -> Board:
    return BoardBuilder(_snapshot()).build()


def test_hitter_form_comes_from_the_game_log() -> None:
    """The innings filter would drop every hitter game, zeroing the whole lineup."""
    board = _board()
    freeman = next(e for e in board.roster if e.player_id == 'hitter')
    assert freeman.season is not None
    assert freeman.season.games == 8
    assert freeman.season.per_game == 3.0


def test_pitcher_form_excludes_games_not_yet_played() -> None:
    board = _board()
    cease = next(p for p in board.pitchers if p.player_id == 'starter')
    assert cease.season is not None
    assert cease.season.games == 4  # 4 started, 2 scheduled


def test_relievers_reach_the_board_without_a_schedule() -> None:
    """Schedules cover only starters, so iterating them loses every reliever."""
    board = _board()
    baker = next(p for p in board.pitchers if p.player_id == 'reliever')
    assert baker.starts == []
    assert baker.ownership == 'mine'


def test_roster_carries_every_spot_with_its_role() -> None:
    board = _board()
    roles = {e.player_id: e.role for e in board.roster}
    assert roles == {
        'hitter': 'hitter',
        'starter': 'starter',
        'reliever': 'reliever',
        'hurt': 'starter',
    }


def test_slots_count_each_roster_status() -> None:
    board = _board()
    assert board.slots is not None
    assert (board.slots.active, board.slots.reserve, board.slots.injured_reserve) == (
        2,
        1,
        1,
    )
    assert board.slots.total == 4


def test_injured_reserve_status_is_spelled_with_a_space() -> None:
    """The web app compares against this exact string to exclude unusable starts."""
    assert _simplify_status('injured_reserve') == 'injured reserve'
    assert _simplify_status('active') == 'owned'
    assert _simplify_status(None) is None


def test_role_prefers_starter_for_a_two_way_eligibility() -> None:
    assert _role('SP,RP') == 'starter'
    assert _role('RP') == 'reliever'
    assert _role('2B,SS') == 'hitter'
    assert _role(None) == 'hitter'
