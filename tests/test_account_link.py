from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import garmin_sync.account_link as account_link_module
from garmin_sync.account_link import GarminAccountLinkService, PendingLoginStore


class FakeGarminClient:
    def __init__(self) -> None:
        self.dumped_paths: list[str] = []

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
        return None, None


class DummyRepository:
    pass


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
