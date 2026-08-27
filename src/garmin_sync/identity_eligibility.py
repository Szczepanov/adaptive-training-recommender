"""Fail-closed effective-identity eligibility projection (PI5/ADR-0028).

This is the Python audit-side equivalent of the TypeScript ``identityEligibility.ts`` boundary.
It deliberately does not call the provisional co-presence heuristic. A configured shared-source
bundle is baseline-eligible only when an exact bundle revision/hash projection resolves to
effective ``USER`` and explicitly grants ``baselineLearning``.

PI6 will supply these projections from persisted immutable assessments + append-only reviews.
Until then, absence of a projection is ``UNCERTAIN``/ineligible, never guessed from physiology.
"""

from dataclasses import dataclass
from typing import Any, Literal, Mapping, TypeAlias

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
