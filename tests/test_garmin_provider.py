import json
from pathlib import Path
from unittest.mock import MagicMock

from garmin_sync.garmin_provider import (
    GarminProviderAdapter,
    canonicalize_activities,
    canonicalize_activity_detail,
    canonicalize_from_raw,
    extract_sleep_metrics,
    qualifies_for_activity_detail,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_canonicalize_activity_detail_from_reduced_contract_fixtures():
    power_zones = json.loads((FIXTURES_DIR / "activity_power_zones.json").read_text())
    hr_zones = json.loads((FIXTURES_DIR / "activity_hr_zones.json").read_text())
    splits = json.loads((FIXTURES_DIR / "activity_splits.json").read_text())

    detail = canonicalize_activity_detail(
        "1002",
        {"normPower": 229.0, "avgPower": 214.0, "intensityFactor": 0.82},
        power_zones,
        hr_zones,
        splits,
    )

    assert len(detail.power_zones or []) == 7
    assert detail.power_zones and detail.power_zones[1].seconds_in_zone == 1318.6
    assert len(detail.hr_zones or []) == 5
    assert detail.normalized_power_watts == 229.0
    assert detail.intensity_factor == 0.82
    assert detail.variability_index == 229.0 / 214.0
    assert detail.laps and detail.laps[2].average_power_watts == 258.0


def test_canonicalize_activity_detail_degrades_on_malformed_payload():
    detail = canonicalize_activity_detail(
        "1002",
        {"normPower": "229", "avgPower": 0, "intensityFactor": object()},
        {"not": "a-list"},
        [
            {"zoneNumber": "1", "secsInZone": 10},
            {"zoneNumber": 2, "secsInZone": 20, "zoneLowBoundary": "bad"},
        ],
        {"lapDTOs": [{"lapIndex": 1, "duration": 60, "averagePower": "bad"}, "bad"]},
    )

    assert detail.power_zones is None
    assert detail.hr_zones is not None and len(detail.hr_zones) == 1
    assert detail.hr_zones[0].low_boundary is None
    assert detail.normalized_power_watts is None
    assert detail.intensity_factor is None
    assert detail.variability_index is None
    assert detail.laps and detail.laps[0].average_power_watts is None


def test_variability_index_omitted_when_average_power_zero():
    detail = canonicalize_activity_detail("1002", {"normPower": 229, "avgPower": 0}, [], [], {})
    assert detail.variability_index is None


def test_detail_gate_skips_easy_and_non_power_activities():
    from garmin_sync.canonical import CanonicalActivity

    def activity(activity_type: str, intensity: str, activity_id: str | None = "1"):
        return CanonicalActivity(
            activity_id=activity_id,
            date="2026-08-17",
            type=activity_type,
            duration_min=60,
            duration_seconds=3600,
            training_effect_aerobic=3.0,
            training_effect_anaerobic=0.0,
            average_hr=140,
            training_load=100,
            intensity_tag=intensity,
        )

    assert qualifies_for_activity_detail(activity("cycling", "moderate"))
    assert not qualifies_for_activity_detail(activity("cycling", "easy"))
    assert not qualifies_for_activity_detail(activity("running", "hard"))
    assert not qualifies_for_activity_detail(activity("cycling", "hard", None))


def test_adapter_fetch_activity_detail_uses_cached_list_summary_and_all_three_endpoints():
    mock_client = MagicMock()
    mock_client.get_activities_window.return_value = [
        {
            "activityId": 1002,
            "startTimeLocal": "2026-08-17T08:00:00",
            "duration": 3600,
            "activityType": {"typeKey": "cycling"},
            "normPower": 229,
            "avgPower": 214,
            "intensityFactor": 0.82,
        }
    ]
    mock_client.get_activity_power_zones.return_value = [
        {"zoneNumber": 2, "secsInZone": 1200, "zoneLowBoundary": 150}
    ]
    mock_client.get_activity_hr_zones.return_value = [
        {"zoneNumber": 3, "secsInZone": 900, "zoneLowBoundary": 137}
    ]
    mock_client.get_activity_splits.return_value = {
        "lapDTOs": [{"lapIndex": 1, "duration": 900, "averagePower": 250}]
    }
    adapter = GarminProviderAdapter(mock_client)

    adapter.fetch_activities("2026-08-17", "2026-08-17")
    result = adapter.fetch_activity_detail("1002")

    assert result.canonical.normalized_power_watts == 229
    assert result.canonical.intensity_factor == 0.82
    assert result.canonical.variability_index == 229 / 214
    assert result.canonical.power_zones and result.canonical.power_zones[0].zone_number == 2
    assert result.canonical.laps and result.canonical.laps[0].average_power_watts == 250
    assert set(result.raw_payloads) == {
        "activity_power_zones",
        "activity_hr_zones",
        "activity_splits",
    }


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
    sleep_fallback = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 78}}, "sleepTimeSeconds": 28800}
    }
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
    nested = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 90}}, "sleepTimeSeconds": 25000}
    }
    assert extract_sleep_metrics(nested) == (90, 25000, None)
    assert extract_sleep_metrics({}) == (None, None, None)
    assert extract_sleep_metrics(None) == (None, None, None)


