import pytest

from garmin_sync.canonical import (
    METRIC_BEDTIME_BASELINE_TIME,
    METRIC_BEDTIME_CONSISTENCY,
    METRIC_CHRONOTYPE_CLASS,
    METRIC_DAILY_RESTING_HEART_RATE_BPM,
    METRIC_DEEP_SLEEP_BASELINE_SECONDS,
    METRIC_HEAVY_SNORE_DURATION_7DAY_AVG_SECONDS,
    METRIC_HEAVY_SNORE_DURATION_SECONDS,
    METRIC_HEAVY_SNORE_PERCENT,
    METRIC_HRV_7DAY_AVG_MS,
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_BASELINE_DURATION_SECONDS,
    METRIC_SLEEP_DEBT_SECONDS,
    METRIC_SLEEP_DURATION_7DAY_AVG_SECONDS,
    METRIC_SLEEP_END_BASELINE_TIME,
    METRIC_SLEEP_LATENCY_ASLEEP_SECONDS,
    METRIC_SLEEP_LATENCY_OUT_SECONDS,
    METRIC_SLEEP_MIDPOINT_BASELINE_TIME,
    METRIC_SLEEP_RESPIRATION_RATE_7DAY_AVG_BRPM,
    METRIC_SLEEP_RESPIRATION_SUMMARY,
    METRIC_SLEEP_STAGE_AWAKE_SECONDS,
    METRIC_SLEEP_STAGE_DEEP_7DAY_AVG_SECONDS,
    METRIC_SLEEP_START_BASELINE_TIME,
    METRIC_SLEEP_START_TIME_CONSISTENCY,
    METRIC_SLEEP_TAGS,
    METRIC_SLEEP_WASO_7DAY_AVG_SECONDS,
    METRIC_SLEEP_WASO_SECONDS,
    METRIC_SLEEPING_HEART_RATE_7DAY_AVG_BPM,
    METRIC_SLEEPING_HEART_RATE_BPM,
    METRIC_SNORE_DURATION_7DAY_AVG_SECONDS,
    METRIC_SNORE_DURATION_SECONDS,
    METRIC_SNORE_MITIGATION_EVENTS_COUNT,
    METRIC_SNORE_PERCENT,
    METRIC_SOCIAL_JETLAG_SECONDS,
    METRIC_TOSS_AND_TURN_COUNT,
    METRIC_TOTAL_SLEEP_TIME_BASELINE_SECONDS,
    METRIC_WAKEUP_TIME_CONSISTENCY,
    METRIC_WASO_BASELINE_SECONDS,
)
from garmin_sync.eight_sleep_client import EightSleepSchemaError
from garmin_sync.eight_sleep_mapper import map_trends_to_observation_batch


def metrics(batch: object) -> dict[str, object]:
    return {x.metric: x for x in batch.observations}


def test_nested_current_is_measurement_not_proprietary_score() -> None:
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "sleepQualityScore": {
                    "hrv": {"current": 67.0, "score": 98},
                    "heartRate": {"current": 43.0, "score": 91},
                    "respiratoryRate": {"current": 13.4, "score": 88},
                },
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)
    assert (
        m[METRIC_HRV_RMSSD_MS].value == 67.0
        and m[METRIC_SLEEPING_HEART_RATE_BPM].value == 43.0
        and METRIC_DAILY_RESTING_HEART_RATE_BPM not in m
        and m[METRIC_SLEEP_RESPIRATION_SUMMARY].value == {"breathsPerMinute": 13.4}
        and m[METRIC_SLEEP_STAGE_AWAKE_SECONDS].value == 1800
        and all(o.source.transport == "eight_sleep_direct" for o in b.observations)
    )


