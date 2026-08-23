from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore as google_firestore

from .firestore_repository import init_firestore_client


class UserDataMigrationError(ValueError):
    """Raised when a legacy-account migration cannot be performed safely."""


class UserDataMigrationConflictError(UserDataMigrationError):
    """Raised when Garmin ownership makes a migration ambiguous or unsafe."""


@dataclass(frozen=True)
class UserDataMigrationSummary:
    documents_copied: int
    collections_copied: int
    sync_queued: bool


# A manual sync request is transient coordination state rather than user history. Copying a
# stale pending/processing request from the legacy account can create a request the target
# poller cannot honestly finish. The migration creates a fresh target request after the data
# copy instead.
_SKIPPED_TOP_LEVEL_COLLECTIONS = {"garmin_sync_requests"}
_OWNER_FIELD_NAMES = {"userId", "user_id", "uid"}


def _rewrite_owner_ids(value: Any, source_uid: str, target_uid: str) -> Any:
    """Rewrite embedded ownership fields while preserving all other payload values."""
    if isinstance(value, dict):
        rewritten: dict[str, Any] = {}
        for key, child in value.items():
            if key in _OWNER_FIELD_NAMES and child == source_uid:
                rewritten[key] = target_uid
            else:
                rewritten[key] = _rewrite_owner_ids(child, source_uid, target_uid)
        return rewritten
    if isinstance(value, list):
        return [_rewrite_owner_ids(item, source_uid, target_uid) for item in value]
    if isinstance(value, tuple):
        return tuple(_rewrite_owner_ids(item, source_uid, target_uid) for item in value)
    return value


class UserDataMigrationService:
    """Copy one authenticated user's complete Firestore user tree into another account.

    The source tree is never deleted. Writes use merge=True so target-only fields survive,
    while source fields with the same name become canonical. This is intentional for the
    legacy-account recovery case: the old account contains the established preferences,
    subjective history and historical snapshots, while the new Garmin-linked account is
    typically almost empty. Garmin identity/token mappings are top-level server collections
    and are never traversed by this service.
    """

    def __init__(self, db: Any = None):
        self.db = db or init_firestore_client()

    def _connection(self, uid: str) -> dict[str, Any]:
        snapshot = self.db.collection("garminConnections").document(uid).get()
        if not snapshot.exists:
            return {}
        return snapshot.to_dict() or {}

    def _assert_safe_direction(self, source_uid: str, target_uid: str) -> None:
        if not source_uid or not target_uid:
            raise UserDataMigrationError("Both source and target user identities are required.")
        if source_uid == target_uid:
            raise UserDataMigrationError("The legacy account and current account are the same user.")

        source_connection = self._connection(source_uid)
        if source_connection.get("status") == "active":
            raise UserDataMigrationConflictError(
                "The legacy account is still linked to Garmin. Migration is blocked to avoid "
                "splitting an active Garmin identity across two app accounts."
            )

        target_connection = self._connection(target_uid)
        if target_connection.get("status") != "active":
            raise UserDataMigrationConflictError(
                "The current account is not linked to Garmin. Sign in with the Garmin-linked "
                "account before importing legacy data."
            )

    def _copy_subcollections(
        self,
        source_parent: Any,
        target_parent: Any,
        source_uid: str,
        target_uid: str,
        *,
        depth: int,
        collection_ids: set[str],
    ) -> int:
        copied = 0
        for source_collection in source_parent.collections():
            if depth == 0 and source_collection.id in _SKIPPED_TOP_LEVEL_COLLECTIONS:
                continue
            collection_ids.add(source_collection.id)
            target_collection = target_parent.collection(source_collection.id)
            for source_snapshot in source_collection.stream():
                target_document = target_collection.document(source_snapshot.id)
                payload = _rewrite_owner_ids(
                    source_snapshot.to_dict() or {},
                    source_uid,
                    target_uid,
                )
                target_document.set(payload, merge=True)
                copied += 1
                copied += self._copy_subcollections(
                    source_snapshot.reference,
                    target_document,
                    source_uid,
                    target_uid,
                    depth=depth + 1,
                    collection_ids=collection_ids,
                )
        return copied

    def migrate(self, source_uid: str, target_uid: str) -> UserDataMigrationSummary:
        self._assert_safe_direction(source_uid, target_uid)

        users = self.db.collection("users")
        source_user = users.document(source_uid)
        target_user = users.document(target_uid)
        documents_copied = 0
        collection_ids: set[str] = set()

        source_snapshot = source_user.get()
        if source_snapshot.exists:
            target_user.set(
                _rewrite_owner_ids(source_snapshot.to_dict() or {}, source_uid, target_uid),
                merge=True,
            )
            documents_copied += 1

        documents_copied += self._copy_subcollections(
            source_user,
            target_user,
            source_uid,
            target_uid,
            depth=0,
            collection_ids=collection_ids,
        )

        if documents_copied == 0:
            raise UserDataMigrationError("The legacy account has no Firestore data to import.")

        requested_at = datetime.now(timezone.utc).isoformat()
        target_user.collection("garmin_sync_requests").document("latest").set(
            {
                "userId": target_uid,
                "status": "pending",
                "requestedAt": requested_at,
                "completedAt": None,
                "error": None,
            }
        )

        migration_id = hashlib.sha256(f"{source_uid}:{target_uid}".encode("utf-8")).hexdigest()
        self.db.collection("userDataMigrations").document(migration_id).set(
            {
                "sourceUserId": source_uid,
                "targetUserId": target_uid,
                "documentsCopied": documents_copied,
                "collectionsCopied": len(collection_ids),
                "sourceDeleted": False,
                "completedAt": google_firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

        return UserDataMigrationSummary(
            documents_copied=documents_copied,
            collections_copied=len(collection_ids),
            sync_queued=True,
        )
