import statistics

from garmin_sync.metrics import (
    calculate_accumulated_deficit,
    calculate_average,
    calculate_circular_delta_minutes,
    calculate_circular_mean_minutes,
    calculate_delta,
    calculate_mad,
    calculate_median,
    calculate_stdev,
    compute_derived_metrics,
    minutes_of_day_local,
    sleep_midpoint_iso,
)


def test_calculate_average_thresholds():
    # Fewer than min_required returns None
    values = [80, 85, None, 90]  # 3 valid values
    assert calculate_average(values, 4) is None
    assert calculate_average(values, 3) == 85.0


def test_calculate_delta():
    assert calculate_delta(80, 75.0) == 5.0
    assert calculate_delta(50, 52.0) == -2.0
    assert calculate_delta(None, 75.0) is None
    assert calculate_delta(80, None) is None


def test_calculate_stdev_thresholds():
    values = [40, 42, None, 44, 46]  # 4 valid values
    assert calculate_stdev(values, 5) is None
    assert calculate_stdev(values, 4) == statistics.pstdev([40, 42, 44, 46])


def test_calculate_stdev_matches_population_stdev():
    values = [10, 12, 14, 16, 18, 20]
    assert calculate_stdev(values, 3) == statistics.pstdev(values)


def test_calculate_median_thresholds():
    values = [14.0, 14.2, None, 14.1]  # 3 valid values
    assert calculate_median(values, 4) is None
    assert calculate_median(values, 3) == 14.1  # median of [14.0, 14.1, 14.2]


def test_calculate_median_even_count_averages_middle_two():
    values = [14.0, 14.2, 14.1, 14.3]
    assert calculate_median(values, 4) == statistics.median(values)


def test_calculate_median_resists_illness_contamination_better_than_mean():
    # 25 healthy nights around 14 br/min, plus 3 nights of a prior illness episode
    # spiking to 20 br/min, inside the same 28-day trailing window.
    healthy = [14.0] * 25
    illness_spike = [20.0] * 3
    window = healthy + illness_spike

    median = calculate_median(window, 14)
    mean = calculate_average(window, 14)

    assert median == 14.0  # unmoved by the spike
    assert mean is not None and mean > 14.0  # dragged upward by it
    assert mean - median > 0.5


def test_calculate_mad_thresholds():
    values = [10, 12, None, 14, 16]  # 4 valid values
    assert calculate_mad(values, 5) is None
    # median=13, abs deviations=[3,1,1,3], median of those=2, scaled by 1.4826
    assert calculate_mad(values, 4) == round(2 * 1.4826, 10)


def test_calculate_mad_resists_illness_contamination_better_than_stdev():
    healthy = [14.0] * 25
    illness_spike = [20.0] * 3
    window = healthy + illness_spike

    mad = calculate_mad(window, 14)
    sd = calculate_stdev(window, 14)

    assert mad == 0.0  # more than half the window is exactly 14.0
    assert sd is not None and sd > 0.0  # population stdev is inflated by the spike


def test_compute_derived_metrics_excludes_current_day():
    window_7d = [
        {"sleepScore": 80, "restingHr": 50, "hrvOvernightAvg": 60, "respirationAvg": 14.0},
        {"sleepScore": 82, "restingHr": 52, "hrvOvernightAvg": 62, "respirationAvg": 14.2},
        {"sleepScore": 84, "restingHr": 51, "hrvOvernightAvg": 61, "respirationAvg": 14.1},
        {"sleepScore": 86, "restingHr": 53, "hrvOvernightAvg": 63, "respirationAvg": 14.3},
    ]
    window_28d = window_7d * 4  # 16 items

    curr = {"sleepScore": 90, "restingHr": 48, "hrvOvernightAvg": 70, "respirationAvg": 14.0}

    derived = compute_derived_metrics(curr, window_7d, window_28d)

    assert derived.sleepScore7dAvg == 83.0
    assert derived.sleepScore28dAvg == 83.0
    assert derived.deltas.sleepScoreVs7d == 7.0
    assert derived.deltas.restingHrVs7d == -3.5  # 48 - 51.5 = -3.5


