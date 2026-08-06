from unittest.mock import MagicMock
import pytest
from garminconnect import GarminConnectTooManyRequestsError
from garmin_sync.canonical import CanonicalDailyMetrics
from garmin_sync.config import Settings
from garmin_sync.provider import ProviderActivitiesResult, ProviderCapabilities, ProviderFetchResult
from garmin_sync.service import GarminSyncService


class FakeTestProvider:
    """Minimal non-Garmin WearableProvider implementation, used to prove
    GarminSyncService is genuinely provider-agnostic (doesn't just work by coincidence
    because it's secretly Garmin-shaped)."""

    capabilities = ProviderCapabilities(daily_summary=True, sleep=True, hrv=True, activities=True)

    def __init__(self, sleep_score: float = 88.0, resting_hr: float = 48.0):
        self.sleep_score = sleep_score
        self.resting_hr = resting_hr
        self.fetch_daily_metrics_calls: list[tuple[str, str]] = []

    def fetch_daily_metrics(self, target_date_iso: str, yesterday_iso: str) -> ProviderFetchResult:
        self.fetch_daily_metrics_calls.append((target_date_iso, yesterday_iso))
        canonical = CanonicalDailyMetrics(
            date=target_date_iso,
            resting_heart_rate_bpm=self.resting_hr,
            resting_heart_rate_date=target_date_iso,
            sleep_score=self.sleep_score,
            sleep_date=target_date_iso,
            hrv_overnight_avg_ms=60.0,
            hrv_date=target_date_iso,
            steps_count=9000,
            steps_date=yesterday_iso,
        )
        return ProviderFetchResult(canonical=canonical, raw_payloads={"stats": {"fake": True}})

    def fetch_activities(self, start_date_iso: str, end_date_iso: str) -> ProviderActivitiesResult:
        return ProviderActivitiesResult(canonical=[], raw_payload=[])

    def clear_cache(self) -> None:
        pass  # this fake provider doesn't cache anything

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
    mock_client.get_activities_window.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    mock_client.get_stats.assert_called()
    mock_repo.upsert_snapshot.assert_called_once()


def test_sync_service_uses_d1_steps_even_when_todays_rhr_is_present():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    def stats_side_effect(date_iso):
        if date_iso == "2026-08-06":
            return {"restingHeartRate": 55, "totalSteps": 500}
        if date_iso == "2026-08-05":
            return {"restingHeartRate": 54, "totalSteps": 11000}
        return {}

    mock_client = MagicMock()
    mock_client.get_stats.side_effect = stats_side_effect
    mock_client.get_sleep_data.return_value = {}
    mock_client.get_hrv_data.return_value = {}
    mock_client.get_activities_window.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    assert mock_client.get_stats.call_count == 2
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["totalSteps"] == 11000
    assert saved_payload["source"]["metricDates"]["steps"] == "2026-08-05"


def test_sync_service_propagates_rate_limit_exhaustion():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False

    mock_client = MagicMock()
    mock_client.get_stats.side_effect = GarminConnectTooManyRequestsError("Too many requests")

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)

    with pytest.raises(GarminConnectTooManyRequestsError):
        service.sync_daily(target_date_str="2026-08-06", force=True)

    mock_repo.upsert_snapshot.assert_not_called()


def test_sync_service_computes_sleep_score_delta():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {
        f"2026-08-0{i}": {"raw": {"sleepScore": 70}} for i in range(1, 5)
    }

    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 55, "totalSteps": 10000}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 90}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["sleepScore"] == 90
    assert saved_payload["derived"]["sleepScore7dAvg"] == 70.0
    assert saved_payload["derived"]["deltas"]["sleepScoreVs7d"] == 20.0


def test_backfill_seeds_prehistory_from_firestore():
    """Regression test for Fix B: backfilling a range should seed raw_memory_store with
    historical Firestore snapshots from [start_d - 28d, start_d - 1d] so day 1 has ready baselines."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()

    # Create 28 days of prehistory (2026-07-01 -> 2026-07-28)
    prehistory_snapshots = {
        f"2026-07-{(i+1):02d}": {"raw": {"restingHr": 50, "sleepScore": 80, "hrvOvernightAvg": 60}}
        for i in range(28)
    }
    mock_repo.get_historical_snapshots.return_value = prehistory_snapshots

    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 50, "totalSteps": 10000}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 60}}
    mock_client.get_activities_window.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)

    # Backfill 1 day (2026-07-29)
    result = service.backfill(start_date_str="2026-07-29", end_date_str="2026-07-29", force=True)

    assert result is True
    mock_repo.get_historical_snapshots.assert_called_once_with("2026-07-01", "2026-07-28")
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["dataQuality"]["baseline7dReady"] is True
    assert saved_payload["dataQuality"]["baseline28dReady"] is True
    assert saved_payload["derived"]["restingHr7dAvg"] == 50.0
    assert saved_payload["derived"]["restingHr28dAvg"] == 50.0


def test_sync_service_fetches_activities_through_today_for_same_day_detection():
    """sync_daily's activity window must include target_iso itself (not just
    yesterday) so an already-uploaded same-day session can populate raw.todayTraining."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 55, "totalSteps": 10000}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = [
        {
            "activityId": 555,
            "startTimeLocal": "2026-08-06T07:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 1800,
            "aerobicTrainingEffect": 3.5,
            "activityTrainingLoad": 90.0,
        }
    ]

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    mock_client.get_activities_window.assert_called_once_with("2026-08-03", "2026-08-06")
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["todayTraining"] is not None
    assert saved_payload["raw"]["todayTraining"]["primaryActivity"]["type"] == "running"


