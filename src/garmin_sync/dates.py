from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


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
