from unittest.mock import MagicMock, patch

from garmin_sync.canonical import CanonicalDailyMetrics
from garmin_sync.config import Settings
from garmin_sync.fit_activity import FitDeviceInventoryEntry
from garmin_sync.service import (
    GarminSyncService,
    SnapshotContext,
    _new_sync_run_id,
    _source_evidence_from_fit_devices,
)


def test_new_sync_run_id() -> None:
    target_iso = "2026-08-20"
    run_id = _new_sync_run_id(target_iso)
    assert run_id.startswith("2026-08-20-")
    assert len(run_id) == len("2026-08-20-") + 8


def test_snapshot_context_defaults() -> None:
    metrics = CanonicalDailyMetrics(date="2026-08-20")
    ctx = SnapshotContext(
        target_iso="2026-08-20",
        canonical=metrics,
        canonical_activities=[],
        raw_memory_store={},
    )
    assert ctx.target_iso == "2026-08-20"
    assert ctx.canonical == metrics
    assert ctx.canonical_activities == []
    assert ctx.raw_memory_store == {}
    assert ctx.activities_through_iso is None


def test_source_evidence_from_fit_devices() -> None:
    device = FitDeviceInventoryEntry(
        device_index=0,
        manufacturer=1,
        product=100,
        device_type="heart_rate",
        source_type="heart_rate",
    )
    evidence = _source_evidence_from_fit_devices((device,))
    assert evidence.external_hr_sensor_present is True
    assert evidence.source_for_activity is not None


def test_garmin_sync_service_init_defaults() -> None:
    settings = Settings(app_user_id="test_user_service")
    mock_repo = MagicMock()
    service = GarminSyncService(settings=settings, repository=mock_repo)
    assert service.settings == settings
    assert service.repository == mock_repo
    assert service.garmin_client is None
    assert service.provider is None


def test_init_garmin_client_restores_login_and_persists_tokens() -> None:
    settings = Settings(
        app_user_id="test_user_service",
        garmin_email="test@example.com",
        garmin_password="secret_password",
    )
    mock_repo = MagicMock()
    mock_token_store = MagicMock()
    mock_archive_store = MagicMock()

    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        archive_store=mock_archive_store,
    )
    service.token_store = mock_token_store

    mock_wrapper_cls = MagicMock()
    mock_wrapper_instance = MagicMock()
    mock_wrapper_cls.return_value = mock_wrapper_instance

    with patch("garmin_sync.service.GarminClientWrapper", mock_wrapper_cls):
        client = service._init_garmin_client()

    assert client == mock_wrapper_instance
    assert service.garmin_client == mock_wrapper_instance
    mock_token_store.restore.assert_called_once_with(service.token_file_path)
    mock_wrapper_cls.assert_called_once_with(
        email="test@example.com",
        password="secret_password",
        retry_attempts=settings.garmin_retry_attempts,
        retry_min_wait=settings.garmin_retry_min_wait,
        retry_max_wait=settings.garmin_retry_max_wait,
        verify_login=settings.garmin_verify_login,
        allow_credential_login=settings.garmin_allow_credential_login,
    )
    mock_wrapper_instance.login_with_tokens_or_credentials.assert_called_once_with(
        service.token_file_path
    )
    mock_token_store.persist.assert_called_once_with(service.token_file_path)


def test_archive_raw_calls_archive_store() -> None:
    settings = Settings(app_user_id="test_user_service")
    mock_repo = MagicMock()
    mock_archive_store = MagicMock()

    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        archive_store=mock_archive_store,
    )

    service._archive_raw(
        endpoint="stats",
        logical_date="2026-08-20",
        payload={"restingHeartRate": 50},
        sync_run_id="run-123",
    )

    mock_archive_store.archive.assert_called_once()
    record = mock_archive_store.archive.call_args.args[0]
    assert record.endpoint == "stats"
    assert record.logical_date == "2026-08-20"
    assert record.payload == {"restingHeartRate": 50}
    assert record.sync_run_id == "run-123"


def test_rebuild_empty_date_range_returns_false() -> None:
    settings = Settings(app_user_id="test_user_service")
    mock_repo = MagicMock()
    service = GarminSyncService(settings=settings, repository=mock_repo)

    result = service.rebuild(start_date_str="2026-08-20", end_date_str="2026-08-19")
    assert result is False


def test_rebuild_skips_missing_archived_payloads() -> None:
    settings = Settings(app_user_id="test_user_service")
    mock_repo = MagicMock()
    mock_repo.get_snapshot.return_value = None
    mock_archive_store = MagicMock()
    mock_archive_store.load.return_value = None  # Missing raw payloads

    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        archive_store=mock_archive_store,
    )

    result = service.rebuild(start_date_str="2026-08-20", end_date_str="2026-08-20")
    assert result is False
    mock_repo.upsert_snapshot.assert_not_called()


def test_rebuild_success_from_archived_payloads() -> None:
    settings = Settings(app_user_id="test_user_service")
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {}
    mock_archive_store = MagicMock()

    # Raw payload mocks for target_date "2026-08-20"
    payloads = {
        ("stats", "2026-08-20"): {"restingHeartRate": 52, "totalSteps": 8000},
        ("sleep", "2026-08-20"): {"dailySleepDTO": {"sleepScores": {"overall": {"value": 85}}}},
        ("hrv", "2026-08-20"): {"hrvSummary": {"lastNightAvg": 60}},
        ("activities", "2026-08-20"): [],
    }
    mock_archive_store.load.side_effect = lambda ep, dt: payloads.get((ep, dt))

    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        archive_store=mock_archive_store,
    )

    result = service.rebuild(start_date_str="2026-08-20", end_date_str="2026-08-20")
    assert result is True
    mock_repo.upsert_snapshot.assert_called_once()
    date_key, snapshot_dict = mock_repo.upsert_snapshot.call_args.args
    assert date_key == "2026-08-20"
    assert snapshot_dict["raw"]["sleepScore"] == 85
    assert snapshot_dict["raw"]["restingHr"] == 52
