from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from garminconnect import GarminConnectTooManyRequestsError

from garmin_sync.canonical import (
    CanonicalActivity,
    CanonicalActivityDetail,
    CanonicalDailyMetrics,
    CanonicalPerformanceTargets,
    CanonicalZoneBucket,
)
from garmin_sync.config import Settings
from garmin_sync.fit_activity import (
    FitActivityEvidence,
    FitDeviceInventoryEntry,
    FitRecordSample,
    FitTimerEvent,
)
from garmin_sync.provider import (
    ProviderActivitiesResult,
    ProviderActivityDetailResult,
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


class DetailFakeProvider(FakeTestProvider):
    capabilities = ProviderCapabilities(
        daily_summary=True,
        sleep=True,
        hrv=True,
        activities=True,
        activity_details=True,
    )

    def __init__(self, activity_count: int = 1):
        super().__init__()
        self.detail_calls: list[str] = []
        self.detail_side_effect: Exception | None = None
        self.activities = [
            CanonicalActivity(
                activity_id=str(index + 1),
                date="2026-08-06",
                type="cycling",
                duration_min=60,
                duration_seconds=3600,
                training_effect_aerobic=3.2,
                training_effect_anaerobic=0.4,
                average_hr=145,
                training_load=110.0,
                intensity_tag="moderate",
            )
            for index in range(activity_count)
        ]

    def fetch_activities(
        self,
        start_date_iso: str,
        end_date_iso: str,
        zone4_floor: int | None = None,
    ) -> ProviderActivitiesResult:
        return ProviderActivitiesResult(canonical=self.activities, raw_payload=[])

    def fetch_activity_detail(self, activity_id: str) -> ProviderActivityDetailResult:
        self.detail_calls.append(activity_id)
        if self.detail_side_effect is not None:
            raise self.detail_side_effect
        detail = CanonicalActivityDetail(
            activity_id=activity_id,
            power_zones=[CanonicalZoneBucket(2, 1200.0, 150.0)],
            normalized_power_watts=230.0,
        )
        return ProviderActivityDetailResult(canonical=detail, raw_payloads={})


class HrFidelityFakeProvider(DetailFakeProvider):
    capabilities = ProviderCapabilities(
        daily_summary=True,
        sleep=True,
        hrv=True,
        activities=True,
        activity_details=True,
        activity_hr_fidelity=True,
    )

    def __init__(self) -> None:
        super().__init__()
        self.hr_fidelity_calls: list[str] = []

    def fetch_activity_hr_fidelity(self, activity_id: str) -> FitActivityEvidence:
        self.hr_fidelity_calls.append(activity_id)
        start = datetime(2026, 8, 6, 8, 0)
        return FitActivityEvidence(
            devices=(FitDeviceInventoryEntry(1, None, None, "heart_rate", None),),
            records=tuple(
                FitRecordSample(start + timedelta(seconds=second), 145.0, None, 200.0)
                for second in range(3)
            ),
            average_heart_rate_bpm=145.0,
            lap_average_heart_rate_bpm=(),
            time_in_hr_zone_seconds=(),
            timer_events=(
                FitTimerEvent(start, "start"),
                FitTimerEvent(start + timedelta(seconds=2), "stop"),
            ),
        )


def _detail_service(provider: DetailFakeProvider, enabled: bool = True):
    settings = Settings(
        app_user_id="test_uid_789",
        garmin_activity_detail_enabled=enabled,
    )
    repo = MagicMock()
    repo.is_fresh.return_value = False
    repo.get_historical_snapshots.return_value = {}
    service = GarminSyncService(settings=settings, repository=repo, provider=provider)
    return service, repo


def test_activity_detail_flag_controls_fetch_and_uses_single_enriched_upsert():
    disabled_provider = DetailFakeProvider()
    disabled_service, disabled_repo = _detail_service(disabled_provider, enabled=False)
    assert disabled_service.sync_daily("2026-08-06", force=True, resync_lookback_days=0)
    assert disabled_provider.detail_calls == []
    disabled_payload = disabled_repo.upsert_activities.call_args.args[0][0][1]
    assert "powerInZones" not in disabled_payload

    enabled_provider = DetailFakeProvider()
    enabled_service, enabled_repo = _detail_service(enabled_provider, enabled=True)
    assert enabled_service.sync_daily("2026-08-06", force=True, resync_lookback_days=0)
    assert enabled_provider.detail_calls == ["1"]
    enabled_repo.upsert_activities.assert_called_once()
    enabled_payload = enabled_repo.upsert_activities.call_args.args[0][0][1]
    assert enabled_payload["normalizedPower"] == 230.0
    assert enabled_payload["powerInZones"][0]["zoneNumber"] == 2


def test_detail_failure_does_not_fail_sync_or_drop_base_activity():
    provider = DetailFakeProvider()
    provider.detail_side_effect = RuntimeError("detail endpoint unavailable")
    service, repo = _detail_service(provider)

    assert service.sync_daily("2026-08-06", force=True, resync_lookback_days=0)
    repo.upsert_snapshot.assert_called_once()
    repo.upsert_activities.assert_called_once()
    assert repo.upsert_activities.call_args.args[0][0][1]["activityId"] == "1"
    assert "powerInZones" not in repo.upsert_activities.call_args.args[0][0][1]


def test_rate_limit_stops_further_detail_fetches():
    provider = DetailFakeProvider(activity_count=2)
    provider.detail_side_effect = GarminConnectTooManyRequestsError("rate limited")
    service, repo = _detail_service(provider)

    assert service.sync_daily("2026-08-06", force=True, resync_lookback_days=0)
    assert provider.detail_calls == ["1"]
    assert (
        repo.upsert_activities.call_count == 1
        and len(repo.upsert_activities.call_args.args[0]) == 2
    )


def test_detail_fetch_skips_qualifying_activity_outside_target_date():
    """D-DETAIL-GATE scopes the live detail fetch to "the target-date pass of
    sync_daily" only. fetch_activities returns a 3-day lookback window (not just
    target_iso) for activity discovery, so a qualifying activity from that window's
    earlier days must not also get detail-fetched -- that would silently repeat the
    fetch/upsert for the same activity across multiple days' syncs, well past the
    documented 3xN-per-run budget."""
    provider = DetailFakeProvider()
    provider.activities = [
        CanonicalActivity(
            activity_id="prior-day",
            date="2026-08-06",
            type="cycling",
            duration_min=60,
            duration_seconds=3600,
            training_effect_aerobic=3.2,
            training_effect_anaerobic=0.4,
            average_hr=145,
            training_load=110.0,
            intensity_tag="moderate",
        ),
        CanonicalActivity(
            activity_id="target-day",
            date="2026-08-08",
            type="cycling",
            duration_min=60,
            duration_seconds=3600,
            training_effect_aerobic=3.2,
            training_effect_anaerobic=0.4,
            average_hr=145,
            training_load=110.0,
            intensity_tag="moderate",
        ),
    ]
    service, repo = _detail_service(provider)

    assert service.sync_daily("2026-08-08", force=True, resync_lookback_days=0)
    assert provider.detail_calls == ["target-day"]


def test_sync_daily_lookback_resync_forwards_activity_detail_flag():
    """Lookback resync (D-1) must forward garmin_activity_detail_enabled so qualifying
    activities on the lookback date are also detail-enriched."""
    provider = DetailFakeProvider()
    provider.activities = [
        CanonicalActivity(
            activity_id="lookback-day",
            date="2026-08-07",
            type="cycling",
            duration_min=60,
            duration_seconds=3600,
            training_effect_aerobic=3.2,
            training_effect_anaerobic=0.4,
            average_hr=145,
            training_load=110.0,
            intensity_tag="moderate",
        ),
        CanonicalActivity(
            activity_id="target-day",
            date="2026-08-08",
            type="cycling",
            duration_min=60,
            duration_seconds=3600,
            training_effect_aerobic=3.2,
            training_effect_anaerobic=0.4,
            average_hr=145,
            training_load=110.0,
            intensity_tag="moderate",
        ),
    ]
    service, repo = _detail_service(provider, enabled=True)

    assert service.sync_daily("2026-08-08", force=True, resync_lookback_days=1)
    assert provider.detail_calls == ["lookback-day", "target-day"]


def test_backfill_issues_no_detail_calls_even_when_enabled():
    provider = DetailFakeProvider()
    service, repo = _detail_service(provider)
    repo.get_snapshot.return_value = None

    assert service.backfill(
        start_date_str="2026-08-06",
        end_date_str="2026-08-06",
        force=True,
    )
    assert provider.detail_calls == []


def test_backfill_with_include_details_fetches_and_persists_details():
    provider = DetailFakeProvider()
    service, repo = _detail_service(provider)
    repo.get_snapshot.return_value = None

    assert service.backfill(
        start_date_str="2026-08-06",
        end_date_str="2026-08-06",
        force=True,
        include_details=True,
    )
    assert provider.detail_calls == ["1"]
    assert repo.upsert_activities.call_count == 1
    payload = repo.upsert_activities.call_args.args[0][0][1]
    assert payload["normalizedPower"] == 230.0
    assert payload["powerInZones"][0]["zoneNumber"] == 2


def test_backfill_uses_bulk_snapshot_lookup_without_per_date_reads():
    provider = DetailFakeProvider()
    service, repo = _detail_service(provider)

    assert service.backfill(
        start_date_str="2026-08-06",
        end_date_str="2026-08-08",
        force=False,
    )

    # One range query seeds prehistory and one covers the requested dates. An empty
    # successful range result is authoritative; it must not trigger an N+1 fallback.
    assert repo.get_historical_snapshots.call_count == 2
    repo.get_snapshot.assert_not_called()
    assert len(provider.fetch_daily_metrics_calls) == 3


def test_backfill_paces_between_live_fetches_but_not_after_the_last_one(monkeypatch) -> None:
    import garmin_sync.service as service_module

    provider = DetailFakeProvider()
    settings = Settings(
        app_user_id="test_uid_789",
        garmin_backfill_delay_min_seconds=1.0,
        garmin_backfill_delay_max_seconds=2.0,
    )
    repo = MagicMock()
    repo.is_fresh.return_value = False
    repo.get_historical_snapshots.return_value = {}
    service = GarminSyncService(settings=settings, repository=repo, provider=provider)

    sleep_calls: list[float] = []
    monkeypatch.setattr(service_module.time, "sleep", lambda seconds: sleep_calls.append(seconds))

    assert service.backfill(start_date_str="2026-08-06", end_date_str="2026-08-08", force=True)

    assert len(provider.fetch_daily_metrics_calls) == 3
    # 3 live fetches -> pace twice (between 1st/2nd and 2nd/3rd), never after the last date.
    assert len(sleep_calls) == 2
    assert all(1.0 <= s <= 2.0 for s in sleep_calls)


def test_backfill_does_not_pace_dates_skipped_via_existing_snapshot(monkeypatch) -> None:
    """Skipped (already-synced) dates never call Garmin -- pacing them would only slow
    down the routine, mostly-already-synced case this exists to protect."""
    import garmin_sync.service as service_module

    provider = DetailFakeProvider()
    settings = Settings(
        app_user_id="test_uid_789",
        garmin_backfill_delay_min_seconds=1.0,
        garmin_backfill_delay_max_seconds=2.0,
    )
    repo = MagicMock()
    repo.is_fresh.return_value = False
    repo.get_historical_snapshots.return_value = {
        "2026-08-06": {"raw": {"sleepScore": 80}},
        "2026-08-07": {"raw": {"sleepScore": 81}},
        "2026-08-08": {"raw": {"sleepScore": 82}},
    }
    service = GarminSyncService(settings=settings, repository=repo, provider=provider)

    sleep_calls: list[float] = []
    monkeypatch.setattr(service_module.time, "sleep", lambda seconds: sleep_calls.append(seconds))

    assert service.backfill(start_date_str="2026-08-06", end_date_str="2026-08-08", force=False)

    assert provider.fetch_daily_metrics_calls == []
    assert sleep_calls == []


def test_backfill_delay_disabled_by_default_in_directly_constructed_settings() -> None:
    """Settings() constructed directly (as every other test in this file does) defaults
    to no backfill pacing -- only _load_base_settings (the real CLI path) turns it on by
    default. This guards that default so test runs stay fast without every test needing
    to know about the new fields."""
    settings = Settings(app_user_id="test_uid_789")
    assert settings.garmin_backfill_delay_min_seconds == 0.0
    assert settings.garmin_backfill_delay_max_seconds == 0.0


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
        date_str="2026-09-01",
        workout_payload={"title": "Easy ride", "modality": "cycling", "blocks": []},
    )

    assert result is False
    client.schedule_workout.assert_not_called()


