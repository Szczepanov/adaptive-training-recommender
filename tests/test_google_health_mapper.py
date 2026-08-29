from garmin_sync.canonical import (
    METRIC_DAILY_RESTING_HEART_RATE_BPM,
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_DURATION_SECONDS,
    METRIC_SLEEP_SESSION,
)
from garmin_sync.google_health_mapper import (
    NORMALIZER_VERSION,
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

    # Verify no steps in observations (D-MS-STEPS / P9)
    assert not any(o.source.source_record_id == "rec_steps_1" for o in batch.observations)
    assert not any("step" in o.metric.lower() for o in batch.observations)


def test_mapper_normalizes_real_google_health_v4_shape() -> None:
    """Regression test for the actual health.googleapis.com/v4 response shape, confirmed
    2026-08-27 against a live account (structure faithful, values/timestamps adjusted --
    see docs/plans/2026-08-27-real-google-health-ingestion.md). The v4 API does not carry a
    flat dataTypeName/startTime/endTime/value on each point the way MS6's original synthetic
    fixtures assumed; sleep nests under sleep.interval/sleep.stages and daily summaries nest
    under a {dailyX: {date: {year,month,day}, ...}} object, with the type only recoverable
    from the point's `name` resource path.
    """
    mapper = GoogleHealthMapper(user_id="test_user")
    raw_points = [
        {
            "name": "users/1234567890/dataTypes/sleep/dataPoints/9876543210",
            "dataSource": {
                "recordingMethod": "PASSIVELY_MEASURED",
                "device": {"formFactor": "WATCH"},
                "application": {"packageName": "com.garmin.android.apps.connectmobile"},
                "platform": "HEALTH_CONNECT",
            },
            "sleep": {
                "interval": {
                    "startTime": "2026-08-20T22:00:00Z",
                    "endTime": "2026-08-21T05:00:00Z",
                },
                "type": "STAGES",
                "stages": [
                    {
                        "startTime": "2026-08-20T22:00:00Z",
                        "endTime": "2026-08-20T22:30:00Z",
                        "type": "LIGHT",
                    },
                    {
                        "startTime": "2026-08-20T22:30:00Z",
                        "endTime": "2026-08-20T23:00:00Z",
                        "type": "DEEP",
                    },
                    {
                        "startTime": "2026-08-20T23:00:00Z",
                        "endTime": "2026-08-20T23:10:00Z",
                        "type": "AWAKE",
                    },
                    {
                        "startTime": "2026-08-20T23:10:00Z",
                        "endTime": "2026-08-21T05:00:00Z",
                        "type": "REM",
                    },
                ],
            },
        },
        {
            "name": "users/1234567890/dataTypes/daily-heart-rate-variability/dataPoints/111",
            "dataSource": {
                "recordingMethod": "MANUAL",
                "device": {},
                "application": {"packageName": "com.eightsleep.eight"},
                "platform": "HEALTH_CONNECT",
            },
            "dailyHeartRateVariability": {
                "date": {"year": 2026, "month": 8, "day": 21},
                "averageHeartRateVariabilityMilliseconds": 57.3,
                "deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds": 57.3,
            },
        },
    ]

    batch = mapper.normalize_data_points(raw_points, target_logical_date="2026-08-21")
    metrics = {o.metric: o for o in batch.observations}

    assert METRIC_SLEEP_SESSION in metrics
    sleep_val = metrics[METRIC_SLEEP_SESSION].value
    assert sleep_val["deepSeconds"] == 30 * 60
    assert sleep_val["lightSeconds"] == 30 * 60
    assert sleep_val["awakeSeconds"] == 10 * 60
    assert sleep_val["remSeconds"] == (5 * 3600 + 50 * 60)
    assert metrics[METRIC_SLEEP_SESSION].source.provider == "garmin"
    assert metrics[METRIC_SLEEP_SESSION].logical_date == "2026-08-21"

    # Regression: real v4 sleep points (Garmin here, but the same fallback path is taken for
    # any provider, including Eight Sleep -- confirmed 2026-08-28 via ES9's direct-vs-Google
    # comparison against a real account) carry no top-level durationSeconds/minutesAsleep, so
    # duration_sec falls back to a computed value. It must be elapsed-minus-awake ("time
    # actually asleep": 7h window - 10min awake = 6h50m), not the raw 7h session span --
    # the raw-span fallback silently overstated duration by exactly the awake time on every
    # affected night.
    assert sleep_val["durationSeconds"] == 6 * 3600 + 50 * 60
    assert METRIC_SLEEP_DURATION_SECONDS in metrics
    assert metrics[METRIC_SLEEP_DURATION_SECONDS].value == 6 * 3600 + 50 * 60

    assert METRIC_HRV_RMSSD_MS in metrics
    assert metrics[METRIC_HRV_RMSSD_MS].value == 57.3
    assert metrics[METRIC_HRV_RMSSD_MS].source.provider == "eight_sleep"
    assert metrics[METRIC_HRV_RMSSD_MS].logical_date == "2026-08-21"


def test_mapper_sleep_duration_falls_back_to_raw_span_when_no_awake_data() -> None:
    """When there's truly no awake-time information at all (no AWAKE stage interval, no
    awakeSleepSeconds/minutesAwake), duration_sec can only fall back to the raw session span
    -- there's nothing to subtract. This is the honest "we don't know" case, distinct from
    the elapsed-minus-awake case covered above where awake data IS available."""
    mapper = GoogleHealthMapper(user_id="test_user")
    raw_points = [
        {
            "name": "users/1234567890/dataTypes/sleep/dataPoints/1",
            "dataSource": {
                "application": {"packageName": "com.eightsleep.eight"},
            },
            "sleep": {
                "interval": {
                    "startTime": "2026-08-20T22:00:00Z",
                    "endTime": "2026-08-21T05:00:00Z",
                },
                "type": "STAGES",
                "stages": [
                    {
                        "startTime": "2026-08-20T22:00:00Z",
                        "endTime": "2026-08-21T05:00:00Z",
                        "type": "LIGHT",
                    },
                ],
            },
        },
    ]
    batch = mapper.normalize_data_points(raw_points, target_logical_date="2026-08-21")
    metrics = {o.metric: o for o in batch.observations}
    assert metrics[METRIC_SLEEP_DURATION_SECONDS].value == 7 * 3600


def test_normalizer_version_bumped_for_the_duration_fallback_fix() -> None:
    """Regression: normalizer_version was hardcoded to 1 and never bumped when the
    elapsed-minus-awake duration fallback fix landed, so save_health_observation_day_bundle
    (which only re-persists when sourcePayloadHash OR normalizerVersion changes) would have
    silently never re-persisted any already-fetched date with the corrected duration --
    sourcePayloadHash alone is blind to mapper logic changes."""
    mapper = GoogleHealthMapper(user_id="test_user")
    batch = mapper.normalize_data_points([], target_logical_date="2026-08-27")
    assert batch.normalizer_version == NORMALIZER_VERSION
    assert NORMALIZER_VERSION > 1
