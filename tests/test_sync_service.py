from unittest.mock import MagicMock

import pytest
from garminconnect import GarminConnectTooManyRequestsError

from garmin_sync.canonical import CanonicalDailyMetrics, CanonicalPerformanceTargets
from garmin_sync.config import Settings
from garmin_sync.provider import (
    ProviderActivitiesResult,
    ProviderCapabilities,
    ProviderFetchResult,
    ProviderPerformanceTargetsResult,
)
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

    def fetch_activities(
        self,
        start_date_iso: str,
        end_date_iso: str,
        zone4_floor: int | None = None,
    ) -> ProviderActivitiesResult:
        return ProviderActivitiesResult(canonical=[], raw_payload=[])

    def clear_cache(self) -> None:
        pass  # this fake provider doesn't cache anything


class TargetAwareFakeProvider(FakeTestProvider):
    def fetch_performance_targets(self) -> ProviderPerformanceTargetsResult:
        return ProviderPerformanceTargetsResult(
            canonical=CanonicalPerformanceTargets(
                cycling_ftp_watts=250, running_threshold_pace_sec_per_km=270, running_lthr_bpm=170
            ),
            raw_payloads={
                "cycling_ftp": {"functionalThresholdPower": 250},
                "lactate_threshold": {"speed_and_heart_rate": {"speed": 0.27}},
            },
        )


def test_push_workout_fails_when_garmin_does_not_return_a_workout_id():
    settings = Settings(app_user_id="test_uid_789")
    client = MagicMock()
    client.upload_workout.return_value = {}
    service = GarminSyncService(
        settings=settings,
        repository=MagicMock(db=None),
        garmin_client=client,
    )

    result = service.push_workout(
        date_str="2026-08-17",
        workout_payload={"title": "Easy ride", "modality": "cycling", "blocks": []},
    )

    assert result is False
    client.schedule_workout.assert_not_called()


def test_push_workout_does_not_authenticate_when_the_queue_is_empty():
    settings = Settings(app_user_id="test_uid_789")
    service = GarminSyncService(settings=settings, repository=MagicMock(db=None))
    service._init_garmin_client = MagicMock()

    result = service.push_workout(date_str="2026-08-17")

    assert result is False
    service._init_garmin_client.assert_not_called()


