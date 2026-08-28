import argparse
import hashlib
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from firebase_admin import auth as firebase_auth
from google.cloud import firestore as google_firestore

from .account_link import GarminConnectionRepository
from .firestore_repository import init_firestore_client

logger = logging.getLogger("garmin_sync.migrate_user_data")

# Operational state must never be replayed under the target account. A fresh manual sync
# request is queued after the copy instead.
_SKIPPED_TOP_LEVEL_COLLECTIONS = {"garmin_sync_requests", "garmin_workout_queue"}

# These collections are Garmin-owned. When the new Garmin-linked account already has the
# same document, preserve its current fields and use the legacy document only to fill fields
# that are absent. Missing historical documents are still copied in full.
_TARGET_WINS_TOP_LEVEL_COLLECTIONS = {"activities", "daily_recovery_snapshots"}

_BATCH_LIMIT = 400


class MigrationError(ValueError):
    """Raised when a one-off user-data migration cannot be performed safely."""


@dataclass(frozen=True)
class MigrationPlan:
    source_uid: str
    target_uid: str
    documents_seen: int
    collections_seen: int
    documents_with_existing_target: int


@dataclass(frozen=True)
class MigrationSummary:
    source_uid: str
    target_uid: str
    documents_copied: int
    collections_copied: int
    documents_with_existing_target: int
    sync_queued: bool


def _rewrite_uid(value: Any, source_uid: str, target_uid: str) -> Any:
    """Re-home embedded ownership/path references without changing unrelated strings."""
    if isinstance(value, str):
        if value == source_uid:
            return target_uid
        source_path = f"users/{source_uid}/"
        if source_path in value:
            return value.replace(source_path, f"users/{target_uid}/")
        return value
    if isinstance(value, dict):
        return {key: _rewrite_uid(child, source_uid, target_uid) for key, child in value.items()}
    if isinstance(value, list):
        return [_rewrite_uid(child, source_uid, target_uid) for child in value]
    if isinstance(value, tuple):
        return tuple(_rewrite_uid(child, source_uid, target_uid) for child in value)
    return value


