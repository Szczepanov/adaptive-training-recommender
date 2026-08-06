import json
from pathlib import Path
from garmin_sync.mapper import map_garmin_payload_to_snapshot, normalize_current_metrics
from garmin_sync.models import DerivedMetrics

FIXTURES_DIR = Path(__file__).parent / "fixtures"

def test_map_garmin_payload_to_snapshot():
    with open(FIXTURES_DIR / "stats.json") as f:
        stats = json.load(f)
    with open(FIXTURES_DIR / "sleep.json") as f:
        sleep = json.load(f)
    with open(FIXTURES_DIR / "hrv.json") as f:
        hrv = json.load(f)
    with open(FIXTURES_DIR / "activities.json") as f:
        activities = json.load(f)

    derived = DerivedMetrics(restingHr7dAvg=53.0, restingHr28dAvg=54.0)

    stats_yesterday = {"totalSteps": 8420, "restingHeartRate": 51}

    snapshot = map_garmin_payload_to_snapshot(
        user_id="test_firebase_uid_123",
        target_date_iso="2026-08-06",
        stats_today=stats,
        stats_fallback=stats_yesterday,
        sleep_today=sleep,
        sleep_fallback=None,
        hrv_today=hrv,
        activities_window=activities,
        derived_metrics=derived,
        timezone_name="Europe/Warsaw",
    )

    assert snapshot.userId == "test_firebase_uid_123"
    assert snapshot.date == "2026-08-06"
    assert snapshot.raw.sleepScore == 82
    assert snapshot.raw.restingHr == 52
    assert snapshot.raw.hrvOvernightAvg == 68
    assert snapshot.raw.last3DaysHardSessionsCount == 1
    assert snapshot.raw.yesterdayTraining is not None
    assert snapshot.raw.yesterdayTraining.primaryActivity is not None
    assert snapshot.raw.yesterdayTraining.primaryActivity.intensityTag == "hard"
    assert snapshot.source.sourceSchemaVersion == 3
    assert snapshot.source.timezone == "Europe/Warsaw"
    assert snapshot.source.metricDates.sleep == "2026-08-06"
    assert snapshot.source.metricDates.steps == "2026-08-05"  # D-1 steps semantics


def test_normalize_current_metrics_fallback_consistency():
    stats_today = {}  # missing RHR
    stats_fallback = {"restingHeartRate": 50, "totalSteps": 12000}
    sleep_today = {}  # missing sleep
    sleep_fallback = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 78}}, "sleepTimeSeconds": 28800}}
    hrv_today = {"hrvSummary": {"lastNightAvg": 62, "status": "BALANCED"}}

    norm, dates = normalize_current_metrics(
        stats_today=stats_today,
        stats_fallback=stats_fallback,
        sleep_today=sleep_today,
        sleep_fallback=sleep_fallback,
        hrv_today=hrv_today,
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
    )

    assert norm["restingHr"] == 50
    assert dates.restingHr == "2026-08-05"
    assert norm["sleepScore"] == 78
    assert dates.sleep == "2026-08-05"
    assert norm["hrvOvernightAvg"] == 62
    assert dates.hrv == "2026-08-06"


def test_deterministic_yesterday_activity_selection():
    derived = DerivedMetrics()
    activities = [
        # Morning light mobility session
        {
            "activityId": 101,
            "startTimeLocal": "2026-08-05T08:00:00",
            "activityType": {"typeKey": "other"},
            "duration": 1800,
            "aerobicTrainingEffect": 1.0,
            "activityTrainingLoad": 10.0,
        },
        # Evening hard running session
        {
            "activityId": 102,
            "startTimeLocal": "2026-08-05T18:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 2400,
            "aerobicTrainingEffect": 3.8,
            "activityTrainingLoad": 120.0,
        },
    ]

    snapshot = map_garmin_payload_to_snapshot(
        user_id="test_uid",
        target_date_iso="2026-08-06",
        stats_today={},
        stats_fallback=None,
        sleep_today={},
        sleep_fallback=None,
        hrv_today={},
        activities_window=activities,
        derived_metrics=derived,
    )

    y = snapshot.raw.yesterdayTraining
    assert y is not None
    assert y.activityCount == 2
    assert y.totalDurationMin == 70  # (1800 + 2400) / 60
    assert y.hardActivityCount == 1
    assert y.primaryActivity is not None
    assert y.primaryActivity.activityId == 102
    assert y.primaryActivity.type == "running"
    assert y.primaryActivity.intensityTag == "hard"
