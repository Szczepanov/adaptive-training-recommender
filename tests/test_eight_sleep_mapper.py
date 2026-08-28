import pytest
from garmin_sync.canonical import METRIC_DAILY_RESTING_HEART_RATE_BPM,METRIC_HRV_RMSSD_MS,METRIC_SLEEP_RESPIRATION_SUMMARY,METRIC_SLEEP_STAGE_AWAKE_SECONDS,METRIC_SLEEPING_HEART_RATE_BPM
from garmin_sync.eight_sleep_client import EightSleepSchemaError
from garmin_sync.eight_sleep_mapper import map_trends_to_observation_batch
def metrics(batch: object) -> dict[str,object]: return {x.metric:x for x in getattr(batch,"observations")}
def test_nested_current_is_measurement_not_proprietary_score() -> None:
    p={"days":[{"day":"2026-08-28","presenceStart":"2026-08-27T21:00:00+02:00","presenceDuration":30600,"sleepDuration":28800,"lightDuration":14400,"deepDuration":7200,"remDuration":7200,"sleepQualityScore":{"hrv":{"current":67.0,"score":98},"heartRate":{"current":43.0,"score":91},"respiratoryRate":{"current":13.4,"score":88}}}]}; b=map_trends_to_observation_batch(p,logical_date="2026-08-28",timezone="Europe/Warsaw"); m=metrics(b); assert m[METRIC_HRV_RMSSD_MS].value==67.0 and m[METRIC_SLEEPING_HEART_RATE_BPM].value==43.0 and METRIC_DAILY_RESTING_HEART_RATE_BPM not in m and m[METRIC_SLEEP_RESPIRATION_SUMMARY].value=={"breathsPerMinute":13.4} and m[METRIC_SLEEP_STAGE_AWAKE_SECONDS].value==1800 and all(o.source.transport=="eight_sleep_direct" for o in b.observations)
def test_successful_no_target_day_is_empty() -> None:
    b=map_trends_to_observation_batch({"days":[{"day":"2026-08-27","sleepDuration":1}]},logical_date="2026-08-28",timezone="Europe/Warsaw"); assert not b.observations and b.source_payload_hash
def test_unknown_target_schema_raises() -> None:
    with pytest.raises(EightSleepSchemaError): map_trends_to_observation_batch({"days":[{"day":"2026-08-28","unknown":1}]},logical_date="2026-08-28",timezone="Europe/Warsaw")