def test_compute_derived_metrics_includes_28d_stdev():
    window_7d = [
        {"sleepScore": 80, "restingHr": 50, "hrvOvernightAvg": 60, "respirationAvg": 14.0},
        {"sleepScore": 82, "restingHr": 52, "hrvOvernightAvg": 62, "respirationAvg": 14.2},
        {"sleepScore": 84, "restingHr": 51, "hrvOvernightAvg": 61, "respirationAvg": 14.1},
        {"sleepScore": 86, "restingHr": 53, "hrvOvernightAvg": 63, "respirationAvg": 14.3},
    ]
    window_28d = window_7d * 4  # 16 items, meets the 14-point minimum
    curr = {"sleepScore": 90, "restingHr": 48, "hrvOvernightAvg": 70, "respirationAvg": 14.0}

    derived = compute_derived_metrics(curr, window_7d, window_28d)

    expected_hrv_sd = round(statistics.pstdev([60, 62, 61, 63] * 4), 1)
    assert derived.hrv28dStdev == expected_hrv_sd
    assert derived.restingHr28dStdev == round(statistics.pstdev([50, 52, 51, 53] * 4), 1)
    assert derived.sleepScore28dStdev == round(statistics.pstdev([80, 82, 84, 86] * 4), 1)


def test_compute_derived_metrics_respiration_uses_median_and_mad():
    window_7d = [
        {"respirationAvg": 14.0},
        {"respirationAvg": 14.2},
        {"respirationAvg": 14.1},
        {"respirationAvg": 14.3},
    ]
    window_28d = window_7d * 4  # 16 items
    curr = {"respirationAvg": 14.0}

    derived = compute_derived_metrics(curr, window_7d, window_28d)

    assert derived.respiration7dAvg == round(
        calculate_median([d["respirationAvg"] for d in window_7d], 4), 1
    )
    assert derived.respiration28dAvg == round(
        calculate_median([d["respirationAvg"] for d in window_28d], 14), 1
    )
    assert derived.respiration28dMad == round(
        calculate_mad([d["respirationAvg"] for d in window_28d], 14), 1
    )


def test_compute_derived_metrics_respiration_mad_none_below_min_required():
    window_7d = [{"respirationAvg": 14.0}] * 4
    window_28d = [{"respirationAvg": 14.0}] * 10  # below the 14-point minimum
    curr = {"respirationAvg": 14.0}

    derived = compute_derived_metrics(curr, window_7d, window_28d)
    assert derived.respiration28dMad is None


