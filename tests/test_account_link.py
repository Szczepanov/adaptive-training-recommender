from __future__ import annotations

import logging
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import garmin_sync.account_link as account_link_module
from garmin_sync.account_link import GarminAccountLinkService, PendingLoginStore


class FakeGarminClient:
    def __init__(self) -> None:
        self.dumped_paths: list[str] = []
        self._mfa_pending = True

    @property
    def is_authenticated(self) -> bool:
        return not self._mfa_pending

    def dump(self, path: str) -> None:
        self.dumped_paths.append(path)
        Path(path).write_text("{}", encoding="utf-8")


class FakeGarmin:
    def __init__(self, *, needs_mfa: bool, **kwargs: Any) -> None:
        assert kwargs["return_on_mfa"] is True
        assert kwargs["retry_attempts"] == 1
        assert "verify_login" not in kwargs
        self.password = kwargs.get("password")
        self.needs_mfa = needs_mfa
        self.client = FakeGarminClient()
        self.resumed_codes: list[str] = []

    def login(self, _token_path: str) -> tuple[str | None, None]:
        return ("needs_mfa", None) if self.needs_mfa else (None, None)

    def resume_login(self, _client_state: dict[str, Any], code: str) -> tuple[None, None]:
        self.resumed_codes.append(code)
        self.client._mfa_pending = False
        return None, None


class DummyRepository:
    pass


def test_sync_request_staleness_matches_shared_frontend_windows() -> None:
    now = account_link_module.datetime(2026, 9, 18, 12, 0, tzinfo=account_link_module.timezone.utc)

    pending = {
        "status": "pending",
        "requestType": "backfill",
        "requestedAt": (now - account_link_module.timedelta(minutes=19)).isoformat(),
    }
    assert account_link_module._is_sync_request_stale(pending, now) is False
    pending["requestedAt"] = (now - account_link_module.timedelta(minutes=21)).isoformat()
    assert account_link_module._is_sync_request_stale(pending, now) is True

    claimed_backfill = {
        "status": "processing",
        "requestType": "initial_backfill",
        "requestedAt": (now - account_link_module.timedelta(hours=1)).isoformat(),
        "claimedAt": (now - account_link_module.timedelta(minutes=29)).isoformat(),
    }
    assert account_link_module._is_sync_request_stale(claimed_backfill, now) is False
    claimed_backfill["claimedAt"] = (now - account_link_module.timedelta(minutes=31)).isoformat()
    assert account_link_module._is_sync_request_stale(claimed_backfill, now) is True

    ordinary_processing = {
        "status": "processing",
        "requestType": "sync",
        "requestedAt": (now - account_link_module.timedelta(hours=1)).isoformat(),
        "claimedAt": (now - account_link_module.timedelta(minutes=21)).isoformat(),
    }
    assert account_link_module._is_sync_request_stale(ordinary_processing, now) is True


def test_mfa_resume_failure_preserves_challenge_for_retry(
    monkeypatch: Any,
) -> None:
    class RetryGarmin(FakeGarmin):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(needs_mfa=True, **kwargs)
            self.failures_remaining = 1

        def resume_login(self, client_state: dict[str, Any], code: str) -> tuple[None, None]:
            if self.failures_remaining:
                self.failures_remaining -= 1
                raise account_link_module.GarminConnectAuthenticationError("invalid code")
            return super().resume_login(client_state, code)

    api: RetryGarmin | None = None

    def factory(**kwargs: Any) -> RetryGarmin:
        nonlocal api
        api = RetryGarmin(**kwargs)
        return api

    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        garmin_factory=factory,  # type: ignore[arg-type]
    )
    monkeypatch.setattr(
        service,
        "_finalize",
        lambda *_args: {"status": "authenticated"},
    )

    first = service.start_login("person@example.com", "secret")
    challenge_id = str(first["challengeId"])

    with pytest.raises(
        account_link_module.GarminConnectAuthenticationError, match="invalid code"
    ) as exc:
        service.complete_mfa(challenge_id, "000000")

    assert exc.value.challenge_reusable is True
    assert exc.value.auth_stage == "pre_authentication"

    assert api is not None
    assert api.password is None
    assert service.complete_mfa(challenge_id, "123456")["status"] == "authenticated"
    assert api.resumed_codes == ["123456"]

    with pytest.raises(
        account_link_module.GarminConnectAuthenticationError, match="invalid, expired"
    ):
        service.complete_mfa(challenge_id, "123456")