# --- Respiration precision (finer than dailySleepDTO.averageRespirationValue) ----


def _respiration_array(
    count: int, start_ms: int = 0, step_ms: int = 120_000
) -> list[list[int | float]]:
    """`count` alternating 12.0/13.0 readings 2 minutes apart -- mean is exactly 12.5."""
    return [[start_ms + i * step_ms, 12.0 if i % 2 == 0 else 13.0] for i in range(count)]


def test_average_sleep_respiration_from_intervals_averages_in_window_readings():
    from garmin_sync.garmin_provider import average_sleep_respiration_from_intervals

    samples = _respiration_array(40)  # ts 0 .. 4,680,000
    # Out-of-window reading (before sleep even started) and an in-window "no reading"
    # sentinel (<=0) -- both must be excluded from the average.
    samples = [[-120_000, 20.0]] + samples + [[100_000, 0]]

    result = average_sleep_respiration_from_intervals(
        {"respirationValuesArray": samples}, sleep_start_gmt_ms=0, sleep_end_gmt_ms=5_000_000
    )

    assert result == 12.5


def test_average_sleep_respiration_from_intervals_requires_min_sample_coverage():
    from garmin_sync.garmin_provider import average_sleep_respiration_from_intervals

    samples = _respiration_array(10)  # below the 30-sample minimum
    result = average_sleep_respiration_from_intervals(
        {"respirationValuesArray": samples}, sleep_start_gmt_ms=0, sleep_end_gmt_ms=5_000_000
    )
    assert result is None


def test_average_sleep_respiration_from_intervals_degrades_on_missing_or_malformed_input():
    from garmin_sync.garmin_provider import average_sleep_respiration_from_intervals

    assert average_sleep_respiration_from_intervals(None, 0, 5_000_000) is None
    assert average_sleep_respiration_from_intervals({}, 0, 5_000_000) is None
    # A truthy non-dict payload (e.g. an archived record or enrichment fetch result
    # with an unexpected shape) must degrade to None, never raise AttributeError from
    # a bare `.get(...)` call.
    assert average_sleep_respiration_from_intervals([1, 2, 3], 0, 5_000_000) is None
    assert average_sleep_respiration_from_intervals("not a dict", 0, 5_000_000) is None
    assert (
        average_sleep_respiration_from_intervals({"respirationValuesArray": "bad"}, 0, 5_000_000)
        is None
    )
    assert (
        average_sleep_respiration_from_intervals(
            {"respirationValuesArray": _respiration_array(40)}, None, 5_000_000
        )
        is None
    )
    assert (
        average_sleep_respiration_from_intervals(
            {"respirationValuesArray": _respiration_array(40)}, 0, None
        )
        is None
    )


