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