def test_concurrent_mfa_completion_allows_only_one_resume(
    monkeypatch: Any,
    caplog: pytest.LogCaptureFixture,
) -> None:
    class BlockingGarmin(FakeGarmin):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(needs_mfa=True, **kwargs)
            self.resume_started = threading.Event()
            self.resume_release = threading.Event()

        def resume_login(self, client_state: dict[str, Any], code: str) -> tuple[None, None]:
            self.resumed_codes.append(code)
            self.resume_started.set()
            assert self.resume_release.wait(timeout=2)
            return None, None

    api: BlockingGarmin | None = None

    def factory(**kwargs: Any) -> BlockingGarmin:
        nonlocal api
        api = BlockingGarmin(**kwargs)
        return api

    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        garmin_factory=factory,  # type: ignore[arg-type]
    )
    monkeypatch.setattr(service, "_finalize", lambda *_args: {"status": "authenticated"})
    first = service.start_login("person@example.com", "secret")
    challenge_id = str(first["challengeId"])

    winning_result: list[dict[str, Any]] = []
    winning_error: list[BaseException] = []

    def complete_winner() -> None:
        try:
            winning_result.append(service.complete_mfa(challenge_id, "654321"))
        except BaseException as exc:  # pragma: no cover - diagnostic guard for thread failures
            winning_error.append(exc)

    winner = threading.Thread(target=complete_winner)
    with caplog.at_level(logging.INFO):
        winner.start()
        assert api is not None
        assert api.resume_started.wait(timeout=2)

        with pytest.raises(
            account_link_module.GarminConnectAuthenticationError, match="already in use"
        ):
            service.complete_mfa(challenge_id, "111111")

        api.resume_release.set()
        winner.join(timeout=2)

    assert not winner.is_alive()
    assert winning_error == []
    assert winning_result == [{"status": "authenticated"}]
    assert api is not None
    assert api.resumed_codes == ["654321"]
    assert "654321" not in caplog.text
    assert "secret" not in caplog.text


def test_failed_mfa_resume_expires_and_cleans_up_live_temp_state() -> None:
    now = [100.0]

    class FailingGarmin(FakeGarmin):
        def resume_login(self, _client_state: dict[str, Any], _code: str) -> tuple[None, None]:
            raise account_link_module.GarminConnectAuthenticationError("invalid code")

    store = PendingLoginStore(ttl_seconds=5, clock=lambda: now[0])
    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=lambda **kwargs: FailingGarmin(needs_mfa=True, **kwargs),  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    challenge_id = str(first["challengeId"])
    pending = store._items[challenge_id]  # noqa: SLF001 - verify cleanup boundary
    assert pending.temp_dir.exists()

    with pytest.raises(account_link_module.GarminConnectAuthenticationError, match="invalid code"):
        service.complete_mfa(challenge_id, "000000")
    assert pending.temp_dir.exists()

    now[0] = 106.0
    with pytest.raises(account_link_module.GarminConnectAuthenticationError, match="expired"):
        service.complete_mfa(challenge_id, "123456")

    assert not pending.temp_dir.exists()


