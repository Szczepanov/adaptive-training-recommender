"""TO4 pre-occurrence historical activity backfill and source-link boundary (Issue #870).

Migrates historical Garmin activities lacking canonical representation into single-source
``PerformedTrainingOccurrence`` and ``PerformedOccurrenceSourceLink`` documents in Firestore.

Persistence invariant:
Uses single-source Firestore transactions with create-only semantics to prevent TOCTOU races
with live ingestion or concurrent reconcilers.
"""

import logging
import time
import urllib.parse
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger("garmin_sync.training_occurrence_backfill")

GARMIN_CYCLING_POWER_TYPES: frozenset[str] = frozenset(
    [
        "cycling",
        "cyclocross",
        "gravel_cycling",
        "indoor_cycling",
        "mountain_biking",
        "road_biking",
        "virtual_ride",
    ]
)

GARMIN_ACTIVITY_TYPE_KEYWORDS: dict[str, list[str]] = {
    "cycling": ["cycl", "bike"],
    "running": ["run"],
    "strength": ["strength", "weight", "lift"],
    "field": ["soccer", "football", "field"],
    "mobility": ["yoga", "mobility"],
    "cross_training": ["swim", "row", "ellipt", "cardio"],
}


def provider_activity_source_key(provider: str, activity_id: str) -> str:
    """Return canonical source key matching ``sourceIdentity.ts``."""
    normalized_provider = provider.strip().lower()
    return f"provider_activity:{normalized_provider}:{activity_id}"


def _fnv32(s: str, seed: int) -> str:
    """32-bit FNV-1a hash over UTF-16 code units, matching JS charCodeAt."""
    utf16_bytes = s.encode("utf-16le")
    h = seed & 0xFFFFFFFF
    for i in range(0, len(utf16_bytes), 2):
        code = utf16_bytes[i] | (utf16_bytes[i + 1] << 8)
        h ^= code
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def _stable_hash(source_key: str) -> str:
    """Two-seed FNV-1a hash matching ``sourceIdentity.ts``."""
    return f"{_fnv32(source_key, 0x811C9DC5)}{_fnv32(source_key, 0x1B873593)}"


def encode_source_key_for_doc_id(source_key: str) -> str:
    """Encode source key for Firestore document ID matching ``sourceIdentity.ts``.

    Uses JS encodeURIComponent escaping rules plus secondary escaping for '%' and '.',
    falling back to a stable hash for keys longer than 400 characters.
    """
    raw_quoted = urllib.parse.quote(source_key, safe="-_.!~*'()")
    res: list[str] = []
    for c in raw_quoted:
        if c == ".":
            res.append("%2E")
        elif c == "%":
            res.append("%25")
        else:
            res.append(c)
    encoded = "".join(res)
    if len(encoded) <= 400 and encoded != "." and encoded != "..":
        return encoded
    return f"h-{_stable_hash(source_key)}"


def normalized_garmin_modality(activity_type: str) -> str | None:
    """Normalize Garmin activity type into canonical modality vocabulary.

    Matches ``app/src/sessions/occurrenceReconciliation.ts``.
    """
    normalized = activity_type.strip().lower()
    if normalized in GARMIN_CYCLING_POWER_TYPES:
        return "cycling"
    for modality, keywords in GARMIN_ACTIVITY_TYPE_KEYWORDS.items():
        if any(keyword in normalized for keyword in keywords):
            return modality
    return None


def new_performed_occurrence_id() -> str:
    """Return fresh occurrence ID following ``pto-{epochMillis}-{uuid}`` convention."""
    epoch_ms = int(time.time() * 1000)
    return f"pto-{epoch_ms}-{uuid.uuid4()}"


@dataclass(frozen=True)
class BackfillCandidate:
    activity_id: str
    date: str
    source_key: str
    source_link_doc_id: str
    started_at: str | None = None
    ended_at: str | None = None
    modality: str | None = None
    duration_min: float | None = None


@dataclass(frozen=True)
class BackfillAnomaly:
    anomaly_type: str
    message: str
    activity_id: str | None = None
    source_key: str | None = None
    occurrence_id: str | None = None


@dataclass
class BackfillPlan:
    user_id: str
    start_date: str
    end_date_inclusive: str
    activities_scanned: int = 0
    eligible_candidates: list[BackfillCandidate] = field(default_factory=list)
    already_linked_count: int = 0
    anomalies: list[BackfillAnomaly] = field(default_factory=list)

    @property
    def would_create_count(self) -> int:
        return len(self.eligible_candidates)


