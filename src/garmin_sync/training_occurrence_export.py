"""TO4/TO5 evidence extraction for issue #646 (ADR-0034 training-occurrence plan).

Two bounded, read-only extractors that feed the TypeScript preparation step
(``app/scripts/training-occurrence-prepare.mjs``):

- ``export_training_occurrence_records`` reads exactly one user's subtree
  (``users/{user_id}/...``) for a date window: performed occurrences, the session executions
  they reference, activities and daily recommendations. It never lists ``users`` and never
  writes. The output is raw private data and belongs only under the git-ignored
  ``app/artifacts/training-occurrence/`` directory.
- ``collect_fit_identity_evidence`` re-downloads Garmin originals one at a time, decodes them
  in memory through the production decoder, and keeps only classifications and fingerprints.
  Original bytes are dropped as soon as they are decoded; they are never written anywhere.

FIT fingerprints are diagnostic identity evidence only. They are never compared with an
Adaptive ``prescriptionHash``; the two are different identity schemes.
"""

import hashlib
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable, Protocol

from google.cloud.firestore_v1.base_query import FieldFilter

from .fit_activity import FitActivityDecodeError, FitActivityEvidence, decode_activity_original
from .fit_workout_identity import FIT_WORKOUT_FINGERPRINT_VERSION, compute_fit_workout_fingerprint

RECORD_EXPORT_SCHEMA_VERSION = 1
MAX_WINDOW_DAYS = 366


def _jsonable(value: Any) -> Any:
    """Firestore timestamps become ISO strings; the TS parsers expect string instants."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _jsonable(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(child) for child in value]
    return value


def _validate_window(start_date: str, end_date_exclusive: str) -> None:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date_exclusive)
    if start >= end:
        raise ValueError("start_date must be before end_date_exclusive")
    if (end - start).days > MAX_WINDOW_DAYS:
        raise ValueError(f"Evidence export window is limited to {MAX_WINDOW_DAYS} days")


def _document(snapshot: Any) -> dict[str, Any]:
    return {"id": snapshot.id, "data": _jsonable(snapshot.to_dict() or {})}


def export_training_occurrence_records(
    db: Any, user_id: str, start_date: str, end_date_exclusive: str
) -> dict[str, Any]:
    """Return one user's bounded TO4 record export in the TS ``TrainingOccurrenceRecordExport`` shape."""
    if not user_id or "/" in user_id:
        raise ValueError("A single concrete user_id is required")
    _validate_window(start_date, end_date_exclusive)
    user = db.collection("users").document(user_id)

    def in_window(collection: str, field_name: str) -> list[dict[str, Any]]:
        stream = (
            user.collection(collection)
            .where(filter=FieldFilter(field_name, ">=", start_date))
            .where(filter=FieldFilter(field_name, "<", end_date_exclusive))
            .order_by(field_name)
            .stream()
        )
        return [_document(snapshot) for snapshot in stream]

    occurrences = in_window("performedTrainingOccurrences", "localDate")
    activities = in_window("activities", "date")
    recommendations = in_window("daily_recommendations", "date")

    execution_ids: set[str] = set()
    referenced_activity_ids: set[str] = set()
    for occurrence in occurrences:
        for ref in occurrence["data"].get("sourceRefs") or []:
            if ref.get("kind") == "structured_execution" and ref.get("executionId"):
                execution_ids.add(str(ref["executionId"]))
            if ref.get("kind") == "provider_activity" and ref.get("activityId"):
                referenced_activity_ids.add(str(ref["activityId"]))

    executions = []
    execution_entries: list[dict[str, Any]] = []
    execution_prescriptions: list[dict[str, Any]] = []
    for execution_id in sorted(execution_ids):
        snapshot = user.collection("session_executions").document(execution_id).get()
        if snapshot.exists:
            execution = _document(snapshot)
            executions.append(execution)
            entries = (
                user.collection("session_executions")
                .document(execution_id)
                .collection("entries")
                .stream()
            )
            execution_entries.extend(_document(entry) for entry in entries)
            prescription_hash = execution["data"].get("prescriptionHash")
            if prescription_hash:
                prescription = (
                    user.collection("execution_prescriptions")
                    .document(str(prescription_hash))
                    .get()
                )
                if prescription.exists:
                    execution_prescriptions.append(_document(prescription))

    # An occurrence near the window edge may reference an activity whose provider date falls
    # just outside it; fetch those by ID so hydration does not report a false missing source.
    known = {document["id"] for document in activities}
    for activity_id in sorted(referenced_activity_ids - known):
        snapshot = user.collection("activities").document(activity_id).get()
        if snapshot.exists:
            activities.append(_document(snapshot))

    return {
        "schemaVersion": RECORD_EXPORT_SCHEMA_VERSION,
        "userId": user_id,
        "window": {"startDate": start_date, "endDateExclusive": end_date_exclusive},
        "performedTrainingOccurrences": occurrences,
        "sessionExecutions": executions,
        "sessionEntries": execution_entries,
        "executionPrescriptions": execution_prescriptions,
        "activities": activities,
        "dailyRecommendations": recommendations,
    }