def test_extended_fields_extracted_when_present() -> None:
    """ES-EXT: snoring, sleep latency/WASO/debt, circadian consistency, and chronotype --
    real fields confirmed present in the private API's response (2026-08-28 probe) that the
    original mapper never extracted. Shape matches the real nested structure exactly."""
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "tnt": 12,
                "snoreDuration": 300,
                "heavySnoreDuration": 60,
                "snorePercent": 2,
                "heavySnorePercent": 0,
                "mitigationEvents": 1,
                "sleepQualityScore": {
                    "hrv": {"current": 67.0},
                    "waso": {"current": 420.0},
                    "sleepDebt": {
                        "dailySleepDebtSeconds": 1800.0,
                        "baselineSleepDurationSeconds": 27000.0,
                    },
                },
                "sleepRoutineScore": {
                    "latencyAsleepSeconds": {"current": 540},
                    "latencyOutSeconds": {"current": 300},
                    "wakeupConsistency": {"current": "06:13:00"},
                    "sleepStartConsistency": {"current": "22:45:00"},
                    "bedtimeConsistency": {"current": "22:30:00"},
                },
                "performanceWindows": {
                    "socialJetlag": {"socialJetlagSeconds": 900},
                    "chronotype": {"chronoClass": "early", "source": "pod"},
                },
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)

    assert m[METRIC_SLEEP_WASO_SECONDS].value == 420
    assert m[METRIC_SLEEP_DEBT_SECONDS].value == 1800
    assert m[METRIC_SLEEP_BASELINE_DURATION_SECONDS].value == 27000
    assert m[METRIC_SLEEP_LATENCY_ASLEEP_SECONDS].value == 540
    assert m[METRIC_SLEEP_LATENCY_OUT_SECONDS].value == 300
    assert m[METRIC_WAKEUP_TIME_CONSISTENCY].value == "06:13:00"
    assert m[METRIC_SLEEP_START_TIME_CONSISTENCY].value == "22:45:00"
    assert m[METRIC_BEDTIME_CONSISTENCY].value == "22:30:00"
    assert m[METRIC_SNORE_DURATION_SECONDS].value == 300
    assert m[METRIC_HEAVY_SNORE_DURATION_SECONDS].value == 60
    assert m[METRIC_SNORE_PERCENT].value == 2
    assert m[METRIC_HEAVY_SNORE_PERCENT].value == 0
    assert m[METRIC_SNORE_MITIGATION_EVENTS_COUNT].value == 1
    assert m[METRIC_TOSS_AND_TURN_COUNT].value == 12
    assert m[METRIC_SOCIAL_JETLAG_SECONDS].value == 900
    assert m[METRIC_CHRONOTYPE_CLASS].value == "early"


def test_batch_2_extended_fields_extracted_when_present() -> None:
    """ES-EXT-2: performanceWindowStats personal baselines, per-metric inclusive7DayAverage
    rolling baselines, and night tags -- confirmed present via a real probe (2026-08-28) and
    still not extracted after the first ES-EXT batch."""
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepStart": "2026-08-27T21:05:00+02:00",
                "sleepEnd": "2026-08-28T05:50:00+02:00",
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "snoreDuration": 300,
                "heavySnoreDuration": 60,
                "tags": ["travel"],
                "sleepQualityScore": {
                    "hrv": {"current": 67.0, "inclusive7DayAverage": 64.2},
                    "respiratoryRate": {"current": 13.4, "inclusive7DayAverage": 13.1},
                    "heartRate": {"current": 43.0, "inclusive7DayAverage": 44.5},
                    "waso": {"current": 420.0, "inclusive7DayAverage": 390.0},
                    "sleepDurationSeconds": {"inclusive7DayAverage": 27600.0},
                    "deep": {"inclusive7DayAverage": 6900.0},
                    "rem": {"inclusive7DayAverage": 6600.0},
                    "snoringDurationSeconds": {"inclusive7DayAverage": 250.0},
                    "heavySnoringDurationSeconds": {"inclusive7DayAverage": 40.0},
                },
                "performanceWindows": {
                    "performanceWindowStats": {
                        "bedtimeBaseline": "22:15:00",
                        "sleepStartBaseline": "22:30:00",
                        "sleepEndBaseline": "06:10:00",
                        "sleepMidpointBaseline": "02:20:00",
                        "wasoBaseline": 400.0,
                        "totalSleepTimeSecondsBaseline": 27900.0,
                        "deepSleepSecondsBaseline": 7000.0,
                    }
                },
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)

    assert m[METRIC_BEDTIME_BASELINE_TIME].value == "22:15:00"
    assert m[METRIC_SLEEP_START_BASELINE_TIME].value == "22:30:00"
    assert m[METRIC_SLEEP_END_BASELINE_TIME].value == "06:10:00"
    assert m[METRIC_SLEEP_MIDPOINT_BASELINE_TIME].value == "02:20:00"
    assert m[METRIC_WASO_BASELINE_SECONDS].value == 400
    assert m[METRIC_TOTAL_SLEEP_TIME_BASELINE_SECONDS].value == 27900
    assert m[METRIC_DEEP_SLEEP_BASELINE_SECONDS].value == 7000

    assert m[METRIC_HRV_7DAY_AVG_MS].value == 64.2
    assert m[METRIC_SLEEP_RESPIRATION_RATE_7DAY_AVG_BRPM].value == 13.1
    assert m[METRIC_SLEEPING_HEART_RATE_7DAY_AVG_BPM].value == 44.5
    assert m[METRIC_SLEEP_WASO_7DAY_AVG_SECONDS].value == 390
    assert m[METRIC_SLEEP_DURATION_7DAY_AVG_SECONDS].value == 27600
    assert m[METRIC_SLEEP_STAGE_DEEP_7DAY_AVG_SECONDS].value == 6900
    assert m[METRIC_SNORE_DURATION_7DAY_AVG_SECONDS].value == 250
    assert m[METRIC_HEAVY_SNORE_DURATION_7DAY_AVG_SECONDS].value == 40

    assert m[METRIC_SLEEP_TAGS].value == {"tags": ["travel"]}

    # sleepStart/sleepEnd, not presence bounds, must be the actual observed window now.
    sleep_obs = m[METRIC_SLEEP_WASO_SECONDS]
    assert sleep_obs.observed_start.isoformat() == "2026-08-27T21:05:00+02:00"
    assert sleep_obs.observed_end.isoformat() == "2026-08-28T05:50:00+02:00"


