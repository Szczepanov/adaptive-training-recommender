from __future__ import annotations

from argparse import Namespace
from typing import Any

import garmin_sync.google_health_account_link as link_module
from garmin_sync.cli import _resolve_google_health_auth_manager
from garmin_sync.google_health_account_link import GoogleHealthLinkError


def _args(**overrides: Any) -> Namespace:
    base = {"token": None, "client_id": None, "client_secret": None, "refresh_token": None}
    base.update(overrides)
    return Namespace(**base)


def _clear_google_health_env(monkeypatch: Any) -> None:
    for var in (
        "GOOGLE_HEALTH_ACCESS_TOKEN",
        "GOOGLE_HEALTH_CLIENT_ID",
        "GOOGLE_HEALTH_CLIENT_SECRET",
        "GOOGLE_HEALTH_REFRESH_TOKEN",
        "GOOGLE_HEALTH_TOKEN_BUCKET",
    ):
        monkeypatch.delenv(var, raising=False)
    # cli.py imports load_dotenv locally (`from dotenv import load_dotenv`) inside
    # _resolve_google_health_auth_manager, so patching a "garmin_sync.cli.load_dotenv"
    # attribute wouldn't be seen by that fresh import -- patch dotenv's own attribute instead,
    # which is what the local import actually resolves at call time. Otherwise this would
    # silently load the repo's real .env (which has real credentials in it this session) and
    # defeat the point of clearing the environment above.
    monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: None)


def test_no_credentials_returns_error(monkeypatch: Any) -> None:
    _clear_google_health_env(monkeypatch)
    manager, err = _resolve_google_health_auth_manager(_args())
    assert manager is None
    assert err is not None


def test_refresh_token_flags_build_manager(monkeypatch: Any) -> None:
    _clear_google_health_env(monkeypatch)
    manager, err = _resolve_google_health_auth_manager(
        _args(client_id="cid", client_secret="secret", refresh_token="rt")
    )
    assert err is None
    assert manager is not None
    assert manager.credentials.refresh_token == "rt"


def test_direct_token_flag_builds_manager(monkeypatch: Any) -> None:
    _clear_google_health_env(monkeypatch)
    manager, err = _resolve_google_health_auth_manager(_args(token="at"))
    assert err is None
    assert manager is not None
    assert manager.credentials.access_token == "at"


def test_user_id_without_explicit_token_uses_stored_credentials(monkeypatch: Any) -> None:
    _clear_google_health_env(monkeypatch)
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_SECRET", "secret")
    monkeypatch.setenv("GOOGLE_HEALTH_TOKEN_BUCKET", "bucket")

    calls: list[dict[str, Any]] = []
    sentinel = object()

    class FakeRepo:
        def load_auth_manager_for_user(self, user_id: str, **kwargs: Any) -> Any:
            calls.append({"user_id": user_id, **kwargs})
            return sentinel

    monkeypatch.setattr(link_module, "GoogleHealthConnectionRepository", FakeRepo)

    manager, err = _resolve_google_health_auth_manager(_args(user_id="uid-1"))

    assert err is None
    assert manager is sentinel
    assert calls == [
        {"user_id": "uid-1", "client_id": "cid", "client_secret": "secret", "bucket_name": "bucket"}
    ]


def test_user_id_lookup_failure_returns_error_message(monkeypatch: Any) -> None:
    _clear_google_health_env(monkeypatch)
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_SECRET", "secret")
    monkeypatch.setenv("GOOGLE_HEALTH_TOKEN_BUCKET", "bucket")

    class FakeRepo:
        def load_auth_manager_for_user(self, user_id: str, **kwargs: Any) -> Any:
            raise GoogleHealthLinkError("no active connection")

    monkeypatch.setattr(link_module, "GoogleHealthConnectionRepository", FakeRepo)

    manager, err = _resolve_google_health_auth_manager(_args(user_id="uid-1"))

    assert manager is None
    assert err == "no active connection"


def test_explicit_token_flag_wins_over_user_id_lookup(monkeypatch: Any) -> None:
    """A manually-supplied --token is an explicit override -- it must not be shadowed by
    per-user stored-credential lookup just because --user-id also happens to be set (e.g. a
    debugging session re-using the same command line as a scheduled per-user sync)."""
    _clear_google_health_env(monkeypatch)
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_HEALTH_TOKEN_BUCKET", "bucket")

    class FakeRepo:
        def load_auth_manager_for_user(self, user_id: str, **kwargs: Any) -> Any:
            raise AssertionError("should not be called when --token is explicit")

    monkeypatch.setattr(link_module, "GoogleHealthConnectionRepository", FakeRepo)

    manager, err = _resolve_google_health_auth_manager(_args(user_id="uid-1", token="at"))

    assert err is None
    assert manager is not None
    assert manager.credentials.access_token == "at"
