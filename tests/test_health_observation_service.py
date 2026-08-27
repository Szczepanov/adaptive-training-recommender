from datetime import datetime, timezone
from unittest.mock import MagicMock

from garmin_sync.archive import NullArchiveStore
from garmin_sync.canonical import (
    CanonicalHealthObservation,
    ObservationBatch,
    ObservationSource,
)
from garmin_sync.firestore_repository import FirestoreRecoveryRepository
from garmin_sync.health_observation_service import HealthObservationService
from garmin_sync.provider import RecoveryObservationProvider


def test_health_observation_service_sync_date_multi_provider() -> None:
    mock_repo = MagicMock(spec=FirestoreRecoveryRepository)
    mock_repo.save_health_observation_day_bundle.return_value = (True, 1)

    mock_provider = MagicMock(spec=RecoveryObservationProvider)
    now = datetime.now(timezone.utc)

    garmin_obs = CanonicalHealthObservation(
        metric="sleep_duration_seconds",
        value=28000,
        unit="seconds",
        source=ObservationSource(provider="garmin", transport="google_health"),
        observed_start=now,
        observed_end=now,
        logical_date="2026-08-27",
    )
    eight_sleep_obs = CanonicalHealthObservation(
        metric="hrv_rmssd_ms",
        value=65.0,
        unit="ms",
        source=ObservationSource(provider="eight_sleep", transport="google_health"),
        observed_start=now,
        observed_end=now,
        logical_date="2026-08-27",
    )

    mock_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-27",
        observations=[garmin_obs, eight_sleep_obs],
        source_payload_hash="sha256:abc",
    )

    service = HealthObservationService(
        user_id="test_uid",
        repository=mock_repo,
        archive_store=NullArchiveStore(),
        providers={"google_health": mock_provider},
    )

    res = service.sync_date("2026-08-27")
    assert "google_health" in res
    assert res["google_health"]["status"] == "success"
    assert res["google_health"]["totalObservations"] == 2
    assert "garmin_google_health" in res["google_health"]["sources"]
    assert "eight_sleep_google_health" in res["google_health"]["sources"]
    assert mock_repo.save_health_observation_day_bundle.call_count == 2


def test_health_observation_service_backfill_range() -> None:
    mock_repo = MagicMock(spec=FirestoreRecoveryRepository)
    mock_repo.save_health_observation_day_bundle.return_value = (True, 1)

    mock_provider = MagicMock(spec=RecoveryObservationProvider)
    mock_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-20",
        observations=[],
        source_payload_hash="sha256:empty",
    )

    service = HealthObservationService(
        user_id="test_uid",
        repository=mock_repo,
        archive_store=NullArchiveStore(),
        providers={"google_health": mock_provider},
    )

    summary = service.backfill_range("2026-08-20", "2026-08-22")
    assert len(summary) == 3
    assert summary[0]["date"] == "2026-08-20"
    assert summary[2]["date"] == "2026-08-22"
    assert mock_provider.fetch_observations.call_count == 3
