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
    mock_repo.get_health_observation_bundles_in_range.return_value = []

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
    mock_repo.get_health_observation_bundles_in_range.return_value = []

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


def test_health_observation_service_tombstones_source_dropped_from_mixed_batch() -> None:
    """Eight Sleep was present in a prior sync of this date but the new batch only
    carries Garmin -- the old Eight Sleep bundle must be deleted, not left queryable."""
    mock_repo = MagicMock(spec=FirestoreRecoveryRepository)
    mock_repo.save_health_observation_day_bundle.return_value = (True, 1)
    mock_repo.get_health_observation_bundles_in_range.return_value = [
        {"provider": "garmin", "transport": "google_health", "logicalDate": "2026-08-27"},
        {"provider": "eight_sleep", "transport": "google_health", "logicalDate": "2026-08-27"},
    ]
    mock_repo.delete_health_observation_day_bundles_batch.return_value = 1

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
    mock_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-27",
        observations=[garmin_obs],
        source_payload_hash="sha256:garmin_only",
    )

    service = HealthObservationService(
        user_id="test_uid",
        repository=mock_repo,
        archive_store=NullArchiveStore(),
        providers={"google_health": mock_provider},
    )

    res = service.sync_date("2026-08-27")

    mock_repo.delete_health_observation_day_bundles_batch.assert_called_once_with(
        [("2026-08-27", "eight_sleep", "google_health")]
    )
    assert res["google_health"]["reconciledStale"] == ["eight_sleep_google_health"]


def test_health_observation_service_tombstones_bundles_on_empty_repeat_batch() -> None:
    """A provider that previously reported observations for this date and now returns
    none must have its earlier bundle(s) reconciled away, not silently left in place."""
    mock_repo = MagicMock(spec=FirestoreRecoveryRepository)
    mock_repo.save_health_observation_day_bundle.return_value = (True, 1)
    mock_repo.delete_health_observation_day_bundles_batch.return_value = 1

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

    service = HealthObservationService(
        user_id="test_uid",
        repository=mock_repo,
        archive_store=NullArchiveStore(),
        providers={"google_health": mock_provider},
    )

    # First sync: provider reports Garmin data -> service now knows this provider's
    # transport is "google_health".
    mock_repo.get_health_observation_bundles_in_range.return_value = []
    mock_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-27", observations=[garmin_obs], source_payload_hash="sha256:1"
    )
    service.sync_date("2026-08-27")

    # Second sync (e.g. re-run/repair): provider now returns nothing for the same date.
    mock_repo.get_health_observation_bundles_in_range.return_value = [
        {"provider": "garmin", "transport": "google_health", "logicalDate": "2026-08-27"},
    ]
    mock_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-27", observations=[], source_payload_hash="sha256:empty"
    )
    res = service.sync_date("2026-08-27")

    mock_repo.delete_health_observation_day_bundles_batch.assert_called_once_with(
        [("2026-08-27", "garmin", "google_health")]
    )
    assert res["google_health"]["reconciledStale"] == ["garmin_google_health"]