def test_average_sleep_respiration_from_intervals_requires_full_night_coverage():
    """40 valid samples clear the sample-count floor but are clustered in the first
    hour of an 8-hour sleep window -- they must not be mistaken for a full-night
    average (e.g. after a sync gap or the device coming back online late)."""
    from garmin_sync.garmin_provider import average_sleep_respiration_from_intervals

    samples = _respiration_array(40)  # ts 0 .. 4,680,000 (~78 minutes)
    result = average_sleep_respiration_from_intervals(
        {"respirationValuesArray": samples},
        sleep_start_gmt_ms=0,
        sleep_end_gmt_ms=8 * 60 * 60 * 1000,  # 8-hour window
    )
    assert result is None


def test_canonicalize_from_raw_prefers_precise_respiration_average_when_available():
    sleep_today = {
        "dailySleepDTO": {
            "sleepScores": {"overall": {"value": 82}},
            "sleepTimeSeconds": 27000,
            "averageRespirationValue": 12,  # Garmin's coarser summary value
            "sleepStartTimestampGMT": 0,
            "sleepEndTimestampGMT": 5_000_000,
        }
    }
    respiration_today = {"respirationValuesArray": _respiration_array(40)}

    canonical = canonicalize_from_raw(
        stats_today={},
        stats_fallback=None,
        sleep_today=sleep_today,
        sleep_fallback=None,
        hrv_today={},
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
        respiration_today=respiration_today,
    )

    assert canonical.respiration_rate_brpm == 12.5  # precise, not the coarse 12


def test_canonicalize_from_raw_falls_back_to_sleep_dto_respiration_without_interval_data():
    sleep_today = {
        "dailySleepDTO": {
            "sleepScores": {"overall": {"value": 82}},
            "sleepTimeSeconds": 27000,
            "averageRespirationValue": 12,
        }
    }

    canonical = canonicalize_from_raw(
        stats_today={},
        stats_fallback=None,
        sleep_today=sleep_today,
        sleep_fallback=None,
        hrv_today={},
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
    )

    assert canonical.respiration_rate_brpm == 12


def test_canonicalize_from_raw_skips_precise_respiration_on_sleep_fallback_day():
    """respiration_today is fetched for target_date_iso only -- it has no relationship
    to sleep_fallback's (D-1) window, so the precise path must not apply to it."""
    sleep_fallback = {
        "dailySleepDTO": {
            "sleepScores": {"overall": {"value": 78}},
            "sleepTimeSeconds": 28800,
            "averageRespirationValue": 13,
            "sleepStartTimestampGMT": 0,
            "sleepEndTimestampGMT": 5_000_000,
        }
    }
    respiration_today = {"respirationValuesArray": _respiration_array(40)}

    canonical = canonicalize_from_raw(
        stats_today={},
        stats_fallback=None,
        sleep_today={},
        sleep_fallback=sleep_fallback,
        hrv_today={},
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
        respiration_today=respiration_today,
    )

    assert canonical.respiration_rate_brpm == 13


def test_canonicalize_activities_maps_fields_and_intensity():
    raw = [
        {
            "activityId": 999,
            "startTimeLocal": "2026-08-05T18:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 2400,
            "aerobicTrainingEffect": 3.8,
            "anaerobicTrainingEffect": 1.2,
            "averageHeartRate": 150,
            "activityTrainingLoad": 120.0,
        }
    ]

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
    raw = [
        {
            "activityId": 1000,
            "startTimeLocal": "2026-08-05T18:00:00",
            "activityType": {"typeKey": "strength_training"},
            "duration": 1800,
            "aerobicTrainingEffect": 2.0,
            "anaerobicTrainingEffect": 3.5,
            "averageHeartRate": 140,
            "activityTrainingLoad": 80.0,
        }
    ]

    act = canonicalize_activities(raw)[0]

    assert act.intensity_tag == "hard"


def test_canonicalize_activities_uses_zone4_floor():
    raw = [
        {
            "activityId": 1001,
            "startTimeLocal": "2026-08-05T18:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 1800,
            "aerobicTrainingEffect": 2.0,
            "anaerobicTrainingEffect": 1.0,
            "averageHeartRate": 148,
            "activityTrainingLoad": 60.0,
        }
    ]

    # Without zone4_floor (defaults to 145), avg_hr=148 is classified as hard
    act_default = canonicalize_activities(raw)[0]
    assert act_default.intensity_tag == "hard"

    # With zone4_floor=152, avg_hr=148 is below zone4_floor, so classified as moderate (TE 2.0)
    act_custom = canonicalize_activities(raw, zone4_floor=152)[0]
    assert act_custom.intensity_tag == "moderate"


