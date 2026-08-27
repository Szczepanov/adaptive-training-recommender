from dataclasses import FrozenInstanceError

import pytest

from garmin_sync.identity_eligibility import (
    EffectiveIdentityDecisionProjection,
    build_effective_identity_decision_index,
    derive_effective_identity_decision_projection,
    health_observation_bundle_id,
    identity_bundle_key,
    is_bundle_baseline_eligible,
    resolve_bundle_identity_projection,
)


def _bundle() -> dict[str, object]:
    return {
        "logicalDate": "2026-08-27",
        "provider": "shared_bed",
        "transport": "health_aggregator",
        "revision": 2,
        "sourcePayloadHash": "sha256:shared",
        "observations": [],
    }


def _decision(**overrides: object) -> EffectiveIdentityDecisionProjection:
    values: dict[str, object] = {
        "assessment_id": "assessment-1",
        "source_night_key": "2026-08-27",
        "provider": "shared_bed",
        "transport": "health_aggregator",
        "bundle_id": "2026-08-27_shared_bed_health_aggregator",
        "bundle_revision": 2,
        "source_payload_hash": "sha256:shared",
        "effective_status": "USER",
        "baseline_learning": True,
    }
    values.update(overrides)
    return EffectiveIdentityDecisionProjection(**values)  # type: ignore[arg-type]


def test_identity_bundle_key_and_id_are_provider_neutral() -> None:
    bundle = _bundle()
    assert identity_bundle_key(bundle) == (
        "2026-08-27",
        "shared_bed",
        "health_aggregator",
    )
    assert health_observation_bundle_id(bundle) == ("2026-08-27_shared_bed_health_aggregator")


def test_exact_effective_user_projection_is_baseline_eligible() -> None:
    bundle = _bundle()
    decisions = {identity_bundle_key(bundle): _decision()}
    assert is_bundle_baseline_eligible(bundle, decisions) is True  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("override", "expected_status"),
    [
        ({"effective_status": "UNCERTAIN"}, "UNCERTAIN"),
        ({"effective_status": "NOT_USER"}, "NOT_USER"),
        ({"baseline_learning": False}, "USER"),
        ({"bundle_revision": 1}, "USER"),
        ({"source_payload_hash": "sha256:stale"}, "USER"),
        ({"bundle_id": "wrong-id"}, "USER"),
    ],
)
def test_non_authoritative_or_stale_projection_fails_closed(
    override: dict[str, object], expected_status: str
) -> None:
    bundle = _bundle()
    decision = _decision(**override)
    assert decision.effective_status == expected_status
    assert (
        is_bundle_baseline_eligible(
            bundle,
            {("2026-08-27", "shared_bed", "health_aggregator"): decision},
        )
        is False
    )


def test_missing_projection_and_malformed_bundle_fail_closed() -> None:
    assert is_bundle_baseline_eligible(_bundle(), {}) is False
    assert is_bundle_baseline_eligible({"provider": "shared_bed"}, {}) is False


def test_stale_projection_does_not_resolve_as_current_identity_status() -> None:
    bundle = _bundle()
    stale = _decision(bundle_revision=1, effective_status="NOT_USER")
    assert (
        resolve_bundle_identity_projection(
            bundle,
            {("2026-08-27", "shared_bed", "health_aggregator"): stale},
        )
        is None
    )


def test_boolean_bundle_revision_is_rejected() -> None:
    bundle = _bundle()
    bundle["revision"] = True
    assert (
        resolve_bundle_identity_projection(
            bundle,
            {("2026-08-27", "shared_bed", "health_aggregator"): _decision(bundle_revision=1)},
        )
        is None
    )


def test_projection_is_immutable() -> None:
    decision = _decision()
    with pytest.raises(FrozenInstanceError):
        decision.baseline_learning = False  # type: ignore[misc]


def _assessment(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "id": "assessment-1",
        "sourceNightKey": "2026-08-27",
        "sharedSource": {"provider": "shared_bed", "transport": "health_aggregator"},
        "automaticStatus": "UNCERTAIN",
        "identityScore": 0.42,
        "confidenceTier": "LOW",
        "reasonCodes": ["SESSION_TIMING_DISCORDANT"],
        "passportVersion": "2026-08-27.1",
        "policyVersion": "identity-v1-shadow",
        "featureSchemaVersion": "identity-features-v1",
        "assessedAt": "2026-08-27T06:30:00.000Z",
        "sharedBundleRef": {
            "id": "2026-08-27_shared_bed_health_aggregator",
            "provider": "shared_bed",
            "transport": "health_aggregator",
            "revision": 2,
            "sourcePayloadHash": "sha256:shared",
            "lineageKey": "shared_bed:pod-side:a",
        },
        "anchorBundleRefs": [
            {
                "id": "2026-08-27_wearable_direct",
                "provider": "wearable",
                "transport": "direct",
                "revision": 1,
                "sourcePayloadHash": "sha256:anchor",
                "lineageKey": "wearable:device:athlete",
            }
        ],
    }
    value.update(overrides)
    return value