def test_compute_derived_metrics_v4_median_mad_are_additive_alongside_mean_stdev():
    # An asymmetric window (unlike the *4-repeated fixtures above) so mean/median and
    # stdev/MAD can actually diverge, proving both statistics are computed independently
    # rather than one silently aliasing the other.
    window_7d = [
        {"sleepScore": 70, "restingHr": 60, "hrvOvernightAvg": 50, "totalSteps": 4000},
        {"sleepScore": 75, "restingHr": 55, "hrvOvernightAvg": 55, "totalSteps": 5000},
        {"sleepScore": 80, "restingHr": 52, "hrvOvernightAvg": 60, "totalSteps": 6000},
        {"sleepScore": 100, "restingHr": 50, "hrvOvernightAvg": 90, "totalSteps": 20000},
    ]
    window_28d = window_7d * 4  # 16 items
    curr = {"sleepScore": 85, "restingHr": 51, "hrvOvernightAvg": 65, "totalSteps": 7000}

    derived = compute_derived_metrics(curr, window_7d, window_28d)

    # v4 fields exist and disagree with the pre-existing mean/stdev fields on this
    # asymmetric window -- both statistics are genuinely computed, not aliased.
    assert derived.sleepScore7dMedian is not None
    assert derived.sleepScore7dMedian != derived.sleepScore7dAvg
    assert derived.restingHr7dMedian is not None
    assert derived.restingHr7dMedian != derived.restingHr7dAvg
    assert derived.hrv7dMedian is not None
    assert derived.hrv7dMedian != derived.hrv7dAvg
    assert derived.steps7dMedian is not None
    assert derived.steps7dMedian != derived.steps7dAvg

    assert derived.sleepScore28dMad is not None
    assert derived.sleepScore28dMad != derived.sleepScore28dStdev
    assert derived.restingHr28dMad is not None
    assert derived.restingHr28dMad != derived.restingHr28dStdev
    assert derived.hrv28dMad is not None
    assert derived.hrv28dMad != derived.hrv28dStdev
    assert derived.steps28dMad is not None
    assert derived.steps28dMad != derived.steps28dStdev

    # Median-baseline deltas are current minus the median, not the mean.
    assert derived.deltas.sleepScoreVs7dMedian == round(
        curr["sleepScore"] - derived.sleepScore7dMedian, 1
    )
    assert derived.deltas.restingHrVs7dMedian == round(
        curr["restingHr"] - derived.restingHr7dMedian, 1
    )
    assert derived.deltas.hrvVs7dMedian == round(curr["hrvOvernightAvg"] - derived.hrv7dMedian, 1)
    assert derived.deltas.stepsVs7dMedian == round(curr["totalSteps"] - derived.steps7dMedian, 1)


def test_compute_derived_metrics_v4_fields_none_below_min_required():
    window_7d = [{"sleepScore": 80}] * 3  # below the 4-point minimum
    window_28d = [{"sleepScore": 80}] * 10  # below the 14-point minimum
    curr = {"sleepScore": 80}

    derived = compute_derived_metrics(curr, window_7d, window_28d)
    assert derived.sleepScore7dMedian is None
    assert derived.sleepScore28dMedian is None
    assert derived.sleepScore28dMad is None
    assert derived.deltas.sleepScoreVs7dMedian is None


def test_compute_derived_metrics_v5_body_battery_stress_training_readiness():
    # An asymmetric window, and current-day values that differ from every window entry,
    # so every v5 baseline/delta is exercised with a non-trivial result.
    window_7d = [
        {
            "bodyBatteryWake": 40,
            "stress": {"avg": 20, "max": 60},
            "trainingReadiness": {"score": 50},
        },
        {
            "bodyBatteryWake": 60,
            "stress": {"avg": 25, "max": 55},
            "trainingReadiness": {"score": 55},
        },
        {
            "bodyBatteryWake": 70,
            "stress": {"avg": 30, "max": 50},
            "trainingReadiness": {"score": 60},
        },
        {
            "bodyBatteryWake": 90,
            "stress": {"avg": 15, "max": 90},
            "trainingReadiness": {"score": 80},
        },
    ]
    window_28d = window_7d * 4  # 16 items
    curr = {
        "bodyBatteryWake": 75,
        "stress": {"avg": 22, "max": 65},
        "trainingReadiness": {"score": 65},
    }

    derived = compute_derived_metrics(curr, window_7d, window_28d)

    expected_bb_median = calculate_median([40, 60, 70, 90], 4)
    assert derived.bodyBatteryWake7dMedian == round(expected_bb_median, 1)
    assert derived.bodyBatteryWake28dMedian == round(expected_bb_median, 1)
    assert derived.bodyBatteryWake28dMad == round(calculate_mad([40, 60, 70, 90] * 4, 14), 1)
    assert derived.deltas.bodyBatteryWakeVs7dMedian == round(75 - expected_bb_median, 1)

    expected_stress_avg_median = calculate_median([20, 25, 30, 15], 4)
    assert derived.stressAvg7dMedian == round(expected_stress_avg_median, 1)
    assert derived.stressAvg28dMad == round(calculate_mad([20, 25, 30, 15] * 4, 14), 1)
    assert derived.deltas.stressAvgVs7dMedian == round(22 - expected_stress_avg_median, 1)

    expected_stress_max_median = calculate_median([60, 55, 50, 90], 4)
    assert derived.stressMax7dMedian == round(expected_stress_max_median, 1)
    assert derived.deltas.stressMaxVs7dMedian == round(65 - expected_stress_max_median, 1)

    expected_readiness_median = calculate_median([50, 55, 60, 80], 4)
    assert derived.trainingReadinessScore7dMedian == round(expected_readiness_median, 1)
    assert derived.deltas.trainingReadinessScoreVs7dMedian == round(
        65 - expected_readiness_median, 1
    )