def test_sync_service_skips_archiving_activity_with_missing_id():
    """An activity with no Garmin activityId must not be written to
    users/{userId}/activities/ -- doing so under a shared placeholder key would let it
    silently collide with another such activity."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 55, "totalSteps": 10000}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = [
        {
            # No "activityId" key -- e.g. an in-progress/pending upload.
            "startTimeLocal": "2026-08-06T07:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 1800,
            "aerobicTrainingEffect": 3.5,
        }
    ]

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    mock_repo.upsert_activity.assert_not_called()
    # The malformed activity still counts toward todayTraining's aggregates -- only
    # per-activity archiving is skipped.
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["todayTraining"] is not None
    assert saved_payload["raw"]["todayTraining"]["activityCount"] == 1


def test_sync_service_works_with_a_non_garmin_provider():
    """GarminSyncService depends on WearableProvider, not GarminClientWrapper directly --
    a fake second provider must be able to satisfy it with zero Garmin-specific code."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    fake_provider = FakeTestProvider(sleep_score=91.0, resting_hr=47.0)
    # garmin_client is intentionally never provided -- if the service tried to fall back
    # to a real GarminClientWrapper it would raise (no credentials configured).
    service = GarminSyncService(settings=settings, repository=mock_repo, provider=fake_provider)

    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    assert fake_provider.fetch_daily_metrics_calls == [("2026-08-06", "2026-08-05")]
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["sleepScore"] == 91.0
    assert saved_payload["raw"]["restingHr"] == 47.0


def test_sync_service_survives_a_failed_enrichment_fetch():
    """A metric-enrichment endpoint (stress/body battery/training readiness/training
    status) failing must not abort the whole sync -- the core snapshot (sleep/HRV/RHR)
    still saves, just without that one enrichment field."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 55, "totalSteps": 10000}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = []
    mock_client.get_stress_data.return_value = {"avgStressLevel": 30, "maxStressLevel": 80}
    mock_client.get_body_battery.return_value = [{"charged": 70, "drained": 60}]
    mock_client.get_training_readiness.return_value = [{"score": 65, "level": "HIGH", "feedbackLong": "OK"}]
    mock_client.get_training_status.side_effect = RuntimeError("training status endpoint down")

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True)

    assert result is True
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    # Core metrics unaffected by the enrichment failure.
    assert saved_payload["raw"]["sleepScore"] == 80
    assert saved_payload["raw"]["restingHr"] == 55
    # The endpoint that succeeded is populated...
    assert saved_payload["raw"]["stress"]["avg"] == 30
    assert saved_payload["dataQuality"]["bodyBatteryDetailAvailable"] is True
    # ...the one that failed degrades to absent, not a crash.
    assert saved_payload["raw"]["trainingStatus"] is None
    assert saved_payload["dataQuality"]["trainingStatusAvailable"] is False


def test_sync_service_does_not_serve_stale_cache_across_repeated_force_runs():
    """Regression test: GarminSyncService (and its lazily-created, reused provider)
    must not serve a prior sync_daily(..., force=True) call's cached stats/sleep on a
    second call for the same date -- each sync_daily invocation is a fresh operation
    and must fetch current Garmin data."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    mock_client = MagicMock()
    mock_client.get_stats.side_effect = [
        {"restingHeartRate": 50, "totalSteps": 9000},  # 1st call: target date
        {"restingHeartRate": 49, "totalSteps": 8800},  # 1st call: D-1 fallback
        {"restingHeartRate": 61, "totalSteps": 9500},  # 2nd call: target date (updated)
        {"restingHeartRate": 60, "totalSteps": 9300},  # 2nd call: D-1 fallback
    ]
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)

    service.sync_daily(target_date_str="2026-08-06", force=True)
    first_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert first_payload["raw"]["restingHr"] == 50

    service.sync_daily(target_date_str="2026-08-06", force=True)
    second_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert second_payload["raw"]["restingHr"] == 61  # fresh fetch, not the 1st run's cache

    assert mock_client.get_stats.call_count == 4  # 2 calls per run, not cached across runs
