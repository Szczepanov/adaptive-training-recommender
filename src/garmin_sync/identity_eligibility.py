"""Fail-closed effective-identity eligibility projection (PI5/ADR-0028).

This is the Python audit-side equivalent of the TypeScript ``identityEligibility.ts`` boundary.
It deliberately does not call the provisional co-presence heuristic. A configured shared-source
bundle is baseline-eligible only when an exact bundle revision/hash projection resolves to
effective ``USER`` and explicitly grants ``baselineLearning``.

PI6 supplies these projections from persisted immutable assessments + append-only reviews.
Absence of a valid, unambiguous projection is ``UNCERTAIN``/ineligible, never guessed from
physiology.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Mapping, Sequence, TypeAlias, cast

IdentityStatus: TypeAlias = Literal["USER", "NOT_USER", "UNCERTAIN"]
IdentityBundleKey: TypeAlias = tuple[str, str, str]


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
    return cast(IdentityStatus, value) if value in {"USER", "NOT_USER", "UNCERTAIN"} else None


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


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
        if (
            event_id is None
            or event.get("assessmentId") != assessment_id
            or event.get("schemaVersion") != 1
            or _parse_timestamp(event.get("recordedAt")) is None
            or not _review_semantics_are_valid(event)
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
        or not isinstance(revision, int)
        or isinstance(revision, bool)
        or revision < 1
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
        bundle_revision=revision,
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
        and decision.bundle_revision == revision
        and isinstance(source_payload_hash, str)
        and decision.source_payload_hash == source_payload_hash
    )
    return decision if exact_match else None
