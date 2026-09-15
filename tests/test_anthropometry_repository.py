from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

import garmin_sync.anthropometry_repository as repository_module
from garmin_sync.anthropometry_repository import (
    AnthropometryEntryRepository,
    EntryAlreadyExistsError,
    EntryNotFoundError,
    RevisionConflictError,
    StoredEntryIntegrityError,
)


@dataclass
class FakeSnapshot:
    exists: bool
    data: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any] | None:
        return self.data


@dataclass
class FakeTransaction:
    set_calls: list[tuple["FakeDocument", dict[str, Any]]] = field(default_factory=list)

    def set(self, document: "FakeDocument", payload: dict[str, Any]) -> None:
        self.set_calls.append((document, payload))


class FakeDocument:
    def __init__(self, client: "FakeClient", path: tuple[str, ...]) -> None:
        self._client = client
        self.path = path
        self.get_transactions: list[FakeTransaction] = []
        self.deleted = False

    def collection(self, name: str) -> "FakeDocument":
        return FakeDocument(self._client, (*self.path, name))

    def document(self, name: str) -> "FakeDocument":
        document = FakeDocument(self._client, (*self.path, name))
        self._client.last_document = document
        return document

    def get(self, *, transaction: FakeTransaction) -> FakeSnapshot:
        self.get_transactions.append(transaction)
        return self._client.snapshot

    def delete(self) -> None:
        self.deleted = True


class FakeClient:
    def __init__(self, snapshot: FakeSnapshot) -> None:
        self.snapshot = snapshot
        self.transaction_value = FakeTransaction()
        self.last_document: FakeDocument | None = None

    def collection(self, name: str) -> FakeDocument:
        return FakeDocument(self, (name,))

    def transaction(self) -> FakeTransaction:
        return self.transaction_value


@pytest.fixture(autouse=True)
def no_firestore_decorator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(repository_module.firestore, "transactional", lambda function: function)


def entry(*, revision: int = 1) -> dict[str, Any]:
    return {
        "id": "entry-1",
        "userId": "athlete-1",
        "revision": revision,
        "createdAt": "2026-09-14T06:00:00.000Z",
        "updatedAt": "2026-09-15T06:00:00.000Z",
    }


def test_create_uses_the_verified_owner_path_and_transactional_precondition() -> None:
    client = FakeClient(FakeSnapshot(exists=False))
    repository = AnthropometryEntryRepository(client)
    payload = entry()

    assert repository.create(payload) == payload
    document = client.last_document
    assert document is not None
    assert document.path == ("users", "athlete-1", "anthropometry_entries", "entry-1")
    assert document.get_transactions == [client.transaction_value]
    assert client.transaction_value.set_calls == [(document, payload)]


def test_create_rejects_an_existing_entry_without_overwriting_it() -> None:
    client = FakeClient(FakeSnapshot(exists=True, data=entry()))

    with pytest.raises(EntryAlreadyExistsError):
        AnthropometryEntryRepository(client).create(entry())

    assert client.transaction_value.set_calls == []


def test_correct_requires_exactly_next_revision_and_preserves_trusted_created_at() -> None:
    client = FakeClient(
        FakeSnapshot(
            exists=True,
            data={"revision": 3, "createdAt": "2026-09-01T06:00:00.000Z"},
        )
    )
    payload = entry(revision=4)
    payload["createdAt"] = "untrusted-client-timestamp"

    persisted = AnthropometryEntryRepository(client).correct(payload)

    assert persisted["createdAt"] == "2026-09-01T06:00:00.000Z"
    assert persisted["updatedAt"] == "2026-09-15T06:00:00.000Z"
    assert client.transaction_value.set_calls == [(client.last_document, persisted)]


def test_correct_rejects_missing_stale_and_malformed_existing_documents() -> None:
    missing = AnthropometryEntryRepository(FakeClient(FakeSnapshot(exists=False)))
    with pytest.raises(EntryNotFoundError):
        missing.correct(entry(revision=2))

    stale = AnthropometryEntryRepository(
        FakeClient(FakeSnapshot(exists=True, data={"revision": 2, "createdAt": "created"}))
    )
    with pytest.raises(RevisionConflictError):
        stale.correct(entry(revision=2))

    malformed = AnthropometryEntryRepository(
        FakeClient(FakeSnapshot(exists=True, data={"revision": "2", "createdAt": None}))
    )
    with pytest.raises(StoredEntryIntegrityError):
        malformed.correct(entry(revision=3))


def test_delete_targets_only_the_verified_owner_entry_path() -> None:
    client = FakeClient(FakeSnapshot(exists=False))
    repository = AnthropometryEntryRepository(client)

    repository.delete("entry-1", "athlete-1")

    document = client.last_document
    assert document is not None
    assert document.path == ("users", "athlete-1", "anthropometry_entries", "entry-1")
    assert document.deleted is True