def test_compute_derived_metrics_v5_fields_none_when_stress_and_readiness_absent():
    # Days where stress/trainingReadiness were never populated (common while these
    # remain "not yet consumed" enrichment fields per CanonicalDailyMetrics's docstring).
    window_7d = [{"bodyBatteryWake": 70}] * 4
    window_28d = [{"bodyBatteryWake": 70}] * 14
    curr = {"bodyBatteryWake": 70}

    derived = compute_derived_metrics(curr, window_7d, window_28d)
    assert derived.bodyBatteryWake7dMedian == 70.0
    assert derived.stressAvg7dMedian is None
    assert derived.stressMax7dMedian is None
    assert derived.trainingReadinessScore7dMedian is None
    assert derived.deltas.stressAvgVs7dMedian is None
    assert derived.deltas.trainingReadinessScoreVs7dMedian is None


def test_compute_derived_metrics_stdev_none_below_min_required():
    # Only 10 valid points in the 28d window -- below the 14-point minimum.
    window_7d = [{"hrvOvernightAvg": 60}] * 4
    window_28d = [{"hrvOvernightAvg": 60}] * 10
    curr = {"hrvOvernightAvg": 60}

    derived = compute_derived_metrics(curr, window_7d, window_28d)
    assert derived.hrv28dStdev is None


def test_compute_derived_metrics_steps():
    window_7d = [
        {"totalSteps": 5000},
        {"totalSteps": 6000},
        {"totalSteps": 7000},
        {"totalSteps": 6000},
    ]
    window_28d = window_7d * 4  # 16 items
    curr = {"totalSteps": 20000}

    derived = compute_derived_metrics(curr, window_7d, window_28d)

    assert derived.steps7dAvg == 6000.0
    assert derived.steps28dAvg == 6000.0
    assert derived.deltas.stepsVs7d == 14000.0
    assert derived.deltas.stepsVs28d == 14000.0
    assert derived.steps28dStdev == round(statistics.pstdev([5000, 6000, 7000, 6000] * 4), 1)


# --- v6: sleep-duration deviation, accumulated deficit, circular time-of-day baselines ---


def test_minutes_of_day_local_converts_utc_to_warsaw_winter_offset():
    # 2026-01-15T22:00:00Z -> Europe/Warsaw is UTC+1 in January (CET) -> 23:00 local.
    assert minutes_of_day_local("2026-01-15T22:00:00+00:00", "Europe/Warsaw") == 23 * 60


def test_minutes_of_day_local_handles_date_rollover():
    # 2026-01-15T23:30:00Z -> 00:30 local the next day -- minutes-of-day is still just 30.
    assert minutes_of_day_local("2026-01-15T23:30:00+00:00", "Europe/Warsaw") == 30


def test_minutes_of_day_local_none_for_missing_or_offset_less():
    assert minutes_of_day_local(None, "Europe/Warsaw") is None
    assert minutes_of_day_local("", "Europe/Warsaw") is None
    assert minutes_of_day_local("2026-01-15T22:00:00", "Europe/Warsaw") is None  # no offset
    assert minutes_of_day_local("not-a-timestamp", "Europe/Warsaw") is None


def test_sleep_midpoint_iso_exact_interval_arithmetic():
    midpoint = sleep_midpoint_iso("2026-01-15T22:00:00+00:00", "2026-01-16T06:00:00+00:00")
    assert midpoint == "2026-01-16T02:00:00+00:00"