def test_push_workout_does_not_authenticate_when_the_queue_is_empty():
    settings = Settings(app_user_id="test_uid_789")
    service = GarminSyncService(settings=settings, repository=MagicMock(db=None))
    service._init_garmin_client = MagicMock()

    result = service.push_workout(date_str="2026-09-01")

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
    mock_repo.db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = doc_snap
    client = MagicMock()
    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=client)

    result = service.push_workout(date_str="2026-09-01")

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
            "2026-09-01",
            {
                "date": "2026-09-01",
                "status": "pending",
                "payload": {"title": "Ride A", "modality": "cycling", "blocks": []},
            },
        ),
        _FakeQueueDoc(
            "2026-09-02",
            {
                "date": "2026-09-02",
                "status": "pending",
                "payload": {"title": "Ride B", "modality": "cycling", "blocks": []},
            },
        ),
    ]
    queue_collection = (
        mock_repo.db.collection.return_value.document.return_value.collection.return_value
    )
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
    queue_collection = (
        mock_repo.db.collection.return_value.document.return_value.collection.return_value
    )
    queue_collection.where.return_value.stream.return_value = docs

    client = MagicMock()
    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=client)

    result = service.push_pending_workouts()

    assert result is True
    client.upload_workout.assert_not_called()


def test_push_pending_workouts_returns_true_for_empty_queue():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    queue_collection = (
        mock_repo.db.collection.return_value.document.return_value.collection.return_value
    )
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