@dataclass
class BackfillApplyResult:
    user_id: str
    start_date: str
    end_date_inclusive: str
    activities_scanned: int = 0
    planned_candidates: int = 0
    created: int = 0
    already_linked_before_apply: int = 0
    concurrently_linked: int = 0
    failed: int = 0
    anomalies: list[BackfillAnomaly] = field(default_factory=list)
    created_occurrence_ids: list[str] = field(default_factory=list)


@dataclass
class BackfillAuditResult:
    user_id: str
    start_date: str
    end_date_inclusive: str
    eligible_activities_checked: int = 0
    verified_links: int = 0
    missing_links: int = 0
    invalid_links: int = 0
    audit_passed: bool = False
    issues: list[str] = field(default_factory=list)


def _validate_user_id(user_id: str) -> None:
    if (
        not user_id
        or "/" in user_id
        or "\\" in user_id
        or ".." in user_id
        or user_id.strip() != user_id
    ):
        raise ValueError(f"Invalid concrete user_id: {user_id!r}")


def _validate_date_window(start_date: str, end_date_inclusive: str) -> None:
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date_inclusive)
    except ValueError as error:
        raise ValueError(f"Invalid ISO date window: {error}") from error
    if start > end:
        raise ValueError(
            f"start_date ({start_date}) must be before or equal to end_date_inclusive ({end_date_inclusive})"
        )


