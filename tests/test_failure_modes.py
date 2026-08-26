from garmin_sync.canonical import CanonicalDailyMetrics
from garmin_sync.garmin_provider import canonicalize_activities, canonicalize_from_raw
from garmin_sync.metrics import (
    calculate_average,
    calculate_delta,
    calculate_mad,
    calculate_median,
    classify_activity_intensity,
)


def test_failure_mode_missing_keys_in_raw_payload() -> None:
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


def test_failure_mode_empty_or_sparse_activities_list() -> None:
    empty_res = canonicalize_activities([])
    assert empty_res == []

    malformed_activity = [{"activityId": 999, "activityType": {}}]
    res = canonicalize_activities(malformed_activity)
    assert len(res) == 1
    assert res[0].activity_id == "999"


def test_failure_mode_zero_and_negative_training_effect() -> None:
    is_hard, tag = classify_activity_intensity(training_effect=0.0, average_hr=None)
    assert is_hard is False
    assert tag == "easy"

    is_hard_neg, tag_neg = classify_activity_intensity(training_effect=-1.0, average_hr=120)
    assert is_hard_neg is False

    # Boundary cases: training_effect just below 2.0 (easy)
    is_hard_below_2, tag_below_2 = classify_activity_intensity(training_effect=1.9, average_hr=None)
    assert is_hard_below_2 is False
    assert tag_below_2 == "easy"

    # Boundary cases: training_effect exactly 2.0 (moderate, not easy)
    is_hard_2, tag_2 = classify_activity_intensity(training_effect=2.0, average_hr=None)
    assert is_hard_2 is False
    assert tag_2 == "moderate"

    # Boundary cases: training_effect just below 3.0 (moderate)
    is_hard_below_3, tag_below_3 = classify_activity_intensity(training_effect=2.9, average_hr=None)
    assert is_hard_below_3 is False
    assert tag_below_3 == "moderate"

    # Boundary cases: training_effect exactly 3.0 (hard, inclusive)
    is_hard_3, tag_3 = classify_activity_intensity(training_effect=3.0, average_hr=None)
    assert is_hard_3 is True
    assert tag_3 == "hard"

    # Boundary cases: average_hr just below 145 (not hard based on HR)
    is_hard_hr_below, tag_hr_below = classify_activity_intensity(
        training_effect=2.5, average_hr=144
    )
    assert is_hard_hr_below is False
    assert tag_hr_below == "moderate"

    # Boundary cases: average_hr exactly 145 (hard, inclusive)
    is_hard_hr_145, tag_hr_145 = classify_activity_intensity(training_effect=2.5, average_hr=145)
    assert is_hard_hr_145 is True
    assert tag_hr_145 == "hard"


def test_failure_mode_baseline_insufficient_samples() -> None:
    values = [45, 48]
    assert calculate_average(values, min_required=7) is None
    assert calculate_median(values, min_required=7) is None
    assert calculate_mad(values, min_required=14) is None


def test_failure_mode_activity_intensity_hr_fallback_boundary() -> None:
    is_hard, tag = classify_activity_intensity(training_effect=2.5, average_hr=165)
    assert is_hard is True
    assert tag == "hard"


def test_failure_mode_delta_with_none_inputs() -> None:
    assert calculate_delta(None, 50.0) is None
    assert calculate_delta(50.0, None) is None
    assert calculate_delta(None, None) is None
    assert calculate_delta(55.0, 50.0) == 5.0
