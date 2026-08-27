from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

import garmin_sync.google_health_account_link as link_module
from garmin_sync.google_health_account_link import (
    GoogleHealthConnectionRepository,
    GoogleHealthLinkError,
    GoogleHealthLinkStateInvalidError,
    GoogleHealthLinkStateStore,
    GoogleHealthLinkTokens,
    GoogleHealthTokenExchangeError,
    build_authorize_url,
    exchange_code_for_tokens,
    load_tokens,
    persist_tokens,
)

# --- Fake Firestore, extended from the account_link.py test pattern with delete()/
# collection_group()/stream() support this module also needs. ---


class _Snapshot:
    def __init__(self, doc_id: str, data: dict[str, Any] | None, reference: "_Document") -> None:
        self.id = doc_id
        self._data = data
        self.exists = data is not None
        self.reference = reference

    def to_dict(self) -> dict[str, Any] | None:
        return dict(self._data) if self._data is not None else None


class _Document:
    def __init__(self, doc_id: str, parent: "_Collection | None" = None) -> None:
        self.id = doc_id
        self.parent = parent
        self.data: dict[str, Any] | None = None
        self._subcollections: dict[str, _Collection] = {}

    def get(self) -> _Snapshot:
        return _Snapshot(self.id, self.data, self)

    def set(self, payload: dict[str, Any], merge: bool = True) -> None:
        if merge:
            self.data = {**(self.data or {}), **payload}
        else:
            self.data = dict(payload)

    def delete(self) -> None:
        self.data = None

    def collection(self, name: str) -> "_Collection":
        return self._subcollections.setdefault(name, _Collection(name, parent_doc=self))


class _Collection:
    def __init__(self, name: str, parent_doc: _Document | None = None) -> None:
        self.name = name
        self.parent = parent_doc
        self._documents: dict[str, _Document] = {}

    def document(self, doc_id: str) -> _Document:
        return self._documents.setdefault(doc_id, _Document(doc_id, parent=self))

    def stream(self) -> list[_Snapshot]:
        return [
            _Snapshot(doc.id, doc.data, doc)
            for doc in self._documents.values()
            if doc.data is not None
        ]


class _CollectionGroup:
    """Firestore's real collection-group query returns every document across every distinct
    parent -- unlike _Collection.stream(), it must NOT collapse same-named docs from
    different parents into one dict keyed by doc id."""

    def __init__(self, snapshots: list[_Snapshot]) -> None:
        self._snapshots = snapshots

    def stream(self) -> list[_Snapshot]:
        return list(self._snapshots)


class _Db:
    def __init__(self) -> None:
        self._collections: dict[str, _Collection] = {}

    def collection(self, name: str) -> _Collection:
        return self._collections.setdefault(name, _Collection(name))

    def collection_group(self, name: str) -> _CollectionGroup:
        """Flatten every subcollection named `name` across every top-level document, mirroring
        Firestore's real collection-group semantics closely enough for these tests."""
        snapshots: list[_Snapshot] = []
        for top_collection in self._collections.values():
            for doc in top_collection._documents.values():
                sub = doc._subcollections.get(name)
                if sub:
                    snapshots.extend(sub.stream())
        return _CollectionGroup(snapshots)


# --- GoogleHealthLinkStateStore ---


def test_state_store_create_then_consume_returns_uid() -> None:
    db = _Db()
    store = GoogleHealthLinkStateStore(db=db)
    state = store.create("uid-1")

    assert store.consume(state) == "uid-1"


def test_state_store_consume_is_one_time_use() -> None:
    db = _Db()
    store = GoogleHealthLinkStateStore(db=db)
    state = store.create("uid-1")
    store.consume(state)

    with pytest.raises(GoogleHealthLinkStateInvalidError):
        store.consume(state)


def test_state_store_rejects_unknown_state() -> None:
    store = GoogleHealthLinkStateStore(db=_Db())
    with pytest.raises(GoogleHealthLinkStateInvalidError):
        store.consume("never-issued")


def test_state_store_rejects_missing_state() -> None:
    store = GoogleHealthLinkStateStore(db=_Db())
    with pytest.raises(GoogleHealthLinkStateInvalidError):
        store.consume("")


