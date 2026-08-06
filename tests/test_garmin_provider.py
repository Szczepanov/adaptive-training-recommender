import json
from pathlib import Path
from unittest.mock import MagicMock
from garmin_sync.garmin_provider import (
    GarminProviderAdapter,
    canonicalize_activities,
    canonicalize_from_raw,
    extract_sleep_metrics,
)

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


def test_canonicalize_activities_uses_anaerobic_training_effect_for_hard_classification():
    """A strength/interval session can be a hard stimulus through anaerobic load alone
    even when its aerobic training effect stays below the threshold on its own -- the
    discriminating case for using max(aerobic, anaerobic) rather than aerobic-only."""
    raw = [{
        "activityId": 1000,
        "startTimeLocal": "2026-08-05T18:00:00",
        "activityType": {"typeKey": "strength_training"},
        "duration": 1800,
        "aerobicTrainingEffect": 2.0,
        "anaerobicTrainingEffect": 3.5,
        "averageHeartRate": 140,
        "activityTrainingLoad": 80.0,
    }]

    act = canonicalize_activities(raw)[0]

    assert act.intensity_tag == "hard"


def test_canonicalize_activities_handles_missing_activity_id():
    """A Garmin activity payload without an activityId (e.g. an in-progress/pending
    upload) must canonicalize to activity_id=None rather than a shared placeholder
    string, so callers can skip archiving it instead of colliding with another such
    activity."""
    raw = [{
        "startTimeLocal": "2026-08-05T18:00:00",
        "activityType": {"typeKey": "running"},
        "duration": 1200,
        "aerobicTrainingEffect": 1.0,
    }]

    act = canonicalize_activities(raw)[0]

    assert act.activity_id is None


def test_provider_adapter_reuses_cached_stats_and_sleep_across_overlapping_dates():
    """Regression test: a backfill's chronological date loop reuses the same
    GarminProviderAdapter instance across dates whose fetch_daily_metrics windows
    overlap by one day (date D is fetched as "today", then again as "yesterday" for
    D+1). The adapter must not re-fetch a date it already has cached."""
    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 50, "totalSteps": 9000}
    mock_client.get_sleep_data.return_value = {"dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 60}}

    adapter = GarminProviderAdapter(mock_client)

    adapter.fetch_daily_metrics("2026-08-06", "2026-08-05")
    adapter.fetch_daily_metrics("2026-08-07", "2026-08-06")

    # get_stats is unconditionally fetched for both the target date and its D-1 fallback
    # on every call. 3 unique dates are touched (08-05, 08-06, 08-07) across the two
    # overlapping calls -- without caching this would be 4 calls (2 per call), since
    # 08-06 is fetched once as "today" and again as the next call's "yesterday".
    assert mock_client.get_stats.call_count == 3
    assert {c.args[0] for c in mock_client.get_stats.call_args_list} == {"2026-08-05", "2026-08-06", "2026-08-07"}


# --- Metric enrichment (item 4) ---------------------------------------------------

def test_canonicalize_from_raw_populates_stress_body_battery_readiness_status():
    """Real-shape fixtures (captured from a live account) round-trip into the 4 new
    canonical enrichment fields."""
    with open(FIXTURES_DIR / "stats.json") as f:
        stats = json.load(f)
    with open(FIXTURES_DIR / "sleep.json") as f:
        sleep = json.load(f)
    with open(FIXTURES_DIR / "hrv.json") as f:
        hrv = json.load(f)
    with open(FIXTURES_DIR / "stress.json") as f:
        stress = json.load(f)
    with open(FIXTURES_DIR / "body_battery.json") as f:
        body_battery = json.load(f)
    with open(FIXTURES_DIR / "training_readiness.json") as f:
        training_readiness = json.load(f)
    with open(FIXTURES_DIR / "training_status.json") as f:
        training_status = json.load(f)

    canonical = canonicalize_from_raw(
        stats_today=stats,
        stats_fallback=None,
        sleep_today=sleep,
        sleep_fallback=None,
        hrv_today=hrv,
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
        stress_today=stress,
        body_battery_today=body_battery,
        training_readiness_today=training_readiness,
        training_status_today=training_status,
    )

    assert canonical.stress is not None
    assert canonical.stress.avg == 43
    assert canonical.stress.max == 100

    assert canonical.body_battery is not None
    assert canonical.body_battery.charged == 75
    assert canonical.body_battery.drained == 84
    assert canonical.body_battery.change == -9  # net drain that day

    assert canonical.training_readiness is not None
    assert canonical.training_readiness.score == 59  # readings[0], newest-first
    assert canonical.training_readiness.level == "MODERATE"
    assert canonical.training_readiness.feedback == "MOD_HRV_LOW"

    assert canonical.training_status is not None
    assert canonical.training_status.status_phrase == "STRAINED_1"
    assert canonical.training_status.acute_training_load == 137
    assert canonical.training_status.acwr_status == "LOW"
    assert canonical.training_status.vo2max_running == 48.0
    assert canonical.training_status.vo2max_running_date == "2026-07-17"  # stale, not today
    assert canonical.training_status.vo2max_cycling == 48.0
    assert canonical.training_status.vo2max_cycling_date == "2026-07-24"


def test_canonicalize_from_raw_enrichment_fields_absent_when_not_provided():
    """Existing callers that don't pass the 4 new optional params (e.g. tests written
    before item 4) must keep working -- new fields default to None, not an error."""
    with open(FIXTURES_DIR / "stats.json") as f:
        stats = json.load(f)

    canonical = canonicalize_from_raw(
        stats_today=stats,
        stats_fallback=None,
        sleep_today={},
        sleep_fallback=None,
        hrv_today={},
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
    )

    assert canonical.stress is None
    assert canonical.body_battery is None
    assert canonical.training_readiness is None
    assert canonical.training_status is None


def test_canonicalize_training_status_handles_missing_device_data_gracefully():
    """A malformed/empty training_status payload (e.g. no devices recorded yet) must
    degrade to a CanonicalTrainingStatus of all-None fields, never a KeyError."""
    from garmin_sync.garmin_provider import _canonicalize_training_status

    result = _canonicalize_training_status({"mostRecentTrainingStatus": {}, "mostRecentVO2Max": {}})
    assert result.status_phrase is None
    assert result.vo2max_running is None
    assert result.acute_training_load is None

    assert _canonicalize_training_status({}) is None
    assert _canonicalize_training_status(None) is None
