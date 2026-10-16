from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from garminconnect import GarminConnectTooManyRequestsError

from garmin_sync.canonical import CanonicalActivity, CanonicalActivityDetail, CanonicalLapSummary
from garmin_sync.config import Settings
from garmin_sync.firestore_repository import FirestoreRecoveryRepository
from garmin_sync.provider import ProviderActivitiesResult, ProviderActivityDetailResult
from garmin_sync.service import GarminSyncService


def make_service() -> tuple[GarminSyncService, MagicMock, MagicMock]:
    activity = CanonicalActivity(
        activity_id="ride",
        date="2026-10-12",
        type="elliptical",
        duration_min=30,
        duration_seconds=1800,
        training_effect_aerobic=1,
        training_effect_anaerobic=0,
        average_hr=100,
        training_load=10,
        intensity_tag="easy",
    )
    repo = MagicMock()
    repo.get_activity.return_value = {
        "activityId": "ride",
        "date": "2026-10-12",
        "intensityTag": "easy",
        "syncRunId": "original",
        "syncedAt": "original",
        "custom": "keep",
        "laps": [{"lapIndex": 1, "durationSeconds": 600, "averagePowerWatts": 200}],
        "hrInZones": [{"zoneNumber": 1, "secondsInZone": 30}],
    }
    provider = MagicMock()
    provider.capabilities.activity_details = True
    provider.fetch_activities.return_value = ProviderActivitiesResult([activity], [])
    provider.fetch_activity_detail.return_value = ProviderActivityDetailResult(
        CanonicalActivityDetail("ride", laps=[CanonicalLapSummary(1, 600, average_hr_bpm=110)]),
        {},
    )
    service = GarminSyncService(
        Settings(app_user_id="owner", garmin_activity_detail_enabled=False),
        repository=repo,
        provider=provider,
    )
    return service, repo, provider


def test_explicit_details_bypass_automatic_eligibility_and_preserve_existing_fields() -> None:
    service, repo, provider = make_service()
    assert service.fetch_activity_details("ride") is True
    repo.get_activity.assert_called_once_with("ride")
    provider.clear_cache.assert_called_once()
    provider.fetch_activities.assert_called_once_with("2026-10-12", "2026-10-12")
    provider.fetch_activity_detail.assert_called_once_with("ride")
    repo.update_activity_details.assert_called_once_with(
        "ride",
        {
            "laps": [
                {
                    "lapIndex": 1,
                    "durationSeconds": 600,
                    "averagePowerWatts": 200,
                    "averageHrBpm": 110,
                }
            ],
        },
    )
    repo.upsert_activity.assert_not_called()
    repo.upsert_activities.assert_not_called()


@pytest.mark.parametrize(
    "record",
    [
        None,
        {},
        {"activityId": "wrong", "date": "2026-10-12"},
        {"activityId": "ride", "date": "bad"},
    ],
)
def test_invalid_or_missing_existing_activity_never_calls_provider(record: object) -> None:
    service, repo, provider = make_service()
    repo.get_activity.return_value = record
    with pytest.raises(ValueError):
        service.fetch_activity_details("ride")
    provider.clear_cache.assert_not_called()
    provider.fetch_activities.assert_not_called()
    repo.update_activity_details.assert_not_called()


@pytest.mark.parametrize("identifier", ["", "   ", "x" * 129, "nested/id", ".", ".."])
def test_invalid_identifier_never_reads_repository(identifier: str) -> None:
    service, repo, _provider = make_service()
    with pytest.raises(ValueError):
        service.fetch_activity_details(identifier)
    repo.get_activity.assert_not_called()


def test_missing_fresh_target_does_not_fetch_any_detail() -> None:
    service, repo, provider = make_service()
    provider.fetch_activities.return_value = ProviderActivitiesResult([], [])
    with pytest.raises(ValueError):
        service.fetch_activity_details("ride")
    provider.fetch_activity_detail.assert_not_called()
    repo.update_activity_details.assert_not_called()


@pytest.mark.parametrize(
    "detail",
    [
        CanonicalActivityDetail("ride"),
        CanonicalActivityDetail("ride", hr_zones=[], exercise_sets=[]),
        CanonicalActivityDetail("wrong", laps=[CanonicalLapSummary(1, 100)]),
    ],
)
def test_empty_or_wrong_detail_never_reports_success_or_writes(
    detail: CanonicalActivityDetail,
) -> None:
    service, repo, provider = make_service()
    provider.fetch_activity_detail.return_value = ProviderActivityDetailResult(detail, {})
    with pytest.raises(ValueError):
        service.fetch_activity_details("ride")
    repo.update_activity_details.assert_not_called()


@pytest.mark.parametrize("endpoint", ["fetch_activities", "fetch_activity_detail"])
def test_rate_limit_stops_all_further_calls(endpoint: str) -> None:
    service, repo, provider = make_service()
    getattr(provider, endpoint).side_effect = GarminConnectTooManyRequestsError("429")
    with pytest.raises(GarminConnectTooManyRequestsError):
        service.fetch_activity_details("ride")
    repo.update_activity_details.assert_not_called()
    if endpoint == "fetch_activities":
        provider.fetch_activity_detail.assert_not_called()


def test_provider_without_detail_capability_is_unavailable() -> None:
    service, repo, provider = make_service()
    provider.capabilities.activity_details = False
    with pytest.raises(ValueError):
        service.fetch_activity_details("ride")
    provider.fetch_activities.assert_not_called()
    repo.update_activity_details.assert_not_called()