def test_state_store_rejects_expired_state(monkeypatch: Any) -> None:
    db = _Db()
    store = GoogleHealthLinkStateStore(db=db)
    state = store.create("uid-1")

    # Simulate the TTL having elapsed by moving time.time() forward past _STATE_TTL_SECONDS.
    real_time = link_module.time.time
    monkeypatch.setattr(link_module.time, "time", lambda: real_time() + 20 * 60)

    with pytest.raises(GoogleHealthLinkStateInvalidError):
        store.consume(state)


# --- build_authorize_url ---


def test_build_authorize_url_contains_required_params() -> None:
    url = build_authorize_url(
        client_id="client-123",
        redirect_uri="https://example.com/callback",
        scopes=["scope-a", "scope-b"],
        state="state-xyz",
    )

    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client_id=client-123" in url
    assert "state=state-xyz" in url
    assert "access_type=offline" in url
    assert "prompt=consent" in url
    assert "scope-a" in url and "scope-b" in url


# --- exchange_code_for_tokens ---


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


def test_exchange_code_for_tokens_success(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        link_module.requests,
        "post",
        lambda *a, **k: _FakeResponse(
            200, {"access_token": "at", "refresh_token": "rt", "scope": "a b"}
        ),
    )

    tokens = exchange_code_for_tokens(
        code="code", client_id="cid", client_secret="secret", redirect_uri="https://x/cb"
    )

    assert tokens.access_token == "at"
    assert tokens.refresh_token == "rt"
    assert tokens.scopes == ["a", "b"]


def test_exchange_code_for_tokens_http_error_raises(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        link_module.requests, "post", lambda *a, **k: _FakeResponse(400, {"error": "bad"})
    )

    with pytest.raises(GoogleHealthTokenExchangeError):
        exchange_code_for_tokens(
            code="code", client_id="cid", client_secret="secret", redirect_uri="https://x/cb"
        )


def test_exchange_code_for_tokens_missing_refresh_token_raises(monkeypatch: Any) -> None:
    """Without prompt=consent (or on a repeat grant), Google can omit refresh_token -- treat
    that as a hard failure rather than silently returning an access-token-only result that
    would die in an hour with no way to renew."""
    monkeypatch.setattr(
        link_module.requests, "post", lambda *a, **k: _FakeResponse(200, {"access_token": "at"})
    )

    with pytest.raises(GoogleHealthTokenExchangeError):
        exchange_code_for_tokens(
            code="code", client_id="cid", client_secret="secret", redirect_uri="https://x/cb"
        )


# --- persist_tokens / load_tokens ---


class _FakeGcsTokenStore:
    _blobs: dict[str, str] = {}

    def __init__(self, bucket_name: str, object_name: str) -> None:
        self.bucket_name = bucket_name
        self.object_name = object_name

    def persist(self, source: Path) -> bool:
        _FakeGcsTokenStore._blobs[self.object_name] = source.read_text()
        return True

    def restore(self, destination: Path) -> bool:
        content = _FakeGcsTokenStore._blobs.get(self.object_name)
        if content is None:
            return False
        destination.write_text(content)
        return True


def test_persist_then_load_tokens_round_trip(monkeypatch: Any) -> None:
    _FakeGcsTokenStore._blobs.clear()
    monkeypatch.setattr(link_module, "GcsTokenStore", _FakeGcsTokenStore)

    tokens = GoogleHealthLinkTokens(
        access_token="at",
        refresh_token="rt",
        token_type="Bearer",
        scopes=["a"],
        obtained_at="2026-08-27T00:00:00+00:00",
    )
    object_name = persist_tokens(bucket_name="bucket", uid="uid-1", tokens=tokens)

    assert object_name.startswith("google-health/users/uid-1/")
    loaded = load_tokens(bucket_name="bucket", object_name=object_name)
    assert loaded is not None
    assert loaded["refresh_token"] == "rt"


def test_load_tokens_missing_object_returns_none(monkeypatch: Any) -> None:
    _FakeGcsTokenStore._blobs.clear()
    monkeypatch.setattr(link_module, "GcsTokenStore", _FakeGcsTokenStore)

    assert load_tokens(bucket_name="bucket", object_name="does/not/exist.json") is None


# --- GoogleHealthConnectionRepository ---


def test_save_and_get_connection_round_trip() -> None:
    db = _Db()
    repo = GoogleHealthConnectionRepository(db=db)

    repo.save_connection(
        "uid-1", health_user_id="health-uid", granted_scopes=["a", "b"], token_object="obj/path"
    )
    connection = repo.get_connection("uid-1")

    assert connection is not None
    assert connection["status"] == "active"
    assert connection["healthUserId"] == "health-uid"
    assert connection["tokenObject"] == "obj/path"