def plan_training_occurrence_backfill(
    db: Any,
    user_id: str,
    start_date: str,
    end_date_inclusive: str,
) -> BackfillPlan:
    """Scan historical activities and inspect source links to build a backfill plan."""
    _validate_user_id(user_id)
    _validate_date_window(start_date, end_date_inclusive)

    user_ref = db.collection("users").document(user_id)
    plan = BackfillPlan(
        user_id=user_id, start_date=start_date, end_date_inclusive=end_date_inclusive
    )

    activity_stream = (
        user_ref.collection("activities")
        .where(filter=FieldFilter("date", ">=", start_date))
        .where(filter=FieldFilter("date", "<=", end_date_inclusive))
        .order_by("date")
        .stream()
    )

    activities: list[dict[str, Any]] = []
    for snapshot in activity_stream:
        data = snapshot.to_dict() or {}
        activities.append({"id": snapshot.id, "data": data})

    activities.sort(key=lambda a: (str(a["data"].get("date", "")), a["id"]))
    plan.activities_scanned = len(activities)

    # 1. Inspect existing source links for each activity
    for act in activities:
        act_data = act["data"]
        raw_act_id = act_data.get("activityId") or act["id"]
        activity_id = str(raw_act_id or "").strip()
        activity_date = str(act_data.get("date") or "").strip()
        act_type = str(act_data.get("type") or "").strip()

        try:
            date.fromisoformat(activity_date)
            is_valid_date = True
        except ValueError:
            is_valid_date = False
        if not activity_id or not is_valid_date or not act_type:
            plan.anomalies.append(
                BackfillAnomaly(
                    anomaly_type="invalid_activity",
                    message="Activity document missing valid activityId, date, or type",
                    activity_id=activity_id or None,
                )
            )
            continue

        source_key = provider_activity_source_key("garmin", activity_id)
        doc_id = encode_source_key_for_doc_id(source_key)
        link_ref = user_ref.collection("performedOccurrenceSourceLinks").document(doc_id)
        link_snap = link_ref.get()

        if link_snap.exists:
            link_data = link_snap.to_dict() or {}
            # Mirror the canonical source-link boundary closely enough to fail closed on
            # corruption before a migration writes anything. The TypeScript repository
            # treats this document as the unique source claim, so a malformed claim must
            # never be interpreted as a harmless "already linked" record.
            stored_key = link_data.get("sourceKey")
            stored_user = link_data.get("userId")
            occ_id = link_data.get("performedOccurrenceId")

            if stored_key != source_key:
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="source_link_identity_mismatch",
                        message=f"Source link key mismatch: expected {source_key}, found {stored_key}",
                        activity_id=activity_id,
                        source_key=source_key,
                        occurrence_id=occ_id,
                    )
                )
                continue
            if stored_user != user_id:
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="foreign_user_source_link",
                        message=f"Source link user mismatch: expected {user_id}, found {stored_user}",
                        activity_id=activity_id,
                        source_key=source_key,
                        occurrence_id=occ_id,
                    )
                )
                continue
            if not occ_id:
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="dangling_source_link",
                        message="Source link document has no performedOccurrenceId",
                        activity_id=activity_id,
                        source_key=source_key,
                    )
                )
                continue

            occ_snap = (
                user_ref.collection("performedTrainingOccurrences").document(str(occ_id)).get()
            )
            if not occ_snap.exists:
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="dangling_source_link",
                        message=f"Target occurrence {occ_id} referenced by source link does not exist",
                        activity_id=activity_id,
                        source_key=source_key,
                        occurrence_id=occ_id,
                    )
                )
                continue

            if (
                link_data.get("schemaVersion") != 1
                or link_data.get("sourceKind") != "provider_activity"
            ):
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="invalid_source_link",
                        message=(
                            f"Source link for {source_key} has unsupported schemaVersion/sourceKind"
                        ),
                        activity_id=activity_id,
                        source_key=source_key,
                        occurrence_id=occ_id,
                    )
                )
                continue

            occ_data = occ_snap.to_dict() or {}
            if (
                occ_data.get("schemaVersion") != 1
                or occ_data.get("userId") != user_id
                or occ_data.get("status") != "active"
            ):
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="invalid_target_occurrence",
                        message=(
                            f"Source link {source_key} does not resolve to an active schema-v1 "
                            f"occurrence owned by {user_id}"
                        ),
                        activity_id=activity_id,
                        source_key=source_key,
                        occurrence_id=str(occ_id),
                    )
                )
                continue

            refs = occ_data.get("sourceRefs")
            has_matching_ref = isinstance(refs, list) and any(
                isinstance(ref, dict)
                and ref.get("kind") == "provider_activity"
                and str(ref.get("provider", "")).strip().lower() == "garmin"
                and str(ref.get("activityId", "")) == activity_id
                for ref in refs
            )
            if not has_matching_ref:
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="source_link_target_mismatch",
                        message=(
                            f"Source link {source_key} points to occurrence {occ_id}, but that "
                            "occurrence does not contain the matching Garmin source ref"
                        ),
                        activity_id=activity_id,
                        source_key=source_key,
                        occurrence_id=str(occ_id),
                    )
                )
                continue

            plan.already_linked_count += 1
        else:
            started_at = act_data.get("startedAt")
            ended_at = act_data.get("endedAt")
            act_type = str(act_data.get("type") or "")
            modality = normalized_garmin_modality(act_type)
            duration_min = act_data.get("durationMin")

            plan.eligible_candidates.append(
                BackfillCandidate(
                    activity_id=activity_id,
                    date=activity_date,
                    source_key=source_key,
                    source_link_doc_id=doc_id,
                    started_at=str(started_at) if started_at else None,
                    ended_at=str(ended_at) if ended_at else None,
                    modality=modality,
                    duration_min=float(duration_min) if duration_min is not None else None,
                )
            )

    # 2. Preflight invariant scan. Every active Garmin source ref in the window must
    # have exactly one source-link claim and that claim must point back to the active
    # occurrence carrying the ref. This mirrors ADR-0034's source-uniqueness primitive
    # and catches corrupt/duplicate ownership before any migration write occurs.
    occ_stream = (
        user_ref.collection("performedTrainingOccurrences")
        .where(filter=FieldFilter("localDate", ">=", start_date))
        .where(filter=FieldFilter("localDate", "<=", end_date_inclusive))
        .where(filter=FieldFilter("status", "==", "active"))
        .stream()
    )

    active_occurrence_ids_for_source: dict[str, list[str]] = {}
    for occ_snap in occ_stream:
        occ_data = occ_snap.to_dict() or {}
        refs = occ_data.get("sourceRefs")
        if not isinstance(refs, list):
            plan.anomalies.append(
                BackfillAnomaly(
                    anomaly_type="invalid_target_occurrence",
                    message=f"Active occurrence {occ_snap.id} has invalid sourceRefs",
                    occurrence_id=occ_snap.id,
                )
            )
            continue

        for ref in refs:
            if not isinstance(ref, dict):
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="invalid_target_occurrence",
                        message=f"Active occurrence {occ_snap.id} contains a malformed source ref",
                        occurrence_id=occ_snap.id,
                    )
                )
                continue
            if (
                ref.get("kind") != "provider_activity"
                or str(ref.get("provider", "")).strip().lower() != "garmin"
            ):
                continue

            ref_act_id = str(ref.get("activityId", "")).strip()
            if not ref_act_id:
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="invalid_target_occurrence",
                        message=f"Active occurrence {occ_snap.id} has a Garmin source ref without activityId",
                        occurrence_id=occ_snap.id,
                    )
                )
                continue

            ref_key = provider_activity_source_key("garmin", ref_act_id)
            active_occurrence_ids_for_source.setdefault(ref_key, []).append(occ_snap.id)
            ref_doc_id = encode_source_key_for_doc_id(ref_key)
            ref_link_snap = (
                user_ref.collection("performedOccurrenceSourceLinks").document(ref_doc_id).get()
            )
            if not ref_link_snap.exists:
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="source_ref_without_source_link",
                        message=(
                            f"Active occurrence {occ_snap.id} contains Garmin source ref {ref_act_id} "
                            "without a corresponding source-link document"
                        ),
                        activity_id=ref_act_id,
                        source_key=ref_key,
                        occurrence_id=occ_snap.id,
                    )
                )
                continue

            ref_link_data = ref_link_snap.to_dict() or {}
            if (
                ref_link_data.get("schemaVersion") != 1
                or ref_link_data.get("sourceKey") != ref_key
                or ref_link_data.get("sourceKind") != "provider_activity"
                or ref_link_data.get("userId") != user_id
            ):
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="invalid_source_link",
                        message=f"Source link claim for {ref_key} is malformed or owned by another user",
                        activity_id=ref_act_id,
                        source_key=ref_key,
                        occurrence_id=occ_snap.id,
                    )
                )
                continue

            linked_occurrence_id = str(ref_link_data.get("performedOccurrenceId") or "")
            if linked_occurrence_id != occ_snap.id:
                plan.anomalies.append(
                    BackfillAnomaly(
                        anomaly_type="source_link_target_mismatch",
                        message=(
                            f"Active occurrence {occ_snap.id} carries {ref_key}, but the unique "
                            f"source link points to {linked_occurrence_id or '<missing>'}"
                        ),
                        activity_id=ref_act_id,
                        source_key=ref_key,
                        occurrence_id=occ_snap.id,
                    )
                )

    for source_key, occurrence_ids in active_occurrence_ids_for_source.items():
        distinct_ids = sorted(set(occurrence_ids))
        if len(distinct_ids) > 1:
            plan.anomalies.append(
                BackfillAnomaly(
                    anomaly_type="duplicate_active_source_ref",
                    message=(
                        f"Source {source_key} is present on multiple active occurrences: "
                        f"{distinct_ids}"
                    ),
                    source_key=source_key,
                )
            )

    return plan


