"""Fail-closed effective-identity eligibility projection (PI5/ADR-0028).

This is the Python audit-side equivalent of the TypeScript ``identityEligibility.ts`` boundary.
It deliberately does not call the provisional co-presence heuristic. A configured shared-source
bundle is baseline-eligible only when an exact bundle revision/hash projection resolves to
effective ``USER`` and explicitly grants ``baselineLearning``.

PI6 supplies these projections from persisted immutable assessments + append-only reviews.
Absence of a valid, unambiguous projection is ``UNCERTAIN``/ineligible, never guessed from
physiology.
"""

import math
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Mapping, Sequence, TypeAlias, cast

IdentityStatus: TypeAlias = Literal["USER", "NOT_USER", "UNCERTAIN"]
IdentityBundleKey: TypeAlias = tuple[str, str, str]

_IDENTITY_STATUSES = {"USER", "NOT_USER", "UNCERTAIN"}
_IDENTITY_CONFIDENCE_TIERS = {"HIGH", "MODERATE", "LOW", "NONE"}
_IDENTITY_REASON_CODES = {
    "ANCHOR_MISSING",
    "ANCHOR_QUALITY_INSUFFICIENT",
    "EVIDENCE_LINEAGE_DEPENDENT",
    "INSUFFICIENT_PASSPORT_HISTORY",
    "MULTIPLE_PAIRING_CANDIDATES",
    "SESSION_TIMING_CONCORDANT",
    "SESSION_TIMING_DISCORDANT",
    "RHR_RELATION_CONCORDANT",
    "RHR_RELATION_DISCORDANT",
    "RESPIRATION_RELATION_CONCORDANT",
    "RESPIRATION_RELATION_DISCORDANT",
    "HRV_RELATION_CONCORDANT",
    "HRV_RELATION_DISCORDANT",
    "MIXED_OCCUPANCY_SUSPECTED",
    "SESSION_INTERVAL_INVALID",
}
_PASSPORT_CHANGE_REASONS = {
    "GARMIN_DEVICE_OR_ALGORITHM_CHANGE",
    "EIGHT_SLEEP_ALGORITHM_OR_API_CHANGE",
    "GOOGLE_HEALTH_MAPPING_CHANGE",
    "MEASUREMENT_SYSTEM_SHIFT_CONFIRMED_BY_REPLAY",
    "INITIAL_BOOTSTRAP",
    "OTHER",
}


@dataclass(frozen=True)
class EffectiveIdentityDecisionProjection:
    """Minimal replay-safe projection required by the Python baseline audit."""

    assessment_id: str
    source_night_key: str
    provider: str
    transport: str
    bundle_id: str
    bundle_revision: int
    source_payload_hash: str
    effective_status: IdentityStatus
    baseline_learning: bool
    automatic_status: IdentityStatus = "UNCERTAIN"
    review_event_id: str | None = None


def _non_empty_string(value: object) -> str | None:
    return value if isinstance(value, str) and bool(value) else None


def _identity_status(value: object) -> IdentityStatus | None:
    return cast(IdentityStatus, value) if value in _IDENTITY_STATUSES else None


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def _is_int(value: object, *, minimum: int = 0) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def _is_finite_or_none(value: object) -> bool:
    if value is None:
        return True
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_identity_bundle_ref(value: object) -> bool:
    """Return whether a persisted observation reference has complete replay metadata."""

    if not isinstance(value, Mapping):
        return False
    return bool(
        _non_empty_string(value.get("id"))
        and _non_empty_string(value.get("provider"))
        and _non_empty_string(value.get("transport"))
        and _is_int(value.get("revision"), minimum=1)
        and _non_empty_string(value.get("sourcePayloadHash"))
        and _non_empty_string(value.get("lineageKey"))
    )


def _validate_scalar_estimate(value: object) -> bool:
    if not isinstance(value, Mapping):
        return False
    return bool(
        _is_finite_or_none(value.get("median"))
        and _is_finite_or_none(value.get("mad"))
        and _is_finite_or_none(value.get("iqr"))
        and _is_int(value.get("n"))
    )


def _validate_location_estimate(value: object) -> bool:
    if not isinstance(value, Mapping):
        return False
    return bool(
        _is_finite_or_none(value.get("median"))
        and _is_finite_or_none(value.get("mad"))
        and _is_int(value.get("n"))
    )


def _validate_ratio_estimate(value: object) -> bool:
    if not isinstance(value, Mapping):
        return False
    return bool(
        _is_finite_or_none(value.get("median"))
        and _is_finite_or_none(value.get("iqr"))
        and _is_int(value.get("n"))
    )


