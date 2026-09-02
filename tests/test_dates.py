from datetime import date, timezone

from garmin_sync.dates import (
    get_date_range,
    get_date_string,
    local_today,
    n_days_ago,
    parse_date_string,
    parse_garmin_gmt_timestamp,
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


def test_parse_garmin_gmt_timestamp_parses_space_separated_naive_utc() -> None:
    """Garmin Connect's startTimeGMT is "YYYY-MM-DD HH:MM:SS" -- naive but already UTC
    despite the name -- so it must come back timezone-aware at UTC, not naive."""
    parsed = parse_garmin_gmt_timestamp("2026-08-05 06:52:30")
    assert parsed is not None
    assert parsed.tzinfo == timezone.utc
    assert parsed.isoformat() == "2026-08-05T06:52:30+00:00"


def test_parse_garmin_gmt_timestamp_returns_none_for_missing_or_malformed_input() -> None:
    assert parse_garmin_gmt_timestamp(None) is None
    assert parse_garmin_gmt_timestamp("") is None
    assert parse_garmin_gmt_timestamp("not-a-timestamp") is None


def test_parse_garmin_gmt_timestamp_returns_none_for_a_non_string_value() -> None:
    """`value` is typed `str | None`, but the real caller passes an untrusted
    dict.get() result -- a truthy non-string must degrade to None, not raise
    TypeError out of datetime.strptime()."""
    assert parse_garmin_gmt_timestamp(12345) is None  # type: ignore[arg-type]
    assert parse_garmin_gmt_timestamp({"unexpected": "shape"}) is None  # type: ignore[arg-type]
