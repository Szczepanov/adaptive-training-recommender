"""Per-strategy Garmin login telemetry (#718), driven by synthetic library log records."""

from __future__ import annotations

import logging
import threading

import pytest
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from garmin_sync.login_strategy_telemetry import (
    SSO_LOGGER_NAME,
    classify_login_failure,
    record_login_strategies,
)

SSO = logging.getLogger(SSO_LOGGER_NAME)
SECRET = "user@example.com password=hunter2 ticket=ST-123 token=eyJabc"


def _try(name: str) -> None:
    SSO.debug("Trying login strategy: %s", name)


def test_records_sequence_and_outcome_categories() -> None:
    with record_login_strategies() as recorder:
        _try("mobile+cffi")
        SSO.warning("%s returned 429: %s", "mobile+cffi", SECRET)
        _try("mobile+requests")
        SSO.warning("%s failed: %s", "mobile+requests", SECRET)
        _try("widget+cffi")
        SSO.warning("%s obtained a token the API rejected; trying next strategy", "widget+cffi")
        _try("portal+cffi")
    summary = recorder.summary("succeeded")
    assert summary.outcome == "succeeded"
    assert [(a.name, a.outcome) for a in summary.attempts] == [
        ("mobile+cffi", "rate_limited"),
        ("mobile+requests", "failed"),
        ("widget+cffi", "token_rejected"),
        ("portal+cffi", "succeeded"),
    ]
    assert summary.rate_limited_count == 1


def test_log_line_never_contains_message_arguments() -> None:
    with record_login_strategies() as recorder:
        _try("mobile+cffi")
        SSO.warning("%s returned 429: %s", "mobile+cffi", SECRET)
        _try("evil@example.com")  # an unexpected name is never echoed
    line = recorder.summary("mfa_required").log_line()
    assert line == (
        "garmin_login_strategies outcome=mfa_required attempts=2 rate_limited=1 "
        "sequence=mobile+cffi:rate_limited>other:mfa_required"
    )
    for fragment in ("example.com", "hunter2", "ST-123", "eyJ"):
        assert fragment not in line


def test_no_strategy_attempts_when_cached_token_is_reused() -> None:
    with record_login_strategies() as recorder:
        pass
    summary = recorder.summary("succeeded")
    assert summary.attempts == ()
    assert summary.log_line().endswith("attempts=0 rate_limited=0 sequence=none")


def test_failed_chain_marks_final_pending_attempt_with_overall_outcome() -> None:
    with record_login_strategies() as recorder:
        _try("mobile+cffi")
    assert recorder.summary("auth_error").attempts[-1].outcome == "auth_error"


def test_debug_records_are_captured_but_not_propagated(caplog: pytest.LogCaptureFixture) -> None:
    previous_level = SSO.level
    with caplog.at_level(logging.WARNING, logger=SSO_LOGGER_NAME):
        level_inside = SSO.level
        with record_login_strategies() as recorder:
            _try("mobile+cffi")
            SSO.warning("%s returned 429: %s", "mobile+cffi", "x")
        assert SSO.level == level_inside
    assert SSO.level == previous_level
    assert [r.getMessage() for r in caplog.records] == ["mobile+cffi returned 429: x"]
    assert recorder.summary("rate_limited").attempts[0].outcome == "rate_limited"


def test_records_from_other_threads_are_ignored() -> None:
    with record_login_strategies() as recorder:
        worker = threading.Thread(target=_try, args=("portal+requests",))
        worker.start()
        worker.join()
        _try("mobile+cffi")
    assert [a.name for a in recorder.summary("succeeded").attempts] == ["mobile+cffi"]


def test_filter_is_removed_after_exit_even_on_error() -> None:
    filters_before = list(SSO.filters)
    with pytest.raises(RuntimeError), record_login_strategies():
        raise RuntimeError("boom")
    assert SSO.filters == filters_before


def test_parsed_format_strings_match_the_installed_library() -> None:
    """A garminconnect upgrade that rewords these messages must fail here, not go silent."""
    import inspect

    import garminconnect.client.sso as sso_module

    from garmin_sync import login_strategy_telemetry as telemetry

    source = inspect.getsource(sso_module)
    for fmt in (telemetry._TRYING, *telemetry._OUTCOME_BY_FORMAT):
        assert f'"{fmt}"' in source, fmt
    assert sso_module._LOGGER.name == SSO_LOGGER_NAME
    for name in telemetry.KNOWN_STRATEGIES:
        assert f'"{name}"' in source, name


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (GarminConnectTooManyRequestsError("429"), "rate_limited"),
        (GarminConnectAuthenticationError("bad"), "auth_error"),
        (GarminConnectConnectionError("down"), "connection_error"),
        (ValueError("other"), "error"),
    ],
)
def test_classify_login_failure(error: Exception, expected: str) -> None:
    assert classify_login_failure(error) == expected


def test_overlapping_recorders_on_two_threads_restore_the_logger() -> None:
    level_before, filters_before = SSO.level, list(SSO.filters)
    inner_entered, outer_may_exit = threading.Event(), threading.Event()
    seen: dict[str, list[str]] = {}

    def other_login() -> None:
        with record_login_strategies() as recorder:
            _try("portal+cffi")
            inner_entered.set()
            outer_may_exit.wait(timeout=5)
        seen["other"] = [a.name for a in recorder.summary("succeeded").attempts]

    with record_login_strategies() as recorder:
        worker = threading.Thread(target=other_login)
        worker.start()
        assert inner_entered.wait(timeout=5)
        _try("mobile+cffi")
    outer_may_exit.set()
    worker.join(timeout=5)

    assert [a.name for a in recorder.summary("succeeded").attempts] == ["mobile+cffi"]
    assert seen["other"] == ["portal+cffi"]
    assert SSO.level == level_before
    assert SSO.filters == filters_before


def test_unexpected_record_arguments_never_raise_into_the_library() -> None:
    with record_login_strategies() as recorder:
        SSO.debug("Trying login strategy: %s", ["unhashable"])  # must not raise
        _try("mobile+cffi")
    assert [a.name for a in recorder.summary("succeeded").attempts] == ["mobile+cffi"]


def test_attempt_that_ends_without_a_record_is_unresolved_not_the_final_outcome() -> None:
    # The library falls through silently when MFA resolution raises a connection error.
    with record_login_strategies() as recorder:
        _try("widget+cffi")
        _try("portal+cffi")
    assert [(a.name, a.outcome) for a in recorder.summary("succeeded").attempts] == [
        ("widget+cffi", "unresolved"),
        ("portal+cffi", "succeeded"),
    ]