class _FakeSyncRequestSnapshot:
    """Minimal stand-in for a Firestore DocumentSnapshot."""

    def __init__(self, data: dict | None):
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict:
        return dict(self._data) if self._data else {}


class _FakeSyncRequestDoc:
    """Minimal stand-in for a Firestore DocumentReference, mutated in place by
    _FakeSyncRequestTransaction.update -- so two poller instances sharing the same
    _FakeSyncRequestDoc observe each other's committed writes, the same way two real
    Cloud Run executions would observe each other's committed transactions."""

    def __init__(self, data: dict | None):
        self.data = data

    def get(self, transaction=None) -> _FakeSyncRequestSnapshot:
        return _FakeSyncRequestSnapshot(self.data)


class _FakeSyncRequestCollection:
    def __init__(self, doc: _FakeSyncRequestDoc):
        self._doc = doc

    def document(self, doc_id: str):
        return self._doc if doc_id == "latest" else self

    def collection(self, _name: str):
        return self


class _FakeSyncRequestTransaction:
    def update(self, doc_ref: _FakeSyncRequestDoc, payload: dict) -> None:
        doc_ref.data = {**(doc_ref.data or {}), **payload}


class _FakeSyncRequestDb:
    """Minimal stand-in for the Firestore client -- enough of the
    users/{uid}/garmin_sync_requests/latest chain plus .transaction() for
    poll_manual_sync_requests's atomic claim/finish transactions."""

    def __init__(self, doc: _FakeSyncRequestDoc):
        self._doc = doc

    def collection(self, _name: str):
        return _FakeSyncRequestCollection(self._doc)

    def transaction(self):
        return _FakeSyncRequestTransaction()