def test_sleep_midpoint_iso_none_for_missing_or_non_positive_interval():
    assert sleep_midpoint_iso(None, "2026-01-16T06:00:00+00:00") is None
    assert sleep_midpoint_iso("2026-01-15T22:00:00+00:00", None) is None
    # end before start -- non-positive interval, not silently flipped.
    assert sleep_midpoint_iso("2026-01-16T06:00:00+00:00", "2026-01-15T22:00:00+00:00") is None


def test_calculate_circular_mean_minutes_handles_midnight_wraparound():
    # 23:50 (1430min) and 00:10 (10min) are 20 minutes apart across midnight -- the mean
    # must be ~00:00, not ~12:00 (which a naive linear mean of 1430 and 10 would give).
    # Compared with a tolerance for floating-point trig round-off, not exact equality.
    result = calculate_circular_mean_minutes([1430.0, 10.0], 2)
    assert result is not None
    assert abs(result % 1440.0) < 0.01 or abs(result % 1440.0 - 1440.0) < 0.01


def test_calculate_circular_mean_minutes_ordinary_case_matches_linear_mean():
    # Values well away from the wraparound point should match an ordinary mean closely.
    result = calculate_circular_mean_minutes([480.0, 500.0, 490.0, 490.0], 4)
    assert result is not None
    assert abs(result - 490.0) < 0.01


def test_calculate_circular_mean_minutes_none_below_min_required():
    assert calculate_circular_mean_minutes([480.0, 490.0], 4) is None


def test_calculate_circular_delta_minutes_handles_wraparound():
    # current=00:10 (10min) vs baseline=23:50 (1430min) -> +20min later, not -1420min.
    assert calculate_circular_delta_minutes(10.0, 1430.0) == 20.0
    # Reverse direction: 20 minutes earlier.
    assert calculate_circular_delta_minutes(1430.0, 10.0) == -20.0
    # Exactly opposite points have no unique shorter direction; convention is -720.
    assert calculate_circular_delta_minutes(720.0, 0.0) == -720.0


def test_calculate_circular_delta_minutes_ordinary_case():
    assert calculate_circular_delta_minutes(500.0, 480.0) == 20.0


def test_calculate_circular_delta_minutes_none_when_either_missing():
    assert calculate_circular_delta_minutes(None, 480.0) is None
    assert calculate_circular_delta_minutes(500.0, None) is None


def test_calculate_accumulated_deficit_sums_most_recent_n():
    # 8h (28800s) baseline; two most recent nights at 7.5h and 7h -> deficits 1800 + 3600.
    values = [28800, 28800, 27000, 25200]
    assert calculate_accumulated_deficit(values, 28800.0, 2) == 5400.0


def test_calculate_accumulated_deficit_uses_tail_when_window_longer_than_n():
    # Gap-tolerant: "most recent n WITH data", i.e. the last n entries of the list, not
    # necessarily the last n calendar nights.
    values = [10, 20, 30, 40, 50]
    assert calculate_accumulated_deficit(values, 100.0, 2) == (100 - 40) + (100 - 50)


def test_calculate_accumulated_deficit_can_be_negative_on_net_surplus():
    values = [30000, 30600]  # both above an 8h/28800s baseline
    result = calculate_accumulated_deficit(values, 28800.0, 2)
    assert result is not None
    assert result < 0


def test_calculate_accumulated_deficit_none_when_baseline_or_data_insufficient():
    assert calculate_accumulated_deficit([28800, 27000], None, 2) is None
    assert calculate_accumulated_deficit([27000], 28800.0, 2) is None


