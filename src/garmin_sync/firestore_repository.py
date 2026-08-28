import logging
import os
from datetime import datetime, timezone
from typing import Any, Mapping, cast

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.exceptions import Conflict
from google.cloud.firestore_v1.base_query import FieldFilter

from .identity_eligibility import (
    EffectiveIdentityDecisionProjection,
    IdentityBundleKey,
    build_effective_identity_decision_index,
    validate_automatic_identity_assessment,
    validate_identity_passport_current,
    validate_identity_passport_version,
    validate_identity_review_event,
)

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

    def patch_snapshot_fields(self, date_iso: str, field_updates: dict[str, Any]) -> bool:
        """Patches an existing snapshot document via explicit dotted field paths (e.g.
        `{"raw.sleepStartTimeGmt": "..."}`), touching only those exact fields.

        Deliberately `update()`, not `upsert_snapshot`'s `set(..., merge=True)`: `update()` with
        dotted-path keys is Firestore's unambiguous mechanism for patching one nested field without
        touching siblings, whereas `set(merge=True)`'s nested-map merge semantics are easy to get
        wrong for a targeted single-field patch on a document holding many other fields (like
        `raw`, which also carries restingHr/hrvOvernightAvg/sleepScore/etc. that must not be
        touched). Returns False (no-op) if the document doesn't exist -- this never creates one.
        """
        doc_ref = self._get_doc_ref(date_iso)
        doc_snap = doc_ref.get()
        if not doc_snap.exists:
            return False
        data = doc_snap.to_dict() or {}
        if data.get("userId") != self.user_id:
            raise ValueError(
                f"Snapshot users/{self.user_id}/{self.collection_name}/{date_iso} has userId "
                f"'{data.get('userId')}', not the configured user_id '{self.user_id}' -- refusing "
                "to patch a document this repository doesn't own."
            )
        updates = dict(field_updates)
        updates["updatedAt"] = datetime.now(timezone.utc).isoformat()
        doc_ref.update(updates)
        logger.info(
            f"Patched fields {sorted(field_updates.keys())} on "
            f"users/{self.user_id}/{self.collection_name}/{date_iso}."
        )
        return True

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
            "weightKg": targets.weight_kg,
            "bodyFatPct": targets.body_fat_pct,
        }
        measured_at = {
            "ftpMeasuredAt": targets.ftp_measured_at,
            "thresholdMeasuredAt": targets.threshold_measured_at,
            "lthrMeasuredAt": targets.lthr_measured_at,
            "weightMeasuredAt": targets.weight_measured_at,
        }

        @firestore.transactional  # pyright: ignore[reportAttributeAccessIssue]
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
            if targets.race_predictions is not None:
                raw_race_predictions = garmin.get("racePredictions")
                race_predictions: dict[str, Any] = (
                    dict(raw_race_predictions) if isinstance(raw_race_predictions, dict) else {}
                )
                incoming_race_predictions = {
                    "fiveKmSec": targets.race_predictions.five_km_sec,
                    "tenKmSec": targets.race_predictions.ten_km_sec,
                    "halfMarathonSec": targets.race_predictions.half_marathon_sec,
                    "marathonSec": targets.race_predictions.marathon_sec,
                }
                race_predictions.update(
                    {
                        key: value
                        for key, value in incoming_race_predictions.items()
                        if value is not None
                    }
                )
                race_predictions["fetchedAt"] = now_iso
                garmin["racePredictions"] = race_predictions
                profile["racePredictions"] = dict(race_predictions)
            garmin["fetchedAt"] = now_iso
            profile["garmin"] = garmin

            for key, value in incoming.items():
                if value is None:
                    continue
                source = sources.get(key)
                existing_value = profile.get(key)
                if source in {"manual", "coach"}:
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
                        "unavailableModalities": [],
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

    def upsert_garmin_gear(self, gear_items: list[Any]) -> None:
        """Persist gear items to user collection and update preferences profile gearTracker."""
        if not gear_items:
            return
        db = self._get_db()
        now_iso = datetime.now(timezone.utc).isoformat()

        profile_ref = (
            db.collection("users")
            .document(self.user_id)
            .collection("preferences")
            .document("profile")
        )

        gear_dicts = [
            {
                key: value
                for key, value in {
                    "gearPk": item.gear_pk,
                    "uuid": item.uuid,
                    "customMakeModel": item.custom_make_model,
                    "displayName": item.display_name,
                    "gearType": item.gear_type,
                    "brand": item.brand,
                    "model": item.model,
                    "totalDistanceKm": item.total_distance_km,
                    "maximumDistanceKm": item.maximum_distance_km,
                    "dateBegin": item.date_begin,
                    "dateEnd": item.date_end,
                    "status": item.status,
                }.items()
                if value is not None
            }
            for item in gear_items
        ]

        batch = db.batch()
        batch.set(
            profile_ref,
            {
                "userId": self.user_id,
                "gearTracker": {
                    "items": gear_dicts,
                    "syncedAt": now_iso,
                },
                "updatedAt": now_iso,
            },
            merge=True,
        )

        for item, g_dict in zip(gear_items, gear_dicts, strict=True):
            gear_doc_ref = (
                db.collection("users")
                .document(self.user_id)
                .collection("gear")
                .document(item.gear_pk)
            )
            batch.set(
                gear_doc_ref,
                {
                    "userId": self.user_id,
                    **g_dict,
                    "updatedAt": now_iso,
                },
                merge=True,
            )

        batch.commit()
        logger.info(
            "Updated Garmin gear items (%d) for user=<UID-redacted>.",
            len(gear_items),
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

    def save_health_observation_day_bundle(
        self,
        bundle: Any,  # HealthObservationDayBundle
    ) -> tuple[bool, int]:
        """Save a day-source observation bundle to Firestore under
        users/{userId}/health_observation_days/{YYYY-MM-DD}_{provider}_{transport}.

        Returns (changed: bool, revision: int). If identical payload exists, returns (False, rev).
        If payload updated, increments revision and saves.
        """
        db = self._get_db()
        doc_id = f"{bundle.logicalDate}_{bundle.provider}_{bundle.transport}"
        doc_ref = (
            db.collection("users")
            .document(self.user_id)
            .collection("health_observation_days")
            .document(doc_id)
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        transaction = getattr(db, "transaction", None)

        if callable(transaction) and firestore is not None:

            @firestore.transactional
            def _update_in_txn(txn: Any) -> tuple[bool, int]:
                existing_doc = doc_ref.get(transaction=txn)
                current_rev = 1
                if existing_doc.exists:
                    data = existing_doc.to_dict() or {}
                    existing_hash = data.get("sourcePayloadHash")
                    current_rev = data.get("revision", 1)
                    if existing_hash == bundle.sourcePayloadHash:
                        return False, current_rev
                    current_rev += 1

                bundle.revision = current_rev
                bundle.ingestedAt = now_iso
                bundle.effectiveAt = now_iso
                txn.set(doc_ref, bundle.to_dict())
                return True, current_rev

            txn = db.transaction()
            changed, current_rev = _update_in_txn(txn)
        else:
            existing_doc = doc_ref.get()
            current_rev = 1
            if existing_doc.exists:
                data = existing_doc.to_dict() or {}
                existing_hash = data.get("sourcePayloadHash")
                current_rev = data.get("revision", 1)
                if existing_hash == bundle.sourcePayloadHash:
                    logger.debug(
                        "Health observation bundle %s already up to date at revision %d.",
                        doc_id,
                        current_rev,
                    )
                    return False, current_rev
                current_rev += 1

            bundle.revision = current_rev
            bundle.ingestedAt = now_iso
            bundle.effectiveAt = now_iso
            doc_ref.set(bundle.to_dict())
            changed = True

        if changed:
            logger.info(
                "Saved health observation bundle %s for user=<UID-redacted> at revision %d (%d observations).",
                doc_id,
                current_rev,
                len(bundle.observations),
            )
        else:
            logger.debug(
                "Health observation bundle %s already up to date at revision %d.",
                doc_id,
                current_rev,
            )
        return changed, current_rev

    def get_health_observation_day_bundle(
        self,
        logical_date: str,
        provider: str,
        transport: str,
    ) -> dict[str, Any] | None:
        """Retrieve a specific day-source bundle from Firestore."""
        db = self._get_db()
        doc_id = f"{logical_date}_{provider}_{transport}"
        doc_ref = (
            db.collection("users")
            .document(self.user_id)
            .collection("health_observation_days")
            .document(doc_id)
        )
        doc = doc_ref.get()
        return doc.to_dict() if doc.exists else None

    def delete_health_observation_day_bundle(
        self,
        logical_date: str,
        provider: str,
        transport: str,
    ) -> bool:
        """Delete a specific day-source bundle from Firestore, e.g. when a source that
        was present in a prior sync is absent from the current authoritative batch and
        must stop being queryable by fusion/audit code (D-MS reconciliation).

        Returns True if a document existed and was deleted, False if there was nothing
        to delete.
        """
        db = self._get_db()
        doc_id = f"{logical_date}_{provider}_{transport}"
        doc_ref = (
            db.collection("users")
            .document(self.user_id)
            .collection("health_observation_days")
            .document(doc_id)
        )
        existing_doc = doc_ref.get()
        if not existing_doc.exists:
            return False
        doc_ref.delete()
        return True

    def get_health_observation_bundles_in_range(
        self,
        start_date: str,
        end_date: str,
        provider: str | None = None,
        transport: str | None = None,
    ) -> list[dict[str, Any]]:
        """Retrieve all health observation day bundles within [start_date, end_date]."""
        db = self._get_db()
        query = (
            db.collection("users")
            .document(self.user_id)
            .collection("health_observation_days")
            .where(filter=FieldFilter("logicalDate", ">=", start_date))
            .where(filter=FieldFilter("logicalDate", "<=", end_date))
        )

        docs: list[dict[str, Any]] = []
        for doc in query.stream():
            data = doc.to_dict()
            if provider and data.get("provider") != provider:
                continue
            if transport and data.get("transport") != transport:
                continue
            docs.append(data)

        docs.sort(key=lambda d: d.get("logicalDate", ""))
        return docs

    def save_connection_metadata(
        self,
        connection_name: str,
        metadata: dict[str, Any],
    ) -> None:
        """Save non-secret connection metadata to users/{userId}/connections/{connection_name}."""
        db = self._get_db()
        doc_ref = (
            db.collection("users")
            .document(self.user_id)
            .collection("connections")
            .document(connection_name)
        )
        doc_ref.set(metadata, merge=True)

    def get_connection_metadata(
        self,
        connection_name: str,
    ) -> dict[str, Any] | None:
        """Retrieve connection metadata from users/{userId}/connections/{connection_name}."""
        db = self._get_db()
        doc_ref = (
            db.collection("users")
            .document(self.user_id)
            .collection("connections")
            .document(connection_name)
        )
        doc = doc_ref.get()
        return doc.to_dict() if doc.exists else None

    def _identity_collection(self, collection_name: str) -> Any:
        return self._get_db().collection("users").document(self.user_id).collection(collection_name)

    def _save_immutable_identity_document(
        self,
        collection_name: str,
        document_id: str,
        payload: Mapping[str, Any],
    ) -> bool:
        """Create an immutable server-owned identity document atomically and idempotently.

        Firestore ``create`` is a single create-only write. Replaying the exact bytes after a
        conflict is a no-op; reusing an existing identity for different content is rejected so a
        concurrent writer cannot overwrite evidence needed by historical replay.
        """

        if not document_id:
            raise ValueError("Identity document id must be non-empty.")
        stored = dict(payload)
        doc_ref = self._identity_collection(collection_name).document(document_id)
        try:
            doc_ref.create(stored)
            return True
        except Conflict as error:
            snapshot = doc_ref.get()
            if snapshot.exists and snapshot.to_dict() == stored:
                return False
            raise ValueError(
                f"Immutable identity document {collection_name}/{document_id} already exists "
                "with different content."
            ) from error

    def save_identity_passport_version(self, passport: Mapping[str, Any]) -> bool:
        """Persist one fully validated immutable/replayable passport version."""

        if not validate_identity_passport_version(passport):
            raise ValueError("Identity passport version does not match the persisted schema.")
        version = cast(str, passport.get("passportVersion"))
        return self._save_immutable_identity_document(
            "physiological_identity_passport_versions", version, passport
        )

    def set_current_identity_passport(self, passport: Mapping[str, Any]) -> None:
        """Replace the fully validated server-owned online passport materialization."""

        if not validate_identity_passport_current(passport):
            raise ValueError("Current identity passport does not match the persisted schema.")
        self._identity_collection("physiological_identity_passports").document("current").set(
            dict(passport)
        )

    def get_current_identity_passport(self) -> dict[str, Any] | None:
        snapshot = (
            self._identity_collection("physiological_identity_passports").document("current").get()
        )
        return snapshot.to_dict() if snapshot.exists else None

    def get_identity_passport_version(self, version: str) -> dict[str, Any] | None:
        snapshot = (
            self._identity_collection("physiological_identity_passport_versions")
            .document(version)
            .get()
        )
        return snapshot.to_dict() if snapshot.exists else None

    def save_automatic_identity_assessment(self, assessment: Mapping[str, Any]) -> bool:
        """Persist fully validated immutable model output and every contributing bundle ref."""

        if not validate_automatic_identity_assessment(assessment):
            raise ValueError("Automatic identity assessment does not match the persisted schema.")
        assessment_id = cast(str, assessment.get("id"))
        return self._save_immutable_identity_document(
            "health_identity_assessments", assessment_id, assessment
        )

    def get_automatic_identity_assessment(self, assessment_id: str) -> dict[str, Any] | None:
        snapshot = (
            self._identity_collection("health_identity_assessments").document(assessment_id).get()
        )
        return snapshot.to_dict() if snapshot.exists else None

    def save_identity_review_event(self, event: Mapping[str, Any]) -> bool:
        """Persist a fully validated append-only admin/user review event."""

        if not validate_identity_review_event(event):
            raise ValueError("Identity review event does not match the persisted schema.")
        event_id = cast(str, event.get("id"))
        stored_event = dict(event)
        recorded_at = cast(str, stored_event["recordedAt"])
        parsed = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        stored_event["recordedAt"] = parsed
        return self._save_immutable_identity_document(
            "health_identity_review_events", event_id, stored_event
        )

    def get_identity_assessments_in_range(
        self, start_night_key: str, end_night_key: str
    ) -> list[dict[str, Any]]:
        query = (
            self._identity_collection("health_identity_assessments")
            .where(filter=FieldFilter("sourceNightKey", ">=", start_night_key))
            .where(filter=FieldFilter("sourceNightKey", "<=", end_night_key))
        )
        assessments = [doc.to_dict() for doc in query.stream()]
        assessments.sort(key=lambda item: (item.get("sourceNightKey", ""), item.get("id", "")))
        return assessments

    def get_identity_review_events(self, assessment_id: str) -> list[dict[str, Any]]:
        query = self._identity_collection("health_identity_review_events").where(
            filter=FieldFilter("assessmentId", "==", assessment_id)
        )
        events = [doc.to_dict() for doc in query.stream()]
        for event in events:
            recorded_at = event.get("recordedAt")
            if isinstance(recorded_at, datetime):
                event["recordedAt"] = (
                    recorded_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                )
        events.sort(key=lambda item: (item.get("recordedAt", ""), item.get("id", "")))
        return events

    def get_effective_identity_decision_projections_in_range(
        self, start_night_key: str, end_night_key: str
    ) -> dict[IdentityBundleKey, EffectiveIdentityDecisionProjection]:
        """Derive baseline-authoritative decisions from immutable persisted evidence."""

        assessments = self.get_identity_assessments_in_range(start_night_key, end_night_key)
        reviews = {
            assessment_id: self.get_identity_review_events(assessment_id)
            for assessment in assessments
            if isinstance((assessment_id := assessment.get("id")), str)
        }
        return build_effective_identity_decision_index(assessments, reviews)
