from __future__ import annotations

from http import HTTPStatus
from typing import Any

import pytest

import garmin_sync.account_link_api as account_link_api
from garmin_sync.account_link_api import (
    GarminAccountLinkHandler,
    GarminConnectAuthenticationError,
    LoginRateLimiter,
)


def _handler_with_forwarded_for(value: str) -> GarminAccountLinkHandler:
    handler = object.__new__(GarminAccountLinkHandler)
    handler.headers = {"X-Forwarded-For": value}  # type: ignore[assignment]
    handler.client_address = ("127.0.0.1", 12345)
    return handler


def test_client_key_uses_google_observed_client_hop() -> None:
    handler = _handler_with_forwarded_for("198.51.100.99, 203.0.113.10, 35.191.0.1")

    assert handler._client_key() == "203.0.113.10"  # noqa: SLF001


def test_client_key_ignores_rotating_leftmost_spoofed_values() -> None:
    first = _handler_with_forwarded_for("198.51.100.1, 203.0.113.10, 35.191.0.1")
    second = _handler_with_forwarded_for("198.51.100.2, 203.0.113.10, 35.191.0.1")

    assert first._client_key() == second._client_key() == "203.0.113.10"  # noqa: SLF001


def test_rate_limiter_prunes_expired_client_buckets(monkeypatch: Any) -> None:
    now = [100.0]
    monkeypatch.setattr(account_link_api.time, "monotonic", lambda: now[0])
    limiter = LoginRateLimiter()

    assert limiter.allow("old-client") is True
    assert "old-client" in limiter._attempts  # noqa: SLF001

    now[0] += account_link_api.RATE_LIMIT_WINDOW_SECONDS + 1
    assert limiter.allow("new-client") is True

    assert "old-client" not in limiter._attempts  # noqa: SLF001
    assert "new-client" in limiter._attempts  # noqa: SLF001


def test_error_response_adds_stable_metadata_and_sanitizes_message() -> None:
    handler = object.__new__(GarminAccountLinkHandler)
    handler.request_id = "req-123"
    captured: dict[str, Any] = {}

    def capture(status: HTTPStatus, payload: dict[str, Any]) -> None:
        captured["status"] = status
        captured["payload"] = payload

    handler._json_response = capture  # type: ignore[method-assign]  # noqa: SLF001
    handler._error_response(  # noqa: SLF001
        HTTPStatus.BAD_GATEWAY,
        message="Provider failed for athlete@example.com password=do-not-leak",
        error_code="garmin_link.upstream_unavailable",
        retryable=True,
    )

    assert captured["status"] == HTTPStatus.BAD_GATEWAY
    payload = captured["payload"]
    assert payload["errorCode"] == "garmin_link.upstream_unavailable"
    assert payload["retryable"] is True
    assert payload["requestId"] == "req-123"
    assert "athlete@example.com" not in payload["error"]
    assert "do-not-leak" not in payload["error"]


def test_handle_login_enforces_per_account_rate_limiting(monkeypatch: Any) -> None:
    handler = object.__new__(GarminAccountLinkHandler)
    handler.headers = {"X-Forwarded-For": "203.0.113.10"}
    handler.client_address = ("127.0.0.1", 12345)
    handler.request_id = "req-test"

    limiter = LoginRateLimiter()
    monkeypatch.setattr(account_link_api, "RATE_LIMITER", limiter)

    # Exhaust rate limit for athlete@example.com
    for _ in range(5):
        assert limiter.allow("account:athlete@example.com") is True

    handler._read_json = lambda: {"email": "athlete@example.com", "password": "secret"}  # type: ignore[method-assign]  # noqa: SLF001

    captured_errors: list[dict[str, Any]] = []

    def capture_error(status: HTTPStatus, **kwargs: Any) -> None:
        captured_errors.append({"status": status, **kwargs})

    handler._error_response = capture_error  # type: ignore[method-assign]  # noqa: SLF001

    handler._handle_login()  # noqa: SLF001

    assert len(captured_errors) == 1
    assert captured_errors[0]["status"] == HTTPStatus.TOO_MANY_REQUESTS
    assert captured_errors[0]["error_code"] == "garmin_link.rate_limited"


def test_verified_uid_raises_authentication_error_on_verify_id_token_exception(
    monkeypatch: Any,
) -> None:
    def mock_verify_id_token(token: str) -> dict[str, Any]:
        raise Exception("Firebase verification failed")

    monkeypatch.setattr(account_link_api.firebase_auth, "verify_id_token", mock_verify_id_token)

    with pytest.raises(
        GarminConnectAuthenticationError, match="App session is invalid or expired."
    ):
        account_link_api._verified_uid("Bearer any-token")  # noqa: SLF001
