from garmin_sync.garmin_provider import extract_sleep_metrics


def test_extract_sleep_metrics_reads_top_level_restless_count():
    payload = {
        "dailySleepDTO": {
            "sleepScores": {"overall": {"value": 91}},
            "sleepTimeSeconds": 27_000,
            "deepSleepSeconds": 5_400,
            "remSleepSeconds": 6_000,
            "lightSleepSeconds": 14_000,
            "awakeSleepSeconds": 1_600,
        },
        "restlessMomentsCount": 17,
    }

    assert extract_sleep_metrics(payload) == (
        91,
        27_000,
        None,
        5_400,
        6_000,
        14_000,
        1_600,
        17,
    )


def test_extract_sleep_metrics_prefers_nested_count_when_both_shapes_exist():
    payload = {
        "dailySleepDTO": {
            "sleepScores": {"overall": {"value": 84}},
            "restlessMomentsCount": 8,
        },
        "restlessMomentsCount": 99,
    }

    assert extract_sleep_metrics(payload)[-1] == 8


def test_extract_sleep_metrics_degrades_on_malformed_sleep_dto_and_invalid_counts():
    payload = {
        "dailySleepDTO": "unexpected-shape",
        "overallSleepScore": {"value": 88},
        "totalSleepSeconds": 25_200,
        "deepSleepSeconds": -1,
        "remSleepSeconds": True,
        "lightSleepSeconds": 13_000,
        "awakeSleepSeconds": 0,
        "restlessMomentsCount": False,
    }

    assert extract_sleep_metrics(payload) == (
        88,
        25_200,
        None,
        None,
        None,
        13_000,
        0,
        None,
    )
