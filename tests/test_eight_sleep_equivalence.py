from datetime import datetime, timezone
from unittest.mock import MagicMock

from garmin_sync.canonical import (
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEPING_HEART_RATE_BPM,
    CanonicalHealthObservation,
    ObservationSource,
)
from garmin_sync.eight_sleep_equivalence import run_eight_sleep_equivalence_analysis
from garmin_sync.equivalence import TransportEquivalenceAnalyzer, bundle_to_canonical_observations


def test_analyzer_expected_provider_filters_by_provider_not_hardcoded_garmin():
    """The generalized analyzer (ES9) must match on `expected_provider`, not the original
    hardcoded "garmin" -- a google-side observation from a *different* provider must never
    be treated as the comparison counterpart."""
    now = datetime.now(timezone.utc)
    direct_src = ObservationSource(provider="eight_sleep", transport="eight_sleep_direct")
    google_garmin_src = ObservationSource(provider="garmin", transport="google_health")
    google_eight_sleep_src = ObservationSource(provider="eight_sleep", transport="google_health")

    direct_obs = [
        CanonicalHealthObservation(
            metric=METRIC_HRV_RMSSD_MS,
            value=65.0,
            unit="ms",
            source=direct_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        )
    ]

    # Only a garmin-sourced Google Health observation present -- an eight_sleep-scoped
    # analyzer must not pair with it (would be MISSING_DIRECT/MISSING_GOOGLE-shaped noise,
    # not a real cross-transport comparison of the same underlying device).
    google_obs_wrong_provider = [
        CanonicalHealthObservation(
            metric=METRIC_HRV_RMSSD_MS,
            value=65.1,
            unit="ms",
            source=google_garmin_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        )
    ]

    analyzer = TransportEquivalenceAnalyzer(expected_provider="eight_sleep")
    result = analyzer.compare_date_observations("2026-08-27", direct_obs, google_obs_wrong_provider)
    # The garmin-provider observation is invisible to this analyzer -- the metric is reported
    # as MISSING_GOOGLE (direct-only), not falsely matched against the wrong provider's value.
    assert len(result.comparisons) == 1
    assert result.comparisons[0].status == "MISSING_GOOGLE"

    google_obs_right_provider = [
        CanonicalHealthObservation(
            metric=METRIC_HRV_RMSSD_MS,
            value=65.1,
            unit="ms",
            source=google_eight_sleep_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        )
    ]
    result2 = analyzer.compare_date_observations(
        "2026-08-27", direct_obs, google_obs_right_provider
    )
    assert result2.comparisons[0].status == "MATCH"
    assert result2.classification == "EQUIVALENT"


def test_analyzer_zero_paired_metrics_fails_closed_to_incomplete():
    """Regression: a date where both sides have data but their metric sets are disjoint (no
    metric present on both transports) must not be reported EQUIVALENT -- there is zero real
    cross-transport evidence for that date. This is the realistic Eight Sleep case: the direct
    transport supplies sleeping_heart_rate_bpm/sleep_respiration_summary that Google Health's
    REST Data Points surface never carries for eight_sleep."""
    now = datetime.now(timezone.utc)
    direct_src = ObservationSource(provider="eight_sleep", transport="eight_sleep_direct")
    google_src = ObservationSource(provider="eight_sleep", transport="google_health")

    direct_obs = [
        CanonicalHealthObservation(
            metric=METRIC_SLEEPING_HEART_RATE_BPM,
            value=52.0,
            unit="bpm",
            source=direct_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        )
    ]
    google_obs = [
        CanonicalHealthObservation(
            metric="sleep_session",
            value="sleep",
            unit=None,
            source=google_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        )
    ]

    analyzer = TransportEquivalenceAnalyzer(expected_provider="eight_sleep")
    result = analyzer.compare_date_observations("2026-08-27", direct_obs, google_obs)
    assert len(result.comparisons) == 2  # one MISSING_GOOGLE, one MISSING_DIRECT
    assert result.classification == "INCOMPLETE"


def test_analyzer_empty_both_sides_fails_closed_to_incomplete():
    """Regression: no observations on either side at all must not default to EQUIVALENT."""
    analyzer = TransportEquivalenceAnalyzer(expected_provider="eight_sleep")
    result = analyzer.compare_date_observations("2026-08-27", [], [])
    assert result.comparisons == []
    assert result.classification == "INCOMPLETE"


def test_default_analyzer_still_scopes_to_garmin():
    """Back-compat: the default constructor must keep MS10's original garmin-only scope."""
    analyzer = TransportEquivalenceAnalyzer()
    assert analyzer.expected_provider == "garmin"