def test_poll_manual_sync_requests_claims_and_runs_forced_sync(monkeypatch):
    # The Firebase decorator normally retries real transactions on write contention;
    # the fake is enough to exercise the transaction body deterministically (see
    # test_performance_target_repository.py for the same convention).
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "pending"})
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.sync_daily = MagicMock(return_value=True)

    result = service.poll_manual_sync_requests()

    assert result is True
    service.sync_daily.assert_called_once_with(force=True)
    assert doc.data["status"] == "completed"
    assert doc.data["error"] is None
    assert doc.data["claimId"]  # tagged during the claim, still present after finishing


def test_poll_manual_sync_requests_marks_failed_when_sync_fails(monkeypatch):
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "pending"})
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.sync_daily = MagicMock(return_value=False)

    result = service.poll_manual_sync_requests()

    assert result is False
    assert doc.data["status"] == "failed"


def test_poll_manual_sync_requests_marks_failed_on_exception(monkeypatch):
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "pending"})
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.sync_daily = MagicMock(side_effect=Exception("boom"))

    result = service.poll_manual_sync_requests()

    assert result is False
    assert doc.data["status"] == "failed"
    assert "boom" in doc.data["error"]


def test_poll_manual_sync_requests_does_not_mislabel_a_successful_sync_when_finish_write_fails(
    monkeypatch,
):
    """A failure recording the outcome must never get relabeled as a sync failure --
    otherwise a sync that actually succeeded gets reported as failed."""
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "pending"})
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.sync_daily = MagicMock(return_value=True)
    service._finish_manual_sync_request = MagicMock(side_effect=RuntimeError("firestore hiccup"))

    result = service.poll_manual_sync_requests()

    assert result is True
    service._finish_manual_sync_request.assert_called_once()
    assert service._finish_manual_sync_request.call_args.args[2] == "completed"