def test_mfa_challenge_is_consumed_after_bounded_failed_attempts() -> None:
    class FailingGarmin(FakeGarmin):
        def resume_login(self, _client_state: dict[str, Any], _code: str) -> tuple[None, None]:
            raise account_link_module.GarminConnectAuthenticationError("invalid code")

    store = PendingLoginStore()
    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=lambda **kwargs: FailingGarmin(needs_mfa=True, **kwargs),  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    challenge_id = str(first["challengeId"])
    pending = store._items[challenge_id]  # noqa: SLF001 - verify cleanup boundary

    for _ in range(account_link_module._MAX_MFA_ATTEMPTS):
        with pytest.raises(
            account_link_module.GarminConnectAuthenticationError, match="invalid code"
        ) as exc:
            service.complete_mfa(challenge_id, "000000")
    assert exc.value.challenge_reusable is False

    with pytest.raises(
        account_link_module.GarminConnectAuthenticationError, match="invalid, expired"
    ):
        service.complete_mfa(challenge_id, "123456")
    assert not pending.temp_dir.exists()


def test_post_authentication_profile_failure_consumes_mfa_challenge() -> None:
    class ProfileFailGarmin(FakeGarmin):
        def resume_login(self, client_state: dict[str, Any], code: str) -> tuple[None, None]:
            super().resume_login(client_state, code)
            raise RuntimeError("profile fetch failed")

    store = PendingLoginStore()
    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=lambda **kwargs: ProfileFailGarmin(needs_mfa=True, **kwargs),  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    challenge_id = str(first["challengeId"])
    pending = store._items[challenge_id]  # noqa: SLF001 - verify cleanup boundary

    with pytest.raises(RuntimeError, match="profile fetch failed"):
        service.complete_mfa(challenge_id, "123456")

    with pytest.raises(
        account_link_module.GarminConnectAuthenticationError, match="invalid, expired"
    ):
        service.complete_mfa(challenge_id, "123456")
    assert not pending.temp_dir.exists()


def test_mfa_rate_limit_consumes_challenge_when_advised_wait_exceeds_ttl() -> None:
    class RateLimitedGarmin(FakeGarmin):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(needs_mfa=True, **kwargs)
            self.resume_calls = 0

        def resume_login(self, _client_state: dict[str, Any], _code: str) -> tuple[None, None]:
            self.resume_calls += 1
            raise account_link_module.GarminConnectTooManyRequestsError("rate limited")

    store = PendingLoginStore()
    api: RateLimitedGarmin | None = None

    def factory(**kwargs: Any) -> RateLimitedGarmin:
        nonlocal api
        api = RateLimitedGarmin(**kwargs)
        return api

    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=factory,  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    challenge_id = str(first["challengeId"])
    pending = store._items[challenge_id]  # noqa: SLF001 - verify retry state

    with pytest.raises(
        account_link_module.GarminConnectTooManyRequestsError, match="rate limited"
    ) as exc:
        service.complete_mfa(challenge_id, "123456")
    assert exc.value.challenge_reusable is False
    assert exc.value.auth_stage == "pre_authentication"

    assert pending.failed_mfa_attempts == 0
    assert not pending.temp_dir.exists()
    with pytest.raises(
        account_link_module.GarminConnectAuthenticationError, match="invalid, expired"
    ):
        service.complete_mfa(challenge_id, "123456")
    assert api is not None
    assert api.resume_calls == 1


def test_mfa_post_authentication_verification_failure_consumes_challenge() -> None:
    class VerificationFailGarmin(FakeGarmin):
        def resume_login(self, client_state: dict[str, Any], code: str) -> tuple[None, None]:
            super().resume_login(client_state, code)
            self.client._mfa_pending = False
            self.client.di_token = None
            raise account_link_module.GarminConnectConnectionError("token rejected")

    store = PendingLoginStore()
    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=lambda **kwargs: VerificationFailGarmin(needs_mfa=True, **kwargs),  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    challenge_id = str(first["challengeId"])
    pending = store._items[challenge_id]  # noqa: SLF001 - verify terminal cleanup

    with pytest.raises(account_link_module.GarminConnectConnectionError, match="token rejected"):
        service.complete_mfa(challenge_id, "123456")

    with pytest.raises(
        account_link_module.GarminConnectAuthenticationError, match="invalid, expired"
    ):
        service.complete_mfa(challenge_id, "123456")
    assert not pending.temp_dir.exists()


