import logging
import os
from datetime import datetime, timezone
from typing import Any
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger(__name__)


def init_firestore_client(credentials_path: str | None = None) -> Any:
    """Initialize Firebase Admin SDK and return Firestore client."""
    if not firebase_admin._apps:
        if credentials_path and os.path.exists(credentials_path):
            logger.info(f"Initializing Firebase Admin with service account from '{credentials_path}'...")
            cred = credentials.Certificate(credentials_path)
            firebase_admin.initialize_app(cred)
        else:
            logger.info("Initializing Firebase Admin with Application Default Credentials (ADC)...")
            firebase_admin.initialize_app()
    return firestore.client()


class FirestoreRecoveryRepository:
    """Repository managing user-scoped Firestore operations for daily recovery snapshots."""

    def __init__(
        self,
        user_id: str,
        collection_name: str = "daily_recovery_snapshots",
        db: Any = None,
        credentials_path: str | None = None,
    ):
        if not user_id or user_id.strip() == "default_user":
            raise ValueError(
                "FirestoreRecoveryRepository requires a valid non-default user_id (Firebase UID)."
            )
        self.user_id = user_id.strip()
        self.collection_name = collection_name
        self.db = db
        self.credentials_path = credentials_path

    def _get_db(self) -> Any:
        if self.db is None:
            self.db = init_firestore_client(self.credentials_path)
        return self.db

    def _get_doc_ref(self, date_iso: str) -> Any:
        db = self._get_db()
        return (
            db.collection("users")
            .document(self.user_id)
            .collection(self.collection_name)
            .document(date_iso)
        )

    def get_snapshot(self, date_iso: str) -> dict[str, Any] | None:
        """Fetch recovery snapshot for target date."""
        try:
            doc_snap = self._get_doc_ref(date_iso).get()
            if doc_snap.exists:
                data = doc_snap.to_dict()
                if data.get("userId") != self.user_id:
                    raise ValueError(
                        f"Document userId '{data.get('userId')}' does not match repository user_id '{self.user_id}'"
                    )
                return data
            return None
        except Exception as e:
            logger.warning(f"Error reading Firestore snapshot for user {self.user_id} date {date_iso}: {e}")
            return None

    def is_fresh(self, date_iso: str, staleness_minutes: int = 60) -> bool:
        """Check if today's snapshot was synced within staleness threshold."""
        snapshot = self.get_snapshot(date_iso)
        if not snapshot:
            return False

        synced_at_str = snapshot.get("source", {}).get("garminSyncedAt") or snapshot.get("updatedAt")
        if not synced_at_str:
            return False

        try:
            synced_at = datetime.fromisoformat(synced_at_str)
            if synced_at.tzinfo is None:
                synced_at = synced_at.replace(tzinfo=timezone.utc)
            now_utc = datetime.now(timezone.utc)
            age_minutes = (now_utc - synced_at).total_seconds() / 60.0
            return age_minutes < staleness_minutes
        except Exception as e:
            logger.warning(f"Failed to parse synced_at timestamp '{synced_at_str}': {e}")
            return False

    def upsert_snapshot(self, date_iso: str, payload: dict[str, Any]) -> None:
        """Upsert user-scoped recovery snapshot document."""
        if payload.get("userId") != self.user_id:
            raise ValueError(
                f"Payload userId '{payload.get('userId')}' does not match configured user_id '{self.user_id}'"
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        doc_ref = self._get_doc_ref(date_iso)
        doc_snap = doc_ref.get()

        if not doc_snap.exists:
            payload["createdAt"] = payload.get("createdAt") or now_iso

        payload["updatedAt"] = now_iso

        doc_ref.set(payload, merge=True)
        logger.info(f"Successfully saved user-scoped snapshot users/{self.user_id}/{self.collection_name}/{date_iso}.")

    def get_historical_snapshots(self, start_date_iso: str, end_date_iso: str) -> dict[str, dict[str, Any]]:
        """Fetch historical snapshots in range [start_date_iso, end_date_iso]."""
        db = self._get_db()
        docs = (
            db.collection("users")
            .document(self.user_id)
            .collection(self.collection_name)
            .where(filter=FieldFilter("date", ">=", start_date_iso))
            .where(filter=FieldFilter("date", "<=", end_date_iso))
            .stream()
        )

        results: dict[str, dict[str, Any]] = {}
        for doc in docs:
            data = doc.to_dict()
            date_key = data.get("date") or doc.id
            results[date_key] = data
        return results
