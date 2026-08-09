"""Tests for the waiver schedule and the collection window it defines.

August 2026 reference: the 9th is a Sunday, so 10th=Mon, 13th=Thu, 15th=Sat,
17th=Mon, 20th=Thu, 22nd=Sat.
"""

from datetime import date, datetime

import pytest

from fbb.fantrax.waivers import WaiverSchedule

SUNDAY = datetime(2026, 8, 9, 10, 0)
MONDAY_BEFORE_PROCESSING = datetime(2026, 8, 10, 6, 0)
MONDAY_AFTER_PROCESSING = datetime(2026, 8, 10, 9, 0)


@pytest.fixture
def schedule() -> WaiverSchedule:
    return WaiverSchedule()


def test_finds_next_deadlines_across_a_week(schedule: WaiverSchedule) -> None:
    assert schedule.next_deadlines(SUNDAY, 4) == [
        date(2026, 8, 10),  # Mon
        date(2026, 8, 13),  # Thu
        date(2026, 8, 15),  # Sat
        date(2026, 8, 17),  # Mon
    ]


def test_today_counts_while_it_can_still_be_acted_on(schedule: WaiverSchedule) -> None:
    assert schedule.next_deadlines(MONDAY_BEFORE_PROCESSING, 1) == [date(2026, 8, 10)]


def test_today_drops_out_once_it_has_processed(schedule: WaiverSchedule) -> None:
    assert schedule.next_deadlines(MONDAY_AFTER_PROCESSING, 1) == [date(2026, 8, 13)]


def test_collects_through_the_day_before_the_third_deadline(
    schedule: WaiverSchedule,
) -> None:
    """From Sunday: deadlines are Mon 10, Thu 13, Sat 15 — so collect through Fri 14."""
    assert schedule.collection_end(SUNDAY, periods_ahead=2) == date(2026, 8, 14)


def test_window_shifts_when_today_has_already_processed(
    schedule: WaiverSchedule,
) -> None:
    """After Monday 8am: deadlines are Thu 13, Sat 15, Mon 17 — collect through Sun 16."""
    assert schedule.collection_end(MONDAY_AFTER_PROCESSING, periods_ahead=2) == date(
        2026, 8, 16
    )


def test_one_period_ahead_stops_before_the_second_deadline(
    schedule: WaiverSchedule,
) -> None:
    assert schedule.collection_end(SUNDAY, periods_ahead=1) == date(2026, 8, 12)


def test_rejects_a_window_of_no_periods(schedule: WaiverSchedule) -> None:
    with pytest.raises(ValueError, match='at least 1'):
        schedule.collection_end(SUNDAY, periods_ahead=0)