def test_clean_login_dumps_tokens_and_clears_password_before_finalize(
    monkeypatch: Any,
) -> None:
    created: list[FakeGarmin] = []

    def factory(**kwargs: Any) -> FakeGarmin:
        api = FakeGarmin(needs_mfa=False, **kwargs)
        created.append(api)
        return api

    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        garmin_factory=factory,  # type: ignore[arg-type]
    )

    def finalize(
        api: Any,
        token_path: Path,
        temp_dir: Path,
        requested_uid: str | None,
    ) -> dict[str, Any]:
        assert api.password is None
        assert api.client.dumped_paths == [str(token_path)]
        assert token_path.exists()
        assert temp_dir.exists()
        assert requested_uid == "existing-uid"
        return {"status": "authenticated", "customToken": "token", "isNewUser": False}

    monkeypatch.setattr(service, "_finalize", finalize)
    result = service.start_login(
        "person@example.com",
        "secret",
        requested_uid="existing-uid",
    )

    assert result["status"] == "authenticated"
    assert created[0].password is None


def test_mfa_challenge_keeps_session_but_not_plaintext_password(
    monkeypatch: Any,
) -> None:
    created: list[FakeGarmin] = []

    def factory(**kwargs: Any) -> FakeGarmin:
        api = FakeGarmin(needs_mfa=True, **kwargs)
        created.append(api)
        return api

    store = PendingLoginStore(ttl_seconds=300)
    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=factory,  # type: ignore[arg-type]
    )

    def finalize(
        api: Any,
        token_path: Path,
        _temp_dir: Path,
        requested_uid: str | None,
    ) -> dict[str, Any]:
        assert api.password is None
        assert api.client.dumped_paths == [str(token_path)]
        assert requested_uid is None
        return {"status": "authenticated", "customToken": "new-token", "isNewUser": True}

    monkeypatch.setattr(service, "_finalize", finalize)
    first = service.start_login("person@example.com", "secret")

    assert first["status"] == "mfa_required"
    assert created[0].password is None
    challenge_id = str(first["challengeId"])

    second = service.complete_mfa(challenge_id, "123456")

    assert second["status"] == "authenticated"
    assert created[0].resumed_codes == ["123456"]


def test_expired_mfa_challenge_is_rejected() -> None:
    now = [100.0]
    store = PendingLoginStore(ttl_seconds=5, clock=lambda: now[0])

    def factory(**kwargs: Any) -> FakeGarmin:
        return FakeGarmin(needs_mfa=True, **kwargs)

    service = GarminAccountLinkService(
        "bucket",
        repository=DummyRepository(),  # type: ignore[arg-type]
        pending_store=store,
        garmin_factory=factory,  # type: ignore[arg-type]
    )

    first = service.start_login("person@example.com", "secret")
    now[0] = 106.0

    with pytest.raises(Exception, match="expired"):
        service.complete_mfa(str(first["challengeId"]), "123456")


def test_mutable_display_name_is_not_accepted_as_account_identity() -> None:
    class DisplayNameOnlyGarmin:
        def connectapi(self, _path: str) -> dict[str, str]:
            return {"displayName": "renameable-handle"}

    with pytest.raises(Exception, match="no stable account identity"):
        account_link_module._garmin_identity(  # noqa: SLF001 - identity contract regression
            DisplayNameOnlyGarmin()  # type: ignore[arg-type]
        )


