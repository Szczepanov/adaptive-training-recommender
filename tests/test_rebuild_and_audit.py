from unittest.mock import MagicMock

from garmin_sync.archive import ArchiveRecord, LocalRawArchiveStore
from garmin_sync.audit import run_audit
from garmin_sync.config import Settings
from garmin_sync.service import GarminSyncService


def _seed_full_day(store: LocalRawArchiveStore, date_iso: str, run_id: str = "run-seed") -> None:
    store.archive(
        ArchiveRecord(
            "stats", date_iso, {"restingHeartRate": 50, "totalSteps": 9000}, run_id, "0.3.8"
        )
    )
    store.archive(
        ArchiveRecord(
            "sleep",
            date_iso,
            {"dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}},
            run_id,
            "0.3.8",
        )
    )
    store.archive(
        ArchiveRecord("hrv", date_iso, {"hrvSummary": {"lastNightAvg": 60}}, run_id, "0.3.8")
    )
    store.archive(ArchiveRecord("activities", date_iso, [], run_id, "0.3.8"))


def test_rebuild_reproduces_snapshot_from_archive_without_garmin_calls(tmp_path) -> None:
    archive_store = LocalRawArchiveStore(base_dir=tmp_path)
    _seed_full_day(archive_store, "2026-08-06")
    # yesterday's stats/sleep archived too, exercising fallback lookups
    _seed_full_day(archive_store, "2026-08-05")

    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {}
    mock_client = MagicMock()  # must never be touched by rebuild()

    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        garmin_client=mock_client,
        archive_store=archive_store,
    )

    result = service.rebuild("2026-08-06", "2026-08-06")

    assert result is True
    mock_repo.upsert_snapshot.assert_called_once()
    mock_repo.upsert_activity.assert_not_called()
    assert mock_client.mock_calls == []  # never called Garmin

    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["sleepScore"] == 80
    assert saved_payload["raw"]["restingHr"] == 50


def test_rebuild_skips_date_missing_archived_payload(tmp_path) -> None:
    archive_store = LocalRawArchiveStore(base_dir=tmp_path)
    # Missing "activities" endpoint for this date -> not rebuildable
    archive_store.archive(
        ArchiveRecord("stats", "2026-08-06", {"restingHeartRate": 50}, "run-1", "0.3.8")
    )
    archive_store.archive(ArchiveRecord("sleep", "2026-08-06", {}, "run-1", "0.3.8"))
    archive_store.archive(ArchiveRecord("hrv", "2026-08-06", {}, "run-1", "0.3.8"))

    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {}
    mock_client = MagicMock()

    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        garmin_client=mock_client,
        archive_store=archive_store,
    )

    result = service.rebuild("2026-08-06", "2026-08-06")

    assert result is False
    mock_repo.upsert_snapshot.assert_not_called()
    assert mock_client.mock_calls == []


def test_rebuild_preserves_existing_firestore_history_on_skipped_dates(tmp_path) -> None:
    archive_store = LocalRawArchiveStore(base_dir=tmp_path)
    # Day 2 is fully archived
    archive_store.archive(
        ArchiveRecord("stats", "2026-08-07", {"restingHeartRate": 50}, "run-1", "0.3.8")
    )
    archive_store.archive(
        ArchiveRecord(
            "sleep",
            "2026-08-07",
            {"sleepScores": {"overallScore": {"value": 80}}},
            "run-1",
            "0.3.8",
        )
    )
    archive_store.archive(
        ArchiveRecord(
            "hrv",
            "2026-08-07",
            {"hrvSummary": {"weeklyAvg": 55, "lastNightAvg": 55}},
            "run-1",
            "0.3.8",
        )
    )
    archive_store.archive(ArchiveRecord("activities", "2026-08-07", [], "run-1", "0.3.8"))

    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {
        f"2026-07-{d:02d}": {
            "raw": {
                "sleepScore": 80,
                "restingHr": 50,
                "hrvOvernightAvg": 55,
                "respirationAvg": 14,
                "totalSteps": 6000,
            }
        }
        for d in range(10, 32)
    }
    # Day 1 is missing from archive but present in Firestore
    mock_repo.get_snapshot.return_value = {
        "raw": {
            "sleepScore": 80,
            "restingHr": 50,
            "hrvOvernightAvg": 55,
            "respirationAvg": 14,
            "totalSteps": 6000,
        }
    }
    mock_client = MagicMock()

    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        garmin_client=mock_client,
        archive_store=archive_store,
    )

    result = service.rebuild("2026-08-06", "2026-08-07")

    assert result is True
    # Day 2 should have been upserted with 28d baseline because Day 1's raw snapshot was preserved in memory
    assert mock_repo.upsert_snapshot.call_count == 1
    call_args = mock_repo.upsert_snapshot.call_args_list[0]
    date_iso, snapshot_dict = call_args[0]
    assert date_iso == "2026-08-07"
    assert snapshot_dict["derived"]["steps28dAvg"] == 6000.0


def test_audit_reports_missing_snapshots_and_availability() -> None:
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.count_activities_in_range.return_value = 12

    def get_snapshot_side_effect(date_iso):
        if date_iso == "2026-08-04":
            return None  # missing
        return {
            "dataQuality": {
                "sleepScoreAvailable": True,
                "hrvAvailable": date_iso != "2026-08-05",
                "restingHrAvailable": True,
            }
        }

    mock_repo.get_snapshot.side_effect = get_snapshot_side_effect

    archive_store = MagicMock()
    archive_store.list_archived_dates.return_value = set()

    report = run_audit(settings, mock_repo, archive_store, days=5, end_date_str="2026-08-06")

    assert report.expected_dates == 5
    assert report.snapshots_present == 4
    assert report.missing_snapshots == ["2026-08-04"]
    assert report.sleep_available == 4
    assert report.hrv_available == 3
    assert report.rhr_available == 4
    assert report.activities_discovered == 12