def _perform_candidate_tx(
    tx: Any,
    user_ref: Any,
    link_ref: Any,
    candidate: BackfillCandidate,
    user_id: str,
) -> tuple[str, str | None]:
    link_snap = link_ref.get(transaction=tx)
    if link_snap.exists:
        link_data = link_snap.to_dict() or {}
        if (
            link_data.get("schemaVersion") != 1
            or link_data.get("sourceKey") != candidate.source_key
            or link_data.get("sourceKind") != "provider_activity"
            or link_data.get("userId") != user_id
            or not link_data.get("performedOccurrenceId")
        ):
            raise ValueError(
                f"Concurrent source-link claim for {candidate.source_key} is malformed"
            )
        return "concurrently_linked", None

    occ_id = new_performed_occurrence_id()
    occ_ref = user_ref.collection("performedTrainingOccurrences").document(occ_id)

    now_iso = datetime.now(timezone.utc).isoformat()
    occ_doc: dict[str, Any] = {
        "schemaVersion": 1,
        "performedOccurrenceId": occ_id,
        "userId": user_id,
        "status": "active",
        "localDate": candidate.date,
        "sourceRefs": [
            {
                "kind": "provider_activity",
                "provider": "garmin",
                "activityId": candidate.activity_id,
            }
        ],
        "reconciliation": {"state": "single_source"},
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }
    if candidate.started_at:
        occ_doc["startedAt"] = candidate.started_at
    if candidate.ended_at:
        occ_doc["endedAt"] = candidate.ended_at
    if candidate.modality:
        occ_doc["modality"] = candidate.modality

    link_doc: dict[str, Any] = {
        "schemaVersion": 1,
        "sourceKey": candidate.source_key,
        "sourceKind": "provider_activity",
        "userId": user_id,
        "performedOccurrenceId": occ_id,
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }

    tx.create(occ_ref, occ_doc)
    tx.create(link_ref, link_doc)
    return "created", occ_id