def test_poll_manual_sync_requests_reports_false_when_finish_write_fails_after_sync_failure(
    monkeypatch,
):
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "pending"})
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.sync_daily = MagicMock(return_value=False)
    service._finish_manual_sync_request = MagicMock(side_effect=RuntimeError("firestore hiccup"))

    result = service.poll_manual_sync_requests()

    assert result is False
    service._finish_manual_sync_request.assert_called_once()
    assert service._finish_manual_sync_request.call_args.args[2] == "failed"


def test_poll_manual_sync_requests_noop_when_no_request_doc(monkeypatch):
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc(None)
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.sync_daily = MagicMock()

    result = service.poll_manual_sync_requests()

    assert result is True
    service.sync_daily.assert_not_called()
    assert doc.data is None


def test_poll_manual_sync_requests_noop_when_not_pending(monkeypatch):
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "completed"})
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.sync_daily = MagicMock()

    result = service.poll_manual_sync_requests()

    assert result is True
    service.sync_daily.assert_not_called()


def test_poll_manual_sync_requests_fails_without_firestore_db():
    settings = Settings(app_user_id="test_uid_789")
    service = GarminSyncService(settings=settings, repository=MagicMock(db=None))

    result = service.poll_manual_sync_requests()

    assert result is False


def test_poll_manual_sync_requests_second_concurrent_worker_never_reaches_sync_daily(monkeypatch):
    """P0 regression test: two Cloud Run executions polling the same pending request
    (e.g. an overrunning previous tick plus the next scheduled one) must not both call
    sync_daily. worker1's sync_daily mock re-enters via worker2.poll_manual_sync_requests()
    mid-call -- the same interleaving a second real execution starting while the first is
    still mid-sync would produce -- sharing the same fake doc so worker2 observes worker1's
    already-committed 'processing' claim."""
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "pending"})
    db = _FakeSyncRequestDb(doc)

    worker1 = GarminSyncService(settings=settings, repository=MagicMock(db=db))
    worker2 = GarminSyncService(settings=settings, repository=MagicMock(db=db))
    worker2.sync_daily = MagicMock(return_value=True)

    def worker1_sync_daily(*args, **kwargs):
        assert worker2.poll_manual_sync_requests() is True
        return True

    worker1.sync_daily = MagicMock(side_effect=worker1_sync_daily)

    result = worker1.poll_manual_sync_requests()

    assert result is True
    worker1.sync_daily.assert_called_once()
    worker2.sync_daily.assert_not_called()
    assert doc.data["status"] == "completed"


def test_poll_manual_sync_requests_initial_backfill(monkeypatch):
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "pending", "requestType": "initial_backfill", "days": 56})
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.backfill = MagicMock(return_value=True)
    service._sync_current_performance_targets = MagicMock()

    result = service.poll_manual_sync_requests()

    assert result is True
    service.backfill.assert_called_once_with(days=56, force=False)
    service._sync_current_performance_targets.assert_called_once()
    assert doc.data["status"] == "completed"
    assert doc.data["error"] is None


def test_sync_daily_cold_start_auto_backfill():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {
        "2026-08-20": {"date": "2026-08-20"},
        "2026-08-21": {"date": "2026-08-21"},
    }  # only 2 days < 14
    service = GarminSyncService(settings=settings, repository=mock_repo)
    service.backfill = MagicMock(return_value=True)
    service._sync_current_performance_targets = MagicMock()

    result = service.sync_daily(target_date_str="2026-08-22", auto_backfill_cold_start=True)

    assert result is True
    # The 56-day backfill window must end at target_date, not today -- days=56 would
    # resolve against local_today() instead.
    service.backfill.assert_called_once_with(
        start_date_str="2026-06-28", end_date_str="2026-08-22", force=False
    )
    service._sync_current_performance_targets.assert_called_once_with("2026-08-22")


