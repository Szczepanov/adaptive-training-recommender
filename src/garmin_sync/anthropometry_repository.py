"""Transactional Firestore persistence for server-authoritative anthropometry writes."""

from typing import Any

from firebase_admin import firestore


class EntryAlreadyExistsError(RuntimeError):
    """The client attempted to create an existing entry id."""


class EntryNotFoundError(RuntimeError):
    """The client attempted to correct an entry that no longer exists."""


class RevisionConflictError(RuntimeError):
    """The correction was based on a stale entry revision."""


class StoredEntryIntegrityError(RuntimeError):
    """An old persisted row cannot safely participate in a server-side correction."""


class AnthropometryEntryRepository:
    """Owns atomic changes under ``users/{uid}/anthropometry_entries``."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def _document(self, user_id: str, entry_id: str) -> Any:
        return (
            self._client.collection("users")
            .document(user_id)
            .collection("anthropometry_entries")
            .document(entry_id)
        )

    def create(self, entry: dict[str, Any]) -> dict[str, Any]:
        document = self._document(str(entry["userId"]), str(entry["id"]))

        @firestore.transactional
        def create_in_transaction(transaction: Any) -> dict[str, Any]:
            if document.get(transaction=transaction).exists:
                raise EntryAlreadyExistsError()
            transaction.set(document, entry)
            return entry

        return create_in_transaction(self._client.transaction())

    def correct(self, entry: dict[str, Any]) -> dict[str, Any]:
        document = self._document(str(entry["userId"]), str(entry["id"]))

        @firestore.transactional
        def correct_in_transaction(transaction: Any) -> dict[str, Any]:
            snapshot = document.get(transaction=transaction)
            if not snapshot.exists:
                raise EntryNotFoundError()
            existing = snapshot.to_dict() or {}
            current_revision = existing.get("revision")
            created_at = existing.get("createdAt")
            if (
                not isinstance(current_revision, int)
                or isinstance(current_revision, bool)
                or current_revision < 1
                or not isinstance(created_at, str)
            ):
                raise StoredEntryIntegrityError()
            if entry["revision"] != current_revision + 1:
                raise RevisionConflictError()
            persisted = {**entry, "createdAt": created_at}
            transaction.set(document, persisted)
            return persisted

        return correct_in_transaction(self._client.transaction())

    def delete(self, entry_id: str, user_id: str) -> None:
        self._document(user_id, entry_id).delete()
