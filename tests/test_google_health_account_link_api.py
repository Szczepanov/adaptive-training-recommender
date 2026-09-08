from http import HTTPStatus
from typing import Any

import pytest

import garmin_sync.google_health_account_link_api as api_module
from garmin_sync.google_health_account_link import (
    GoogleHealthLinkError,
    GoogleHealthLinkStateInvalidError,
    GoogleHealthLinkTokens,
    GoogleHealthTokenExchangeError,
)
from garmin_sync.google_health_account_link_api import GoogleHealthAccountLinkHandler, _verified_uid


def _handler() -> GoogleHealthAccountLinkHandler:
    handler = object.__new__(GoogleHealthAccountLinkHandler)
    handler.request_id = "req-test"
    return handler


def _capture_json(handler: GoogleHealthAccountLinkHandler) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def capture(status: HTTPStatus, payload: dict[str, Any]) -> None:
        captured["status"] = status
        captured["payload"] = payload

    handler._json_response = capture  # type: ignore[method-assign]
    return captured


def _capture_redirect(handler: GoogleHealthAccountLinkHandler) -> list[str]:
    locations: list[str] = []
    handler._redirect = lambda location: locations.append(location)  # type: ignore[method-assign]
    return locations


# --- _verified_uid ---


def test_verified_uid_requires_authorization_header() -> None:
    with pytest.raises(GoogleHealthLinkError):
        _verified_uid(None)


def test_verified_uid_requires_bearer_scheme() -> None:
    with pytest.raises(GoogleHealthLinkError):
        _verified_uid("Basic abc123")


def test_verified_uid_returns_uid_on_valid_token(monkeypatch: Any) -> None:
    def verify(token: str, *, check_revoked: bool) -> dict[str, Any]:
        assert check_revoked is True
        return {"uid": "uid-1"}

    monkeypatch.setattr(api_module.firebase_auth, "verify_id_token", verify)
    assert _verified_uid("Bearer some-token") == "uid-1"


def test_verified_uid_wraps_verification_failure(monkeypatch: Any) -> None:
    def _raise(token: str, *, check_revoked: bool) -> Any:
        assert check_revoked is True
        raise ValueError("bad token")

    monkeypatch.setattr(api_module.firebase_auth, "verify_id_token", _raise)
    with pytest.raises(GoogleHealthLinkError):
        _verified_uid("Bearer bad-token")


def test_verified_uid_rejects_unverified_password_user(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        api_module.firebase_auth,
        "verify_id_token",
        lambda token, *, check_revoked: {
            "uid": "uid-1",
            "email_verified": False,
            "firebase": {"sign_in_provider": "password"},
        },
    )
    with pytest.raises(GoogleHealthLinkError, match="Verify your email"):
        _verified_uid("Bearer valid-token")


# --- _app_redirect ---


def test_app_redirect_success_uses_app_base_url(monkeypatch: Any) -> None:
    monkeypatch.setenv("APP_BASE_URL", "https://example.web.app")
    handler = _handler()
    locations = _capture_redirect(handler)

    handler._app_redirect(success=True)

    assert locations == ["https://example.web.app/settings?googleHealthLinked=success"]


def test_app_redirect_error_includes_reason(monkeypatch: Any) -> None:
    monkeypatch.setenv("APP_BASE_URL", "https://example.web.app")
    handler = _handler()
    locations = _capture_redirect(handler)

    handler._app_redirect(success=False, reason="invalid_state")

    assert "googleHealthLinked=error" in locations[0]
    assert "reason=invalid_state" in locations[0]


def test_app_redirect_falls_back_to_relative_path_without_app_base_url(monkeypatch: Any) -> None:
    monkeypatch.delenv("APP_BASE_URL", raising=False)
    handler = _handler()
    locations = _capture_redirect(handler)

    handler._app_redirect(success=True)

    assert locations == ["/settings?googleHealthLinked=success"]


