import statistics

from garmin_sync.metrics import (
    calculate_average,
    calculate_delta,
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

