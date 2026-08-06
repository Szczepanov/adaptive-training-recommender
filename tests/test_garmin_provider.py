import json
from pathlib import Path
from garmin_sync.garmin_provider import canonicalize_activities, canonicalize_from_raw, extract_sleep_metrics

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_canonicalize_from_raw_using_fixtures():
    with open(FIXTURES_DIR / "stats.json") as f:
        stats = json.load(f)
    with open(FIXTURES_DIR / "sleep.json") as f:
        sleep = json.load(f)
    with open(FIXTURES_DIR / "hrv.json") as f:
        hrv = json.load(f)

    stats_fallback = {"totalSteps": 8420, "restingHeartRate": 51}

    canonical = canonicalize_from_raw(
        stats_today=stats,
        stats_fallback=stats_fallback,
        sleep_today=sleep,
        sleep_fallback=None,
        hrv_today=hrv,
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
    )

    assert canonical.sleep_score == 82
    assert canonical.resting_heart_rate_bpm == 52
    assert canonical.hrv_overnight_avg_ms == 68
    assert canonical.sleep_date == "2026-08-06"
    assert canonical.steps_date == "2026-08-05"  # D-1 steps semantics


def test_canonicalize_from_raw_fallback_consistency():
    """RHR/sleep fallback must land consistently on the canonical object, mirroring the
    fallback behavior formerly verified against normalize_current_metrics."""
    stats_today = {}  # missing RHR
    stats_fallback = {"restingHeartRate": 50, "totalSteps": 12000}
    sleep_today = {}  # missing sleep
    sleep_fallback = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 78}}, "sleepTimeSeconds": 28800}}
    hrv_today = {"hrvSummary": {"lastNightAvg": 62, "status": "BALANCED"}}

    canonical = canonicalize_from_raw(
        stats_today=stats_today,
        stats_fallback=stats_fallback,
        sleep_today=sleep_today,
        sleep_fallback=sleep_fallback,
        hrv_today=hrv_today,
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
    )

    assert canonical.resting_heart_rate_bpm == 50
    assert canonical.resting_heart_rate_date == "2026-08-05"
    assert canonical.sleep_score == 78
    assert canonical.sleep_date == "2026-08-05"
    assert canonical.hrv_overnight_avg_ms == 62
    assert canonical.hrv_date == "2026-08-06"


def test_extract_sleep_metrics_handles_nested_and_fallback_shapes():
    nested = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 90}}, "sleepTimeSeconds": 25000}}
    assert extract_sleep_metrics(nested) == (90, 25000, None)
    assert extract_sleep_metrics({}) == (None, None, None)
    assert extract_sleep_metrics(None) == (None, None, None)


def test_canonicalize_activities_maps_fields_and_intensity():
    raw = [{
        "activityId": 999,
        "startTimeLocal": "2026-08-05T18:00:00",
        "activityType": {"typeKey": "running"},
        "duration": 2400,
        "aerobicTrainingEffect": 3.8,
        "anaerobicTrainingEffect": 1.2,
        "averageHeartRate": 150,
        "activityTrainingLoad": 120.0,
    }]

    canonical = canonicalize_activities(raw)

    assert len(canonical) == 1
    act = canonical[0]
    assert act.activity_id == "999"
    assert act.date == "2026-08-05"
    assert act.type == "running"
    assert act.duration_min == 40
    assert act.duration_seconds == 2400
    assert act.training_effect_aerobic == 3.8
    assert act.training_effect_anaerobic == 1.2
    assert act.average_hr == 150
    assert act.training_load == 120.0
    assert act.intensity_tag == "hard"
