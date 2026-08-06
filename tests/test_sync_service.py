from unittest.mock import MagicMock
import pytest
from garmin_sync.config import Settings
from garmin_sync.service import GarminSyncService

def test_sync_service_skips_when_fresh():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = True

    service = GarminSyncService(settings=settings, repository=mock_repo)
    result = service.sync_daily(target_date_str="2026-08-06", force=False)

    assert result is True
    mock_repo.is_fresh.assert_called_once_with("2026-08-06", 60)

def test_sync_service_forces_refresh():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = True
    mock_repo.get_historical_snapshots.return_value = {}

    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 55, "totalSteps": 10000}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_batch.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    mock_client.get_stats.assert_called()
    mock_repo.upsert_snapshot.assert_called_once()


def test_sync_service_uses_d1_steps_even_when_todays_rhr_is_present():
    """Regression test: totalSteps must always come from D-1's completed day, even when
    today's RHR is already available (which used to skip the D-1 stats fetch entirely
    and silently leak today's partial-morning step count into the snapshot)."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    def stats_side_effect(date_iso):
        if date_iso == "2026-08-06":
            return {"restingHeartRate": 55, "totalSteps": 500}  # partial morning count for D
        if date_iso == "2026-08-05":
            return {"restingHeartRate": 54, "totalSteps": 11000}  # completed D-1 count
        return {}

    mock_client = MagicMock()
    mock_client.get_stats.side_effect = stats_side_effect
    mock_client.get_sleep_data.return_value = {}
    mock_client.get_hrv_data.return_value = {}
    mock_client.get_activities_batch.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    assert mock_client.get_stats.call_count == 2
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["totalSteps"] == 11000
    assert saved_payload["source"]["metricDates"]["steps"] == "2026-08-05"


def test_sync_service_propagates_rate_limit_exhaustion():
    """A Garmin call that exhausts its retries must fail the run (non-zero exit at the
    CLI layer), not be silently swallowed into an incomplete but 'successful' snapshot."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False

    mock_client = MagicMock()
    mock_client.get_stats.side_effect = RuntimeError(
        "Garmin API call failed after 4 retries due to rate limiting."
    )

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)

    with pytest.raises(RuntimeError):
        service.sync_daily(target_date_str="2026-08-06", force=True)

    mock_repo.upsert_snapshot.assert_not_called()


def test_sync_service_computes_sleep_score_delta():
    """Regression test: sleepScoreVs7d/Vs28d must be computed from the same sleep-score
    extraction as raw.sleepScore. A previous separate/naive extraction in the delta
    calculation always evaluated to None for real Garmin response shapes, silently
    leaving these deltas null even though raw.sleepScore and the 7d/28d averages
    themselves were correct."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    # 4 days of history with sleepScore present -> 7d baseline should be ready
    mock_repo.get_historical_snapshots.return_value = {
        f"2026-08-0{i}": {"raw": {"sleepScore": 70}} for i in range(1, 5)
    }

    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 55, "totalSteps": 10000}
    # Real Garmin response shape: score lives under dailySleepDTO.sleepScores.overall.value
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 90}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_batch.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["sleepScore"] == 90
    assert saved_payload["derived"]["sleepScore7dAvg"] == 70.0
    assert saved_payload["derived"]["deltas"]["sleepScoreVs7d"] == 20.0
