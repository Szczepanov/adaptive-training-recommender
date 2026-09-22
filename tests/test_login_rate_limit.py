"""Synthetic Firestore contract tests; these never contact Garmin or GCP."""

from __future__ import annotations

import copy
import threading
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from types import SimpleNamespace
from typing import Any

import pytest

import garmin_sync.account_link_api as api_module
import garmin_sync.login_rate_limit as limiter_module
from garmin_sync.login_rate_limit import FirestoreLoginRateLimiter


class FakeSnapshot:
    def __init__(self, value: dict[str, Any] | None) -> None:
        self.exists = value is not None
        self._value = copy.deepcopy(value)

    def to_dict(self) -> dict[str, Any] | None:
        return copy.deepcopy(self._value)


class FakeDocument:
    def __init__(self, db: FakeFirestore, path: str) -> None:
        self._db = db
        self.path = path

    def get(self, *, transaction: FakeTransaction | None = None) -> FakeSnapshot:
        return FakeSnapshot(self._db.documents.get(self.path))


class FakeCollection:
    def __init__(self, db: FakeFirestore, name: str) -> None:
        self._db = db
        self._name = name

    def document(self, name: str) -> FakeDocument:
        return FakeDocument(self._db, f"{self._name}/{name}")


class FakeTransaction:
    def __init__(self, db: FakeFirestore) -> None:
        self._db = db

    def run(self, function: Any) -> Any:
        with self._db.lock:
            return function(self)

    def set(self, ref: FakeDocument, payload: dict[str, Any], *, merge: bool) -> None:
        value = copy.deepcopy(self._db.documents.get(ref.path, {})) if merge else {}
        value.update(copy.deepcopy(payload))
        self._db.documents[ref.path] = value


class FakeFirestore:
    def __init__(self) -> None:
        self.documents: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self, name)

    def transaction(self) -> FakeTransaction:
        return FakeTransaction(self)


@pytest.fixture
def fake_firestore(monkeypatch: pytest.MonkeyPatch) -> FakeFirestore:
    monkeypatch.setattr(
        limiter_module.firestore,
        "transactional",
        lambda function: lambda transaction: transaction.run(function),
    )
    return FakeFirestore()


def _limiter(db: FakeFirestore, now: list[float]) -> FirestoreLoginRateLimiter:
    return FirestoreLoginRateLimiter(
        "synthetic-secret-with-at-least-32-bytes",
        db=db,
        clock=lambda: now[0],
    )


def test_attempt_window_survives_recreation_and_expires(
    fake_firestore: FakeFirestore,
) -> None:
    now = [1_000_000.0]
    first = _limiter(fake_firestore, now)
    for _ in range(5):
        assert first.check("account:athlete@example.com") == (True, None)

    restarted = _limiter(fake_firestore, now)
    assert restarted.check("account:athlete@example.com") == (False, 600)
    now[0] += 60.5
    assert restarted.check("account:athlete@example.com") == (False, 540)
    now[0] += 539.5
    assert restarted.check("account:athlete@example.com") == (True, None)


def test_concurrent_transactions_admit_only_the_budget(
    fake_firestore: FakeFirestore,
) -> None:
    limiter = _limiter(fake_firestore, [1_000_000.0])
    with ThreadPoolExecutor(max_workers=10) as pool:
        decisions = list(pool.map(limiter.check, ["198.51.100.7"] * 10))
    assert decisions.count((True, None)) == 5
    assert decisions.count((False, 600)) == 5


def test_combined_login_check_returns_longest_applicable_retry_delay(
    fake_firestore: FakeFirestore,
) -> None:
    now = [1_000_000.0]
    limiter = _limiter(fake_firestore, now)
    limiter.record_upstream_rate_limit("account:athlete@example.com")
    for index in range(5):
        assert limiter.check_login("198.51.100.7", f"account:other-{index}@example.com") == (
            True,
            None,
        )
    assert limiter.check_login("198.51.100.7", "account:athlete@example.com") == (
        False,
        1800,
    )
    assert _limiter(fake_firestore, now).check_login(
        "198.51.100.7", "account:athlete@example.com"
    ) == (False, 1800)


