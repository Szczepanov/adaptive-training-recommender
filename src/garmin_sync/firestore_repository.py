import logging
import os
from datetime import datetime, timezone
from typing import Any, cast

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger(__name__)


def init_firestore_client(credentials_path: str | None = None) -> Any:
    """Initialize Firebase Admin SDK and return Firestore client."""
    if not firebase_admin._apps:
        if credentials_path and os.path.exists(credentials_path):
            logger.info(
                f"Initializing Firebase Admin with service account from '{credentials_path}'..."
            )
            cred = credentials.Certificate(credentials_path)
            firebase_admin.initialize_app(cred)
        else:
            logger.info("Initializing Firebase Admin with Application Default Credentials (ADC)...")
            firebase_admin.initialize_app()
    return firestore.client()


def is_snapshot_complete(snapshot: dict[str, Any]) -> bool:
    """Return True if the snapshot contains all core recovery metrics:
    sleep (score or duration), resting HR, HRV overnight avg, respiration avg,
    body battery at wake, and total steps (D-1 completed)."""
    raw = snapshot.get("raw", {})
    if not isinstance(raw, dict):
        return False

    has_sleep = raw.get("sleepScore") is not None or raw.get("sleepDurationSec") is not None
    has_rhr = raw.get("restingHr") is not None
    has_hrv = raw.get("hrvOvernightAvg") is not None
    has_resp = raw.get("respirationAvg") is not None
    has_bb = raw.get("bodyBatteryWake") is not None
    has_steps = raw.get("totalSteps") is not None

    return bool(has_sleep and has_rhr and has_hrv and has_resp and has_bb and has_steps)


