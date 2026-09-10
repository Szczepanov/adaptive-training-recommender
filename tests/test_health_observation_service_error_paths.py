import logging
from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock

import pytest

from garmin_sync.archive import NullArchiveStore
from garmin_sync.canonical import CanonicalHealthObservation, ObservationBatch, ObservationSource
from garmin_sync.firestore_repository import FirestoreRecoveryRepository
from garmin_sync.health_observation_service import HealthObservationService
from garmin_sync.provider import RecoveryObservationProvider


def test_sync_date_reports_bundle_persistence_failure(caplog: pytest.LogCaptureFixture) -> None:
    mock_repo = MagicMock(spec=FirestoreRecoveryRepository)
    mock_repo.save_health_observation_day_bundle.side_effect = OSError("database save failed")

    mock_provider = MagicMock(spec=RecoveryObservationProvider)
    now = datetime.now(timezone.utc)
    mock_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-27",
        observations=[
            CanonicalHealthObservation(
                metric="sleep_duration_seconds",
                value=28000,
                unit="seconds",
                source=ObservationSource(provider="garmin", transport="google_health"),
                observed_start=now,
                observed_end=now,
                logical_date="2026-08-27",
            )
        ],
        source_payload_hash="sha256:garmin_only",
    )

    service = HealthObservationService(
        user_id="test_uid",
        repository=mock_repo,
        archive_store=NullArchiveStore(),
        providers={"google_health": mock_provider},
    )

    with caplog.at_level(logging.ERROR):
        result = service.sync_date("2026-08-27")

    assert result["google_health"] == {
        "status": "error",
        "error": "database save failed",
    }
    assert (
        "Error syncing observations from google_health for 2026-08-27: database save failed"
        in caplog.text
    )


def test_sync_date_isolates_one_provider_persistence_failure() -> None:
    mock_repo = MagicMock(spec=FirestoreRecoveryRepository)
    mock_repo.get_health_observation_bundles_in_range.return_value = []

    def save_side_effect(bundle: Any) -> tuple[bool, int]:
        if bundle.provider == "failing_provider":
            raise OSError("provider save failure")
        return True, 1

    mock_repo.save_health_observation_day_bundle.side_effect = save_side_effect

    now = datetime.now(timezone.utc)
    failing_provider = MagicMock(spec=RecoveryObservationProvider)
    failing_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-27",
        observations=[
            CanonicalHealthObservation(
                metric="steps_count",
                value=1000,
                unit="count",
                source=ObservationSource(provider="failing_provider", transport="api"),
                observed_start=now,
                observed_end=now,
                logical_date="2026-08-27",
            )
        ],
        source_payload_hash="sha256:fail",
    )

    successful_provider = MagicMock(spec=RecoveryObservationProvider)
    successful_provider.fetch_observations.return_value = ObservationBatch(
        logical_date="2026-08-27",
        observations=[
            CanonicalHealthObservation(
                metric="sleep_duration_seconds",
                value=28000,
                unit="seconds",
                source=ObservationSource(provider="garmin", transport="google_health"),
                observed_start=now,
                observed_end=now,
                logical_date="2026-08-27",
            )
        ],
        source_payload_hash="sha256:ok",
    )

    service = HealthObservationService(
        user_id="test_uid",
        repository=mock_repo,
        archive_store=NullArchiveStore(),
        providers={
            "failing_provider": failing_provider,
            "successful_provider": successful_provider,
        },
    )

    result = service.sync_date("2026-08-27")

    assert result["failing_provider"] == {
        "status": "error",
        "error": "provider save failure",
    }
    assert result["successful_provider"]["status"] == "success"
    assert result["successful_provider"]["totalObservations"] == 1
    assert "garmin_google_health" in result["successful_provider"]["sources"]