def test_canonicalize_activities_extracts_average_hr_from_average_hr_key():
    raw = [
        {
            "activityId": 1001,
            "startTimeLocal": "2026-08-05T18:00:00",
            "activityType": {"typeKey": "cycling"},
            "duration": 1800,
            "aerobicTrainingEffect": 1.5,
            "averageHR": 125,
            "activityTrainingLoad": 15.0,
        }
    ]
    act = canonicalize_activities(raw)[0]
    assert act.average_hr == 125.0
    assert act.intensity_tag == "easy"


def test_canonicalize_activities_extracts_running_dynamics():
    raw = [
        {
            "activityId": 1002,
            "startTimeLocal": "2026-08-05T07:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 2400,
            "aerobicTrainingEffect": 3.2,
            "averageHR": 150,
            "avgGroundContactTime": 240.0,
            "avgGroundContactBalance": 49.5,
            "avgVerticalOscillation": 84.0,  # mm -> 8.4 cm
            "avgVerticalRatio": 7.5,
            "avgStrideLength": 115.0,  # cm -> 1.15 m
            "avgPower": 290,
            "maxPower": 410,
        }
    ]
    act = canonicalize_activities(raw)[0]
    assert act.running_dynamics is not None
    assert act.running_dynamics.ground_contact_time_ms == 240.0
    assert act.running_dynamics.ground_contact_balance_left_pct == 49.5
    assert act.running_dynamics.vertical_oscillation_cm == 8.4
    assert act.running_dynamics.vertical_ratio_pct == 7.5
    assert act.running_dynamics.stride_length_m == 1.15
    assert act.running_dynamics.avg_running_power_watts == 290
    assert act.running_dynamics.max_running_power_watts == 410


def test_canonicalize_activities_handles_missing_activity_id():
    """A Garmin activity payload without an activityId (e.g. an in-progress/pending
    upload) must canonicalize to activity_id=None rather than a shared placeholder
    string, so callers can skip archiving it instead of colliding with another such
    activity."""
    raw = [
        {
            "startTimeLocal": "2026-08-05T18:00:00",
            "activityType": {"typeKey": "running"},
            "duration": 1200,
            "aerobicTrainingEffect": 1.0,
        }
    ]

    act = canonicalize_activities(raw)[0]

    assert act.activity_id is None


def test_provider_adapter_reuses_cached_stats_and_sleep_across_overlapping_dates():
    """Regression test: a backfill's chronological date loop reuses the same
    GarminProviderAdapter instance across dates whose fetch_daily_metrics windows
    overlap by one day (date D is fetched as "today", then again as "yesterday" for
    D+1). The adapter must not re-fetch a date it already has cached."""
    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 50, "totalSteps": 9000}
    # Empty (falsy) so fetch_daily_metrics takes the sleep_fallback branch and actually
    # calls _get_sleep_data(yesterday_iso) too -- a truthy sleep_today would short-circuit
    # that call and this test would never exercise sleep-cache reuse.
    mock_client.get_sleep_data.return_value = {}
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 60}}

    adapter = GarminProviderAdapter(mock_client)

    adapter.fetch_daily_metrics("2026-08-06", "2026-08-05")
    adapter.fetch_daily_metrics("2026-08-07", "2026-08-06")

    # get_stats is unconditionally fetched for both the target date and its D-1 fallback
    # on every call. 3 unique dates are touched (08-05, 08-06, 08-07) across the two
    # overlapping calls -- without caching this would be 4 calls (2 per call), since
    # 08-06 is fetched once as "today" and again as the next call's "yesterday".
    assert mock_client.get_stats.call_count == 3
    assert {c.args[0] for c in mock_client.get_stats.call_args_list} == {
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
    }

    # Same reasoning applies to sleep: get_sleep_data(target) always fires, and (since
    # sleep_today is empty here) get_sleep_data(yesterday_iso) fires for the fallback too
    # -- caching must dedup that fallback call the same way it dedups get_stats.
    assert mock_client.get_sleep_data.call_count == 3
    assert {c.args[0] for c in mock_client.get_sleep_data.call_args_list} == {
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
    }


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


