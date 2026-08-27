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


def test_health_observation_service_sync_date():
    mock_repo = MagicMock(spec=FirestoreRecoveryRepository)
    mock_repo.save_health_observation_day_bundle.return_value = (True, 1)

    mock_provider = MagicMock(spec=RecoveryObservationProvider)
    now = datetime.now(timezone.utc)
    source = ObservationSource(provider="garmin", transport="google_health")
    obs = CanonicalHealthObservation(
        metric="hrv_rmssd_ms",
        value=62.0,
        unit="ms",
        source=source,
        observed_start=now,
        observed_end=now,
        logical_date="2026-08-27",
    )
    mock_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-27",
        observations=[obs],
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
    assert res["google_health"]["status"] == "saved"
    assert res["google_health"]["observations"] == 1
    mock_repo.save_health_observation_day_bundle.assert_called_once()
