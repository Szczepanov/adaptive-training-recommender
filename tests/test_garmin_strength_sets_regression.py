from unittest.mock import MagicMock

from garmin_sync.canonical import (
    CanonicalActivity,
    CanonicalActivityDetail,
    CanonicalDailyMetrics,
    CanonicalExerciseSet,
)
from garmin_sync.config import Settings
from garmin_sync.garmin_provider import (
    GarminProviderAdapter,
    extract_exercise_sets,
    qualifies_for_strength_exercise_sets,
)
from garmin_sync.provider import (
    ProviderActivitiesResult,
    ProviderActivityDetailResult,
    ProviderCapabilities,
    ProviderFetchResult,
)
from garmin_sync.service import GarminSyncService


def _realistic_strength_payload() -> dict:
    return {
        "exerciseSets": [
            {
                "messageIndex": 0,
                "setType": "ACTIVE",
                "duration": 35.2,
                "repetitionCount": 10,
                "weight": 12473,
                "exercises": [
                    {"category": "BENCH_PRESS", "name": "BARBELL_BENCH_PRESS", "probability": 88.0},
                    {"category": "UNKNOWN", "probability": 12.0},
                ],
            },
            {"messageIndex": 1, "setType": "REST", "duration": 90.0},
            {
                "messageIndex": 2,
                "setType": "ACTIVE",
                "duration": 31.0,
                "repetitionCount": 8,
                "weight": 60000,
                "exercises": [
                    {"category": "SQUAT", "name": "BACK_SQUAT", "probability": 50.0},
                    {"category": "DEADLIFT", "name": "BARBELL_DEADLIFT", "probability": 50.0},
                ],
            },
            {"messageIndex": 3, "setType": "REST", "duration": 120.0},
        ]
    }


def test_extract_exercise_sets_matches_live_garmin_shape():
    sets = extract_exercise_sets(_realistic_strength_payload())

    assert sets is not None and len(sets) == 2
    assert sets[0].set_order == 0
    assert sets[0].repetition_count == 10
    assert sets[0].weight_kg == 12.47  # Garmin raw `weight` is grams.
    assert sets[0].exercise_category == "BENCH_PRESS"
    assert sets[0].exercise_name == "BARBELL_BENCH_PRESS"
    assert sets[0].rest_duration_seconds == 90.0

    # REST rows do not become fake numbered sets; working sets stay compact 1, 2, ...
    assert sets[1].set_order == 1
    assert sets[1].repetition_count == 8
    assert sets[1].weight_kg == 60.0
    assert sets[1].rest_duration_seconds == 120.0
    # A tied Garmin ML classification is not presented as a factual exercise label.
    assert sets[1].exercise_category is None
    assert sets[1].exercise_name is None


def test_extract_exercise_sets_keeps_explicit_weight_kg_compatibility_shape():
    sets = extract_exercise_sets(
        {
            "exerciseSets": [
                {
                    "setOrder": 0,
                    "setType": "ACTIVE",
                    "repetitionCount": 5,
                    "weightKg": 70.0,
                    "exerciseName": "Deadlift",
                    "durationSeconds": 20,
                    "restDurationSeconds": 120,
                }
            ]
        }
    )

    assert sets is not None
    assert sets[0].weight_kg == 70.0
    assert sets[0].exercise_name == "Deadlift"


def _activity(activity_type: str, activity_id: str | None = "42") -> CanonicalActivity:
    return CanonicalActivity(
        activity_id=activity_id,
        date="2026-08-23",
        type=activity_type,
        duration_min=45,
        duration_seconds=2700,
        training_effect_aerobic=1.0,
        training_effect_anaerobic=1.0,
        average_hr=110,
        training_load=40.0,
        intensity_tag="easy",
    )


def test_strength_set_gate_is_independent_of_intensity_and_power_detail_gate():
    assert qualifies_for_strength_exercise_sets(_activity("strength_training"))
    assert qualifies_for_strength_exercise_sets(_activity("fitness_equipment"))
    assert not qualifies_for_strength_exercise_sets(_activity("cycling"))
    assert not qualifies_for_strength_exercise_sets(_activity("running"))
    assert not qualifies_for_strength_exercise_sets(_activity("strength_training", None))