def test_canonicalize_from_raw_uses_precise_respiration_fixture_over_sleep_dto_average():
    """Real-shape respiration.json (dedicated endpoint) round-trips into a finer-grained
    respiration_rate_brpm than sleep.json's own averageRespirationValue (14.5)."""
    with open(FIXTURES_DIR / "stats.json") as f:
        stats = json.load(f)
    with open(FIXTURES_DIR / "sleep.json") as f:
        sleep = json.load(f)
    with open(FIXTURES_DIR / "hrv.json") as f:
        hrv = json.load(f)
    with open(FIXTURES_DIR / "respiration.json") as f:
        respiration = json.load(f)

    canonical = canonicalize_from_raw(
        stats_today=stats,
        stats_fallback=None,
        sleep_today=sleep,
        sleep_fallback=None,
        hrv_today=hrv,
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
        respiration_today=respiration,
    )

    assert canonical.respiration_rate_brpm == 12.2  # not sleep.json's coarser 14.5


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


# --- Heart rate zones -----------------------------------------------------------


def test_canonicalize_from_raw_populates_heart_rate_zones_from_default_sport():
    with open(FIXTURES_DIR / "stats.json") as f:
        stats = json.load(f)
    with open(FIXTURES_DIR / "sleep.json") as f:
        sleep = json.load(f)
    with open(FIXTURES_DIR / "hrv.json") as f:
        hrv = json.load(f)
    with open(FIXTURES_DIR / "heart_rate_zones.json") as f:
        zones = json.load(f)

    canonical = canonicalize_from_raw(
        stats_today=stats,
        stats_fallback=None,
        sleep_today=sleep,
        sleep_fallback=None,
        hrv_today=hrv,
        target_date_iso="2026-08-06",
        yesterday_iso="2026-08-05",
        heart_rate_zones=zones,
    )

    assert canonical.heart_rate_zones is not None
    # Fixture's DEFAULT entry, not the RUNNING entry that follows it -- proves the
    # sport-picking logic isn't just "take the first item".
    assert canonical.heart_rate_zones.resting_hr_used == 52
    assert canonical.heart_rate_zones.max_hr_used == 188
    assert canonical.heart_rate_zones.zone4_floor == 152
    assert canonical.heart_rate_zones.sport == "DEFAULT"


def test_canonicalize_heart_rate_zones_falls_back_to_first_entry_without_default():
    from garmin_sync.garmin_provider import _canonicalize_heart_rate_zones

    result = _canonicalize_heart_rate_zones(
        [
            {
                "sport": "RUNNING",
                "restingHeartRateUsed": 50,
                "maxHeartRateUsed": 190,
                "zone4Floor": 150,
            },
        ]
    )
    assert result is not None
    assert result.sport == "RUNNING"
    assert result.max_hr_used == 190


def test_canonicalize_heart_rate_zones_handles_missing_or_malformed_input_gracefully():
    from garmin_sync.garmin_provider import _canonicalize_heart_rate_zones

    assert _canonicalize_heart_rate_zones(None) is None
    assert _canonicalize_heart_rate_zones([]) is None
    # A non-list (e.g. an unconfigured Mock return value in a test double, or a
    # malformed API response) must degrade to None, never raise.
    assert _canonicalize_heart_rate_zones("not a list") is None  # type: ignore[arg-type]
    assert (
        _canonicalize_heart_rate_zones([{"unexpected": "shape"}]) is not None
    )  # degrades to all-None fields, not an error
    degraded = _canonicalize_heart_rate_zones([{"unexpected": "shape"}])
    assert degraded.max_hr_used is None


def test_canonicalize_from_raw_heart_rate_zones_absent_when_not_provided():
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
    assert canonical.heart_rate_zones is None