class OriginalDownloader(Protocol):
    def download_activity_original(self, activity_id: str) -> bytes | None: ...


@dataclass(frozen=True)
class FitActivityRef:
    activity_id: str
    local_date: str
    in_matched_structured_occurrence: bool = False


@dataclass
class FitIdentityEvidence:
    aggregate: dict[str, Any] = field(default_factory=dict)
    private_rows: list[dict[str, Any]] = field(default_factory=list)


def _fingerprint_kind(evidence: FitActivityEvidence) -> str:
    if evidence.workout_steps:
        return "semantic_definition"
    if evidence.workout_step_indices or (evidence.workout_name or "").strip():
        return "index_fallback"
    return "no_workout_evidence"


def _fingerprint(evidence: FitActivityEvidence) -> str | None:
    return compute_fit_workout_fingerprint(
        evidence.workout_name, evidence.workout_step_indices, evidence.workout_steps
    )


def _alias(activity_id: str, salt: str) -> str:
    return "fit-" + hashlib.sha256(f"{salt}:{activity_id}".encode()).hexdigest()[:12]


def collect_fit_identity_evidence(
    downloader: OriginalDownloader,
    activities: list[FitActivityRef],
    alias_salt: str,
    *,
    is_rate_limit: Callable[[BaseException], bool] = lambda _error: False,
    decode: Callable[[bytes], FitActivityEvidence] = decode_activity_original,
) -> FitIdentityEvidence:
    """Decode each original twice in memory and aggregate TO5 counts.

    A missing original, a download failure and a decode failure are counted separately and
    never abort the run; a rate limit stops further downloads and the remainder is reported
    as not examined rather than unavailable.
    """
    counts: Counter[str] = Counter()
    rows: list[dict[str, Any]] = []
    fingerprints_by_date: dict[str, list[str | None]] = defaultdict(list)
    fingerprints: Counter[str] = Counter()
    for index, ref in enumerate(
        sorted(activities, key=lambda item: (item.local_date, item.activity_id))
    ):
        row: dict[str, Any] = {"alias": _alias(ref.activity_id, alias_salt), "date": ref.local_date}
        try:
            original = downloader.download_activity_original(ref.activity_id)
        except Exception as error:  # noqa: BLE001 -- every failure class is evidence, never fatal
            if is_rate_limit(error):
                counts["notExaminedRateLimited"] += len(activities) - index
                break
            counts["activitiesExamined"] += 1
            counts["downloadFailure"] += 1
            rows.append({**row, "outcome": "download_failure"})
            continue
        counts["activitiesExamined"] += 1
        if original is None:
            counts["originalFitUnavailable"] += 1
            rows.append({**row, "outcome": "original_unavailable"})
            continue
        counts["originalFitAvailable"] += 1
        try:
            first = decode(original)
            second = decode(original)
        except FitActivityDecodeError:
            counts["decodeFailure"] += 1
            counts["malformedCount"] += 1
            rows.append({**row, "outcome": "decode_failure"})
            continue
        except Exception:  # noqa: BLE001 -- an unexpected decoder failure is unsupported input
            counts["decodeFailure"] += 1
            counts["unsupportedCount"] += 1
            rows.append({**row, "outcome": "decode_unsupported"})
            continue
        finally:
            del original
        counts["decodeSuccess"] += 1
        kind = _fingerprint_kind(first)
        fingerprint = _fingerprint(first)
        if fingerprint != _fingerprint(second):
            counts["deterministicRepeatDecodeMismatches"] += 1
        counts[
            {
                "semantic_definition": "semanticDefinitionFingerprintCount",
                "index_fallback": "observedIndexFallbackFingerprintCount",
                "no_workout_evidence": "noWorkoutEvidenceCount",
            }[kind]
        ] += 1
        if fingerprint:
            fingerprints[fingerprint] += 1
            if ref.in_matched_structured_occurrence:
                counts["canonicalMatchedWithFitFingerprint"] += 1
        fingerprints_by_date[ref.local_date].append(fingerprint)
        rows.append(
            {**row, "outcome": "decoded", "fingerprintKind": kind, "fingerprint": fingerprint}
        )

    for day in fingerprints_by_date.values():
        for left in range(len(day)):
            for right in range(left + 1, len(day)):
                if day[left] and day[right] and day[left] != day[right]:
                    counts["discriminationImprovedCount"] += 1
                else:
                    counts["discriminationUnchangedCount"] += 1

    aggregate: dict[str, Any] = {
        key: counts.get(key, 0)
        for key in (
            "activitiesExamined",
            "originalFitAvailable",
            "originalFitUnavailable",
            "downloadFailure",
            "notExaminedRateLimited",
            "decodeSuccess",
            "decodeFailure",
            "unsupportedCount",
            "malformedCount",
            "semanticDefinitionFingerprintCount",
            "observedIndexFallbackFingerprintCount",
            "noWorkoutEvidenceCount",
            "deterministicRepeatDecodeMismatches",
            "canonicalMatchedWithFitFingerprint",
            "discriminationImprovedCount",
            "discriminationUnchangedCount",
        )
    }
    aggregate["repeatedFingerprintCount"] = sum(1 for count in fingerprints.values() if count > 1)
    aggregate["fitFingerprintVersion"] = FIT_WORKOUT_FINGERPRINT_VERSION
    return FitIdentityEvidence(aggregate=aggregate, private_rows=rows)


def fit_activity_refs_from_records(records: dict[str, Any]) -> list[FitActivityRef]:
    """Every Garmin activity in the exported window, flagged when a matched structured
    occurrence links it -- association evidence only, never an exact Adaptive identity."""
    matched: set[str] = set()
    for occurrence in records.get("performedTrainingOccurrences", []):
        data = occurrence.get("data") or {}
        refs = data.get("sourceRefs") or []
        if data.get("status") != "active" or not any(
            ref.get("kind") == "structured_execution" for ref in refs
        ):
            continue
        matched.update(
            str(ref["activityId"])
            for ref in refs
            if ref.get("kind") == "provider_activity"
            and str(ref.get("provider", "")).lower() == "garmin"
        )
    window = records["window"]
    activity_refs: list[FitActivityRef] = []
    for document in records.get("activities", []):
        data = document.get("data") or {}
        activity_date = str(data.get("date", ""))
        if not (window["startDate"] <= activity_date < window["endDateExclusive"]):
            continue
        activity_id = str(data.get("activityId") or document["id"])
        activity_refs.append(FitActivityRef(activity_id, activity_date, activity_id in matched))
    return activity_refs
