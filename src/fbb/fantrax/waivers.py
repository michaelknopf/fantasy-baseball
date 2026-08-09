"""The league's waiver schedule, and the collection window it implies."""

from datetime import date, datetime, time, timedelta

# Waivers process Mon/Thu/Sat at 8am league time. Roster moves are only possible at
# these boundaries, so they define the periods a streaming decision spans.
WAIVER_WEEKDAYS = (0, 3, 5)  # Monday, Thursday, Saturday
WAIVER_HOUR = time(8, 0)

# How many waiver deadlines ahead to look. Collecting through the day before the
# third deadline covers the two full periods a decision can still influence.
DEFAULT_PERIODS_AHEAD = 2


class WaiverSchedule:
    """Locates upcoming waiver deadlines relative to a moment in time."""

    def __init__(
        self,
        weekdays: tuple[int, ...] = WAIVER_WEEKDAYS,
        process_at: time = WAIVER_HOUR,
    ) -> None:
        self._weekdays = weekdays
        self._process_at = process_at

    def next_deadlines(self, now: datetime, count: int) -> list[date]:
        """The next `count` waiver dates at or after `now`."""
        deadlines: list[date] = []
        day = now.date()
        while len(deadlines) < count:
            if day.weekday() in self._weekdays and not self._already_processed(
                day, now
            ):
                deadlines.append(day)
            day += timedelta(days=1)
        return deadlines

    def _already_processed(self, day: date, now: datetime) -> bool:
        """True once today's deadline has passed; it can no longer be acted on."""
        return day == now.date() and now.time() >= self._process_at

    def collection_end(self, now: datetime, periods_ahead: int) -> date:
        """
        The last date worth collecting.

        Looking `periods_ahead` periods forward means collecting up to, but not
        including, the deadline that closes them — so the day before deadline
        number `periods_ahead + 1`.
        """
        if periods_ahead < 1:
            raise ValueError('periods_ahead must be at least 1')
        deadlines = self.next_deadlines(now, periods_ahead + 1)
        return deadlines[-1] - timedelta(days=1)
