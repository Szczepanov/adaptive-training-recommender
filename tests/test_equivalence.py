from datetime import datetime, timezone

from garmin_sync.canonical import (
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_DURATION_SECONDS,
    CanonicalHealthObservation,
    ObservationSource,
)
from garmin_sync.equivalence import TransportEquivalenceAnalyzer


def test_equivalence_analyzer_match():
    now = datetime.now(timezone.utc)
    direct_src = ObservationSource(provider="garmin", transport="garmin_direct")
    google_src = ObservationSource(provider="garmin", transport="google_health")

    direct_obs = [
        CanonicalHealthObservation(
            metric=METRIC_SLEEP_DURATION_SECONDS,
            value=28800,
            unit="seconds",
            source=direct_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        ),
        CanonicalHealthObservation(
            metric=METRIC_HRV_RMSSD_MS,
            value=65.0,
            unit="ms",
            source=direct_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        ),
    ]

    google_obs = [
        CanonicalHealthObservation(
            metric=METRIC_SLEEP_DURATION_SECONDS,
            value=28810,  # 10s difference (tolerance is 60s)
            unit="seconds",
            source=google_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        ),
        CanonicalHealthObservation(
            metric=METRIC_HRV_RMSSD_MS,
            value=65.1,  # 0.1ms difference (tolerance is 0.5ms)
            unit="ms",
            source=google_src,
            observed_start=now,
            observed_end=now,
            logical_date="2026-08-27",
        ),
    ]

    analyzer = TransportEquivalenceAnalyzer()
    result = analyzer.compare_date_observations("2026-08-27", direct_obs, google_obs)
    assert result.classification == "EQUIVALENT"
    assert len(result.comparisons) == 2
    assert all(c.isWithinTolerance for c in result.comparisons)


def test_snapshot_conversion_and_run_analysis():
    from unittest.mock import MagicMock

    from garmin_sync.equivalence import (
        bundle_to_canonical_observations,
        run_equivalence_analysis,
        snapshot_to_canonical_observations,
    )

    snap = {
        "date": "2026-08-25",
        "restingHeartRate": 43,
        "sleepSeconds": 28800,
        "deepSleepSeconds": 5400,
        "remSleepSeconds": 5400,
        "lightSleepSeconds": 16200,
        "awakeSleepSeconds": 1800,
    }
    direct_obs = snapshot_to_canonical_observations(snap)
    assert len(direct_obs) == 6

    bundle = {
        "userId": "test_user",
        "logicalDate": "2026-08-25",
        "provider": "garmin",
        "transport": "google_health",
        "observations": [
            {
                "metric": "daily_resting_heart_rate_bpm",
                "value": 43.0,
                "unit": "bpm",
            }
        ],
    }
    google_obs = bundle_to_canonical_observations(bundle)
    assert len(google_obs) == 1

    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {"2026-08-25": snap}
    mock_repo.get_health_observation_bundles_in_range.return_value = [bundle]

    report = run_equivalence_analysis(mock_repo, "2026-08-25", "2026-08-25")
    assert report.totalOverlapDays == 1
    assert "daily_resting_heart_rate_bpm" in report.metricSummaries
    assert report.metricSummaries["daily_resting_heart_rate_bpm"]["matchCount"] == 1


def test_snapshot_conversion_carries_sleep_session_timing_when_present():
    from datetime import datetime, timezone

    from garmin_sync.equivalence import snapshot_to_canonical_observations

    snap = {
        "date": "2026-08-25",
        "raw": {
            "sleepDurationSec": 28800,
            "sleepSessionStart": "2026-08-24T22:00:00+00:00",
            "sleepSessionEnd": "2026-08-25T06:00:00+00:00",
        },
    }
    obs = snapshot_to_canonical_observations(snap)
    sleep_obs = next(o for o in obs if o.metric == "sleep_duration_seconds")
    assert sleep_obs.observed_start == datetime(2026, 8, 24, 22, 0, tzinfo=timezone.utc)
    assert sleep_obs.observed_end == datetime(2026, 8, 25, 6, 0, tzinfo=timezone.utc)


def test_build_metric_summaries_reports_none_not_zero_when_never_paired() -> None:
    """Regression: a metric that only ever appears on one side (e.g. Garmin's RHR vs Eight
    Sleep's sleeping-HR-only surface -- always MISSING_DIRECT/MISSING_GOOGLE, never a real
    pair) previously defaulted meanDifference/maxDifference to 0.0, which is indistinguishable
    in a printed report from "these values are identical." It must report None ("not
    comparable") instead, and pairedCount must be 0 while totalEvaluated still counts the
    one-sided occurrences."""
    from garmin_sync.equivalence import build_metric_summaries

    summaries = build_metric_summaries(
        metric_counts={"one_sided_metric": 5, "paired_metric": 3},
        metric_matches={"paired_metric": 2},
        metric_diffs={"paired_metric": [1.0, 2.0, 0.0]},
        metric_paired_counts={"paired_metric": 3},
        ambiguous_date_counts={},
    )
    assert summaries["one_sided_metric"]["pairedCount"] == 0
    assert summaries["one_sided_metric"]["meanDifference"] is None
    assert summaries["one_sided_metric"]["maxDifference"] is None
    assert summaries["one_sided_metric"]["matchRatePct"] == 0.0

    assert summaries["paired_metric"]["pairedCount"] == 3
    assert summaries["paired_metric"]["meanDifference"] == 1.0
    assert summaries["paired_metric"]["maxDifference"] == 2.0


def test_format_metric_summaries_table_shows_na_and_ambiguous_section() -> None:
    from garmin_sync.equivalence import build_metric_summaries, format_metric_summaries_table

    summaries = build_metric_summaries(
        metric_counts={"one_sided_metric": 5},
        metric_matches={},
        metric_diffs={},
        metric_paired_counts={},
        ambiguous_date_counts={"one_sided_metric": 3},
    )
    table = format_metric_summaries_table(summaries)
    assert "N/A" in table
    assert "AMBIGUOUS METRICS" in table
    assert "one_sided_metric: 3 date(s)" in table


def test_snapshot_conversion_sleep_timing_none_when_absent():
    from garmin_sync.equivalence import snapshot_to_canonical_observations

    snap = {"date": "2026-08-25", "raw": {"sleepDurationSec": 28800}}
    obs = snapshot_to_canonical_observations(snap)
    sleep_obs = next(o for o in obs if o.metric == "sleep_duration_seconds")
    assert sleep_obs.observed_start is None
    assert sleep_obs.observed_end is None