def test_push_workout_skips_already_synced_queue_item():
    """The idempotency guard that makes polling safe: a queue item that already made
    it to Garmin must not be re-uploaded just because push_workout runs again."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {
        "status": "synced",
        "garminWorkoutId": "999",
        "payload": {"title": "Easy ride", "modality": "cycling", "blocks": []},
    }
    mock_repo.db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = (
        doc_snap
    )
    client = MagicMock()
    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=client)

    result = service.push_workout(date_str="2026-08-17")

    assert result is True
    client.upload_workout.assert_not_called()


class _FakeQueueDoc:
    """Minimal stand-in for a Firestore QueryResult document snapshot."""

    def __init__(self, doc_id: str, data: dict):
        self.id = doc_id
        self._data = data

    def to_dict(self) -> dict:
        return self._data


def test_push_pending_workouts_pushes_each_pending_item_and_marks_synced():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    docs = [
        _FakeQueueDoc(
            "2026-08-17",
            {
                "date": "2026-08-17",
                "status": "pending",
                "payload": {"title": "Ride A", "modality": "cycling", "blocks": []},
            },
        ),
        _FakeQueueDoc(
            "2026-08-18",
            {
                "date": "2026-08-18",
                "status": "pending",
                "payload": {"title": "Ride B", "modality": "cycling", "blocks": []},
            },
        ),
    ]
    queue_collection = mock_repo.db.collection.return_value.document.return_value.collection.return_value
    queue_collection.where.return_value.stream.return_value = docs

    client = MagicMock()
    client.upload_workout.side_effect = [{"workoutId": "111"}, {"workoutId": "222"}]
    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=client)

    result = service.push_pending_workouts()

    assert result is True
    assert client.upload_workout.call_count == 2
    assert client.schedule_workout.call_count == 2
    set_calls = queue_collection.document.return_value.set.call_args_list
    assert len(set_calls) == 2
    for call in set_calls:
        assert call.args[0]["status"] == "synced"


def test_push_pending_workouts_leaves_stale_items_pending():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    docs = [
        _FakeQueueDoc(
            "2025-01-01",
            {
                "date": "2025-01-01",
                "status": "pending",
                "payload": {"title": "Old ride", "modality": "cycling", "blocks": []},
            },
        ),
    ]
    queue_collection = mock_repo.db.collection.return_value.document.return_value.collection.return_value
    queue_collection.where.return_value.stream.return_value = docs

    client = MagicMock()
    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=client)

    result = service.push_pending_workouts()

    assert result is True
    client.upload_workout.assert_not_called()


def test_push_pending_workouts_returns_true_for_empty_queue():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    queue_collection = mock_repo.db.collection.return_value.document.return_value.collection.return_value
    queue_collection.where.return_value.stream.return_value = []
    service = GarminSyncService(settings=settings, repository=mock_repo)
    service._init_garmin_client = MagicMock()

    result = service.push_pending_workouts()

    assert result is True
    service._init_garmin_client.assert_not_called()


def test_push_pending_workouts_fails_without_firestore_db():
    settings = Settings(app_user_id="test_uid_789")
    service = GarminSyncService(settings=settings, repository=MagicMock(db=None))

    result = service.push_pending_workouts()

    assert result is False


class DateAwareFakeProvider:
    """Like FakeTestProvider, but returns a per-date restingHr so a test can tell which
    date's fetch produced which stored value -- needed to prove the lookback resync's
    correction for one date actually shows up in another date's snapshot."""

    capabilities = ProviderCapabilities(daily_summary=True, sleep=True, hrv=True, activities=True)

    def __init__(self, resting_hr_by_date: dict[str, float]):
        self.resting_hr_by_date = resting_hr_by_date
        self.fetch_daily_metrics_calls: list[str] = []

    def fetch_daily_metrics(self, target_date_iso: str, yesterday_iso: str) -> ProviderFetchResult:
        self.fetch_daily_metrics_calls.append(target_date_iso)
        canonical = CanonicalDailyMetrics(
            date=target_date_iso,
            resting_heart_rate_bpm=self.resting_hr_by_date[target_date_iso],
            resting_heart_rate_date=target_date_iso,
            sleep_score=80.0,
            sleep_date=target_date_iso,
            hrv_overnight_avg_ms=60.0,
            hrv_date=target_date_iso,
            steps_count=9000,
            steps_date=yesterday_iso,
        )
        return ProviderFetchResult(canonical=canonical, raw_payloads={"stats": {"fake": True}})

    def fetch_activities(
        self,
        start_date_iso: str,
        end_date_iso: str,
        zone4_floor: int | None = None,
    ) -> ProviderActivitiesResult:
        return ProviderActivitiesResult(canonical=[], raw_payload=[])

    def clear_cache(self) -> None:
        pass


class FakeStatefulRepository:
    """Minimal in-memory FirestoreRecoveryRepository stand-in that actually persists
    upserts and serves them back from get_historical_snapshots. A MagicMock's static
    return value can't exercise cross-date ordering -- it never reflects an earlier
    write in the same sync_daily call, which is exactly what the lookback-then-target
    ordering regression test below needs to prove."""

    def __init__(self) -> None:
        self.snapshots: dict[str, dict] = {}

    def is_fresh(self, date_iso: str, staleness_minutes: int) -> bool:
        return False

    def get_historical_snapshots(self, start_iso: str, end_iso: str) -> dict[str, dict]:
        return {d: v for d, v in self.snapshots.items() if start_iso <= d <= end_iso}

    def upsert_snapshot(self, date_iso: str, payload: dict) -> None:
        self.snapshots[date_iso] = payload

    def upsert_activity(self, activity_id: int, payload: dict) -> None:
        pass  # not exercised by this test

    def get_snapshot(self, date_iso: str) -> dict | None:
        return self.snapshots.get(date_iso)


def test_live_sync_imports_current_targets_but_non_garmin_providers_need_not_support_them():
    settings = Settings(app_user_id="test_uid_789")
    repo = MagicMock()
    repo.is_fresh.return_value = False
    repo.get_historical_snapshots.return_value = {}
    service = GarminSyncService(
        settings=settings, repository=repo, provider=TargetAwareFakeProvider()
    )

    assert (
        service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0) is True
    )

    imported = repo.upsert_garmin_performance_targets.call_args.args[0]
    assert imported.cycling_ftp_watts == 250
    assert imported.running_lthr_bpm == 170


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
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}
    }
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)

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
    result = service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)

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
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 90}}}
    }
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)

    assert result is True
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["sleepScore"] == 90
    assert saved_payload["derived"]["sleepScore7dAvg"] == 70.0
    assert saved_payload["derived"]["deltas"]["sleepScoreVs7d"] == 20.0


