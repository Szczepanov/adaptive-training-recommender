from garmin_sync.metrics import calculate_average, calculate_delta, compute_derived_metrics

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