def test_strength_adapter_calls_only_exercise_sets_endpoint():
    client = MagicMock()
    client.get_activities_window.return_value = [
        {
            "activityId": 42,
            "startTimeLocal": "2026-08-23T08:00:00",
            "duration": 2700,
            "activityType": {"typeKey": "strength_training"},
        }
    ]
    client.get_activity_exercise_sets.return_value = _realistic_strength_payload()
    adapter = GarminProviderAdapter(client)

    adapter.fetch_activities("2026-08-23", "2026-08-23")
    result = adapter.fetch_activity_detail("42")

    client.get_activity_exercise_sets.assert_called_once_with("42")
    client.get_activity_power_zones.assert_not_called()
    client.get_activity_hr_zones.assert_not_called()
    client.get_activity_splits.assert_not_called()
    assert set(result.raw_payloads) == {"activity_exercise_sets"}
    assert result.canonical.exercise_sets is not None
    assert result.canonical.exercise_sets[0].weight_kg == 12.47


class _StrengthProvider:
    capabilities = ProviderCapabilities(
        daily_summary=True,
        sleep=True,
        hrv=True,
        activities=True,
        activity_details=True,
    )

    def __init__(self, activity_type: str):
        self.activity = _activity(activity_type)
        self.detail_calls: list[str] = []

    def clear_cache(self) -> None:
        pass

    def fetch_daily_metrics(self, target_date_iso: str, yesterday_iso: str) -> ProviderFetchResult:
        return ProviderFetchResult(
            canonical=CanonicalDailyMetrics(date=target_date_iso),
            raw_payloads={"stats": {}, "stats_fallback": {}, "sleep": {}, "hrv": {}},
        )

    def fetch_activities(
        self,
        start_date_iso: str,
        end_date_iso: str,
        zone4_floor: int | None = None,
    ) -> ProviderActivitiesResult:
        self.activity.date = end_date_iso
        return ProviderActivitiesResult(canonical=[self.activity], raw_payload=[])

    def fetch_activity_detail(self, activity_id: str) -> ProviderActivityDetailResult:
        self.detail_calls.append(activity_id)
        return ProviderActivityDetailResult(
            canonical=CanonicalActivityDetail(
                activity_id=activity_id,
                exercise_sets=[
                    CanonicalExerciseSet(
                        set_order=0,
                        repetition_count=10,
                        weight_kg=12.47,
                        rest_duration_seconds=90.0,
                    )
                ],
            ),
            raw_payloads={"activity_exercise_sets": _realistic_strength_payload()},
        )


def _service(provider: _StrengthProvider) -> tuple[GarminSyncService, MagicMock]:
    # Production explicitly leaves the existing power-detail flag disabled. Strength
    # sets must still auto-sync, while cycling detail must remain gated off.
    settings = Settings(app_user_id="test_uid_strength", garmin_activity_detail_enabled=False)
    repo = MagicMock()
    repo.is_fresh.return_value = False
    repo.get_historical_snapshots.return_value = {}
    service = GarminSyncService(settings=settings, repository=repo, provider=provider)
    return service, repo


def test_strength_sets_auto_sync_when_power_detail_flag_is_disabled():
    provider = _StrengthProvider("strength_training")
    service, repo = _service(provider)

    assert service.sync_daily("2026-08-23", force=True, resync_lookback_days=0)
    assert provider.detail_calls == ["42"]
    payload = repo.upsert_activities.call_args.args[0][0][1]
    assert payload["exerciseSets"][0]["repetitionCount"] == 10
    assert payload["exerciseSets"][0]["weightKg"] == 12.47


def test_disabled_power_detail_flag_still_skips_cycling_detail():
    provider = _StrengthProvider("cycling")
    service, _ = _service(provider)

    assert service.sync_daily("2026-08-23", force=True, resync_lookback_days=0)
    assert provider.detail_calls == []