def test_run_eight_sleep_equivalence_analysis_overlap_and_summary():
    direct_bundle = {
        "userId": "test_user",
        "logicalDate": "2026-08-27",
        "provider": "eight_sleep",
        "transport": "eight_sleep_direct",
        "observations": [
            {"metric": METRIC_SLEEPING_HEART_RATE_BPM, "value": 52.0, "unit": "bpm"},
        ],
    }
    google_bundle = {
        "userId": "test_user",
        "logicalDate": "2026-08-27",
        "provider": "eight_sleep",
        "transport": "google_health",
        "observations": [
            {"metric": METRIC_SLEEPING_HEART_RATE_BPM, "value": 52.0, "unit": "bpm"},
        ],
    }

    mock_repo = MagicMock()

    def fake_bundles(start, end, provider=None, transport=None):
        if transport == "eight_sleep_direct":
            return [direct_bundle]
        if transport == "google_health":
            return [google_bundle]
        return []

    mock_repo.get_health_observation_bundles_in_range.side_effect = fake_bundles

    report = run_eight_sleep_equivalence_analysis(mock_repo, "2026-08-27", "2026-08-27")
    assert report.totalOverlapDays == 1
    assert report.directOnlyDays == 0
    assert report.googleOnlyDays == 0
    assert report.overallClassification == "EQUIVALENT"
    assert report.metricSummaries[METRIC_SLEEPING_HEART_RATE_BPM]["matchCount"] == 1


def test_run_eight_sleep_equivalence_analysis_direct_only_no_overlap():
    """Fails closed to an honest INCOMPLETE/zero-overlap report rather than inventing a
    comparison when only one side has data -- e.g. before backfill-eight-sleep-direct has
    ever run against the account, or before Google Health has any eight_sleep bundle yet."""
    direct_bundle = {
        "userId": "test_user",
        "logicalDate": "2026-08-27",
        "provider": "eight_sleep",
        "transport": "eight_sleep_direct",
        "observations": [
            {"metric": METRIC_SLEEPING_HEART_RATE_BPM, "value": 52.0, "unit": "bpm"},
        ],
    }
    mock_repo = MagicMock()

    def fake_bundles(start, end, provider=None, transport=None):
        if transport == "eight_sleep_direct":
            return [direct_bundle]
        return []

    mock_repo.get_health_observation_bundles_in_range.side_effect = fake_bundles

    report = run_eight_sleep_equivalence_analysis(mock_repo, "2026-08-27", "2026-08-27")
    assert report.totalOverlapDays == 0
    assert report.directOnlyDays == 1
    assert report.overallClassification == "INCOMPLETE"
    assert report.dailyResults == []


def test_analyzer_flags_ambiguous_metric_when_google_side_has_duplicates():
    """Regression for the real ES9 first-read finding: Google Health emitted TWO
    sleep_duration_seconds observations for one logical date (an overnight session plus a
    shorter overlapping fragment). The comparator's dict-building silently keeps only the
    last one (ordinary dict-comprehension collapse) -- that's still true here, since fixing
    the collapse itself would require picking a "correct" session with no principled way to
    do so from this module alone. What must change is that the collapse becomes visible:
    ambiguousMetrics records which metric/side had more than one candidate."""
    now = datetime.now(timezone.utc)
    direct_src = ObservationSource(provider="eight_sleep", transport="eight_sleep_direct")
    google_src = ObservationSource(provider="eight_sleep", transport="google_health")

    direct_obs = [
        CanonicalHealthObservation(
            metric="sleep_duration_seconds",
            value=29340,
            unit="s",
            source=direct_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-14",
        )
    ]
    # Two same-metric observations from Google Health for the same date -- an overnight
    # session and a shorter nested fragment, exactly as observed in real data.
    google_obs = [
        CanonicalHealthObservation(
            metric="sleep_duration_seconds",
            value=2400,
            unit="seconds",
            source=google_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-14",
        ),
        CanonicalHealthObservation(
            metric="sleep_duration_seconds",
            value=30690,
            unit="seconds",
            source=google_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-14",
        ),
    ]

    analyzer = TransportEquivalenceAnalyzer(expected_provider="eight_sleep")
    result = analyzer.compare_date_observations("2026-08-14", direct_obs, google_obs)
    assert "sleep_duration_seconds" in result.ambiguousMetrics
    assert result.ambiguousMetrics["sleep_duration_seconds"] == {"google": 2}
    # The comparison itself still ran (against whichever candidate dict-comprehension kept) --
    # ambiguity is reported, not silently hidden, but doesn't block the comparison either.
    assert len(result.comparisons) == 1


def test_bundle_to_canonical_observations_reused_directly_for_eight_sleep():
    """eight_sleep_equivalence deliberately reuses equivalence.py's bundle converter rather
    than duplicating it -- confirm it round-trips an eight_sleep_direct bundle correctly."""
    bundle = {
        "logicalDate": "2026-08-27",
        "provider": "eight_sleep",
        "transport": "eight_sleep_direct",
        "observations": [
            {"metric": METRIC_HRV_RMSSD_MS, "value": 60.0, "unit": "ms"},
        ],
    }
    obs = bundle_to_canonical_observations(bundle)
    assert len(obs) == 1
    assert obs[0].source.provider == "eight_sleep"
    assert obs[0].source.transport == "eight_sleep_direct"