# --- _handle_start_link ---


def test_handle_start_link_requires_auth(monkeypatch: Any) -> None:
    handler = _handler()
    handler.headers = {}  # type: ignore[assignment]
    with pytest.raises(GoogleHealthLinkError):
        handler._handle_start_link()


def test_handle_start_link_returns_authorize_url(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        api_module.firebase_auth,
        "verify_id_token",
        lambda token, *, check_revoked: {"uid": "uid-1"},
    )
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_HEALTH_REDIRECT_URI", "https://x/callback")

    created_for: list[str] = []

    class FakeStateStore:
        def create(self, uid: str) -> str:
            created_for.append(uid)
            return "state-abc"

    monkeypatch.setattr(api_module, "GoogleHealthLinkStateStore", FakeStateStore)
    monkeypatch.setattr(
        api_module,
        "build_authorize_url",
        lambda **kwargs: f"https://accounts.google.com/auth?state={kwargs['state']}",
    )

    handler = _handler()
    handler.headers = {"Authorization": "Bearer token"}  # type: ignore[assignment]
    captured = _capture_json(handler)

    handler._handle_start_link()

    assert created_for == ["uid-1"]
    assert captured["status"] == HTTPStatus.OK
    assert captured["payload"]["authorizeUrl"] == "https://accounts.google.com/auth?state=state-abc"


# --- _handle_callback ---


def _base_callback_env(monkeypatch: Any) -> None:
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_SECRET", "secret")
    monkeypatch.setenv("GOOGLE_HEALTH_REDIRECT_URI", "https://x/callback")
    monkeypatch.setenv("GOOGLE_HEALTH_TOKEN_BUCKET", "bucket")


def test_handle_callback_google_declined_redirects_with_reason(monkeypatch: Any) -> None:
    handler = _handler()
    handler.path = "/api/google-health/callback?error=access_denied"
    locations = _capture_redirect(handler)

    handler._handle_callback()

    assert "reason=google_declined" in locations[0]


def test_handle_callback_missing_code_or_state_redirects_with_reason() -> None:
    handler = _handler()
    handler.path = "/api/google-health/callback?state=abc"
    locations = _capture_redirect(handler)

    handler._handle_callback()

    assert "reason=missing_code_or_state" in locations[0]


def test_handle_callback_invalid_state_redirects_with_reason(monkeypatch: Any) -> None:
    class FakeStateStore:
        def consume(self, state: str) -> str:
            raise GoogleHealthLinkStateInvalidError("expired")

    monkeypatch.setattr(api_module, "GoogleHealthLinkStateStore", FakeStateStore)

    handler = _handler()
    handler.path = "/api/google-health/callback?code=abc&state=xyz"
    locations = _capture_redirect(handler)

    handler._handle_callback()

    assert "reason=invalid_state" in locations[0]


def test_handle_callback_token_exchange_failure_redirects_with_reason(monkeypatch: Any) -> None:
    _base_callback_env(monkeypatch)

    class FakeStateStore:
        def consume(self, state: str) -> str:
            return "uid-1"

    def _raise_exchange(**kwargs: Any) -> GoogleHealthLinkTokens:
        raise GoogleHealthTokenExchangeError("nope")

    monkeypatch.setattr(api_module, "GoogleHealthLinkStateStore", FakeStateStore)
    monkeypatch.setattr(api_module, "exchange_code_for_tokens", _raise_exchange)

    handler = _handler()
    handler.path = "/api/google-health/callback?code=abc&state=xyz"
    locations = _capture_redirect(handler)

    handler._handle_callback()

    assert "reason=token_exchange_failed" in locations[0]