def test_get_connection_missing_returns_none() -> None:
    repo = GoogleHealthConnectionRepository(db=_Db())
    assert repo.get_connection("nobody") is None


def test_list_active_user_ids_only_returns_active_google_health_connections() -> None:
    db = _Db()
    repo = GoogleHealthConnectionRepository(db=db)

    repo.save_connection("uid-active", health_user_id=None, granted_scopes=[], token_object="o1")
    repo.save_connection("uid-inactive", health_user_id=None, granted_scopes=[], token_object="o2")
    # Simulate a disconnect: flip status without going through save_connection's always-"active".
    db.collection("users").document("uid-inactive").collection("connections").document(
        "googleHealth"
    ).set({"status": "disconnected"}, merge=True)
    # A same-shaped connection under a different name must not be picked up.
    db.collection("users").document("uid-other-service").collection("connections").document(
        "somethingElse"
    ).set({"status": "active"}, merge=True)

    active_ids = repo.list_active_user_ids()

    assert active_ids == ["uid-active"]


def test_load_auth_manager_for_user_missing_connection_raises() -> None:
    repo = GoogleHealthConnectionRepository(db=_Db())
    with pytest.raises(GoogleHealthLinkError):
        repo.load_auth_manager_for_user(
            "nobody", client_id="cid", client_secret="secret", bucket_name="bucket"
        )


def test_load_auth_manager_for_user_builds_manager_from_stored_tokens(monkeypatch: Any) -> None:
    _FakeGcsTokenStore._blobs.clear()
    monkeypatch.setattr(link_module, "GcsTokenStore", _FakeGcsTokenStore)

    db = _Db()
    repo = GoogleHealthConnectionRepository(db=db)
    tokens = GoogleHealthLinkTokens(
        access_token="at",
        refresh_token="rt",
        token_type="Bearer",
        scopes=["a"],
        obtained_at="2026-08-27T00:00:00+00:00",
    )
    object_name = persist_tokens(bucket_name="bucket", uid="uid-1", tokens=tokens)
    repo.save_connection(
        "uid-1", health_user_id=None, granted_scopes=["a"], token_object=object_name
    )

    manager = repo.load_auth_manager_for_user(
        "uid-1", client_id="cid", client_secret="secret", bucket_name="bucket"
    )

    assert manager.credentials is not None
    assert manager.credentials.refresh_token == "rt"


def test_load_auth_manager_for_user_persists_rotated_refresh_token(monkeypatch: Any) -> None:
    """Regression test: Google doesn't rotate the refresh_token on every access-token
    refresh, but can. Without an on_refresh persistence hook, a linked user's stored token
    object would never see a rotation, and a later process restart would reload the stale
    refresh_token and eventually fail with invalid_grant. See
    docs/plans/2026-08-27-real-google-health-ingestion.md."""
    _FakeGcsTokenStore._blobs.clear()
    monkeypatch.setattr(link_module, "GcsTokenStore", _FakeGcsTokenStore)

    import garmin_sync.google_health_auth as auth_module

    class _FakeRefreshResponse:
        status_code = 200

        def json(self) -> dict[str, Any]:
            return {"access_token": "new-at", "expires_in": 3600, "refresh_token": "rotated-rt"}

    monkeypatch.setattr(auth_module.requests, "post", lambda *a, **k: _FakeRefreshResponse())

    db = _Db()
    repo = GoogleHealthConnectionRepository(db=db)
    tokens = GoogleHealthLinkTokens(
        access_token="at",
        refresh_token="original-rt",
        token_type="Bearer",
        scopes=["a"],
        obtained_at="2026-08-27T00:00:00+00:00",
    )
    object_name = persist_tokens(bucket_name="bucket", uid="uid-1", tokens=tokens)
    repo.save_connection(
        "uid-1", health_user_id=None, granted_scopes=["a"], token_object=object_name
    )

    manager = repo.load_auth_manager_for_user(
        "uid-1", client_id="cid", client_secret="secret", bucket_name="bucket"
    )
    manager.get_valid_access_token()  # expires_at=0.0 forces a refresh

    reloaded = load_tokens(bucket_name="bucket", object_name=object_name)
    assert reloaded is not None
    assert reloaded["refresh_token"] == "rotated-rt"
    assert reloaded["access_token"] == "new-at"