def test_fetch_daily_metrics_survives_unconfigured_heart_rate_zones_mock():
    """A bare MagicMock() (as used by other provider tests that don't care about
    enrichment) returns a MagicMock -- not a list -- from an unconfigured
    get_heart_rate_zones(). fetch_daily_metrics must not raise TypeError trying to
    iterate it; it should degrade to heart_rate_zones=None like any other malformed
    payload."""
    mock_client = MagicMock()
    mock_client.get_stats.return_value = {"restingHeartRate": 50, "totalSteps": 9000}
    mock_client.get_sleep_data.return_value = {
        "dailySleepDTO": {"sleepScores": {"overall": {"value": 80}}}
    }
    mock_client.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 60}}

    adapter = GarminProviderAdapter(mock_client)
    result = adapter.fetch_daily_metrics("2026-08-06", "2026-08-05")

    # The unconfigured mock's return value isn't a real API failure, so _fetch_enrichment
    # doesn't catch anything and the (bogus) value still lands in raw_payloads for
    # archiving -- same as it would for any other enrichment endpoint given a malformed
    # response. What matters is that canonicalization degrades safely rather than
    # raising when handed that non-list value.
    assert result.canonical.heart_rate_zones is None


# --- Current performance targets -------------------------------------------------


def test_canonicalize_performance_targets_maps_ftp_running_pace_and_lthr():
    from garmin_sync.garmin_provider import canonicalize_performance_targets

    with open(FIXTURES_DIR / "cycling_ftp.json") as f:
        ftp = json.load(f)
    with open(FIXTURES_DIR / "lactate_threshold.json") as f:
        threshold = json.load(f)

    targets = canonicalize_performance_targets(ftp, threshold, None)

    assert targets.cycling_ftp_watts == 254
    assert targets.running_threshold_pace_sec_per_km == 316  # 0.3166667 sec/m -> 5:16/km
    assert targets.running_lthr_bpm == 169
    assert targets.ftp_measured_at == "2026-08-01"
    assert targets.threshold_measured_at == "2026-08-02"


def test_canonicalize_performance_targets_falls_back_to_running_then_default_zone_lthr():
    from garmin_sync.garmin_provider import canonicalize_performance_targets

    targets = canonicalize_performance_targets(
        None,
        {"speed_and_heart_rate": {"speed": 0.25}},
        [
            {"sport": "DEFAULT", "lactateThresholdHeartRateUsed": 160},
            {"sport": "RUNNING", "lactateThresholdHeartRateUsed": 166},
        ],
    )

    assert targets.running_threshold_pace_sec_per_km == 250
    assert targets.running_lthr_bpm == 166


def test_canonicalize_performance_targets_rejects_invalid_values():
    from garmin_sync.garmin_provider import canonicalize_performance_targets

    targets = canonicalize_performance_targets(
        {"functionalThresholdPower": 0},
        {"speed_and_heart_rate": {"speed": 0, "heartRate": -1}},
        None,
    )

    assert targets.cycling_ftp_watts is None
    assert targets.running_threshold_pace_sec_per_km is None
    assert targets.running_lthr_bpm is None


def test_fetch_performance_targets_uses_cached_hr_zones_and_archivable_raw_payloads():
    mock_client = MagicMock()
    mock_client.get_heart_rate_zones.return_value = [
        {"sport": "RUNNING", "lactateThresholdHeartRateUsed": 165}
    ]
    mock_client.get_cycling_ftp.return_value = {"functionalThresholdPower": 250}
    mock_client.get_lactate_threshold.return_value = {"speed_and_heart_rate": {"speed": 0.25}}
    adapter = GarminProviderAdapter(mock_client)
    adapter._heart_rate_zones_cache = mock_client.get_heart_rate_zones()

    result = adapter.fetch_performance_targets()

    assert result.canonical.cycling_ftp_watts == 250
    assert result.canonical.running_lthr_bpm == 165
    assert result.raw_payloads["cycling_ftp"] == {"functionalThresholdPower": 250}
    mock_client.get_heart_rate_zones.assert_called_once()