def test_backfill_seeds_prehistory_from_firestore():
    """Regression test: backfilling a range should seed raw_memory_store with
    historical Firestore snapshots from [start_d - 28d, start_d - 1d] so day 1 has ready baselines."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()

    # Create 28 days of prehistory (2026-07-01 -> 2026-07-28)
    prehistory_snapshots = {
        f"2026-07-{(i + 1):02d}": {
            "raw": {"restingHr": 50, "sleepScore": 80, "hrvOvernightAvg": 60}
        }
        for i in range(28)
    }
    mock_repo.get_historical_snapshots.return_value = prehistory_snapshots

    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 50, "totalSteps": 10000}
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}
    }
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
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}
    }
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
    result = service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)

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
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}
    }
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
    result = service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)

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

    result = service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)

    assert result is True
    assert fake_provider.fetch_daily_metrics_calls == [("2026-08-06", "2026-08-05")]
    saved_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert saved_payload["raw"]["sleepScore"] == 91.0
    assert saved_payload["raw"]["restingHr"] == 47.0


def test_sync_service_derives_step_delta_from_completed_d1_steps():
    """Step deltas must receive the current canonical D-1 total, not only history."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {
        f"2026-08-0{day}": {"raw": {"totalSteps": 5000}}
        for day in range(2, 6)
    }
    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        provider=FakeTestProvider(),
    )

    assert service.sync_daily(
        target_date_str="2026-08-06", force=True, resync_lookback_days=0
    ) is True

    saved_payload = mock_repo.upsert_snapshot.call_args.args[1]
    assert saved_payload["raw"]["totalSteps"] == 9000
    assert saved_payload["derived"]["steps7dAvg"] == 5000.0
    assert saved_payload["derived"]["deltas"]["stepsVs7d"] == 4000.0


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
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}
    }
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = []
    mock_client.get_stress_data.return_value = {"avgStressLevel": 30, "maxStressLevel": 80}
    mock_client.get_body_battery.return_value = [{"charged": 70, "drained": 60}]
    mock_client.get_training_readiness.return_value = [
        {"score": 65, "level": "HIGH", "feedbackLong": "OK"}
    ]
    mock_client.get_training_status.side_effect = RuntimeError("training status endpoint down")

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    result = service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)

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
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}
    }
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = []

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)

    service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)
    first_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert first_payload["raw"]["restingHr"] == 50

    service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)
    second_payload = mock_repo.upsert_snapshot.call_args[0][1]
    assert second_payload["raw"]["restingHr"] == 61  # fresh fetch, not the 1st run's cache

    assert mock_client.get_stats.call_count == 4  # 2 calls per run, not cached across runs


def test_sync_service_resyncs_previous_day_by_default():
    """The core feature this covers: a training session logged today isn't guaranteed
    to be reflected by today's own sync -- e.g. it's uploaded to Garmin after that sync
    already ran. sync_daily's default lookback (settings.garmin_resync_lookback_days,
    normally 1) must revisit D-1 too, so tomorrow's sync is what actually picks it up."""
    settings = Settings(app_user_id="test_uid_789")
    assert settings.garmin_resync_lookback_days == 1
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    fake_provider = FakeTestProvider(sleep_score=91.0, resting_hr=47.0)
    service = GarminSyncService(settings=settings, repository=mock_repo, provider=fake_provider)

    result = service.sync_daily(target_date_str="2026-08-06", force=False)

    assert result is True
    # D-1, then the target date -- both actually fetched from the provider. D-1 goes
    # first (and is stored first) so the target date's own rolling baselines, built
    # last, pick up whatever D-1 correction just landed; see sync_daily's docstring.
    assert fake_provider.fetch_daily_metrics_calls == [
        ("2026-08-05", "2026-08-04"),
        ("2026-08-06", "2026-08-05"),
    ]
    assert mock_repo.upsert_snapshot.call_count == 2
    stored_dates = [call.args[0] for call in mock_repo.upsert_snapshot.call_args_list]
    assert stored_dates == ["2026-08-05", "2026-08-06"]


