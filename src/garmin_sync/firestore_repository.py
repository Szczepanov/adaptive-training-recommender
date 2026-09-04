import itertools
import logging
import os
from collections.abc import Iterable, Iterator
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
        resolved_path = credentials_path or os.getenv("FIREBASE_CREDENTIALS_PATH")
        if resolved_path:
            if not os.path.isfile(resolved_path):
                raise FileNotFoundError(
                    "Configured Firebase credentials path does not exist or is not a regular "
                    f"file: {resolved_path}"
                )
            logger.info(
                f"Initializing Firebase Admin with service account from '{resolved_path}'..."
            )
            cred = credentials.Certificate(resolved_path)
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
        collection_name: str | None = None,
        db: Any | None = None,
    ) -> None:
        normalized_user_id = user_id.strip()
        if not normalized_user_id or normalized_user_id == "default_user":
            raise ValueError("FirestoreRecoveryRepository requires a valid non-default user_id")
        self.user_id = user_id
        self.collection_name = collection_name or os.getenv(
            "FIRESTORE_RECOVERY_COLLECTION", "daily_recovery_snapshots"
        )
        self.db = db or init_firestore_client()

    def _collection(self) -> Any:
        return self.db.collection("users").document(self.user_id).collection(self.collection_name)

    def upsert_snapshot(self, date: str, payload: dict[str, Any]) -> None:
        """Upsert recovery snapshot with idempotent merge semantics."""
        payload_user_id = payload.get("userId")
        if payload_user_id != self.user_id:
            raise ValueError(
                f"Snapshot userId '{payload_user_id}' does not match configured user_id '{self.user_id}'"
            )

        doc_ref = self._collection().document(date)
        now = datetime.now(timezone.utc).isoformat()

        doc = doc_ref.get()
        data = dict(payload)
        data["updatedAt"] = now
        if not doc.exists:
            data["createdAt"] = now

        doc_ref.set(data, merge=True)

    def get_snapshot(self, date: str) -> dict[str, Any] | None:
        """Return a recovery snapshot by date, or None if not found."""
        doc = self._collection().document(date).get()
        if not doc.exists:
            return None
        return cast(dict[str, Any], doc.to_dict())

    def is_fresh(
        self,
        date: str,
        *,
        staleness_minutes: int,
        incomplete_staleness_minutes: int,
    ) -> bool:
        """Return whether an existing snapshot is fresh enough to skip another sync.

        Complete snapshots get the normal cooldown. Incomplete snapshots use a much shorter
        cooldown so late-arriving Garmin metrics can be picked up quickly.
        """
        snapshot = self.get_snapshot(date)
        if not snapshot:
            return False

        source = snapshot.get("source", {})
        synced_at = source.get("garminSyncedAt") if isinstance(source, dict) else None
        if not isinstance(synced_at, str):
            return False

        try:
            synced_dt = datetime.fromisoformat(synced_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        if synced_dt.tzinfo is None:
            synced_dt = synced_dt.replace(tzinfo=timezone.utc)

        age_minutes = (datetime.now(timezone.utc) - synced_dt).total_seconds() / 60.0
        threshold = (
            staleness_minutes
            if is_snapshot_complete(snapshot)
            else incomplete_staleness_minutes
        )
        return age_minutes < threshold

    def get_snapshots(self, dates: Iterable[str]) -> dict[str, dict[str, Any]]:
        """Return existing snapshots keyed by date."""
        snapshots: dict[str, dict[str, Any]] = {}
        for date in dates:
            snapshot = self.get_snapshot(date)
            if snapshot:
                snapshots[date] = snapshot
        return snapshots

    def iter_snapshots(self, *, start_date: str, end_date: str) -> Iterator[dict[str, Any]]:
        """Yield snapshots in date order for the inclusive date range."""
        query = (
            self._collection()
            .where(filter=FieldFilter("date", ">=", start_date))
            .where(filter=FieldFilter("date", "<=", end_date))
            .order_by("date")
        )
        for doc in query.stream():
            data = doc.to_dict()
            if isinstance(data, dict):
                yield data

    def delete_snapshot(self, date: str) -> None:
        """Delete a snapshot by date."""
        self._collection().document(date).delete()

    def upsert_observation_bundle(
        self,
        bundle: "HealthObservationDayBundle",
        *,
        document_id: str | None = None,
    ) -> bool:
        """Persist a canonical observation bundle if source/version content changed.

        Returns True when a write occurred, False when an existing row already has the
        same `sourcePayloadHash` and `normalizerVersion`.
        """
        from .models import HealthObservationDayBundle

        if not isinstance(bundle, HealthObservationDayBundle):
            raise TypeError("bundle must be a HealthObservationDayBundle")
        if bundle.userId != self.user_id:
            raise ValueError(
                f"Observation bundle userId '{bundle.userId}' does not match configured "
                f"user_id '{self.user_id}'"
            )

        doc_id = document_id or f"{bundle.logicalDate}_{bundle.provider}_{bundle.transport}"
        doc_ref = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("health_observations")
            .document(doc_id)
        )
        payload = bundle.model_dump(mode="json")

        transaction_factory = getattr(self.db, "transaction", None)
        if callable(transaction_factory):
            transaction = transaction_factory()

            @firestore.transactional
            def _upsert_in_transaction(txn: Any) -> bool:
                existing = doc_ref.get(transaction=txn)
                existing_data = existing.to_dict() if existing.exists else None
                if isinstance(existing_data, dict) and (
                    existing_data.get("sourcePayloadHash") == bundle.sourcePayloadHash
                    and existing_data.get("normalizerVersion") == bundle.normalizerVersion
                ):
                    return False

                previous_revision = 0
                if isinstance(existing_data, dict):
                    try:
                        previous_revision = int(existing_data.get("revision") or 0)
                    except (TypeError, ValueError):
                        previous_revision = 0

                write_payload = {
                    **payload,
                    "revision": max(1, previous_revision + 1),
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }
                if not existing.exists:
                    write_payload["createdAt"] = firestore.SERVER_TIMESTAMP
                txn.set(doc_ref, write_payload, merge=True)
                return True

            return bool(_upsert_in_transaction(transaction))

        # Fallback is primarily for deterministic tests/fakes that do not implement
        # transactions. Production Firestore clients provide transaction().
        existing = doc_ref.get()
        existing_data = existing.to_dict() if existing.exists else None
        if isinstance(existing_data, dict) and (
            existing_data.get("sourcePayloadHash") == bundle.sourcePayloadHash
            and existing_data.get("normalizerVersion") == bundle.normalizerVersion
        ):
            return False

        previous_revision = 0
        if isinstance(existing_data, dict):
            try:
                previous_revision = int(existing_data.get("revision") or 0)
            except (TypeError, ValueError):
                previous_revision = 0
        write_payload = {
            **payload,
            "revision": max(1, previous_revision + 1),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if not existing.exists:
            write_payload["createdAt"] = firestore.SERVER_TIMESTAMP
        doc_ref.set(write_payload, merge=True)
        return True

    def _identity_bundle_doc_ref(self, bundle_id: str) -> Any:
        return (
            self.db.collection("users")
            .document(self.user_id)
            .collection("health_identity_bundles")
            .document(bundle_id)
        )

    def _identity_current_doc_ref(self) -> Any:
        return (
            self.db.collection("users")
            .document(self.user_id)
            .collection("identity_passports")
            .document("current")
        )

    def save_identity_assessment(self, assessment: Mapping[str, Any]) -> None:
        """Persist one immutable physiological identity assessment."""
        validated = validate_automatic_identity_assessment(dict(assessment))
        if validated.userId != self.user_id:
            raise ValueError(
                "Identity assessment userId does not match configured Firestore repository user_id"
            )
        doc_ref = self._identity_bundle_doc_ref(validated.bundleId)
        payload = validated.model_dump(mode="json")
        payload["updatedAt"] = firestore.SERVER_TIMESTAMP
        try:
            doc_ref.create(payload)
        except Conflict as exc:
            raise ValueError(
                f"Identity assessment bundle '{validated.bundleId}' is immutable and already exists"
            ) from exc

    def get_identity_assessment(self, bundle_id: str) -> dict[str, Any] | None:
        """Return one immutable physiological identity assessment."""
        doc = self._identity_bundle_doc_ref(bundle_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        return dict(data) if isinstance(data, dict) else None

    def save_identity_passport_version(self, passport: Mapping[str, Any]) -> None:
        """Persist one immutable Physiological Identity Passport version."""
        validated = validate_identity_passport_version(dict(passport))
        if validated.userId != self.user_id:
            raise ValueError(
                "Identity passport userId does not match configured Firestore repository user_id"
            )
        doc_ref = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("identity_passport_versions")
            .document(validated.passportVersionId)
        )
        payload = validated.model_dump(mode="json")
        payload["updatedAt"] = firestore.SERVER_TIMESTAMP
        try:
            doc_ref.create(payload)
        except Conflict as exc:
            raise ValueError(
                f"Identity passport version '{validated.passportVersionId}' is immutable and already exists"
            ) from exc

    def get_identity_passport_version(self, passport_version_id: str) -> dict[str, Any] | None:
        """Return one immutable Physiological Identity Passport version."""
        doc = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("identity_passport_versions")
            .document(passport_version_id)
            .get()
        )
        if not doc.exists:
            return None
        data = doc.to_dict()
        return dict(data) if isinstance(data, dict) else None

    def save_identity_passport_current(self, current: Mapping[str, Any]) -> None:
        """Persist the mutable pointer to the currently active passport version."""
        validated = validate_identity_passport_current(dict(current))
        if validated.userId != self.user_id:
            raise ValueError(
                "Identity passport current userId does not match configured Firestore repository user_id"
            )
        payload = validated.model_dump(mode="json")
        payload["updatedAt"] = firestore.SERVER_TIMESTAMP
        self._identity_current_doc_ref().set(payload, merge=False)

    def get_identity_passport_current(self) -> dict[str, Any] | None:
        """Return the mutable pointer to the currently active passport version."""
        doc = self._identity_current_doc_ref().get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        return dict(data) if isinstance(data, dict) else None

    def save_identity_review_event(self, event: Mapping[str, Any]) -> None:
        """Persist one immutable user review decision for a suspicious identity bundle."""
        validated = validate_identity_review_event(dict(event))
        if validated.userId != self.user_id:
            raise ValueError(
                "Identity review event userId does not match configured Firestore repository user_id"
            )
        doc_ref = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("health_identity_reviews")
            .document(validated.reviewId)
        )
        payload = validated.model_dump(mode="json")
        payload["updatedAt"] = firestore.SERVER_TIMESTAMP
        try:
            doc_ref.create(payload)
        except Conflict as exc:
            raise ValueError(
                f"Identity review '{validated.reviewId}' is immutable and already exists"
            ) from exc

    def get_identity_review_event(self, review_id: str) -> dict[str, Any] | None:
        """Return one immutable user review decision."""
        doc = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("health_identity_reviews")
            .document(review_id)
            .get()
        )
        if not doc.exists:
            return None
        data = doc.to_dict()
        return dict(data) if isinstance(data, dict) else None

    def iter_identity_assessments(
        self,
        *,
        start_date: str,
        end_date: str,
    ) -> Iterator[dict[str, Any]]:
        """Yield physiological identity assessments in deterministic date/bundle order."""
        query = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("health_identity_bundles")
            .where(filter=FieldFilter("logicalDate", ">=", start_date))
            .where(filter=FieldFilter("logicalDate", "<=", end_date))
            .order_by("logicalDate")
        )
        rows: list[dict[str, Any]] = []
        for doc in query.stream():
            data = doc.to_dict()
            if isinstance(data, dict):
                rows.append(dict(data))
        rows.sort(key=lambda row: (str(row.get("logicalDate", "")), str(row.get("bundleId", ""))))
        yield from rows

    def iter_identity_reviews(
        self,
        *,
        start_date: str,
        end_date: str,
    ) -> Iterator[dict[str, Any]]:
        """Yield immutable identity review events in deterministic date/review order."""
        query = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("health_identity_reviews")
            .where(filter=FieldFilter("logicalDate", ">=", start_date))
            .where(filter=FieldFilter("logicalDate", "<=", end_date))
            .order_by("logicalDate")
        )
        rows: list[dict[str, Any]] = []
        for doc in query.stream():
            data = doc.to_dict()
            if isinstance(data, dict):
                rows.append(dict(data))
        rows.sort(key=lambda row: (str(row.get("logicalDate", "")), str(row.get("reviewId", ""))))
        yield from rows

    def build_effective_identity_decision_index(
        self,
        *,
        start_date: str,
        end_date: str,
    ) -> dict[IdentityBundleKey, EffectiveIdentityDecisionProjection]:
        """Build effective identity outcomes with immutable user reviews overriding automation."""
        return build_effective_identity_decision_index(
            self.iter_identity_assessments(start_date=start_date, end_date=end_date),
            self.iter_identity_reviews(start_date=start_date, end_date=end_date),
        )

    def list_identity_training_observations(
        self,
        *,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Return identity-attributed historical observations newest-first.

        This bounded read powers PI3 historical passport bootstrap. Observations are read
        from the canonical `health_observations` collection and the persisted `identity`
        attribution block is preserved for caller-side filtering.
        """
        query = self.db.collection("users").document(self.user_id).collection("health_observations")
        if hasattr(query, "order_by"):
            query = query.order_by("logicalDate", direction=firestore.Query.DESCENDING)
        if limit is not None and hasattr(query, "limit"):
            query = query.limit(limit)

        rows: list[dict[str, Any]] = []
        for doc in query.stream():
            data = doc.to_dict()
            if isinstance(data, dict):
                rows.append(dict(data))
        return rows

    def list_identity_reviewed_reference_rows(
        self,
        *,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Return reviewed identity bundles as signed reference rows for passport bootstrap."""
        reviews_query = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("health_identity_reviews")
        )
        if hasattr(reviews_query, "order_by"):
            reviews_query = reviews_query.order_by(
                "logicalDate", direction=firestore.Query.DESCENDING
            )
        if limit is not None and hasattr(reviews_query, "limit"):
            reviews_query = reviews_query.limit(limit)

        rows: list[dict[str, Any]] = []
        for review_doc in reviews_query.stream():
            review = review_doc.to_dict()
            if not isinstance(review, dict):
                continue
            bundle_id = review.get("bundleId")
            if not isinstance(bundle_id, str) or not bundle_id:
                continue
            bundle = self.get_identity_assessment(bundle_id)
            if not bundle:
                continue
            rows.append(
                {
                    "review": dict(review),
                    "bundle": bundle,
                }
            )
        return rows

    def list_identity_passport_versions(self, *, limit: int | None = None) -> list[dict[str, Any]]:
        """Return immutable passport versions newest-first."""
        query = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("identity_passport_versions")
        )
        if hasattr(query, "order_by"):
            query = query.order_by("createdAt", direction=firestore.Query.DESCENDING)
        if limit is not None and hasattr(query, "limit"):
            query = query.limit(limit)

        rows: list[dict[str, Any]] = []
        for doc in query.stream():
            data = doc.to_dict()
            if isinstance(data, dict):
                rows.append(dict(data))
        return rows

    def list_identity_review_events(self, *, limit: int | None = None) -> list[dict[str, Any]]:
        """Return immutable identity review events newest-first."""
        query = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("health_identity_reviews")
        )
        if hasattr(query, "order_by"):
            query = query.order_by("createdAt", direction=firestore.Query.DESCENDING)
        if limit is not None and hasattr(query, "limit"):
            query = query.limit(limit)

        rows: list[dict[str, Any]] = []
        for doc in query.stream():
            data = doc.to_dict()
            if isinstance(data, dict):
                rows.append(dict(data))
        return rows

    def get_identity_bundle_evidence_rows(
        self,
        *,
        bundle_id: str,
    ) -> list[dict[str, Any]]:
        """Return the persisted observation rows referenced by one identity bundle."""
        bundle = self.get_identity_assessment(bundle_id)
        if not bundle:
            return []

        observation_ids = bundle.get("observationIds")
        if not isinstance(observation_ids, list):
            return []

        collection = (
            self.db.collection("users").document(self.user_id).collection("health_observations")
        )
        rows: list[dict[str, Any]] = []
        for observation_id in observation_ids:
            if not isinstance(observation_id, str) or not observation_id:
                continue
            doc = collection.document(observation_id).get()
            if doc.exists:
                data = doc.to_dict()
                if isinstance(data, dict):
                    rows.append(dict(data))
        return rows

    def batch_get_identity_assessments(self, bundle_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
        """Return existing physiological identity assessments keyed by bundle id."""
        ids = list(dict.fromkeys(bundle_ids))
        if not ids:
            return {}
        refs = [self._identity_bundle_doc_ref(bundle_id) for bundle_id in ids]
        documents = self.db.get_all(refs)
        result: dict[str, dict[str, Any]] = {}
        for doc in documents:
            if not doc.exists:
                continue
            data = doc.to_dict()
            if isinstance(data, dict):
                bundle_id = data.get("bundleId")
                if isinstance(bundle_id, str):
                    result[bundle_id] = dict(data)
        return result

    def batch_get_identity_reviews_by_bundle_id(
        self, bundle_ids: Iterable[str]
    ) -> dict[str, dict[str, Any]]:
        """Return latest review for each physiological identity bundle."""
        ids = list(dict.fromkeys(bundle_ids))
        if not ids:
            return {}

        results: dict[str, dict[str, Any]] = {}
        collection = (
            self.db.collection("users").document(self.user_id).collection("health_identity_reviews")
        )
        for chunk in itertools.batched(ids, 30):
            query = collection.where(filter=FieldFilter("bundleId", "in", list(chunk)))
            for doc in query.stream():
                data = doc.to_dict()
                if not isinstance(data, dict):
                    continue
                bundle_id = data.get("bundleId")
                if not isinstance(bundle_id, str):
                    continue
                previous = results.get(bundle_id)
                if previous is None or str(data.get("createdAt", "")) > str(
                    previous.get("createdAt", "")
                ):
                    results[bundle_id] = dict(data)
        return results
