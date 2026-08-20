import statistics

from garmin_sync.metrics import (
    calculate_average,
    calculate_delta,
    calculate_mad,
    calculate_median,
    calculate_stdev,
    compute_derived_metrics,
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
