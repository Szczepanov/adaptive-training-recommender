from unittest.mock import MagicMock

from garmin_sync.garmin_sleep_timing_backfill import patch_sleep_timing_for_range


def _sleep_payload(start_ms: int, end_ms: int) -> dict:
    return {"dailySleepDTO": {"sleepStartTimestampGMT": start_ms, "sleepEndTimestampGMT": end_ms}}


def test_backfill_patches_dates_with_archived_timestamps() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {
        "2026-08-01": {"raw": {}},
    }
    repo.patch_snapshot_fields.return_value = True

    archive = MagicMock()
    archive.list_archived_dates.return_value = {"2026-08-01"}
    archive.load.return_value = _sleep_payload(0, 5_000_000)

    result = patch_sleep_timing_for_range(repo, archive, "2026-08-01", "2026-08-01")

    assert result.datesChecked == 1
    assert result.datesPatched == 1
    assert result.patchedDates == ["2026-08-01"]
    repo.patch_snapshot_fields.assert_called_once_with(
        "2026-08-01",
        {
            "raw.sleepStartTimeGmt": "1970-01-01T00:00:00+00:00",
            "raw.sleepEndTimeGmt": "1970-01-01T01:23:20+00:00",
        },
    )


def test_backfill_skips_date_with_no_existing_snapshot() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {}
    archive = MagicMock()
    archive.list_archived_dates.return_value = {"2026-08-01"}

    result = patch_sleep_timing_for_range(repo, archive, "2026-08-01", "2026-08-01")

    assert result.datesPatched == 0
    repo.patch_snapshot_fields.assert_not_called()
    archive.load.assert_not_called()


def test_backfill_skips_date_with_no_archived_payload() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {"2026-08-01": {"raw": {}}}
    archive = MagicMock()
    archive.list_archived_dates.return_value = set()

    result = patch_sleep_timing_for_range(repo, archive, "2026-08-01", "2026-08-01")

    assert result.datesSkippedNoArchive == 1
    assert result.datesPatched == 0
    repo.patch_snapshot_fields.assert_not_called()


def test_backfill_skips_archived_payload_with_no_parseable_timestamps() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {"2026-08-01": {"raw": {}}}
    archive = MagicMock()
    archive.list_archived_dates.return_value = {"2026-08-01"}
    archive.load.return_value = {"dailySleepDTO": {}}  # real gap: no timestamps in the payload

    result = patch_sleep_timing_for_range(repo, archive, "2026-08-01", "2026-08-01")

    assert result.datesSkippedNoTimestamps == 1
    assert result.datesPatched == 0
    repo.patch_snapshot_fields.assert_not_called()


def test_backfill_skips_already_present_by_default() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {
        "2026-08-01": {
            "raw": {
                "sleepStartTimeGmt": "2026-08-01T22:00:00+00:00",
                "sleepEndTimeGmt": "2026-08-02T06:00:00+00:00",
            }
        }
    }
    archive = MagicMock()

    result = patch_sleep_timing_for_range(repo, archive, "2026-08-01", "2026-08-01")

    assert result.datesSkippedAlreadyPresent == 1
    assert result.datesPatched == 0
    archive.list_archived_dates.assert_called_once()
    archive.load.assert_not_called()
    repo.patch_snapshot_fields.assert_not_called()


def test_backfill_overwrite_existing_repatches_present_dates() -> None:
    repo = MagicMock()
    repo.get_historical_snapshots.return_value = {
        "2026-08-01": {
            "raw": {
                "sleepStartTimeGmt": "2026-08-01T22:00:00+00:00",
                "sleepEndTimeGmt": "2026-08-02T06:00:00+00:00",
            }
        }
    }
    repo.patch_snapshot_fields.return_value = True
    archive = MagicMock()
    archive.list_archived_dates.return_value = {"2026-08-01"}
    archive.load.return_value = _sleep_payload(0, 5_000_000)

    result = patch_sleep_timing_for_range(
        repo, archive, "2026-08-01", "2026-08-01", overwrite_existing=True
    )

    assert result.datesPatched == 1
    repo.patch_snapshot_fields.assert_called_once()