def test_link_commit_failure_removes_uploaded_token(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    class Repository:
        def uid_for_identity(self, _identity_digest: str) -> None:
            return None

        def assert_target_available(self, _uid: str, _identity_digest: str) -> None:
            return None

        def commit_link(
            self,
            _uid: str,
            _identity_digest: str,
            _identity_kind: str,
            _token_object: str,
        ) -> None:
            raise account_link_module.GarminLinkConflictError("conflicting link")

    class TokenStore:
        def __init__(self, _bucket: str, _object_name: str) -> None:
            pass

        def persist(self, _source: Path) -> bool:
            return True

    class FinalizableGarmin:
        password = None

        def connectapi(self, _path: str) -> dict[str, str]:
            return {"garminGUID": "stable-guid"}

    monkeypatch.setattr(account_link_module, "GcsTokenStore", TokenStore)
    service = GarminAccountLinkService(
        "bucket",
        repository=Repository(),  # type: ignore[arg-type]
    )
    deleted_objects: list[str] = []
    monkeypatch.setattr(service, "_delete_token_object", deleted_objects.append)

    token_path = tmp_path / "tokens.json"
    token_path.write_text("{}", encoding="utf-8")
    temp_dir = tmp_path / "temporary"
    temp_dir.mkdir()

    with pytest.raises(account_link_module.GarminLinkConflictError, match="conflicting link"):
        service._finalize(  # noqa: SLF001 - regression test for rollback boundary
            FinalizableGarmin(),  # type: ignore[arg-type]
            token_path,
            temp_dir,
            "existing-uid",
        )

    assert len(deleted_objects) == 1
    assert deleted_objects[0].startswith("garmin/users/existing-uid/garmin_tokens-")
    assert deleted_objects[0].endswith(".json")


def test_relink_commit_failure_preserves_active_token(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    """A failed relink must clean up only its own staged upload, never the active token
    that scheduled sync still reads -- the two now live at different object names."""

    class Repository:
        def uid_for_identity(self, _identity_digest: str) -> None:
            return None

        def assert_target_available(self, _uid: str, _identity_digest: str) -> None:
            return None

        def commit_link(
            self,
            _uid: str,
            _identity_digest: str,
            _identity_kind: str,
            _token_object: str,
        ) -> str | None:
            # A concurrent commit could have already replaced this uid's active token by
            # the time this one is attempted; commit_link() itself still fails the link,
            # so its (unused, since it raises) previous-token value never matters here.
            raise account_link_module.GarminLinkConflictError("conflicting link")

    class TokenStore:
        def __init__(self, _bucket: str, _object_name: str) -> None:
            pass

        def persist(self, _source: Path) -> bool:
            return True

    class FinalizableGarmin:
        password = None

        def connectapi(self, _path: str) -> dict[str, str]:
            return {"garminGUID": "stable-guid"}

    monkeypatch.setattr(account_link_module, "GcsTokenStore", TokenStore)
    service = GarminAccountLinkService(
        "bucket",
        repository=Repository(),  # type: ignore[arg-type]
    )
    deleted_objects: list[str] = []
    monkeypatch.setattr(service, "_delete_token_object", deleted_objects.append)

    token_path = tmp_path / "tokens.json"
    token_path.write_text("{}", encoding="utf-8")
    temp_dir = tmp_path / "temporary"
    temp_dir.mkdir()

    with pytest.raises(account_link_module.GarminLinkConflictError, match="conflicting link"):
        service._finalize(  # noqa: SLF001 - regression test for rollback boundary
            FinalizableGarmin(),  # type: ignore[arg-type]
            token_path,
            temp_dir,
            "existing-uid",
        )

    assert "garmin/users/existing-uid/garmin_tokens-original.json" not in deleted_objects
    assert len(deleted_objects) == 1
    assert deleted_objects[0].startswith("garmin/users/existing-uid/garmin_tokens-")
    assert deleted_objects[0] != "garmin/users/existing-uid/garmin_tokens-original.json"


def test_successful_relink_deletes_superseded_token(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    """A successful relink commits the new staged token and only then removes the
    now-superseded previous one, using the value commit_link() itself just overwrote
    (read atomically inside its transaction) rather than a pre-transaction snapshot."""

    class Repository:
        def uid_for_identity(self, _identity_digest: str) -> None:
            return None

        def assert_target_available(self, _uid: str, _identity_digest: str) -> None:
            return None

        def commit_link(
            self,
            _uid: str,
            _identity_digest: str,
            _identity_kind: str,
            _token_object: str,
        ) -> str | None:
            return "garmin/users/existing-uid/garmin_tokens-original.json"

    class TokenStore:
        def __init__(self, _bucket: str, _object_name: str) -> None:
            pass

        def persist(self, _source: Path) -> bool:
            return True

    class FinalizableGarmin:
        password = None

        def connectapi(self, _path: str) -> dict[str, str]:
            return {"garminGUID": "stable-guid"}

    monkeypatch.setattr(account_link_module, "GcsTokenStore", TokenStore)
    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "create_custom_token",
        lambda _uid: b"token",
    )
    service = GarminAccountLinkService(
        "bucket",
        repository=Repository(),  # type: ignore[arg-type]
    )
    deleted_objects: list[str] = []
    monkeypatch.setattr(service, "_delete_token_object", deleted_objects.append)

    token_path = tmp_path / "tokens.json"
    token_path.write_text("{}", encoding="utf-8")
    temp_dir = tmp_path / "temporary"
    temp_dir.mkdir()

    result = service._finalize(  # noqa: SLF001 - regression test for rollback boundary
        FinalizableGarmin(),  # type: ignore[arg-type]
        token_path,
        temp_dir,
        "existing-uid",
    )

    assert result["status"] == "authenticated"
    assert deleted_objects == ["garmin/users/existing-uid/garmin_tokens-original.json"]


def test_custom_token_failure_after_commit_keeps_new_user_for_retry(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    class Repository:
        committed = False

        def uid_for_identity(self, _identity_digest: str) -> None:
            return None

        def assert_target_available(self, _uid: str, _identity_digest: str) -> None:
            return None

        def commit_link(
            self,
            _uid: str,
            _identity_digest: str,
            _identity_kind: str,
            _token_object: str,
        ) -> None:
            self.committed = True

    class TokenStore:
        def __init__(self, _bucket: str, _object_name: str) -> None:
            pass

        def persist(self, _source: Path) -> bool:
            return True

    class FinalizableGarmin:
        password = None

        def connectapi(self, _path: str) -> dict[str, str]:
            return {"garminGUID": "stable-guid"}

    repository = Repository()
    deleted_uids: list[str] = []
    monkeypatch.setattr(account_link_module, "GcsTokenStore", TokenStore)
    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "create_user",
        lambda: SimpleNamespace(uid="new-uid"),
    )
    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "delete_user",
        deleted_uids.append,
    )

    def fail_custom_token(_uid: str) -> bytes:
        raise RuntimeError("temporary signer failure")

    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "create_custom_token",
        fail_custom_token,
    )

    service = GarminAccountLinkService(
        "bucket",
        repository=repository,  # type: ignore[arg-type]
    )
    token_path = tmp_path / "tokens.json"
    token_path.write_text("{}", encoding="utf-8")
    temp_dir = tmp_path / "temporary"
    temp_dir.mkdir()

    with pytest.raises(RuntimeError, match="temporary signer failure"):
        service._finalize(  # noqa: SLF001 - regression test for transactional boundary
            FinalizableGarmin(),  # type: ignore[arg-type]
            token_path,
            temp_dir,
            None,
        )

    assert repository.committed is True
    assert deleted_uids == []


