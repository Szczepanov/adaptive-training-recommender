from __future__ import annotations

from datetime import datetime, timezone
from http import HTTPStatus
from typing import Any

import pytest

import garmin_sync.account_link_api as account_link_api
import garmin_sync.connection_status as connection_status


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

    def collection(self, name: str) -> _Collection:
        return self._collections.setdefault(name, _Collection())


class _Collection:
    def __init__(self) -> None:
        self._documents: dict[str, _Document] = {}

    def document(self, doc_id: str) -> _Document:
        return self._documents.setdefault(doc_id, _Document())


class _Transaction:
    def set(self, doc_ref: _Document, payload: dict[str, Any], merge: bool = False) -> None:
        if merge:
            doc_ref.data = {**(doc_ref.data or {}), **payload}
        else:
            doc_ref.data = dict(payload)

    def delete(self, doc_ref: _Document) -> None:
        doc_ref.data = None


class _Db:
    def __init__(self) -> None:
        self._collections: dict[str, _Collection] = {}

    def collection(self, name: str) -> _Collection:
        return self._collections.setdefault(name, _Collection())

    def transaction(self) -> _Transaction:
        return _Transaction()


def _mirror(db: _Db, uid: str) -> _Document:
    return db.collection("users").document(uid).collection("connections").document("garmin")


def test_reconcile_backfills_only_non_secret_active_status(monkeypatch: Any) -> None:
    monkeypatch.setattr(connection_status.google_firestore, "transactional", lambda fn: fn)
    db = _Db()
    linked_at = datetime(2026, 8, 1, 12, 30, tzinfo=timezone.utc)
    db.collection("garminConnections").document("uid-1").data = {
        "userId": "uid-1",
        "status": "active",
        "identityKind": "garmin_guid",
        "identityDigest": "secret-identity-digest",
        "tokenObject": "garmin/users/uid-1/private-token.json",
        "linkedAt": linked_at,
    }

    result = connection_status.reconcile_garmin_connection_status("uid-1", db=db)

    assert result == {"status": "active", "linkedAt": linked_at.isoformat()}
    mirror = _mirror(db, "uid-1").data
    assert mirror is not None
    assert mirror["status"] == "active"
    assert mirror["identityKind"] == "garmin_guid"
    assert mirror["linkedAt"] == linked_at
    assert "updatedAt" in mirror
    assert "tokenObject" not in mirror
    assert "identityDigest" not in mirror


def test_reconcile_deletes_stale_mirror_when_canonical_is_not_active(monkeypatch: Any) -> None:
    monkeypatch.setattr(connection_status.google_firestore, "transactional", lambda fn: fn)
    db = _Db()
    _mirror(db, "uid-1").data = {"status": "active"}

    result = connection_status.reconcile_garmin_connection_status("uid-1", db=db)

    assert result == {"status": "disconnected", "linkedAt": None}
    assert _mirror(db, "uid-1").data is None


def test_status_handler_requires_authenticated_app_user(monkeypatch: Any) -> None:
    handler = account_link_api.GarminAccountLinkHandler.__new__(
        account_link_api.GarminAccountLinkHandler
    )
    handler.headers = {}  # type: ignore[assignment]
    monkeypatch.setattr(account_link_api, "_verified_uid", lambda _authorization: None)

    with pytest.raises(account_link_api.GarminConnectAuthenticationError, match="required"):
        handler._handle_status()  # noqa: SLF001 - endpoint contract regression


def test_status_handler_returns_reconciled_status(monkeypatch: Any) -> None:
    handler = account_link_api.GarminAccountLinkHandler.__new__(
        account_link_api.GarminAccountLinkHandler
    )
    handler.headers = {"Authorization": "Bearer app-token"}  # type: ignore[assignment]
    captured: list[tuple[HTTPStatus, dict[str, Any]]] = []
    handler._json_response = lambda status, payload: captured.append(  # type: ignore[method-assign]
        (status, payload)
    )

    monkeypatch.setattr(account_link_api, "_verified_uid", lambda _authorization: "uid-1")
    monkeypatch.setattr(
        account_link_api,
        "reconcile_garmin_connection_status",
        lambda uid: (
            {"status": "active", "linkedAt": "2026-08-01T12:30:00+00:00"}
            if uid == "uid-1"
            else {"status": "disconnected", "linkedAt": None}
        ),
    )

    handler._handle_status()  # noqa: SLF001 - endpoint contract regression

    assert captured == [
        (HTTPStatus.OK, {"status": "active", "linkedAt": "2026-08-01T12:30:00+00:00"})
    ]


def test_linked_at_json_returns_none_for_invalid_value() -> None:
    assert connection_status._linked_at_json("not-a-datetime") is None


def test_reconcile_garmin_connection_status_requires_uid() -> None:
    with pytest.raises(ValueError, match="uid is required"):
        connection_status.reconcile_garmin_connection_status("")


def test_reconcile_handles_missing_identity_kind_and_linked_at(monkeypatch: Any) -> None:
    monkeypatch.setattr(connection_status.google_firestore, "transactional", lambda fn: fn)
    db = _Db()
    db.collection("garminConnections").document("uid-1").data = {
        "userId": "uid-1",
        "status": "active",
    }

    result = connection_status.reconcile_garmin_connection_status("uid-1", db=db)

    assert result == {"status": "active", "linkedAt": None}
    mirror = _mirror(db, "uid-1").data
    assert mirror is not None
    assert mirror["status"] == "active"
    assert "identityKind" not in mirror
    assert mirror["linkedAt"] == connection_status.google_firestore.SERVER_TIMESTAMP
    assert "updatedAt" in mirror
