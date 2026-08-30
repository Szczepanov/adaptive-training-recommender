from datetime import datetime, timezone

import pytest

from garmin_sync.canonical import (
    METRIC_HRV_RMSSD_MS,
    CanonicalHealthObservation,
    ObservationBatch,
    ObservationSource,
)


def test_observation_source_validation() -> None:
    with pytest.raises(ValueError, match="provider"):
        ObservationSource(provider="", transport="garmin_direct")

    with pytest.raises(ValueError, match="transport"):
        ObservationSource(provider="garmin", transport="")

    src = ObservationSource(
        provider="garmin",
        transport="google_health",
        origin_application="com.garmin.android.apps.connectmobile",
    )
    assert src.provider == "garmin"
    assert src.transport == "google_health"
    assert src.origin_application == "com.garmin.android.apps.connectmobile"


def test_canonical_health_observation_validation() -> None:
    src = ObservationSource(provider="garmin", transport="garmin_direct")

    with pytest.raises(ValueError, match="metric name"):
        CanonicalHealthObservation(
            metric="",
            value=65.0,
            unit="ms",
            source=src,
            observed_start=None,
            observed_end=None,
            logical_date="2026-08-27",
        )

    with pytest.raises(ValueError, match="logical_date"):
        CanonicalHealthObservation(
            metric=METRIC_HRV_RMSSD_MS,
            value=65.0,
            unit="ms",
            source=src,
            observed_start=None,
            observed_end=None,
            logical_date="invalid-date",
        )

    now = datetime.now(timezone.utc)
    obs = CanonicalHealthObservation(
        metric=METRIC_HRV_RMSSD_MS,
        value=65.2,
        unit="ms",
        source=src,
        observed_start=now,
        observed_end=now,
        logical_date="2026-08-27",
    )
    assert obs.metric == "hrv_rmssd_ms"
    assert obs.value == 65.2
    assert obs.logical_date == "2026-08-27"


def test_observation_batch() -> None:
    with pytest.raises(ValueError, match="source_payload_hash"):
        ObservationBatch(logical_date="2026-08-27")

    batch = ObservationBatch(logical_date="2026-08-27", source_payload_hash="sha256:abc1234")
    assert batch.logical_date == "2026-08-27"
    assert len(batch.observations) == 0
    assert batch.revision == 1
    assert batch.source_payload_hash == "sha256:abc1234"