class _Snapshot:
    def __init__(self, data: dict[str, Any] | None) -> None:
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict[str, Any] | None:
        return dict(self._data) if self._data is not None else None


class _Document:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        self.data = data
        self._collections: dict[str, _Collection] = {}

    def get(self, transaction: Any = None) -> _Snapshot:
        return _Snapshot(self.data)

    def set(self, payload: dict[str, Any], merge: bool = True) -> None:
        if merge:
            self.data = {**(self.data or {}), **payload}
        else:
            self.data = dict(payload)

    def collection(self, name: str) -> _Collection:
        return self._collections.setdefault(name, _Collection())


class _Collection:
    def __init__(self) -> None:
        self._documents: dict[str, _Document] = {}

    def document(self, doc_id: str) -> _Document:
        return self._documents.setdefault(doc_id, _Document())


class _Transaction:
    def set(self, doc_ref: _Document, payload: dict[str, Any], merge: bool = False) -> None:
        # Mirrors google.cloud.firestore.Transaction.set's real default (merge=False):
        # a bare transaction.set() fully replaces the document, it doesn't merge.
        if merge:
            doc_ref.data = {**(doc_ref.data or {}), **payload}
        else:
            doc_ref.data = dict(payload)


class _Db:
    def __init__(self) -> None:
        self._collections: dict[str, _Collection] = {}

    def collection(self, name: str) -> _Collection:
        return self._collections.setdefault(name, _Collection())

    def transaction(self) -> _Transaction:
        return _Transaction()