def test_sync_daily_cold_start_auto_backfill_bounds_window_to_old_target_date():
    """Regression test: a target_date more than 56 days in the past must still get
    its own historical window ending at that date, not one ending at local_today()
    (which would silently skip creating target_date's own snapshot)."""
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    mock_repo.get_historical_snapshots.return_value = {}  # cold start
    service = GarminSyncService(settings=settings, repository=mock_repo)
    service.backfill = MagicMock(return_value=True)
    service._sync_current_performance_targets = MagicMock()

    result = service.sync_daily(target_date_str="2026-01-01", auto_backfill_cold_start=True)

    assert result is True
    service.backfill.assert_called_once_with(
        start_date_str="2025-11-07", end_date_str="2026-01-01", force=False
    )
    service._sync_current_performance_targets.assert_called_once_with("2026-01-01")


def test_sync_daily_warm_history_skips_cold_start_backfill():
    settings = Settings(app_user_id="test_uid_789")
    mock_repo = MagicMock()
    # 20 historical days >= 14
    mock_repo.get_historical_snapshots.return_value = {
        f"2026-07-{i:02d}": {"date": f"2026-07-{i:02d}"} for i in range(1, 21)
    }
    mock_repo.is_fresh.return_value = False
    service = GarminSyncService(settings=settings, repository=mock_repo)
    service.backfill = MagicMock()
    service._fetch_and_store_date = MagicMock(return_value=True)
    service._sync_current_performance_targets = MagicMock()

    result = service.sync_daily(target_date_str="2026-08-22", auto_backfill_cold_start=True)

    assert result is True
    service.backfill.assert_not_called()
    assert service._fetch_and_store_date.call_count >= 1


def test_poll_manual_sync_requests_retry_uses_latest_attempt_payload(monkeypatch):
    """P0 regression: Firestore retries claim_pending's transaction body on write
    contention, re-reading the doc from scratch each attempt. If a retry observes a
    *different* pending request than the first attempt (e.g. requestType changed
    because a fresh request superseded the original one between attempts), only the
    attempt whose transaction.update actually commits may be processed -- not an
    earlier attempt's stale read."""
    attempts = [
        {"status": "pending", "requestType": "backfill", "days": 56},
        {"status": "pending", "requestType": "sync"},
    ]

    class RetryingDoc:
        def __init__(self):
            self.data = attempts[-1]
            self._reads = 0

        def get(self, transaction=None):
            data = attempts[self._reads] if self._reads < len(attempts) else attempts[-1]
            self._reads += 1
            return _FakeSyncRequestSnapshot(data)

    def retried_transactional(fn):
        # Simulate Firestore auto-retrying the whole transaction body on contention:
        # the first invocation observes attempts[0] and loses the commit race, so the
        # runtime re-invokes fn from scratch -- only the second (successful) call's
        # observations may end up used by the caller.
        def wrapper(transaction):
            fn(transaction)
            return fn(transaction)

        return wrapper

    monkeypatch.setattr("garmin_sync.service.firestore.transactional", retried_transactional)
    settings = Settings(app_user_id="test_uid_789")
    doc = RetryingDoc()
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))
    service.sync_daily = MagicMock(return_value=True)
    service.backfill = MagicMock(return_value=True)

    result = service.poll_manual_sync_requests()

    assert result is True
    # The retry's payload (requestType="sync") must win -- not the first attempt's
    # stale "backfill" read, which would have routed this into service.backfill()
    # instead of the plain sync_daily() a bare 'sync' request type requires.
    service.sync_daily.assert_called_once_with(force=True)
    service.backfill.assert_not_called()