def test_upstream_cooldown_is_account_local_and_survives_restart(
    fake_firestore: FakeFirestore,
) -> None:
    now = [1_000_000.0]
    first = _limiter(fake_firestore, now)
    assert first.record_upstream_rate_limit("account:athlete@example.com") == 1800

    restarted = _limiter(fake_firestore, now)
    assert restarted.check("account:athlete@example.com") == (False, 1800)
    assert restarted.check("account:other@example.com") == (True, None)
    assert restarted.check_provider() == (True, None)
    now[0] += 1801
    assert restarted.check("account:athlete@example.com") == (True, None)


def test_breaker_needs_distinct_accounts_and_is_half_open_after_expiry(
    fake_firestore: FakeFirestore,
) -> None:
    now = [1_000_000.0]
    limiter = _limiter(fake_firestore, now)
    for _ in range(4):
        limiter.record_upstream_rate_limit("account:one@example.com")
    assert limiter.check_provider() == (True, None)
    limiter.record_upstream_rate_limit("account:two@example.com")
    assert limiter.check_provider() == (True, None)
    limiter.record_upstream_rate_limit("account:three@example.com")
    assert limiter.check_provider() == (False, 1800)
    assert limiter.check("account:four@example.com") == (False, 1800)

    now[0] += 1801
    assert _limiter(fake_firestore, now).check_provider() == (True, None)
    limiter.record_upstream_rate_limit("account:one@example.com")
    assert limiter.check_provider() == (True, None)


def test_persisted_keys_and_payload_exclude_raw_identifiers_and_secrets(
    fake_firestore: FakeFirestore,
) -> None:
    limiter = _limiter(fake_firestore, [1_000_000.0])
    limiter.check("account:athlete@example.com")
    limiter.check("uid:firebase-uid-123")
    limiter.check("198.51.100.7")
    limiter.record_upstream_rate_limit("account:athlete@example.com")

    saved = repr(fake_firestore.documents)
    for sensitive in (
        "athlete@example.com",
        "firebase-uid-123",
        "198.51.100.7",
        "synthetic-secret-with-at-least-32-bytes",
        "password",
        "token",
        "mfa",
    ):
        assert sensitive not in saved.lower()
    assert len([path for path in fake_firestore.documents if "/account-" in path]) == 1


def test_missing_hmac_secret_fails_configuration(fake_firestore: FakeFirestore) -> None:
    with pytest.raises(ValueError, match="GARMIN_RATE_LIMIT_HMAC_KEY"):
        FirestoreLoginRateLimiter("short", db=fake_firestore)


def _login_handler(email: str, captured: list[dict[str, Any]]) -> Any:
    handler = object.__new__(api_module.GarminAccountLinkHandler)
    handler.path = "/api/garmin/login"
    handler.headers = {"X-Forwarded-For": "198.51.100.7"}
    handler.client_address = ("127.0.0.1", 12345)
    handler._read_json = lambda: {"email": email, "password": "synthetic-password"}  # type: ignore[method-assign]  # noqa: SLF001
    handler._error_response = lambda status, **kwargs: captured.append(  # type: ignore[method-assign]  # noqa: SLF001
        {"status": status, **kwargs}
    )
    return handler