def _validate_passport_core(value: object) -> bool:
    if not isinstance(value, Mapping) or value.get("schemaVersion") != 1:
        return False
    for field in ("passportVersion", "createdAt", "policyVersion", "featureSchemaVersion"):
        if _non_empty_string(value.get(field)) is None:
            return False

    anchor_policy = value.get("anchorPolicy")
    if not isinstance(anchor_policy, Mapping):
        return False
    if not all(
        _non_empty_string(anchor_policy.get(field)) is not None
        for field in ("primaryProvider", "primaryTransport", "role")
    ) or not isinstance(anchor_policy.get("requireIndependentLineage"), bool):
        return False

    source_profiles = value.get("sourceProfiles")
    cross_source_profiles = value.get("crossSourceProfiles")
    if not isinstance(source_profiles, Mapping) or not isinstance(cross_source_profiles, Mapping):
        return False
    for profile in source_profiles.values():
        if not isinstance(profile, Mapping) or not _is_int(profile.get("trustedNightCount")):
            return False
        if not all(
            _validate_scalar_estimate(profile.get(field))
            for field in ("restingHeartRate", "respirationRate", "logHrv")
        ):
            return False
        if not all(
            _validate_location_estimate(profile.get(field))
            for field in ("sleepStartMinutesLocal", "sleepDurationMinutes")
        ):
            return False
    for profile in cross_source_profiles.values():
        if not isinstance(profile, Mapping):
            return False
        if not all(
            _validate_scalar_estimate(profile.get(field))
            for field in ("rhrResidual", "respirationResidual", "hrvLogResidual")
        ):
            return False
        if not all(
            _validate_location_estimate(profile.get(field))
            for field in ("startDeltaMinutes", "endDeltaMinutes", "durationDeltaMinutes")
        ) or not _validate_ratio_estimate(profile.get("sessionJaccard")):
            return False

    calibration = value.get("calibration")
    if not isinstance(calibration, Mapping):
        return False
    if not all(
        _is_int(calibration.get(field))
        for field in (
            "manualUserCount",
            "manualNotUserCount",
            "mixedOccupancyCount",
            "uncertainCount",
        )
    ):
        return False
    for field in ("shadowWindowStart", "shadowWindowEnd"):
        window = calibration.get(field)
        if window is not None and _non_empty_string(window) is None:
            return False
    return True


def validate_identity_passport_current(value: object) -> bool:
    """Validate the complete materialized-current passport schema before persistence."""

    return bool(
        _validate_passport_core(value)
        and isinstance(value, Mapping)
        and _non_empty_string(value.get("updatedAt"))
    )


def validate_identity_passport_version(value: object) -> bool:
    """Validate the complete immutable passport-version schema before persistence."""

    if not _validate_passport_core(value) or not isinstance(value, Mapping):
        return False
    training_set_hash = value.get("trainingSetHash")
    previous_version = value.get("previousVersion")
    return bool(
        isinstance(training_set_hash, str)
        and re.fullmatch(r"[0-9a-f]{64}", training_set_hash)
        and _is_int(value.get("trainingObservationCount"))
        and _non_empty_string(value.get("trainingWindowStart"))
        and _non_empty_string(value.get("trainingWindowEnd"))
        and (previous_version is None or _non_empty_string(previous_version))
        and value.get("changeReason") in _PASSPORT_CHANGE_REASONS
        and _non_empty_string(value.get("algorithmVersion"))
    )


def validate_automatic_identity_assessment(value: object) -> bool:
    """Validate the complete immutable automatic-assessment contract."""

    if not isinstance(value, Mapping):
        return False
    identity_score = value.get("identityScore")
    shared_source = value.get("sharedSource")
    shared_ref = value.get("sharedBundleRef")
    anchor_refs = value.get("anchorBundleRefs")
    reason_codes = value.get("reasonCodes")
    passport_version = value.get("passportVersion")
    if (
        _non_empty_string(value.get("id")) is None
        or _non_empty_string(value.get("sourceNightKey")) is None
        or not isinstance(shared_source, Mapping)
        or _non_empty_string(shared_source.get("provider")) is None
        or _non_empty_string(shared_source.get("transport")) is None
        or _identity_status(value.get("automaticStatus")) is None
        or not _is_finite_or_none(identity_score)
        or value.get("confidenceTier") not in _IDENTITY_CONFIDENCE_TIERS
        or not isinstance(reason_codes, list)
        or not all(isinstance(code, str) and code in _IDENTITY_REASON_CODES for code in reason_codes)
        or (passport_version is not None and _non_empty_string(passport_version) is None)
        or _non_empty_string(value.get("policyVersion")) is None
        or _non_empty_string(value.get("featureSchemaVersion")) is None
        or _non_empty_string(value.get("assessedAt")) is None
        or not validate_identity_bundle_ref(shared_ref)
        or not isinstance(anchor_refs, list)
        or not all(validate_identity_bundle_ref(ref) for ref in anchor_refs)
    ):
        return False
    assert isinstance(shared_ref, Mapping)
    return bool(
        shared_ref.get("provider") == shared_source.get("provider")
        and shared_ref.get("transport") == shared_source.get("transport")
    )


