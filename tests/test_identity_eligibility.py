from dataclasses import FrozenInstanceError

import pytest

from garmin_sync.identity_eligibility import (
    EffectiveIdentityDecisionProjection,
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


def test_projection_is_immutable() -> None:
    decision = _decision()
    with pytest.raises(FrozenInstanceError):
        decision.baseline_learning = False  # type: ignore[misc]