def test_commit_link_returns_exactly_the_tokenObject_it_overwrote(monkeypatch: Any) -> None:
    """Regression for a relink cleanup race: previous_token_object must come from inside
    commit_link()'s own transaction, not a separate pre-transaction read, or a second
    concurrent relink can delete a token a sibling commit just wrote instead of the one
    it actually superseded -- leaking the sibling's staged object forever.

    The fake transaction here runs the decorated body directly (no real retry machinery),
    but that's enough: it proves each commit's returned "previous" value is read from
    Firestore state at that exact commit, so sequential commits for the same uid chain
    correctly regardless of how many callers are really racing.
    """
    monkeypatch.setattr(account_link_module.google_firestore, "transactional", lambda fn: fn)
    db = _Db()
    repository = account_link_module.GarminConnectionRepository(db=db)

    first_previous = repository.commit_link(
        "uid-1", "digest-1", "garmin_guid", "garmin/users/uid-1/garmin_tokens-aaa.json"
    )
    second_previous = repository.commit_link(
        "uid-1", "digest-1", "garmin_guid", "garmin/users/uid-1/garmin_tokens-bbb.json"
    )
    third_previous = repository.commit_link(
        "uid-1", "digest-1", "garmin_guid", "garmin/users/uid-1/garmin_tokens-ccc.json"
    )

    assert first_previous is None  # nothing committed yet for this uid
    assert second_previous == "garmin/users/uid-1/garmin_tokens-aaa.json"
    assert third_previous == "garmin/users/uid-1/garmin_tokens-bbb.json"
    connection = db.collection("garminConnections").document("uid-1").data
    assert connection is not None
    assert connection["tokenObject"] == "garmin/users/uid-1/garmin_tokens-ccc.json"

    # commit_link also mirrors non-secret status onto users/{uid}/connections/garmin so the
    # frontend can read its own connection state without server-only garminConnections access.
    client_status = (
        db.collection("users").document("uid-1").collection("connections").document("garmin").data
    )
    assert client_status is not None
    assert client_status["status"] == "active"
    assert "tokenObject" not in client_status
    assert "identityDigest" not in client_status


def test_finalize_queues_initial_backfill_request(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    class TokenStore:
        def __init__(self, _bucket: str, _object_name: str) -> None:
            pass

        def persist(self, _source: Path) -> bool:
            return True

    class FinalizableGarmin:
        password = None

        def connectapi(self, _path: str) -> dict[str, str]:
            return {"garminGUID": "stable-guid"}

    monkeypatch.setattr(account_link_module, "GcsTokenStore", TokenStore)
    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "create_custom_token",
        lambda _uid: b"token",
    )
    monkeypatch.setattr(account_link_module.google_firestore, "transactional", lambda fn: fn)

    db = _Db()
    repository = account_link_module.GarminConnectionRepository(db=db)
    service = GarminAccountLinkService("bucket", repository=repository)

    token_path = tmp_path / "tokens.json"
    token_path.write_text("{}", encoding="utf-8")
    temp_dir = tmp_path / "temporary"
    temp_dir.mkdir()

    result = service._finalize(
        FinalizableGarmin(),  # type: ignore[arg-type]
        token_path,
        temp_dir,
        "new-user-123",
    )

    assert result["status"] == "authenticated"
    sync_req = (
        db.collection("users")
        .document("new-user-123")
        .collection("garmin_sync_requests")
        .document("latest")
        .data
    )
    assert sync_req is not None
    assert sync_req["status"] == "pending"
    assert sync_req["requestType"] == "initial_backfill"
    assert sync_req["days"] == 56
    assert sync_req["backfillPhase"] == "recent"
    assert sync_req["backfillNextDate"] is None
    assert sync_req["retryAt"] is None
    assert len(sync_req["backfillEndDate"]) == 10