class UserDataMigrator:
    """Non-destructively copy one Firebase user's Firestore tree into another Firebase user."""

    def __init__(self, db: Any = None):
        self.db = db or init_firestore_client()
        self.connection_repository = GarminConnectionRepository(db=self.db)

    def source_uid_for_email(self, source_email: str) -> str:
        email = source_email.strip()
        if not email:
            raise MigrationError("--source-email is required.")
        try:
            return str(firebase_auth.get_user_by_email(email).uid)
        except Exception as exc:
            raise MigrationError(
                "The legacy Firebase account could not be resolved by email."
            ) from exc

    def resolve_target_uid(self, source_uid: str, explicit_target_uid: str | None) -> str:
        if explicit_target_uid:
            target_uid = explicit_target_uid
        else:
            active = [
                uid
                for uid, _token_object in self.connection_repository.list_active_connections()
                if uid != source_uid
            ]
            if not active:
                raise MigrationError("No active Garmin-linked target account was found.")
            if len(active) > 1:
                raise MigrationError(
                    "More than one active Garmin-linked account exists; rerun with --target-uid."
                )
            target_uid = active[0]

        if target_uid == source_uid:
            raise MigrationError("Source and target resolve to the same Firebase user.")

        target_connection = self.db.collection("garminConnections").document(target_uid).get()
        target_data = target_connection.to_dict() if target_connection.exists else {}
        if not target_data or target_data.get("status") != "active":
            raise MigrationError("The target Firebase user is not actively linked to Garmin.")

        source_connection = self.db.collection("garminConnections").document(source_uid).get()
        source_data = source_connection.to_dict() if source_connection.exists else {}
        if source_data and source_data.get("status") == "active":
            raise MigrationError(
                "The legacy Firebase user is still actively linked to Garmin; refusing to duplicate ownership."
            )
        return target_uid

    @staticmethod
    def _merged_payload(
        source_payload: dict[str, Any],
        target_payload: dict[str, Any] | None,
        source_uid: str,
        target_uid: str,
        *,
        target_wins: bool,
    ) -> dict[str, Any]:
        rewritten = _rewrite_uid(source_payload, source_uid, target_uid)
        if not target_payload:
            return rewritten
        if target_wins:
            return {**rewritten, **target_payload}
        return {**target_payload, **rewritten}

    def _walk(
        self,
        source_parent: Any,
        target_parent: Any,
        source_uid: str,
        target_uid: str,
        *,
        top_level_collection: str | None,
        apply: bool,
        batch_state: dict[str, Any],
        collection_ids: set[str],
    ) -> tuple[int, int]:
        documents_seen = 0
        existing_targets = 0
        for source_collection in source_parent.collections():
            collection_id = str(source_collection.id)
            effective_top = top_level_collection or collection_id
            if top_level_collection is None and collection_id in _SKIPPED_TOP_LEVEL_COLLECTIONS:
                continue
            collection_ids.add(effective_top)
            target_collection = target_parent.collection(collection_id)

            for source_snapshot in source_collection.stream():
                documents_seen += 1
                target_ref = target_collection.document(source_snapshot.id)
                target_snapshot = target_ref.get()
                target_payload = target_snapshot.to_dict() if target_snapshot.exists else None
                if target_snapshot.exists:
                    existing_targets += 1

                source_payload = source_snapshot.to_dict() or {}
                payload = self._merged_payload(
                    source_payload,
                    target_payload,
                    source_uid,
                    target_uid,
                    target_wins=effective_top in _TARGET_WINS_TOP_LEVEL_COLLECTIONS,
                )
                if apply:
                    batch_state["batch"].set(target_ref, payload)
                    batch_state["ops"] += 1
                    if batch_state["ops"] >= _BATCH_LIMIT:
                        batch_state["batch"].commit()
                        batch_state["batch"] = self.db.batch()
                        batch_state["ops"] = 0

                nested_seen, nested_existing = self._walk(
                    source_snapshot.reference,
                    target_ref,
                    source_uid,
                    target_uid,
                    top_level_collection=effective_top,
                    apply=apply,
                    batch_state=batch_state,
                    collection_ids=collection_ids,
                )
                documents_seen += nested_seen
                existing_targets += nested_existing
        return documents_seen, existing_targets

    def migrate(
        self, source_uid: str, target_uid: str, *, apply: bool
    ) -> MigrationPlan | MigrationSummary:
        users = self.db.collection("users")
        source_user = users.document(source_uid)
        target_user = users.document(target_uid)
        source_root = source_user.get()
        target_root = target_user.get()

        collection_ids: set[str] = set()
        batch_state = {"batch": self.db.batch(), "ops": 0}
        documents_seen = 0
        existing_targets = 0

        if source_root.exists:
            documents_seen += 1
            target_payload = target_root.to_dict() if target_root.exists else None
            if target_root.exists:
                existing_targets += 1
            payload = self._merged_payload(
                source_root.to_dict() or {},
                target_payload,
                source_uid,
                target_uid,
                target_wins=False,
            )
            if apply:
                batch_state["batch"].set(target_user, payload)
                batch_state["ops"] += 1

        nested_seen, nested_existing = self._walk(
            source_user,
            target_user,
            source_uid,
            target_uid,
            top_level_collection=None,
            apply=apply,
            batch_state=batch_state,
            collection_ids=collection_ids,
        )
        documents_seen += nested_seen
        existing_targets += nested_existing

        if documents_seen == 0:
            raise MigrationError("The legacy account has no Firestore user data to migrate.")

        if not apply:
            return MigrationPlan(
                source_uid=source_uid,
                target_uid=target_uid,
                documents_seen=documents_seen,
                collections_seen=len(collection_ids),
                documents_with_existing_target=existing_targets,
            )

        if batch_state["ops"]:
            batch_state["batch"].commit()

        now_iso = datetime.now(timezone.utc).isoformat()
        target_user.collection("garmin_sync_requests").document("latest").set(
            {
                "userId": target_uid,
                "status": "pending",
                "requestedAt": now_iso,
                "completedAt": None,
                "error": None,
            }
        )

        audit_id = hashlib.sha256(f"{source_uid}:{target_uid}".encode("utf-8")).hexdigest()
        self.db.collection("userDataMigrations").document(audit_id).set(
            {
                "sourceUserId": source_uid,
                "targetUserId": target_uid,
                "documentsCopied": documents_seen,
                "collectionsCopied": len(collection_ids),
                "documentsWithExistingTarget": existing_targets,
                "sourceDeleted": False,
                "completedAt": google_firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

        return MigrationSummary(
            source_uid=source_uid,
            target_uid=target_uid,
            documents_copied=documents_seen,
            collections_copied=len(collection_ids),
            documents_with_existing_target=existing_targets,
            sync_queued=True,
        )


def _redact(uid: str) -> str:
    return f"{uid[:4]}...{uid[-4:]}" if len(uid) > 10 else "<uid>"


def main(args: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="One-off non-destructive migration of a legacy Firebase user's Firestore tree."
    )
    parser.add_argument("--source-email", required=True, help="Legacy Firebase Auth email")
    parser.add_argument(
        "--target-uid",
        default=None,
        help="Garmin-linked Firebase UID; omit only when exactly one active Garmin-linked user exists",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform writes. Without this flag the command is a dry-run only.",
    )
    parsed = parser.parse_args(args)

    try:
        migrator = UserDataMigrator()
        source_uid = migrator.source_uid_for_email(parsed.source_email)
        target_uid = migrator.resolve_target_uid(source_uid, parsed.target_uid)
        result = migrator.migrate(source_uid, target_uid, apply=parsed.apply)

        if isinstance(result, MigrationPlan):
            print(
                "DRY RUN: "
                f"source={_redact(result.source_uid)} target={_redact(result.target_uid)} "
                f"documents={result.documents_seen} collections={result.collections_seen} "
                f"existing_target_docs={result.documents_with_existing_target}. "
                "No writes were made. Re-run with --apply after reviewing this plan."
            )
        else:
            print(
                "MIGRATION COMPLETE: "
                f"source={_redact(result.source_uid)} target={_redact(result.target_uid)} "
                f"documents={result.documents_copied} collections={result.collections_copied} "
                f"existing_target_docs={result.documents_with_existing_target} "
                f"sync_queued={result.sync_queued}. Source data was not deleted."
            )
        return 0
    except Exception as exc:
        logger.error("User-data migration failed: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