def test_compute_derived_metrics_v6_sleep_duration_deviation_and_accumulated_deficit():
    window_7d = [{"sleepDurationSec": v} for v in (27000, 28800, 29700, 27900)]
    window_28d = window_7d * 4  # 16 historical items; current is intentionally separate.
    curr = {"sleepDurationSec": 25200}  # a short current night: 7h

    derived = compute_derived_metrics(curr, window_7d, window_28d)

    expected_median = calculate_median([27000, 28800, 29700, 27900], 4)
    assert derived.sleepDuration7dMedian == round(expected_median, 1)
    assert derived.sleepDuration28dMedian == round(expected_median, 1)
    assert derived.deltas.sleepDurationVs7dMedian == round(25200 - expected_median, 1)

    # The historical baseline excludes current, but accumulated deficit must include the
    # current night. For 2d that means yesterday + current; for 3d, D-2 + D-1 + current.
    expected_2d = calculate_accumulated_deficit([27900, 25200], expected_median, 2)
    expected_3d = calculate_accumulated_deficit([29700, 27900, 25200], expected_median, 3)
    assert derived.sleepDurationAccumulated2dDeficitSec == round(expected_2d, 1)
    assert derived.sleepDurationAccumulated3dDeficitSec == round(expected_3d, 1)


def test_compute_derived_metrics_v6_bedtime_wake_midpoint_circular_baselines():
    # A stable ~22:30 bedtime / ~06:30 wake time across the window, real UTC timestamps
    # (Warsaw is UTC+1 in January).
    window_7d = [
        {
            "sleepSessionStart": f"2026-01-{d:02d}T21:30:00+00:00",
            "sleepSessionEnd": f"2026-01-{d + 1:02d}T05:30:00+00:00",
        }
        for d in (10, 11, 12, 13)
    ]
    window_28d = window_7d * 4
    # Current night: bedtime an hour later than usual (23:30 local), wake time on time.
    curr = {
        "sleepSessionStart": "2026-01-20T22:30:00+00:00",
        "sleepSessionEnd": "2026-01-21T05:30:00+00:00",
    }

    derived = compute_derived_metrics(curr, window_7d, window_28d, timezone_name="Europe/Warsaw")

    # Baseline bedtime: 21:30 UTC -> 22:30 local -> 1350 minutes.
    assert derived.bedtime7dCircularMeanMinutes == 22 * 60 + 30
    # Baseline wake time: 05:30 UTC -> 06:30 local -> 390 minutes.
    assert derived.wakeTime7dCircularMeanMinutes == 6 * 60 + 30
    # Current bedtime: 22:30 UTC -> 23:30 local -> 60 minutes later than the 22:30 baseline.
    assert derived.deltas.bedtimeDeviationVs7dMinutes == 60.0
    # Current wake time matches baseline exactly.
    assert derived.deltas.wakeTimeDeviationVs7dMinutes == 0.0


def test_compute_derived_metrics_v6_midnight_circular_mean_persists_as_zero_not_1440():
    # Symmetric 23:50 / 00:10 local bedtimes have a true mean of midnight. Floating-point
    # trig can represent that as 1439.999..., so persistence must normalize after rounding.
    starts = [
        "2026-01-10T22:50:00+00:00",  # 23:50 local
        "2026-01-11T23:10:00+00:00",  # 00:10 local next day
        "2026-01-12T22:50:00+00:00",
        "2026-01-13T23:10:00+00:00",
    ]
    window_7d = [{"sleepSessionStart": value} for value in starts]
    window_28d = window_7d * 4

    derived = compute_derived_metrics({}, window_7d, window_28d, timezone_name="Europe/Warsaw")

    assert derived.bedtime7dCircularMeanMinutes == 0.0
    assert derived.bedtime28dCircularMeanMinutes == 0.0


def test_compute_derived_metrics_v6_fields_none_when_sleep_timing_absent():
    window_7d = [{"sleepScore": 80}] * 4
    window_28d = [{"sleepScore": 80}] * 14
    curr = {"sleepScore": 80}

    derived = compute_derived_metrics(curr, window_7d, window_28d)
    assert derived.sleepDuration7dMedian is None
    assert derived.sleepDurationAccumulated2dDeficitSec is None
    assert derived.bedtime7dCircularMeanMinutes is None
    assert derived.deltas.sleepDurationVs7dMedian is None
    assert derived.deltas.bedtimeDeviationVs7dMinutes is None