def apply_training_occurrence_backfill(
    db: Any,
    plan: BackfillPlan,
) -> BackfillApplyResult:
    """Apply the backfill plan using single-source Firestore transactions with create-only semantics."""
    _validate_user_id(plan.user_id)
    user_ref = db.collection("users").document(plan.user_id)

    result = BackfillApplyResult(
        user_id=plan.user_id,
        start_date=plan.start_date,
        end_date_inclusive=plan.end_date_inclusive,
        activities_scanned=plan.activities_scanned,
        planned_candidates=len(plan.eligible_candidates),
        already_linked_before_apply=plan.already_linked_count,
        anomalies=list(plan.anomalies),
    )

    # Dry-run and apply use the same fail-closed boundary. If preflight observed any
    # malformed activity/link/occurrence state, do not partially migrate the remaining
    # candidates and hope the post-write audit catches it later.
    blocking_anomalies = list(plan.anomalies)
    if blocking_anomalies:
        raise ValueError(
            f"Cannot apply backfill due to {len(blocking_anomalies)} blocking invariant anomalies: "
            f"{[a.message for a in blocking_anomalies]}"
        )

    for candidate in plan.eligible_candidates:
        link_ref = user_ref.collection("performedOccurrenceSourceLinks").document(
            candidate.source_link_doc_id
        )

        try:
            transaction = db.transaction()

            if hasattr(transaction, "_read_only"):
                from google.cloud import firestore

                outcome, created_id = firestore.transactional(_perform_candidate_tx)(
                    transaction, user_ref, link_ref, candidate, plan.user_id
                )
            else:
                outcome, created_id = _perform_candidate_tx(
                    transaction, user_ref, link_ref, candidate, plan.user_id
                )

            if outcome == "created" and created_id:
                result.created += 1
                result.created_occurrence_ids.append(created_id)
            elif outcome == "concurrently_linked":
                result.concurrently_linked += 1

        except Exception as exc:
            logger.error("Failed to backfill candidate activity %s: %s", candidate.activity_id, exc)
            result.failed += 1
            result.anomalies.append(
                BackfillAnomaly(
                    anomaly_type="transaction_failure",
                    message=f"Transaction failed for activity {candidate.activity_id}: {exc}",
                    activity_id=candidate.activity_id,
                    source_key=candidate.source_key,
                )
            )

    return result


