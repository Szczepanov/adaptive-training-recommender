from garmin_sync.canonical import (
    METRIC_DAILY_RESTING_HEART_RATE_BPM,
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_SESSION,
)
from garmin_sync.google_health_mapper import (
    GoogleHealthMapper,
    resolve_provider_from_package,
)


def test_resolve_provider_from_package():
    assert resolve_provider_from_package("com.garmin.android.apps.connectmobile") == "garmin"
    assert resolve_provider_from_package("com.eightsleep.eightsleep") == "eight_sleep"
    assert resolve_provider_from_package("com.google.android.apps.fitness") == "google_fit"
    assert resolve_provider_from_package("com.custom.app") == "unknown:com.custom.app"
    assert resolve_provider_from_package(None) == "unknown"


def test_mapper_normalizes_sleep_and_hrv():
    mapper = GoogleHealthMapper(user_id="test_user")
    raw_points = [
        {
            "dataTypeName": "sleep",
            "dataPointId": "sleep_rec_1",
            "startTime": "2026-08-26T22:30:00Z",
            "endTime": "2026-08-27T06:00:00Z",
            "dataSource": {
                "application": {"packageName": "com.garmin.android.apps.connectmobile"},
                "device": {"model": "Forerunner 965"},
            },
            "value": {
                "durationSeconds": 27000,
                "deepSleepSeconds": 5400,
                "remSleepSeconds": 5400,
                "lightSleepSeconds": 14400,
                "awakeSleepSeconds": 1800,
            },
        },
        {
            "dataTypeName": "heart_rate_variability",
            "dataPointId": "hrv_rec_1",
            "startTime": "2026-08-26T22:30:00Z",
            "endTime": "2026-08-27T06:00:00Z",
            "dataSource": {
                "application": {"packageName": "com.garmin.android.apps.connectmobile"},
            },
            "value": {"rmssd": 64.5},
        },
        {
            "dataTypeName": "resting_heart_rate",
            "dataPointId": "rhr_rec_1",
            "startTime": "2026-08-26T22:30:00Z",
            "endTime": "2026-08-27T06:00:00Z",
            "dataSource": {
                "application": {"packageName": "com.eightsleep.eightsleep"},
            },
            "value": {"bpm": 48.0},
        },
        # Steps data point - should be locked out per D-MS-STEPS
        {
            "dataTypeName": "steps",
            "dataPointId": "steps_rec_1",
            "startTime": "2026-08-26T00:00:00Z",
            "endTime": "2026-08-26T23:59:59Z",
            "dataSource": {
                "application": {"packageName": "com.google.android.apps.fitness"},
            },
            "value": {"count": 12000},
        },
    ]

    batch = mapper.normalize_data_points(raw_points, target_logical_date="2026-08-27")
    assert batch.logical_date == "2026-08-27"
    assert len(batch.observations) > 0

    metrics = {o.metric: o for o in batch.observations}
    assert METRIC_SLEEP_SESSION in metrics
    assert metrics[METRIC_SLEEP_SESSION].source.provider == "garmin"
    assert metrics[METRIC_SLEEP_SESSION].source.origin_device == "Forerunner 965"

    assert METRIC_HRV_RMSSD_MS in metrics
    assert metrics[METRIC_HRV_RMSSD_MS].value == 64.5
    assert metrics[METRIC_HRV_RMSSD_MS].source.provider == "garmin"

    assert METRIC_DAILY_RESTING_HEART_RATE_BPM in metrics
    assert metrics[METRIC_DAILY_RESTING_HEART_RATE_BPM].value == 48.0
    assert metrics[METRIC_DAILY_RESTING_HEART_RATE_BPM].source.provider == "eight_sleep"

    # Verify no steps in observations
    assert "steps_count" not in metrics
    assert "steps" not in metrics
