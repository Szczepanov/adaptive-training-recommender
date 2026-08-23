from __future__ import annotations

import logging

import pytest

from garmin_sync.error_reporting import (
    build_error_report,
    classify_exception,
    log_exception,
    sanitize_context,
    sanitize_text,
)


class GarminConnectTooManyRequestsError(RuntimeError):
    pass


class GarminConnectConnectionError(RuntimeError):
    pass


class GarminConnectAuthenticationError(RuntimeError):
    pass


def _raise_nested(secret: str) -> None:
    raise GarminConnectConnectionError(f"provider failed password={secret}")


def test_sanitize_text_redacts_credentials_identity_paths_and_email() -> None:
    secret = "super-secret-password"
    token = "A" * 64
    raw = (
        f"contact=athlete@example.com email=athlete@example.com password={secret} "
        f"Authorization: Bearer {token} path=garmin/users/firebase-user-123/tokens token={token}"
    )

    sanitized = sanitize_text(raw)

    assert "athlete@example.com" not in sanitized
    assert secret not in sanitized
    assert token not in sanitized
    assert "firebase-user-123" not in sanitized
    assert "<email-redacted>" in sanitized
    assert "<uid-redacted>" in sanitized


def test_sanitize_context_redacts_sensitive_keys_recursively() -> None:
    context = sanitize_context(
        {
            "stage": "restore",
            "user_id": "firebase-user-123",
            "nested": {"authorization": "Bearer hidden", "attempt": 2},
        }
    )

    assert context == {
        "stage": "restore",
        "user_id": "<redacted>",
        "nested": {"authorization": "<redacted>", "attempt": 2},
    }


def test_exception_classification_is_stable_and_marks_retryable_failures() -> None:
    assert classify_exception(GarminConnectTooManyRequestsError()) == ("rate_limited", True)
    assert classify_exception(GarminConnectConnectionError()) == ("upstream_unavailable", True)
    assert classify_exception(GarminConnectAuthenticationError()) == ("authentication", False)
    assert classify_exception(ValueError()) == ("validation", False)
    assert classify_exception(RuntimeError()) == ("unexpected", False)


def test_error_report_has_stable_code_and_safe_stack() -> None:
    try:
        _raise_nested("do-not-log-me")
    except GarminConnectConnectionError as error:
        report = build_error_report("daily sync", error, context={"date": "2026-08-23"})

    assert report.code == "daily_sync.upstream_unavailable"
    assert report.retryable is True
    assert report.exception_type == "GarminConnectConnectionError"
    assert "do-not-log-me" not in report.message
    assert report.context == {"date": "2026-08-23"}
    assert any("test_error_reporting.py" in frame for frame in report.stack)
    assert all("do-not-log-me" not in frame for frame in report.stack)


def test_log_exception_emits_structured_sanitized_diagnostics(
    caplog: pytest.LogCaptureFixture,
) -> None:
    logger = logging.getLogger("test.error-reporting")
    secret = "A" * 64

    with caplog.at_level(logging.ERROR, logger=logger.name):
        try:
            _raise_nested(secret)
        except GarminConnectConnectionError as error:
            report = log_exception(
                logger,
                "linked user sync",
                error,
                context={"user_id": "user-123", "user_index": 2},
            )

    text = caplog.text
    assert report.code == "linked_user_sync.upstream_unavailable"
    assert "operation_failure" in text
    assert report.code in text
    assert secret not in text
    assert "user-123" not in text
    assert '"user_index":2' in text
