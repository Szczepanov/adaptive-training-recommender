from garmin_sync.canonical import CanonicalDailyMetrics
from garmin_sync.garmin_provider import canonicalize_activities, canonicalize_from_raw
from garmin_sync.metrics import (
    calculate_average,
    calculate_delta,
    calculate_mad,
    calculate_median,
    classify_activity_intensity,
)


def test_failure_mode_missing_keys_in_raw_payload():
    corrupt_payload = {"unexpectedKey": 123}
    canonical = canonicalize_from_raw(
        stats_today=corrupt_payload,
        stats_fallback=None,
        sleep_today=corrupt_payload,
        sleep_fallback=None,
        hrv_today=corrupt_payload,
        target_date_iso="2026-08-26",
        yesterday_iso="2026-08-25",
    )
    assert isinstance(canonical, CanonicalDailyMetrics)
    assert canonical.resting_heart_rate_bpm is None
    assert canonical.sleep_duration_seconds is None
    assert canonical.hrv_overnight_avg_ms is None


def test_failure_mode_empty_or_sparse_activities_list():
    empty_res = canonicalize_activities([])
    assert empty_res == []

    malformed_activity = [{"activityId": 999, "activityType": {}}]
    res = canonicalize_activities(malformed_activity)
    assert len(res) == 1
    assert res[0].activity_id == "999"


def test_failure_mode_zero_and_negative_training_effect():
    is_hard, tag = classify_activity_intensity(training_effect=0.0, average_hr=None)
    assert is_hard is False
    assert tag == "easy"

    is_hard_neg, tag_neg = classify_activity_intensity(training_effect=-1.0, average_hr=120)
    assert is_hard_neg is False


def test_failure_mode_baseline_insufficient_samples():
    values = [45, 48]
    assert calculate_average(values, min_required=7) is None
    assert calculate_median(values, min_required=7) is None
    assert calculate_mad(values, min_required=14) is None


def test_failure_mode_activity_intensity_hr_fallback_boundary():
    is_hard, tag = classify_activity_intensity(training_effect=2.5, average_hr=165)
    assert is_hard is True
    assert tag == "hard"


def test_failure_mode_delta_with_none_inputs():
    assert calculate_delta(None, 50.0) is None
    assert calculate_delta(50.0, None) is None
    assert calculate_delta(None, None) is None
    assert calculate_delta(55.0, 50.0) == 5.0