def test_handle_callback_happy_path_saves_connection_and_redirects_success(
    monkeypatch: Any,
) -> None:
    _base_callback_env(monkeypatch)

    class FakeStateStore:
        def consume(self, state: str) -> str:
            assert state == "xyz"
            return "uid-1"

    tokens = GoogleHealthLinkTokens(
        access_token="at",
        refresh_token="rt",
        token_type="Bearer",
        scopes=["a"],
        obtained_at="2026-08-27T00:00:00+00:00",
    )
    saved: dict[str, Any] = {}

    class FakeConnectionRepo:
        def save_connection(
            self,
            uid: str,
            *,
            health_user_id: str | None,
            granted_scopes: list[str],
            token_object: str,
        ) -> None:
            saved["uid"] = uid
            saved["health_user_id"] = health_user_id
            saved["granted_scopes"] = granted_scopes
            saved["token_object"] = token_object

    class FakeGoogleHealthClient:
        def __init__(self, auth_manager: Any) -> None:
            pass

        def get_identity(self) -> dict[str, Any]:
            return {"healthUserId": "health-uid-1"}

    monkeypatch.setattr(api_module, "GoogleHealthLinkStateStore", FakeStateStore)
    monkeypatch.setattr(api_module, "exchange_code_for_tokens", lambda **kwargs: tokens)
    monkeypatch.setattr(
        api_module, "persist_tokens", lambda **kwargs: "google-health/users/uid-1/tok.json"
    )
    monkeypatch.setattr(api_module, "GoogleHealthConnectionRepository", FakeConnectionRepo)
    monkeypatch.setattr(api_module, "GoogleHealthClient", FakeGoogleHealthClient)
    monkeypatch.setattr(api_module, "GoogleHealthAuthManager", lambda **kwargs: object())

    handler = _handler()
    handler.path = "/api/google-health/callback?code=abc&state=xyz"
    locations = _capture_redirect(handler)

    handler._handle_callback()

    assert saved == {
        "uid": "uid-1",
        "health_user_id": "health-uid-1",
        "granted_scopes": ["a"],
        "token_object": "google-health/users/uid-1/tok.json",
    }
    assert locations == ["/settings?googleHealthLinked=success"]


def test_handle_callback_identity_lookup_failure_still_saves_connection(monkeypatch: Any) -> None:
    """The link itself must not fail just because the (best-effort) identity probe did --
    tokens are already persisted by that point."""
    _base_callback_env(monkeypatch)

    class FakeStateStore:
        def consume(self, state: str) -> str:
            return "uid-1"

    tokens = GoogleHealthLinkTokens(
        access_token="at",
        refresh_token="rt",
        token_type="Bearer",
        scopes=["a"],
        obtained_at="2026-08-27T00:00:00+00:00",
    )
    saved: dict[str, Any] = {}

    class FakeConnectionRepo:
        def save_connection(self, uid: str, **kwargs: Any) -> None:
            saved["uid"] = uid
            saved.update(kwargs)

    class FailingGoogleHealthClient:
        def __init__(self, auth_manager: Any) -> None:
            pass

        def get_identity(self) -> dict[str, Any]:
            raise RuntimeError("network blip")

    monkeypatch.setattr(api_module, "GoogleHealthLinkStateStore", FakeStateStore)
    monkeypatch.setattr(api_module, "exchange_code_for_tokens", lambda **kwargs: tokens)
    monkeypatch.setattr(api_module, "persist_tokens", lambda **kwargs: "obj.json")
    monkeypatch.setattr(api_module, "GoogleHealthConnectionRepository", FakeConnectionRepo)
    monkeypatch.setattr(api_module, "GoogleHealthClient", FailingGoogleHealthClient)
    monkeypatch.setattr(api_module, "GoogleHealthAuthManager", lambda **kwargs: object())

    handler = _handler()
    handler.path = "/api/google-health/callback?code=abc&state=xyz"
    locations = _capture_redirect(handler)

    handler._handle_callback()

    assert saved["uid"] == "uid-1"
    assert saved["health_user_id"] is None
    assert locations == ["/settings?googleHealthLinked=success"]