def test_repository_scopes_reads_and_uses_update_not_upsert() -> None:
    db = MagicMock()
    ref = db.collection.return_value.document.return_value.collection.return_value.document.return_value
    ref.get.return_value = SimpleNamespace(exists=True, to_dict=lambda: {"activityId": "ride"})
    repo = FirestoreRecoveryRepository(user_id="owner", db=db)
    assert repo.get_activity("ride") == {"activityId": "ride"}
    repo.update_activity_details(
        "ride", {"laps": [{"lapIndex": 1}], "runningDynamics": {"strideLengthM": 1.2}}
    )
    db.collection.assert_called_with("users")
    db.collection.return_value.document.assert_called_with("owner")
    db.collection.return_value.document.return_value.collection.assert_called_with("activities")
    ref.update.assert_called_once_with(
        {"laps": [{"lapIndex": 1}], "runningDynamics.strideLengthM": 1.2}
    )
    ref.set.assert_not_called()
    ref.get.return_value = SimpleNamespace(exists=False)
    assert repo.get_activity("gone") is None


def test_repository_rejects_non_detail_fields() -> None:
    repo = FirestoreRecoveryRepository(user_id="owner", db=MagicMock())
    with pytest.raises(ValueError):
        repo.update_activity_details("ride", {"intensityTag": "hard"})


def test_partial_rate_limit_preserves_detail_and_stops_with_retry_signal() -> None:
    service, repo, provider = make_service()
    provider.fetch_activity_detail.return_value.rate_limited = True
    with pytest.raises(GarminConnectTooManyRequestsError):
        service.fetch_activity_details("ride")
    repo.update_activity_details.assert_called_once()
    provider.fetch_activity_detail.assert_called_once_with("ride")
    assert len(provider.method_calls) == 3  # clear cache, fresh summary, requested detail


def test_partial_empty_fields_preserve_previous_zones() -> None:
    service, repo, provider = make_service()
    provider.fetch_activity_detail.return_value.canonical.hr_zones = []
    assert service.fetch_activity_details("ride") is True
    assert "hrInZones" not in repo.update_activity_details.call_args.args[1]


def test_repository_never_recreates_a_deleted_activity() -> None:
    db = MagicMock()
    ref = db.collection.return_value.document.return_value.collection.return_value.document.return_value
    ref.update.side_effect = RuntimeError("not found")
    repo = FirestoreRecoveryRepository(user_id="owner", db=db)
    with pytest.raises(RuntimeError):
        repo.update_activity_details("ride", {"laps": [{"lapIndex": 1}]})
    ref.set.assert_not_called()


def queue_request(
    service: GarminSyncService, monkeypatch: pytest.MonkeyPatch
) -> tuple[dict, MagicMock]:
    monkeypatch.setattr("garmin_sync.service.firestore.transactional", lambda fn: fn)
    data = {"status": "pending", "requestType": "activity_details", "activityId": "ride"}
    db = MagicMock()
    ref = db.collection.return_value.document.return_value.collection.return_value.document.return_value
    ref.get.side_effect = lambda **kwargs: SimpleNamespace(exists=True, to_dict=lambda: dict(data))
    db.transaction.return_value.update.side_effect = lambda _ref, fields: data.update(fields)
    service.repository.db = db
    service.sync_daily = MagicMock()
    return data, ref


def test_poll_dispatch_and_completed_request_does_not_repeat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _repo, provider = make_service()
    data, _ref = queue_request(service, monkeypatch)
    assert service.poll_manual_sync_requests() is True
    assert data["status"] == "completed"
    assert data["error"] is None
    assert data["completedAt"]
    assert data["claimId"]
    assert service.poll_manual_sync_requests() is True
    provider.fetch_activity_detail.assert_called_once_with("ride")
    service.sync_daily.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        ValueError("private activity payload"),
        RuntimeError("private credentials"),
        GarminConnectTooManyRequestsError("429 private payload"),
    ],
)
def test_poll_failure_is_safe_terminal_and_retry_can_run(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    service, repo, provider = make_service()
    data, _ref = queue_request(service, monkeypatch)
    provider.fetch_activity_detail.side_effect = error
    assert service.poll_manual_sync_requests() is False
    assert data["status"] == "failed"
    assert data["completedAt"]
    assert "private" not in data["error"]
    repo.update_activity_details.assert_not_called()
    provider.fetch_activity_detail.side_effect = None
    data["status"] = "pending"
    assert service.poll_manual_sync_requests() is True
    assert data["status"] == "completed"


def test_poll_finish_preserves_superseding_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    service, _repo, provider = make_service()
    data, _ref = queue_request(service, monkeypatch)
    result = provider.fetch_activity_detail.return_value

    def supersede(_activity_id: str) -> object:
        data.update({"claimId": "new-owner", "status": "processing"})
        return result

    provider.fetch_activity_detail.side_effect = supersede
    assert service.poll_manual_sync_requests() is True
    assert data["claimId"] == "new-owner"
    assert data["status"] == "processing"
    assert "completedAt" not in data


def test_poll_partial_rate_limit_records_failure_after_saving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, repo, provider = make_service()
    data, _ref = queue_request(service, monkeypatch)
    provider.fetch_activity_detail.return_value.rate_limited = True
    assert service.poll_manual_sync_requests() is False
    assert data["status"] == "failed"
    assert "rate limited" in data["error"]
    repo.update_activity_details.assert_called_once()