def _review(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "id": "review-1",
        "assessmentId": "assessment-1",
        "schemaVersion": 1,
        "label": "USER",
        "occupancyAttestation": "EXCLUSIVE",
        "supersedesReviewEventId": None,
        "recordedAt": "2026-08-27T08:00:00.000Z",
        "source": "user_ui",
    }
    value.update(overrides)
    return value


def test_persisted_review_correction_derives_effective_projection_without_mutation() -> None:
    assessment = _assessment()
    original = _review()
    correction = _review(
        id="review-2",
        label="NOT_USER",
        occupancyAttestation="UNKNOWN",
        supersedesReviewEventId="review-1",
        recordedAt="2026-08-27T09:00:00.000Z",
    )

    projection = derive_effective_identity_decision_projection(assessment, [correction, original])

    assert projection is not None
    assert projection.automatic_status == "UNCERTAIN"
    assert projection.effective_status == "NOT_USER"
    assert projection.review_event_id == "review-2"
    assert projection.baseline_learning is False
    assert assessment["automaticStatus"] == "UNCERTAIN"


def test_orphan_or_non_monotonic_review_cannot_change_effective_identity() -> None:
    assessment = _assessment(automaticStatus="USER")
    invalid = _review(
        id="review-2",
        label="NOT_USER",
        occupancyAttestation="UNKNOWN",
        supersedesReviewEventId="missing",
        recordedAt="2026-08-27T09:00:00.000Z",
    )
    projection = derive_effective_identity_decision_projection(assessment, [invalid])
    assert projection is not None
    assert projection.effective_status == "USER"
    assert projection.review_event_id is None
    assert projection.baseline_learning is True


def test_cyclic_review_chain_cannot_change_effective_identity() -> None:
    assessment = _assessment(automaticStatus="UNCERTAIN")
    first = _review(id="review-1", supersedesReviewEventId="review-2")
    second = _review(
        id="review-2",
        supersedesReviewEventId="review-1",
        recordedAt="2026-08-27T09:00:00.000Z",
    )
    projection = derive_effective_identity_decision_projection(assessment, [first, second])
    assert projection is not None
    assert projection.effective_status == "UNCERTAIN"
    assert projection.review_event_id is None
    assert projection.baseline_learning is False


def test_incomplete_assessment_cannot_produce_projection() -> None:
    assessment = _assessment()
    assessment.pop("policyVersion")
    assert derive_effective_identity_decision_projection(assessment, [_review()]) is None

    missing_lineage = _assessment()
    shared_ref = dict(missing_lineage["sharedBundleRef"])  # type: ignore[arg-type]
    shared_ref.pop("lineageKey")
    missing_lineage["sharedBundleRef"] = shared_ref
    assert derive_effective_identity_decision_projection(missing_lineage, [_review()]) is None


def test_malformed_review_event_cannot_override_automatic_identity() -> None:
    assessment = _assessment(automaticStatus="UNCERTAIN")
    malformed = _review()
    malformed.pop("source")
    projection = derive_effective_identity_decision_projection(assessment, [malformed])
    assert projection is not None
    assert projection.effective_status == "UNCERTAIN"
    assert projection.review_event_id is None


def test_mixed_occupancy_requires_explicit_exclusive_user_attestation() -> None:
    assessment = _assessment(automaticStatus="USER", reasonCodes=["MIXED_OCCUPANCY_SUSPECTED"])
    automatic = derive_effective_identity_decision_projection(assessment, [])
    reviewed = derive_effective_identity_decision_projection(assessment, [_review()])
    assert automatic is not None and automatic.baseline_learning is False
    assert reviewed is not None and reviewed.baseline_learning is True


def test_duplicate_assessments_for_one_bundle_are_omitted_from_index() -> None:
    duplicate = _assessment(id="assessment-2")
    index = build_effective_identity_decision_index(
        [_assessment(), duplicate], {"assessment-1": [], "assessment-2": []}
    )
    assert index == {}
