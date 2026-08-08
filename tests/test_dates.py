from datetime import date

from garmin_sync.dates import (
    get_date_range,
    get_date_string,
    local_today,
    n_days_ago,
    parse_date_string,
)


def test_local_today_returns_date():
    today = local_today("Europe/Warsaw")
    assert isinstance(today, date)

def test_parse_and_format_date():
    d_str = "2026-08-06"
    parsed = parse_date_string(d_str)
    assert parsed == date(2026, 8, 6)
    assert get_date_string(parsed) == d_str

def test_n_days_ago():
    base = date(2026, 8, 6)
    three_days_ago = n_days_ago(base, 3)
    assert three_days_ago == date(2026, 8, 3)

def test_get_date_range():
    start = date(2026, 8, 1)
    end = date(2026, 8, 3)
    rng = get_date_range(start, end)
    assert rng == [date(2026, 8, 1), date(2026, 8, 2), date(2026, 8, 3)]