def audit_training_occurrence_backfill(
    db: Any,
    user_id: str,
    start_date: str,
    end_date_inclusive: str,
) -> BackfillAuditResult:
    """Perform post-migration verification audit over the window."""
    _validate_user_id(user_id)
    _validate_date_window(start_date, end_date_inclusive)

    user_ref = db.collection("users").document(user_id)
    audit = BackfillAuditResult(
        user_id=user_id, start_date=start_date, end_date_inclusive=end_date_inclusive
    )

    activity_stream = (
        user_ref.collection("activities")
        .where(filter=FieldFilter("date", ">=", start_date))
        .where(filter=FieldFilter("date", "<=", end_date_inclusive))
        .order_by("date")
        .stream()
    )

    activities: list[dict[str, Any]] = []
    for snapshot in activity_stream:
        data = snapshot.to_dict() or {}
        activities.append({"id": snapshot.id, "data": data})

    audit.eligible_activities_checked = len(activities)

    # First prove every activity resolves through one well-formed source link to one
    # active occurrence that actually carries that Garmin source ref.
    for act in activities:
        act_data = act["data"]
        activity_id = str(act_data.get("activityId") or act["id"]).strip()
        source_key = provider_activity_source_key("garmin", activity_id)
        doc_id = encode_source_key_for_doc_id(source_key)

        link_snap = user_ref.collection("performedOccurrenceSourceLinks").document(doc_id).get()
        if not link_snap.exists:
            audit.missing_links += 1
            audit.issues.append(f"Missing source link for activity {activity_id} ({source_key})")
            continue

        link_data = link_snap.to_dict() or {}
        if (
            link_data.get("schemaVersion") != 1
            or link_data.get("sourceKey") != source_key
            or link_data.get("sourceKind") != "provider_activity"
            or link_data.get("userId") != user_id
        ):
            audit.invalid_links += 1
            audit.issues.append(
                f"Invalid source-link claim for activity {activity_id}: {link_data}"
            )
            continue

        target_occ_id = str(link_data.get("performedOccurrenceId") or "")
        if not target_occ_id:
            audit.invalid_links += 1
            audit.issues.append(
                f"Source link missing performedOccurrenceId for activity {activity_id}"
            )
            continue

        occ_snap = user_ref.collection("performedTrainingOccurrences").document(target_occ_id).get()
        if not occ_snap.exists:
            audit.invalid_links += 1
            audit.issues.append(
                f"Target occurrence {target_occ_id} does not exist for activity {activity_id}"
            )
            continue

        occ_data = occ_snap.to_dict() or {}
        if (
            occ_data.get("schemaVersion") != 1
            or occ_data.get("userId") != user_id
            or occ_data.get("status") != "active"
        ):
            audit.invalid_links += 1
            audit.issues.append(
                f"Target occurrence {target_occ_id} is not an active schema-v1 occurrence for {user_id}"
            )
            continue

        refs = occ_data.get("sourceRefs")
        has_matching_ref = isinstance(refs, list) and any(
            isinstance(ref, dict)
            and ref.get("kind") == "provider_activity"
            and str(ref.get("provider", "")).strip().lower() == "garmin"
            and str(ref.get("activityId", "")) == activity_id
            for ref in refs
        )
        if not has_matching_ref:
            audit.invalid_links += 1
            audit.issues.append(
                f"Target occurrence {target_occ_id} does not contain source ref for activity {activity_id}"
            )
            continue

        audit.verified_links += 1

    # Then independently scan active canonical occurrences. Looking only from activity ->
    # source-link cannot detect two active occurrences carrying the same source ref because
    # there is, by design, only one source-link document per key.
    occ_stream = (
        user_ref.collection("performedTrainingOccurrences")
        .where(filter=FieldFilter("localDate", ">=", start_date))
        .where(filter=FieldFilter("localDate", "<=", end_date_inclusive))
        .where(filter=FieldFilter("status", "==", "active"))
        .stream()
    )

    active_occurrence_ids_for_source: dict[str, list[str]] = {}
    for occ_snap in occ_stream:
        occ_data = occ_snap.to_dict() or {}
        refs = occ_data.get("sourceRefs")
        if not isinstance(refs, list):
            audit.invalid_links += 1
            audit.issues.append(f"Active occurrence {occ_snap.id} has invalid sourceRefs")
            continue

        for ref in refs:
            if (
                not isinstance(ref, dict)
                or ref.get("kind") != "provider_activity"
                or str(ref.get("provider", "")).strip().lower() != "garmin"
            ):
                continue

            activity_id = str(ref.get("activityId", "")).strip()
            if not activity_id:
                audit.invalid_links += 1
                audit.issues.append(
                    f"Active occurrence {occ_snap.id} has Garmin source ref without activityId"
                )
                continue

            source_key = provider_activity_source_key("garmin", activity_id)
            active_occurrence_ids_for_source.setdefault(source_key, []).append(occ_snap.id)
            link_snap = (
                user_ref.collection("performedOccurrenceSourceLinks")
                .document(encode_source_key_for_doc_id(source_key))
                .get()
            )
            if not link_snap.exists:
                audit.invalid_links += 1
                audit.issues.append(
                    f"Active occurrence {occ_snap.id} carries {source_key} without a source link"
                )
                continue

            link_data = link_snap.to_dict() or {}
            if (
                link_data.get("schemaVersion") != 1
                or link_data.get("sourceKey") != source_key
                or link_data.get("sourceKind") != "provider_activity"
                or link_data.get("userId") != user_id
                or str(link_data.get("performedOccurrenceId") or "") != occ_snap.id
            ):
                audit.invalid_links += 1
                audit.issues.append(
                    f"Active occurrence {occ_snap.id} does not own the unique source-link claim for {source_key}"
                )

    for source_key, occurrence_ids in active_occurrence_ids_for_source.items():
        distinct_ids = sorted(set(occurrence_ids))
        if len(distinct_ids) > 1:
            audit.invalid_links += 1
            audit.issues.append(
                f"Source key {source_key} is present on multiple active occurrences: {distinct_ids}"
            )

    audit.audit_passed = audit.missing_links == 0 and audit.invalid_links == 0
    return audit