def _review_semantics_are_valid(event: Mapping[str, Any]) -> bool:
    label = _identity_status(event.get("label"))
    attestation = event.get("occupancyAttestation")
    if label == "USER":
        return attestation == "EXCLUSIVE"
    if label == "NOT_USER":
        return attestation == "UNKNOWN"
    if label == "UNCERTAIN":
        return attestation in {"MIXED", "UNKNOWN"}
    return False


def validate_identity_review_event(
    value: object,
    *,
    expected_assessment_id: str | None = None,
) -> bool:
    """Validate a complete review event, including label/occupancy semantics."""

    if not isinstance(value, Mapping):
        return False
    event_id = _non_empty_string(value.get("id"))
    assessment_id = _non_empty_string(value.get("assessmentId"))
    supersedes = value.get("supersedesReviewEventId")
    if (
        event_id is None
        or assessment_id is None
        or (expected_assessment_id is not None and assessment_id != expected_assessment_id)
        or value.get("schemaVersion") != 1
        or _identity_status(value.get("label")) is None
        or value.get("occupancyAttestation") not in {"EXCLUSIVE", "MIXED", "UNKNOWN"}
        or (supersedes is not None and _non_empty_string(supersedes) is None)
        or supersedes == event_id
        or _parse_timestamp(value.get("recordedAt")) is None
        or value.get("source") not in {"user_ui", "admin_replay"}
        or not _review_semantics_are_valid(value)
    ):
        return False
    return True


def _effective_review_event(
    assessment_id: str,
    review_events: Sequence[Mapping[str, Any]],
) -> Mapping[str, Any] | None:
    """Resolve the newest head from valid append-only supersession chains.

    A correction is admitted only after its referenced predecessor is admitted and only when its
    timestamp is monotonic. Orphans, cycles, malformed events, and events for another assessment
    therefore cannot influence effective identity.
    """

    candidates: dict[str, Mapping[str, Any]] = {}
    duplicate_ids: set[str] = set()
    for event in review_events:
        event_id = _non_empty_string(event.get("id"))
        if event_id is None or not validate_identity_review_event(
            event,
            expected_assessment_id=assessment_id,
        ):
            continue
        if event_id in candidates:
            duplicate_ids.add(event_id)
        candidates[event_id] = event
    for duplicate_id in duplicate_ids:
        candidates.pop(duplicate_id, None)

    accepted: dict[str, Mapping[str, Any]] = {
        event_id: event
        for event_id, event in candidates.items()
        if event.get("supersedesReviewEventId") is None
    }
    while True:
        added = False
        for event_id, event in candidates.items():
            if event_id in accepted:
                continue
            parent_id = _non_empty_string(event.get("supersedesReviewEventId"))
            parent = accepted.get(parent_id or "")
            event_time = _parse_timestamp(event.get("recordedAt"))
            parent_time = _parse_timestamp(parent.get("recordedAt")) if parent else None
            if parent and event_time and parent_time and event_time >= parent_time:
                accepted[event_id] = event
                added = True
        if not added:
            break

    if not accepted:
        return None
    superseded_ids = {
        parent_id
        for event in accepted.values()
        if (parent_id := _non_empty_string(event.get("supersedesReviewEventId"))) is not None
    }
    heads = [event for event_id, event in accepted.items() if event_id not in superseded_ids]
    return max(
        heads,
        key=lambda event: (
            (
                parsed.timestamp()
                if (parsed := _parse_timestamp(event.get("recordedAt"))) is not None
                else float("-inf")
            ),
            str(event.get("id", "")),
        ),
    )