def test_finalize_does_not_stomp_a_live_in_flight_sync_request(
    monkeypatch: Any,
    tmp_path: Path,
) -> None:
    """Regression test: a plain merge=True set() here would flip an already-claimed
    'processing' request back to 'pending' while keeping its claimId -- the worker
    that owns that claim would then mark this brand-new initial-backfill request
    completed without ever running it, and a second poller could concurrently claim
    the 'pending' doc too. Linking must leave a genuinely still-running request
    alone."""

    class TokenStore:
        def __init__(self, _bucket: str, _object_name: str) -> None:
            pass

        def persist(self, _source: Path) -> bool:
            return True

    class FinalizableGarmin:
        password = None

        def connectapi(self, _path: str) -> dict[str, str]:
            return {"garminGUID": "stable-guid"}

    monkeypatch.setattr(account_link_module, "GcsTokenStore", TokenStore)
    monkeypatch.setattr(
        account_link_module.firebase_auth,
        "create_custom_token",
        lambda _uid: b"token",
    )
    monkeypatch.setattr(account_link_module.google_firestore, "transactional", lambda fn: fn)

    db = _Db()
    live_request = {
        "userId": "new-user-123",
        "status": "processing",
        "requestType": "sync",
        "requestedAt": account_link_module.datetime.now(
            account_link_module.timezone.utc
        ).isoformat(),
        "claimId": "worker-currently-running",
        "claimedAt": account_link_module.datetime.now(account_link_module.timezone.utc).isoformat(),
    }
    db.collection("users").document("new-user-123").collection("garmin_sync_requests").document(
        "latest"
    ).data = dict(live_request)

    repository = account_link_module.GarminConnectionRepository(db=db)
    service = GarminAccountLinkService("bucket", repository=repository)

    token_path = tmp_path / "tokens.json"
    token_path.write_text("{}", encoding="utf-8")
    temp_dir = tmp_path / "temporary"
    temp_dir.mkdir()

    result = service._finalize(
        FinalizableGarmin(),  # type: ignore[arg-type]
        token_path,
        temp_dir,
        "new-user-123",
    )

    assert result["status"] == "authenticated"
    sync_req = (
        db.collection("users")
        .document("new-user-123")
        .collection("garmin_sync_requests")
        .document("latest")
        .data
    )
    # Untouched: still the live worker's claim, not the queued initial_backfill.
    assert sync_req == live_request


def test_delete_token_object_handles_google_cloud_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import logging
    import sys

    from google.cloud.exceptions import GoogleCloudError

    service = GarminAccountLinkService("bucket", repository=DummyRepository())  # type: ignore[arg-type]

    class FailingStorageModule:
        class Client:
            def bucket(self, name: str) -> Any:
                raise GoogleCloudError("GCS deletion failed")

    monkeypatch.setitem(sys.modules, "google.cloud.storage", FailingStorageModule)

    with caplog.at_level(logging.WARNING):
        service._delete_token_object("test-object.json")

    assert "Failed to remove orphaned Garmin token object after link error:" in caplog.text
    assert "GCS deletion failed" in caplog.text


def test_delete_token_object_handles_import_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import logging
    import sys

    service = GarminAccountLinkService("bucket", repository=DummyRepository())  # type: ignore[arg-type]

    monkeypatch.setitem(sys.modules, "google.cloud.storage", None)

    with caplog.at_level(logging.WARNING):
        service._delete_token_object("test-object.json")

    assert "Failed to remove orphaned Garmin token object after link error" in caplog.text