def test_poll_manual_sync_requests_finish_does_not_stomp_a_superseding_request(monkeypatch):
    """If the request doc gets reclaimed (a fresh Sync Now click) while this run is
    still in flight, finishing must not overwrite it -- the claimId check in
    _finish_manual_sync_request is what prevents that."""
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    settings = Settings(app_user_id="test_uid_789")
    doc = _FakeSyncRequestDoc({"status": "pending"})
    service = GarminSyncService(settings=settings, repository=MagicMock(db=_FakeSyncRequestDb(doc)))

    def fake_sync_daily(*args, **kwargs):
        doc.data = {"status": "processing", "claimId": "someone-elses-claim"}
        return True

    service.sync_daily = MagicMock(side_effect=fake_sync_daily)

    result = service.poll_manual_sync_requests()

    assert result is True
    assert doc.data == {"status": "processing", "claimId": "someone-elses-claim"}


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

    def is_fresh(
        self,
        date_iso: str,
        staleness_minutes: int = 60,
        incomplete_staleness_minutes: int = 5,
        require_complete: bool = True,
    ) -> bool:
        return False

    def get_historical_snapshots(self, start_iso: str, end_iso: str) -> dict[str, dict]:
        return {d: v for d, v in self.snapshots.items() if start_iso <= d <= end_iso}

    def upsert_snapshot(self, date_iso: str, payload: dict) -> None:
        self.snapshots[date_iso] = payload

    def upsert_activity(self, activity_id: int, payload: dict) -> None:
        pass  # not exercised by this test

    def upsert_activities(self, activities: list[tuple[str | int, dict]]) -> None:
        for activity_id, payload in activities:
            self.upsert_activity(activity_id, payload)

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
    mock_repo.is_fresh.assert_called_once_with(
        "2026-08-06", staleness_minutes=60, incomplete_staleness_minutes=5
    )


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


def test_hr_fidelity_is_target_only_and_never_blocks_base_activity_sync():
    settings = Settings(
        app_user_id="test_uid_789",
        garmin_activity_hr_fidelity_enabled=True,
    )
    mock_repo = MagicMock()
    mock_repo.is_fresh.return_value = False
    mock_repo.get_historical_snapshots.return_value = {}
    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 55, "totalSteps": 10000}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 65}}
    mock_client.get_activities_window.return_value = [
        {
            "activityId": 100,
            "startTimeLocal": "2026-08-05T08:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 1800,
        },
        {
            "activityId": 101,
            "startTimeLocal": "2026-08-06T08:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 1800,
        },
    ]
    mock_client.download_activity_original.side_effect = GarminConnectTooManyRequestsError("rate")

    service = GarminSyncService(settings=settings, repository=mock_repo, garmin_client=mock_client)
    assert service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0)

    mock_client.download_activity_original.assert_called_once_with("101")
    mock_repo.upsert_snapshot.assert_called_once()
    payload = mock_repo.upsert_activities.call_args.args[0][1][1]
    assert "hrMeasurement" not in payload


def test_hr_fidelity_persists_compact_assessment_in_existing_activity_upsert() -> None:
    provider = HrFidelityFakeProvider()
    settings = Settings(
        app_user_id="test_uid_789",
        garmin_activity_hr_fidelity_enabled=True,
    )
    repo = MagicMock()
    repo.is_fresh.return_value = False
    repo.get_historical_snapshots.return_value = {}
    service = GarminSyncService(settings=settings, repository=repo, provider=provider)

    assert service.sync_daily("2026-08-06", force=True, resync_lookback_days=0)

    assert provider.hr_fidelity_calls == ["1"]
    payload = repo.upsert_activities.call_args.args[0][0][1]
    assert payload["hrMeasurement"] == {
        "externalHrSensorPresent": True,
        "sourceForActivity": "mixed_possible",
        "provenanceConfidence": "ambiguous",
        "sensorTechnology": "external_unknown",
        "activityMotionRisk": "moderate",
        "coveragePct": 100.0,
        "longestGapSeconds": 1.0,
        "signalQuality": "clean",
        "measurementConfidence": "moderate",
        "summaryCompatibility": "unknown",
        "artifactFlags": [],
        "reasons": ["PROVENANCE_AMBIGUOUS"],
        "diagnosticVersion": "1.0.0",
    }


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
        f"2026-08-0{day}": {"raw": {"totalSteps": 5000}} for day in range(2, 6)
    }
    service = GarminSyncService(
        settings=settings,
        repository=mock_repo,
        provider=FakeTestProvider(),
    )

    assert (
        service.sync_daily(target_date_str="2026-08-06", force=True, resync_lookback_days=0) is True
    )

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
    mock_repo.is_fresh.assert_called_once_with(
        "2026-08-06", staleness_minutes=60, incomplete_staleness_minutes=5
    )


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