def test_sync_service_lookback_days_can_be_overridden():
    """--resync-days (resync_lookback_days) overrides settings.garmin_resync_lookback_days
    per call, e.g. to widen the window after an extended outage or narrow it to 0."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    fake_provider = FakeTestProvider()
    service = GarminSyncService(settings=settings, repository=mock_repo, provider=fake_provider)

    result = service.sync_daily(target_date_str="2026-08-06", force=False, resync_lookback_days=3)

    assert result is True
    # Oldest lookback date first, target date last.
    assert fake_provider.fetch_daily_metrics_calls == [
        ("2026-08-03", "2026-08-02"),
        ("2026-08-04", "2026-08-03"),
        ("2026-08-05", "2026-08-04"),
        ("2026-08-06", "2026-08-05"),
    ]


def test_sync_service_fresh_target_skips_lookback_resync_too():
    """A retriggered run within the staleness window is a full no-op -- it must not
    re-hit the lookback dates either, or every duplicate cron/manual re-trigger would
    double the Garmin API calls for no reason."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = True

    fake_provider = FakeTestProvider()
    service = GarminSyncService(settings=settings, repository=mock_repo, provider=fake_provider)

    result = service.sync_daily(target_date_str="2026-08-06", force=False)

    assert result is True
    assert fake_provider.fetch_daily_metrics_calls == []
    mock_repo.upsert_snapshot.assert_not_called()
    mock_repo.is_fresh.assert_called_once_with("2026-08-06", 60)


def test_sync_service_lookback_failure_does_not_hide_primary_success_but_reports_false():
    """If the D-1 lookback resync blows up (e.g. a transient Garmin error), the primary
    target-date sync must still have been saved -- but the overall call reports False so
    the failure isn't silently swallowed. D-1 is fetched first (see sync_daily), so it's
    the first provider call that's made to fail here."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}

    call_count = {"n": 0}

    class FlakyLookbackProvider(FakeTestProvider):
        def fetch_daily_metrics(self, target_date_iso: str, yesterday_iso: str):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("transient Garmin error on lookback date")
            return super().fetch_daily_metrics(target_date_iso, yesterday_iso)

    service = GarminSyncService(
        settings=settings, repository=mock_repo, provider=FlakyLookbackProvider()
    )
    result = service.sync_daily(target_date_str="2026-08-06", force=False)

    assert result is False
    mock_repo.upsert_snapshot.assert_called_once()
    assert mock_repo.upsert_snapshot.call_args[0][0] == "2026-08-06"


def test_sync_service_builds_target_snapshot_after_lookback_dates_are_corrected():
    """Regression test: target_iso's rolling 7d baseline must be built from D-1's
    *corrected* raw value (the one the lookback resync just wrote), not the stale value
    that was already in Firestore before this sync_daily call started. That only holds
    if D-1 is resynced and stored before the target date's own snapshot is built --
    a MagicMock repository can't exercise this because its return value is static
    regardless of what was upserted moments earlier, hence FakeStatefulRepository."""
    settings = Settings(app_user_id="test_uid_789")
    repo = FakeStatefulRepository()
    # Pre-existing (stale) history, as if an earlier/incomplete sync wrote it.
    repo.snapshots["2026-08-05"] = {"raw": {"restingHr": 40.0}}  # D-1, about to be corrected
    repo.snapshots["2026-08-04"] = {"raw": {"restingHr": 50.0}}
    repo.snapshots["2026-08-03"] = {"raw": {"restingHr": 50.0}}
    repo.snapshots["2026-08-02"] = {"raw": {"restingHr": 50.0}}

    provider = DateAwareFakeProvider(
        {
            "2026-08-06": 70.0,  # target date's own value (excluded from its own baseline)
            "2026-08-05": 60.0,  # D-1's corrected value, as returned by the lookback resync
        }
    )

    service = GarminSyncService(settings=settings, repository=repo, provider=provider)
    result = service.sync_daily(target_date_str="2026-08-06", force=False)

    assert result is True
    # D-1 was actually resynced and its stale value overwritten.
    assert repo.snapshots["2026-08-05"]["raw"]["restingHr"] == 60.0
    # Target's 7d baseline -- (60 + 50 + 50 + 50) / 4 -- used the corrected D-1 value
    # because D-1 was rebuilt and stored before the target snapshot was.
    assert repo.snapshots["2026-08-06"]["derived"]["restingHr7dAvg"] == 52.5
