import re
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from garmin_sync import canonical

_VALID_AUTHORITY_CLASSES = {
    "training_authoritative",
    "planning_authoritative",
    "health_anomaly",
    "observability_only",
    "research_only",
}


def _all_metric_constant_values() -> set[str]:
    """Every METRIC_* string constant defined in canonical.py, read directly from source
    so this stays correct even if new constants are added without remembering to update
    this test by hand."""
    src = Path(canonical.__file__).read_text(encoding="utf-8")
    names = re.findall(r'^(METRIC_\w+)\s*=\s*"', src, re.MULTILINE)
    return {getattr(canonical, name) for name in names}


def test_observation_authority_covers_every_metric_constant_exactly() -> None:
    """OBSERVATION_AUTHORITY is a lint-able reference (docs/analysis/
    2026-08-29-sleep-data-training-recommendations-analysis.md) -- a metric with no
    classification, or a stale entry for a metric that no longer exists, defeats its
    purpose silently. Catch both directions."""
    all_metrics = _all_metric_constant_values()
    classified = set(canonical.OBSERVATION_AUTHORITY.keys())
    assert all_metrics - classified == set(), "unclassified metric constant(s) found"
    assert classified - all_metrics == set(), "stale OBSERVATION_AUTHORITY entry/entries found"


def test_observation_authority_values_are_valid_classes() -> None:
    invalid = {
        metric: cls
        for metric, cls in canonical.OBSERVATION_AUTHORITY.items()
        if cls not in _VALID_AUTHORITY_CLASSES
    }
    assert invalid == {}


def test_hr_measurement_quality_keeps_unknown_distinct_from_unreliable() -> None:
    source = canonical.CanonicalHrSourceEvidence(
        external_hr_sensor_present=None,
        source_for_activity="unknown",
        provenance_confidence="unknown",
        sensor_technology="unknown",
    )
    quality = canonical.CanonicalHrMeasurementQuality(
        source=source,
        activity_motion_risk="unknown",
        coverage_pct=None,
        longest_gap_seconds=None,
        signal_quality="unknown",
        measurement_confidence="unknown",
        reasons=("ASSESSMENT_UNAVAILABLE",),
    )

    assert quality.measurement_confidence == "unknown"
    assert quality.summary_compatibility == "unknown"
    assert quality.artifact_flags == ()
    assert quality.reasons == ("ASSESSMENT_UNAVAILABLE",)


def test_hr_source_presence_does_not_change_activity_source_provenance() -> None:
    source = canonical.CanonicalHrSourceEvidence(
        external_hr_sensor_present=True,
        source_for_activity="mixed_possible",
        provenance_confidence="ambiguous",
        sensor_technology="external_unknown",
    )

    assert source.external_hr_sensor_present is True
    assert source.source_for_activity == "mixed_possible"
    assert source.sensor_technology == "external_unknown"
    with pytest.raises(FrozenInstanceError):
        source.source_for_activity = "external"  # type: ignore[misc]
