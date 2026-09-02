from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def parse_garmin_gmt_timestamp(value: str | None) -> datetime | None:
    """Parse Garmin Connect's `startTimeGMT`-style timestamp ("YYYY-MM-DD HH:MM:SS", a
    naive string that is already UTC despite the name) into a timezone-aware UTC
    `datetime`. Returns None for missing/empty/unparseable input so a malformed or absent
    upstream field degrades to "no absolute timestamp available" rather than raising and
    losing the whole activity.
    """
    if not value or not isinstance(value, str):
        # `value` is typed `str | None`, but the caller passes a raw dict.get() result
        # from an untrusted upstream payload -- a truthy non-string (e.g. a malformed
        # API response returning a number/dict) would otherwise reach strptime() and
        # raise TypeError, which the except clause below does not catch.
        return None
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def local_today(timezone_name: str = "Europe/Warsaw") -> date:
    """Return current calendar date in target timezone (default Europe/Warsaw)."""
    tz = ZoneInfo(timezone_name)
    return datetime.now(tz).date()


def get_date_string(d: date) -> str:
    """Format date as YYYY-MM-DD."""
    return d.isoformat()


def parse_date_string(date_str: str) -> date:
    """Parse YYYY-MM-DD string to date object."""
    return date.fromisoformat(date_str)


def n_days_ago(base_date: date, days: int) -> date:
    """Return date N days before base_date."""
    return base_date - timedelta(days=days)


def get_date_range(start_date: date, end_date: date) -> list[date]:
    """Return chronological list of dates from start_date to end_date inclusive."""
    if start_date > end_date:
        return []
    result = []
    curr = start_date
    while curr <= end_date:
        result.append(curr)
        curr += timedelta(days=1)
    return result