class FirestoreRecoveryRepository:
    """Repository managing user-scoped Firestore operations for daily recovery snapshots."""

    def __init__(
        self,
        user_id: str,
        collection_name: str = "daily_recovery_snapshots",
        db: Any = None,
        credentials_path: str | None = None,
    ):
        if not user_id or not user_id.strip() or user_id.strip() == "default_user":
            raise ValueError(
                "FirestoreRecoveryRepository requires a valid non-default user_id (Firebase UID)."
            )
        # Firebase Auth UIDs are identifiers, not free-form display text. Preserve the
        # exact value supplied by Auth instead of normalizing it: stripping would make
        # distinct legal UIDs share Firestore/token/archive scopes.
        self.user_id = user_id
        self.collection_name = collection_name
        self._db = db
        self.credentials_path = credentials_path

    @property
    def db(self) -> Any:
        return self._get_db()

    @db.setter
    def db(self, value: Any) -> None:
        self._db = value

    def _get_db(self) -> Any:
        if self._db is None:
            self._db = init_firestore_client(self.credentials_path)
        return self._db

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
            logger.warning(
                f"Error reading Firestore snapshot for user {self.user_id} date {date_iso}: {e}"
            )
            return None

    def is_fresh(
        self,
        date_iso: str,
        staleness_minutes: int = 60,
        incomplete_staleness_minutes: int = 5,
        require_complete: bool = True,
    ) -> bool:
        """Check if date's snapshot was synced within staleness threshold.

        If require_complete is True and the snapshot is missing any core recovery metric
        (sleep, resting HR, HRV, respiration, body battery wake, steps), it is considered
        incomplete and only remains fresh for incomplete_staleness_minutes (a short rate-limit
        cooldown). Once complete, it respects staleness_minutes.
        """
        snapshot = self.get_snapshot(date_iso)
        if not snapshot:
            return False

        synced_at_str = snapshot.get("source", {}).get("garminSyncedAt") or snapshot.get(
            "updatedAt"
        )
        if not synced_at_str:
            return False

        try:
            synced_at = datetime.fromisoformat(synced_at_str)
            if synced_at.tzinfo is None:
                synced_at = synced_at.replace(tzinfo=timezone.utc)
            now_utc = datetime.now(timezone.utc)
            age_minutes = (now_utc - synced_at).total_seconds() / 60.0

            if require_complete and not is_snapshot_complete(snapshot):
                return age_minutes < incomplete_staleness_minutes

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
        logger.info(
            f"Successfully saved user-scoped snapshot users/{self.user_id}/{self.collection_name}/{date_iso}."
        )

    def get_historical_snapshots(
        self, start_date_iso: str, end_date_iso: str
    ) -> dict[str, dict[str, Any]]:
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

    def upsert_activity(self, activity_id: str | int, payload: dict[str, Any]) -> None:
        """Upsert a normalized activity record at users/{userId}/activities/{activityId}.
        Doc ID = activityId, so re-fetching the same activity across overlapping sync
        windows (e.g. daily 3-day lookback, backfill) naturally dedups instead of
        creating duplicate records."""
        db = self._get_db()
        doc_ref = (
            db.collection("users")
            .document(self.user_id)
            .collection("activities")
            .document(str(activity_id))
        )
        doc_ref.set(payload, merge=True)

    def upsert_activities(self, activities: list[tuple[str | int, dict[str, Any]]]) -> None:
        """Batch upsert normalized activity records.
        Handles Firestore's 500 document limit per batch automatically."""
        if not activities:
            return

        db = self._get_db()
        collection_ref = db.collection("users").document(self.user_id).collection("activities")

        # Firestore batches are limited to 500 operations
        batch_size = 500
        for i in range(0, len(activities), batch_size):
            chunk = activities[i : i + batch_size]
            batch = db.batch()
            for activity_id, payload in chunk:
                doc_ref = collection_ref.document(str(activity_id))
                batch.set(doc_ref, payload, merge=True)
            batch.commit()

    def upsert_garmin_performance_targets(self, targets: Any) -> None:
        """Merge Garmin's current targets into the user's preference profile.

        Active targets are intentionally field-level owned: importing a new Garmin
        value never replaces a target the coach/user marked ``manual``. Existing
        target values without provenance predate this feature and are conservatively
        treated as manual on their first import.
        """
        db = self._get_db()
        doc_ref = (
            db.collection("users")
            .document(self.user_id)
            .collection("preferences")
            .document("profile")
        )
        now_iso = datetime.now(timezone.utc).isoformat()
        incoming = {
            "ftpWatts": targets.cycling_ftp_watts,
            "thresholdPaceSecPerKm": targets.running_threshold_pace_sec_per_km,
            "lthrBpm": targets.running_lthr_bpm,
        }
        measured_at = {
            "ftpMeasuredAt": targets.ftp_measured_at,
            "thresholdMeasuredAt": targets.threshold_measured_at,
            "lthrMeasuredAt": targets.lthr_measured_at,
        }

        @firestore.transactional
        def merge_targets(transaction: Any) -> None:
            snapshot = doc_ref.get(transaction=transaction)
            existing: dict[str, Any] = cast(
                dict[str, Any], snapshot.to_dict() if snapshot.exists else {}
            )
            raw_profile = existing.get("performanceProfile")
            profile: dict[str, Any] = (
                cast(dict[str, Any], raw_profile) if isinstance(raw_profile, dict) else {}
            )
            raw_sources = profile.get("targetSources")
            sources: dict[str, Any] = (
                cast(dict[str, Any], raw_sources) if isinstance(raw_sources, dict) else {}
            )

            raw_garmin = profile.get("garmin")
            garmin: dict[str, Any] = (
                cast(dict[str, Any], raw_garmin) if isinstance(raw_garmin, dict) else {}
            )
            # A partial Garmin response must not erase a previously successful import
            # for another target (for example, cycling FTP can be available while
            # running lactate threshold is not configured on the account).
            garmin.update({key: value for key, value in incoming.items() if value is not None})
            garmin.update({key: value for key, value in measured_at.items() if value is not None})
            garmin["fetchedAt"] = now_iso
            profile["garmin"] = garmin

            for key, value in incoming.items():
                if value is None:
                    continue
                source = sources.get(key)
                existing_value = profile.get(key)
                if source == "manual":
                    continue
                if source == "garmin" or existing_value is None:
                    profile[key] = value
                    sources[key] = "garmin"
                else:
                    # Old documents have active values but no ownership metadata. The
                    # safe migration is manual; an explicit UI action can adopt Garmin.
                    sources[key] = "manual"

            if sources:
                profile["targetSources"] = sources

            payload: dict[str, Any] = {
                "userId": self.user_id,
                "performanceProfile": profile,
                "updatedAt": now_iso,
            }
            # A scheduled Garmin sync can run before the client has opened the app and
            # created preferences. Do not leave that first-run document partial: the
            # frontend treats an existing preferences record as complete.
            if not snapshot.exists:
                payload.update(
                    {
                        "preferredRecoveryStyle": "mixed",
                        "defaultWeekdayTimeMin": 45,
                        "defaultWeekendTimeMin": 60,
                        "preferredTimeOfDay": "flexible",
                        "preferredModalities": ["Running", "Cycling", "Strength"],
                        "deprioritizedModalities": [],
                        "avoidedModalities": [],
                        "explanationVerbosity": "detailed",
                        "conservativeBias": False,
                        "preferredUnits": {
                            "distance": "km",
                            "weight": "kg",
                            "temperature": "celsius",
                        },
                        "schemaVersion": 1,
                        "createdAt": now_iso,
                    }
                )
            transaction.set(doc_ref, payload, merge=True)

        merge_targets(db.transaction())
        logger.info(
            "Updated Garmin performance targets in user-scoped preferences for user=<UID-redacted>."
        )

    def count_activities_in_range(self, start_date_iso: str, end_date_iso: str) -> int:
        """Count normalized activity records with date in [start_date_iso, end_date_iso]."""
        db = self._get_db()
        query = (
            db.collection("users")
            .document(self.user_id)
            .collection("activities")
            .where(filter=FieldFilter("date", ">=", start_date_iso))
            .where(filter=FieldFilter("date", "<=", end_date_iso))
        )
        try:
            agg = query.count()
            result = agg.get()
            return int(result[0][0].value)
        except Exception:
            # Firestore aggregation queries may be unavailable in older emulators/mocks --
            # fall back to a client-side count.
            return sum(1 for _ in query.stream())
