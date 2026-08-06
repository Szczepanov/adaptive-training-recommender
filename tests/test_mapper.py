import json
from pathlib import Path
from garmin_sync.mapper import map_garmin_payload_to_snapshot
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
    assert snapshot.raw.yesterdayTraining.intensityTag == "hard"
    assert snapshot.source.timezone == "Europe/Warsaw"
    assert snapshot.source.metricDates.sleep == "2026-08-06"
    assert snapshot.source.metricDates.steps == "2026-08-05"  # D-1 steps semantics