def derive_effective_identity_decision_projection(
    assessment: Mapping[str, Any],
    review_events: Sequence[Mapping[str, Any]],
) -> EffectiveIdentityDecisionProjection | None:
    """Derive the replay-safe baseline projection without mutating persisted records."""

    if not validate_automatic_identity_assessment(assessment):
        return None
    assessment_id = _non_empty_string(assessment.get("id"))
    source_night_key = _non_empty_string(assessment.get("sourceNightKey"))
    automatic_status = _identity_status(assessment.get("automaticStatus"))
    shared_source = assessment.get("sharedSource")
    shared_ref = assessment.get("sharedBundleRef")
    if (
        assessment_id is None
        or source_night_key is None
        or automatic_status is None
        or not isinstance(shared_source, Mapping)
        or not isinstance(shared_ref, Mapping)
    ):
        return None
    provider = _non_empty_string(shared_source.get("provider"))
    transport = _non_empty_string(shared_source.get("transport"))
    bundle_id = _non_empty_string(shared_ref.get("id"))
    source_payload_hash = _non_empty_string(shared_ref.get("sourcePayloadHash"))
    revision = shared_ref.get("revision")
    if (
        provider is None
        or transport is None
        or bundle_id is None
        or source_payload_hash is None
        or shared_ref.get("provider") != provider
        or shared_ref.get("transport") != transport
        or not _is_int(revision, minimum=1)
    ):
        return None

    current_review = _effective_review_event(assessment_id, review_events)
    effective_status = (
        _identity_status(current_review.get("label")) if current_review else automatic_status
    )
    if effective_status is None:
        return None
    attestation = current_review.get("occupancyAttestation") if current_review else "UNKNOWN"
    reason_codes = assessment.get("reasonCodes")
    mixed_suspected = (
        isinstance(reason_codes, list) and "MIXED_OCCUPANCY_SUSPECTED" in reason_codes
    ) or attestation == "MIXED"
    baseline_learning = effective_status == "USER" and not (
        mixed_suspected and attestation != "EXCLUSIVE"
    )

    return EffectiveIdentityDecisionProjection(
        assessment_id=assessment_id,
        source_night_key=source_night_key,
        provider=provider,
        transport=transport,
        bundle_id=bundle_id,
        bundle_revision=cast(int, revision),
        source_payload_hash=source_payload_hash,
        effective_status=effective_status,
        baseline_learning=baseline_learning,
        automatic_status=automatic_status,
        review_event_id=(_non_empty_string(current_review.get("id")) if current_review else None),
    )


def build_effective_identity_decision_index(
    assessments: Sequence[Mapping[str, Any]],
    review_events_by_assessment: Mapping[str, Sequence[Mapping[str, Any]]],
) -> dict[IdentityBundleKey, EffectiveIdentityDecisionProjection]:
    """Index unambiguous projections; duplicate assessments for one source fail closed."""

    grouped: dict[IdentityBundleKey, list[EffectiveIdentityDecisionProjection]] = {}
    for assessment in assessments:
        assessment_id = assessment.get("id")
        reviews = (
            review_events_by_assessment.get(assessment_id, [])
            if isinstance(assessment_id, str)
            else []
        )
        projection = derive_effective_identity_decision_projection(assessment, reviews)
        if projection is None:
            continue
        key = (projection.source_night_key, projection.provider, projection.transport)
        grouped.setdefault(key, []).append(projection)
    return {key: values[0] for key, values in grouped.items() if len(values) == 1}


def identity_bundle_key(bundle: Mapping[str, Any]) -> IdentityBundleKey | None:
    logical_date = bundle.get("logicalDate")
    provider = bundle.get("provider")
    transport = bundle.get("transport")
    if not isinstance(logical_date, str) or not logical_date:
        return None
    if not isinstance(provider, str) or not provider:
        return None
    if not isinstance(transport, str) or not transport:
        return None
    return logical_date, provider, transport


def health_observation_bundle_id(bundle: Mapping[str, Any]) -> str | None:
    key = identity_bundle_key(bundle)
    return "_".join(key) if key else None


def is_bundle_baseline_eligible(
    bundle: Mapping[str, Any],
    decisions: Mapping[IdentityBundleKey, EffectiveIdentityDecisionProjection],
) -> bool:
    """Return true only for an exact effective-USER bundle projection.

    Revision/hash mismatches are expected after corrected ingestion and fail closed so a stale
    assessment cannot silently authorise different observation bytes.
    """

    decision = resolve_bundle_identity_projection(bundle, decisions)
    if decision is None:
        return False
    return decision.effective_status == "USER" and decision.baseline_learning


def resolve_bundle_identity_projection(
    bundle: Mapping[str, Any],
    decisions: Mapping[IdentityBundleKey, EffectiveIdentityDecisionProjection],
) -> EffectiveIdentityDecisionProjection | None:
    """Resolve only an exact current-bundle projection; stale metadata resolves as absent."""

    key = identity_bundle_key(bundle)
    bundle_id = health_observation_bundle_id(bundle)
    if key is None or bundle_id is None:
        return None
    decision = decisions.get(key)
    if decision is None:
        return None
    revision = bundle.get("revision")
    source_payload_hash = bundle.get("sourcePayloadHash")
    exact_match = (
        bool(decision.assessment_id)
        and decision.source_night_key == key[0]
        and decision.provider == key[1]
        and decision.transport == key[2]
        and decision.bundle_id == bundle_id
        and isinstance(revision, int)
        and not isinstance(revision, bool)
        and decision.bundle_revision == revision
        and isinstance(source_payload_hash, str)
        and decision.source_payload_hash == source_payload_hash
    )
    return decision if exact_match else None
