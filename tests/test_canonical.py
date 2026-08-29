import re
from pathlib import Path

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