def test_login_handler_records_upstream_429_and_blocks_same_account(
    fake_firestore: FakeFirestore, monkeypatch: pytest.MonkeyPatch
) -> None:
    limiter = _limiter(fake_firestore, [1_000_000.0])
    monkeypatch.setattr(api_module, "RATE_LIMITER", limiter)
    monkeypatch.setattr(
        api_module,
        "log_exception",
        lambda *_args, **_kwargs: SimpleNamespace(code="garmin_link.rate_limited", retryable=True),
    )

    class RateLimitedService:
        calls = 0

        def start_login(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            self.calls += 1
            raise api_module.GarminConnectTooManyRequestsError("synthetic rate limit")

    service = RateLimitedService()
    monkeypatch.setattr(api_module, "_service", lambda: service)
    first: list[dict[str, Any]] = []
    _login_handler("athlete@example.com", first).do_POST()
    assert first[0]["status"] == HTTPStatus.TOO_MANY_REQUESTS
    assert first[0]["retry_after_seconds"] == 1800

    second: list[dict[str, Any]] = []
    _login_handler("athlete@example.com", second)._handle_login()  # noqa: SLF001
    assert second[0]["status"] == HTTPStatus.TOO_MANY_REQUESTS
    assert second[0]["retry_after_seconds"] == 1800
    assert service.calls == 1


def test_explicit_waf_signal_cools_only_the_attempted_account(
    fake_firestore: FakeFirestore, monkeypatch: pytest.MonkeyPatch
) -> None:
    limiter = _limiter(fake_firestore, [1_000_000.0])
    monkeypatch.setattr(api_module, "RATE_LIMITER", limiter)
    monkeypatch.setattr(
        api_module,
        "log_exception",
        lambda *_args, **_kwargs: SimpleNamespace(
            code="garmin_link.upstream_unavailable", retryable=True
        ),
    )

    class WafService:
        def start_login(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise api_module.GarminConnectConnectionError("Cloudflare bot challenge")

    monkeypatch.setattr(api_module, "_service", WafService)
    captured: list[dict[str, Any]] = []
    _login_handler("athlete@example.com", captured).do_POST()

    assert captured[0]["status"] == HTTPStatus.TOO_MANY_REQUESTS
    assert captured[0]["retry_after_seconds"] == 1800
    assert limiter.check("account:athlete@example.com") == (False, 1800)
    assert limiter.check("account:other@example.com") == (True, None)


def test_generic_upstream_connection_failure_does_not_create_cooldown(
    fake_firestore: FakeFirestore, monkeypatch: pytest.MonkeyPatch
) -> None:
    limiter = _limiter(fake_firestore, [1_000_000.0])
    monkeypatch.setattr(api_module, "RATE_LIMITER", limiter)

    class ConnectionFailureService:
        def start_login(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise api_module.GarminConnectConnectionError("Connection timed out")

    monkeypatch.setattr(api_module, "_service", ConnectionFailureService)
    captured: list[dict[str, Any]] = []
    _login_handler("athlete@example.com", captured).do_POST()

    assert captured[0]["status"] == HTTPStatus.BAD_GATEWAY
    assert limiter.check("account:athlete@example.com") == (True, None)


def test_invalid_credentials_do_not_open_provider_breaker(
    fake_firestore: FakeFirestore, monkeypatch: pytest.MonkeyPatch
) -> None:
    limiter = _limiter(fake_firestore, [1_000_000.0])
    monkeypatch.setattr(api_module, "RATE_LIMITER", limiter)

    class AuthenticationFailureService:
        def start_login(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise api_module.GarminConnectAuthenticationError("Invalid login")

    monkeypatch.setattr(api_module, "_service", AuthenticationFailureService)
    for account in ("one@example.com", "two@example.com", "three@example.com"):
        captured: list[dict[str, Any]] = []
        _login_handler(account, captured).do_POST()
        assert captured[0]["status"] == HTTPStatus.UNAUTHORIZED
    assert limiter.check_provider() == (True, None)


def test_mfa_upstream_429_cools_its_original_account(
    fake_firestore: FakeFirestore, monkeypatch: pytest.MonkeyPatch
) -> None:
    limiter = _limiter(fake_firestore, [1_000_000.0])
    monkeypatch.setattr(api_module, "RATE_LIMITER", limiter)
    monkeypatch.setattr(api_module, "_MFA_ACCOUNT_KEYS", {})
    monkeypatch.setattr(
        api_module,
        "log_exception",
        lambda *_args, **_kwargs: SimpleNamespace(code="garmin_link.rate_limited", retryable=True),
    )
    api_module._remember_mfa_account(  # noqa: SLF001
        "synthetic-challenge", "account:athlete@example.com"
    )

    class RateLimitedMfaService:
        def complete_mfa(self, *_args: Any) -> dict[str, Any]:
            raise api_module.GarminConnectTooManyRequestsError("synthetic rate limit")

    monkeypatch.setattr(api_module, "_service", RateLimitedMfaService)
    handler = object.__new__(api_module.GarminAccountLinkHandler)
    handler.path = "/api/garmin/mfa"
    handler._read_json = lambda: {"challengeId": "synthetic-challenge", "code": "123456"}  # type: ignore[method-assign]  # noqa: SLF001
    captured: list[dict[str, Any]] = []
    handler._error_response = lambda status, **kwargs: captured.append(  # type: ignore[method-assign]  # noqa: SLF001
        {"status": status, **kwargs}
    )

    handler.do_POST()

    assert captured[0]["status"] == HTTPStatus.TOO_MANY_REQUESTS
    assert limiter.check("account:athlete@example.com") == (False, 1800)