def test_start_end_fall_back_to_presence_when_sleep_start_end_absent() -> None:
    """Backward compat: an older/degraded response shape without sleepStart/sleepEnd must
    still use presence bounds, exactly as before this change."""
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "sleepQualityScore": {"hrv": {"current": 67.0}},
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)
    hrv_obs = m[METRIC_HRV_RMSSD_MS]
    assert hrv_obs.observed_start.isoformat() == "2026-08-27T21:00:00+02:00"
    # presence end = presenceStart + presenceDuration (30600s = 8h30m)
    assert hrv_obs.observed_end.isoformat() == "2026-08-28T05:30:00+02:00"


def test_incomplete_flag_recorded_in_quality() -> None:
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "incomplete": True,
                "sleepQualityScore": {"hrv": {"current": 67.0}},
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)
    assert m[METRIC_HRV_RMSSD_MS].quality["incomplete"] is True


def test_batch_2_fields_absent_when_not_present() -> None:
    """Backward compat: a response with none of the batch-2 fields must not error and must
    not synthesize any of them, including an empty tags list not producing an observation."""
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "tags": [],
                "sleepQualityScore": {"hrv": {"current": 67.0}},
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)
    for extended_metric in (
        METRIC_BEDTIME_BASELINE_TIME,
        METRIC_WASO_BASELINE_SECONDS,
        METRIC_HRV_7DAY_AVG_MS,
        METRIC_SLEEP_TAGS,
    ):
        assert extended_metric not in m


def test_sleep_debt_can_be_negative_on_a_surplus_night() -> None:
    """dailySleepDebtSeconds is plausibly bidirectional (ahead of baseline = surplus, not
    just behind = debt) -- must not be silently clamped to None the way _num() would for a
    duration/count field. Confirms _signed_num is actually used, not _num."""
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "sleepQualityScore": {
                    "hrv": {"current": 67.0},
                    "sleepDebt": {"dailySleepDebtSeconds": -600.0},
                },
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)
    assert m[METRIC_SLEEP_DEBT_SECONDS].value == -600


def test_malformed_time_of_day_consistency_value_is_rejected() -> None:
    """A consistency 'current' value that doesn't match the confirmed real HH:MM:SS shape
    must be dropped, not passed through as if it were a valid time-of-day."""
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "sleepQualityScore": {"hrv": {"current": 67.0}},
                "sleepRoutineScore": {
                    "wakeupConsistency": {"current": "not-a-time"},
                    "sleepStartConsistency": {"current": "25:99:00"},  # out-of-range
                },
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)
    assert METRIC_WAKEUP_TIME_CONSISTENCY not in m
    assert METRIC_SLEEP_START_TIME_CONSISTENCY not in m


def test_extended_fields_absent_when_not_present() -> None:
    """Backward compat: a response with none of the extended fields (the original test
    fixture's shape) must not error and must not synthesize any of the new metrics."""
    p = {
        "days": [
            {
                "day": "2026-08-28",
                "presenceStart": "2026-08-27T21:00:00+02:00",
                "presenceDuration": 30600,
                "sleepDuration": 28800,
                "lightDuration": 14400,
                "deepDuration": 7200,
                "remDuration": 7200,
                "sleepQualityScore": {"hrv": {"current": 67.0}},
            }
        ]
    }
    b = map_trends_to_observation_batch(p, logical_date="2026-08-28", timezone="Europe/Warsaw")
    m = metrics(b)
    for extended_metric in (
        METRIC_SLEEP_WASO_SECONDS,
        METRIC_SLEEP_DEBT_SECONDS,
        METRIC_SNORE_DURATION_SECONDS,
        METRIC_TOSS_AND_TURN_COUNT,
        METRIC_SOCIAL_JETLAG_SECONDS,
        METRIC_CHRONOTYPE_CLASS,
        METRIC_WAKEUP_TIME_CONSISTENCY,
    ):
        assert extended_metric not in m


def test_successful_no_target_day_is_empty() -> None:
    b = map_trends_to_observation_batch(
        {"days": [{"day": "2026-08-27", "sleepDuration": 1}]},
        logical_date="2026-08-28",
        timezone="Europe/Warsaw",
    )
    assert not b.observations and b.source_payload_hash


def test_unknown_target_schema_raises() -> None:
    with pytest.raises(EightSleepSchemaError):
        map_trends_to_observation_batch(
            {"days": [{"day": "2026-08-28", "unknown": 1}]},
            logical_date="2026-08-28",
            timezone="Europe/Warsaw",
        )
