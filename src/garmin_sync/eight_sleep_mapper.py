"""Map Eight Sleep trend payloads into ADR-0027 source-aware observations."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from garmin_sync.canonical import (
    METRIC_BEDTIME_BASELINE_TIME,
    METRIC_BEDTIME_CONSISTENCY,
    METRIC_CHRONOTYPE_CLASS,
    METRIC_DEEP_SLEEP_BASELINE_SECONDS,
    METRIC_HEAVY_SNORE_DURATION_7DAY_AVG_SECONDS,
    METRIC_HEAVY_SNORE_DURATION_SECONDS,
    METRIC_HEAVY_SNORE_PERCENT,
    METRIC_HRV_7DAY_AVG_MS,
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_BASELINE_DURATION_SECONDS,
    METRIC_SLEEP_DEBT_SECONDS,
    METRIC_SLEEP_DURATION_7DAY_AVG_SECONDS,
    METRIC_SLEEP_DURATION_SECONDS,
    METRIC_SLEEP_END_BASELINE_TIME,
    METRIC_SLEEP_LATENCY_ASLEEP_SECONDS,
    METRIC_SLEEP_LATENCY_OUT_SECONDS,
    METRIC_SLEEP_MIDPOINT_BASELINE_TIME,
    METRIC_SLEEP_RESPIRATION_RATE_7DAY_AVG_BRPM,
    METRIC_SLEEP_RESPIRATION_SUMMARY,
    METRIC_SLEEP_SESSION,
    METRIC_SLEEP_STAGE_AWAKE_SECONDS,
    METRIC_SLEEP_STAGE_DEEP_7DAY_AVG_SECONDS,
    METRIC_SLEEP_STAGE_DEEP_SECONDS,
    METRIC_SLEEP_STAGE_LIGHT_SECONDS,
    METRIC_SLEEP_STAGE_REM_7DAY_AVG_SECONDS,
    METRIC_SLEEP_STAGE_REM_SECONDS,
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
    CanonicalHealthObservation,
    ObservationBatch,
    ObservationSource,
)
from garmin_sync.eight_sleep_client import EightSleepSchemaError

PROVIDER = "eight_sleep"
TRANSPORT = "eight_sleep_direct"
ORIGIN_APPLICATION = "eight_sleep_private_api"
# 2 (ES-EXT, 2026-08-28): added snoring/latency/WASO/sleep-debt/circadian-consistency/
# chronotype extraction.
# 3 (ES-EXT-2, 2026-08-28): added performanceWindowStats personal baselines, per-metric
# inclusive7DayAverage rolling baselines, night tags, incomplete-night quality flag, and
# switched observed_start/observed_end to the real sleepStart/sleepEnd fields instead of
# presence-derived bounds (presence = time in bed; sleep = time actually asleep, a strictly
# narrower and more accurate window -- confirmed via a real probe: sleepStart lagged
# presenceStart by the latency-to-fall-asleep, sleepEnd led presenceEnd by the
# latency-to-get-out-of-bed, both already captured separately as duration metrics).
# Bumping this is what actually makes save_health_observation_day_bundle re-persist
# already-fetched dates with the richer observation set -- sourcePayloadHash alone is blind
# to mapper logic changes, since the underlying raw Eight Sleep response is unchanged.
NORMALIZER_VERSION = 3


def map_trends_to_observation_batch(
    payload: Any, *, logical_date: str, timezone: str
) -> ObservationBatch:
    days = _extract_days(payload)
    selected = _select_day(days, logical_date, ZoneInfo(timezone))
    if selected is None:
        return ObservationBatch(
            logical_date=logical_date,
            observations=[],
            source_payload_hash=_hash({"logicalDate": logical_date, "status": "no-record"}),
            normalizer_version=NORMALIZER_VERSION,
        )
    presence_start = _dt(_first(selected, "presenceStart", "presence_start"))
    presence = _num(
        _first(selected, "presenceDurationSeconds", "presenceDuration", "presence_duration")
    )
    presence_end = (
        presence_start + timedelta(seconds=presence)
        if presence_start and presence is not None
        else None
    )
    sleep = _num(_first(selected, "sleepDurationSeconds", "sleepDuration", "sleep_duration"))
    light = _num(_first(selected, "lightDurationSeconds", "lightDuration", "light_duration"))
    deep = _num(_first(selected, "deepDurationSeconds", "deepDuration", "deep_duration"))
    rem = _num(_first(selected, "remDurationSeconds", "remDuration", "rem_duration"))
    # Prefer the real sleepStart/sleepEnd (time actually asleep) over presence bounds (time
    # in bed, a strictly wider window -- the gap is exactly the latency-asleep/latency-out
    # durations already captured separately). Falls back to presence bounds only when the
    # API response doesn't carry sleepStart/sleepEnd at all, preserving prior behavior for
    # any degraded/older response shape.
    sleep_start = _dt(_first(selected, "sleepStart", "sleep_start"))
    sleep_end = _dt(_first(selected, "sleepEnd", "sleep_end"))
    start = sleep_start or presence_start
    end = sleep_end or presence_end
    quality_score = selected.get("sleepQualityScore")
    score = quality_score if isinstance(quality_score, dict) else {}
    hrv = _num(_current(score, "hrv"))
    hr = _num(_first(selected, "heartRate", "heart_rate") or _current(score, "heartRate"))
    resp = _num(
        _first(selected, "respiratoryRate", "respiratory_rate")
        or _current(score, "respiratoryRate")
    )

    # Extended fields (ES-EXT): sleepQualityScore.waso/sleepDebt, sleepRoutineScore's
    # latency/consistency sub-objects, and performanceWindows' social-jetlag/chronotype --
    # all already computed server-side by the private API but not previously extracted.
    # None of these count toward the "did this record contain anything recognized" check
    # below: a day with only these fields and no core sleep/recovery data would be a
    # malformed record, not a legitimately extended one.
    waso = _num(_current(score, "waso"))
    debt_obj = score.get("sleepDebt")
    debt_obj = debt_obj if isinstance(debt_obj, dict) else {}
    sleep_debt = _signed_num(debt_obj.get("dailySleepDebtSeconds"))
    sleep_baseline = _num(debt_obj.get("baselineSleepDurationSeconds"))

    routine_score = selected.get("sleepRoutineScore")
    routine = routine_score if isinstance(routine_score, dict) else {}
    latency_asleep = _num(_current(routine, "latencyAsleepSeconds"))
    latency_out = _num(_current(routine, "latencyOutSeconds"))
    wakeup_consistency = _time_of_day(_current(routine, "wakeupConsistency"))
    sleep_start_consistency = _time_of_day(_current(routine, "sleepStartConsistency"))
    bedtime_consistency = _time_of_day(_current(routine, "bedtimeConsistency"))

    snore_sec = _num(_first(selected, "snoreDuration", "snore_duration"))
    heavy_snore_sec = _num(_first(selected, "heavySnoreDuration", "heavy_snore_duration"))
    snore_pct = _num(_first(selected, "snorePercent", "snore_percent"))
    heavy_snore_pct = _num(_first(selected, "heavySnorePercent", "heavy_snore_percent"))
    mitigation_events = _num(_first(selected, "mitigationEvents", "mitigation_events"))
    tnt = _num(_first(selected, "tnt"))

    perf_windows = selected.get("performanceWindows")
    perf_windows = perf_windows if isinstance(perf_windows, dict) else {}
    social_jetlag_obj = perf_windows.get("socialJetlag")
    social_jetlag_obj = social_jetlag_obj if isinstance(social_jetlag_obj, dict) else {}
    social_jetlag = _num(social_jetlag_obj.get("socialJetlagSeconds"))
    chronotype_obj = perf_windows.get("chronotype")
    chronotype_obj = chronotype_obj if isinstance(chronotype_obj, dict) else {}
    chronotype_class = _str(chronotype_obj.get("chronoClass"))

    # Extended fields batch 2 (ES-EXT-2): performanceWindowStats' personal baselines (not
    # tonight's own reading -- its "current*" fields duplicate day.sleepStart/sleepEnd/
    # sleepDuration in a different string shape and are deliberately not re-extracted) and
    # per-metric inclusive7DayAverage rolling baselines. Both only present when
    # performanceWindows.isAvailable -- checked implicitly by field presence, not the flag
    # itself, since an individual field being absent is the more precise signal.
    pw_stats_obj = perf_windows.get("performanceWindowStats")
    pw_stats = pw_stats_obj if isinstance(pw_stats_obj, dict) else {}
    bedtime_baseline = _time_of_day(pw_stats.get("bedtimeBaseline"))
    sleep_start_baseline = _time_of_day(pw_stats.get("sleepStartBaseline"))
    sleep_end_baseline = _time_of_day(pw_stats.get("sleepEndBaseline"))
    sleep_midpoint_baseline = _time_of_day(pw_stats.get("sleepMidpointBaseline"))
    waso_baseline = _num(pw_stats.get("wasoBaseline"))
    total_sleep_time_baseline = _num(pw_stats.get("totalSleepTimeSecondsBaseline"))
    deep_sleep_baseline = _num(pw_stats.get("deepSleepSecondsBaseline"))

    hrv_7day_avg = _num(_avg7(score, "hrv"))
    resp_7day_avg = _num(_avg7(score, "respiratoryRate"))
    hr_7day_avg = _num(_avg7(score, "heartRate"))
    waso_7day_avg = _num(_avg7(score, "waso"))
    sleep_duration_7day_avg = _num(_avg7(score, "sleepDurationSeconds"))
    deep_7day_avg = _num(_avg7(score, "deep"))
    rem_7day_avg = _num(_avg7(score, "rem"))
    snore_7day_avg = _num(_avg7(score, "snoringDurationSeconds"))
    heavy_snore_7day_avg = _num(_avg7(score, "heavySnoringDurationSeconds"))

    tags_val = selected.get("tags")
    tags = tags_val if isinstance(tags_val, list) and tags_val else None

    if not any(v is not None for v in (start, presence, sleep, light, deep, rem, hrv, hr, resp)):
        raise EightSleepSchemaError(
            "Eight Sleep target-day record did not contain any recognized sleep/recovery fields."
        )
    source = ObservationSource(
        provider=PROVIDER,
        transport=TRANSPORT,
        origin_application=ORIGIN_APPLICATION,
        source_record_id=_source_id(selected, logical_date, start),
    )
    quality: dict[str, float | int | str | bool] = {"privateApi": True}
    if isinstance(selected.get("processing"), bool):
        quality["processing"] = selected["processing"]
    if isinstance(selected.get("incomplete"), bool):
        quality["incomplete"] = selected["incomplete"]
    observations: list[CanonicalHealthObservation] = []

    def add(
        metric: str, value: float | int | str | dict[str, Any] | None, unit: str | None
    ) -> None:
        if value is not None:
            observations.append(
                CanonicalHealthObservation(
                    metric=metric,
                    value=value,
                    unit=unit,
                    source=source,
                    observed_start=start,
                    observed_end=end,
                    logical_date=logical_date,
                    quality=dict(quality),
                )
            )

    add(METRIC_SLEEP_SESSION, "sleep", None)
    add(METRIC_SLEEP_DURATION_SECONDS, _whole(sleep), "s")
    add(METRIC_SLEEP_STAGE_LIGHT_SECONDS, _whole(light), "s")
    add(METRIC_SLEEP_STAGE_DEEP_SECONDS, _whole(deep), "s")
    add(METRIC_SLEEP_STAGE_REM_SECONDS, _whole(rem), "s")
    if presence is not None and sleep is not None:
        add(METRIC_SLEEP_STAGE_AWAKE_SECONDS, _whole(max(0.0, presence - sleep)), "s")
    add(METRIC_HRV_RMSSD_MS, hrv, "ms")
    add(METRIC_SLEEPING_HEART_RATE_BPM, hr, "bpm")
    if resp is not None:
        add(METRIC_SLEEP_RESPIRATION_SUMMARY, {"breathsPerMinute": resp}, "brpm")

    add(METRIC_SLEEP_WASO_SECONDS, _whole(waso), "s")
    add(METRIC_SLEEP_DEBT_SECONDS, _whole(sleep_debt), "s")
    add(METRIC_SLEEP_BASELINE_DURATION_SECONDS, _whole(sleep_baseline), "s")
    add(METRIC_SLEEP_LATENCY_ASLEEP_SECONDS, _whole(latency_asleep), "s")
    add(METRIC_SLEEP_LATENCY_OUT_SECONDS, _whole(latency_out), "s")
    add(METRIC_WAKEUP_TIME_CONSISTENCY, wakeup_consistency, "HH:MM:SS")
    add(METRIC_SLEEP_START_TIME_CONSISTENCY, sleep_start_consistency, "HH:MM:SS")
    add(METRIC_BEDTIME_CONSISTENCY, bedtime_consistency, "HH:MM:SS")
    add(METRIC_SNORE_DURATION_SECONDS, _whole(snore_sec), "s")
    add(METRIC_HEAVY_SNORE_DURATION_SECONDS, _whole(heavy_snore_sec), "s")
    add(METRIC_SNORE_PERCENT, _whole(snore_pct), "percent")
    add(METRIC_HEAVY_SNORE_PERCENT, _whole(heavy_snore_pct), "percent")
    add(METRIC_SNORE_MITIGATION_EVENTS_COUNT, _whole(mitigation_events), "count")
    add(METRIC_TOSS_AND_TURN_COUNT, _whole(tnt), "count")
    add(METRIC_SOCIAL_JETLAG_SECONDS, _whole(social_jetlag), "s")
    add(METRIC_CHRONOTYPE_CLASS, chronotype_class, None)

    add(METRIC_BEDTIME_BASELINE_TIME, bedtime_baseline, "HH:MM:SS")
    add(METRIC_SLEEP_START_BASELINE_TIME, sleep_start_baseline, "HH:MM:SS")
    add(METRIC_SLEEP_END_BASELINE_TIME, sleep_end_baseline, "HH:MM:SS")
    add(METRIC_SLEEP_MIDPOINT_BASELINE_TIME, sleep_midpoint_baseline, "HH:MM:SS")
    add(METRIC_WASO_BASELINE_SECONDS, _whole(waso_baseline), "s")
    add(METRIC_TOTAL_SLEEP_TIME_BASELINE_SECONDS, _whole(total_sleep_time_baseline), "s")
    add(METRIC_DEEP_SLEEP_BASELINE_SECONDS, _whole(deep_sleep_baseline), "s")

    add(METRIC_HRV_7DAY_AVG_MS, hrv_7day_avg, "ms")
    add(METRIC_SLEEP_RESPIRATION_RATE_7DAY_AVG_BRPM, resp_7day_avg, "brpm")
    add(METRIC_SLEEPING_HEART_RATE_7DAY_AVG_BPM, hr_7day_avg, "bpm")
    add(METRIC_SLEEP_WASO_7DAY_AVG_SECONDS, _whole(waso_7day_avg), "s")
    add(METRIC_SLEEP_DURATION_7DAY_AVG_SECONDS, _whole(sleep_duration_7day_avg), "s")
    add(METRIC_SLEEP_STAGE_DEEP_7DAY_AVG_SECONDS, _whole(deep_7day_avg), "s")
    add(METRIC_SLEEP_STAGE_REM_7DAY_AVG_SECONDS, _whole(rem_7day_avg), "s")
    add(METRIC_SNORE_DURATION_7DAY_AVG_SECONDS, _whole(snore_7day_avg), "s")
    add(METRIC_HEAVY_SNORE_DURATION_7DAY_AVG_SECONDS, _whole(heavy_snore_7day_avg), "s")

    if tags is not None:
        add(METRIC_SLEEP_TAGS, {"tags": tags}, None)

    return ObservationBatch(
        logical_date=logical_date,
        observations=observations,
        source_payload_hash=_hash(selected),
        normalizer_version=NORMALIZER_VERSION,
    )


def summarize_trends_shape(payload: Any) -> dict[str, Any]:
    days = _extract_days(payload)
    keys = (
        "presenceStart",
        "presenceDuration",
        "presenceDurationSeconds",
        "sleepDuration",
        "sleepDurationSeconds",
        "lightDuration",
        "lightDurationSeconds",
        "deepDuration",
        "deepDurationSeconds",
        "remDuration",
        "remDurationSeconds",
        "heartRate",
        "respiratoryRate",
        "sleepQualityScore",
        "processing",
    )
    return {
        "dayCount": len(days),
        "availableFields": sorted({k for d in days for k in keys if k in d}),
    }


def _extract_days(payload: Any) -> list[dict[str, Any]]:
    raw: list[Any]
    if isinstance(payload, list):
        raw = payload
    elif isinstance(payload, dict):
        found_list: Any = next(
            (payload[k] for k in ("days", "trends", "data") if isinstance(payload.get(k), list)),
            None,
        )
        if found_list is not None:
            raw = found_list
        elif any(
            k in payload
            for k in (
                "day",
                "date",
                "presenceStart",
                "sleepDuration",
                "sleepDurationSeconds",
                "sleepQualityScore",
            )
        ):
            raw = [payload]
        else:
            raw = []
    else:
        raise EightSleepSchemaError("Eight Sleep trends response must be an object or array.")
    days = [x for x in raw if isinstance(x, dict)]
    if raw and not days:
        raise EightSleepSchemaError("Eight Sleep trends response contains no object-shaped days.")
    return days


def _select_day(
    days: list[dict[str, Any]], logical_date: str, tz: ZoneInfo
) -> dict[str, Any] | None:
    for d in days:
        explicit = _first(d, "day", "date")
        if isinstance(explicit, str) and explicit[:10] == logical_date:
            return d
    for d in days:
        start = _dt(_first(d, "presenceStart", "presence_start"))
        presence = _num(
            _first(d, "presenceDurationSeconds", "presenceDuration", "presence_duration")
        )
        if (
            start
            and (start + timedelta(seconds=presence or 0)).astimezone(tz).date().isoformat()
            == logical_date
        ):
            return d
    return None


def _current(score: dict[str, Any], key: str) -> Any:
    value = score.get(key)
    return value.get("current") if isinstance(value, dict) else None


def _avg7(score: dict[str, Any], key: str) -> Any:
    value = score.get(key)
    return value.get("inclusive7DayAverage") if isinstance(value, dict) else None


def _first(mapping: dict[str, Any], *keys: str) -> Any:
    return next((mapping[k] for k in keys if mapping.get(k) is not None), None)


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _signed_num(value: Any) -> float | None:
    """Like _num but does not clamp negative values -- for fields that are legitimately
    bidirectional (sleepDebt can plausibly go negative on a surplus night; unlike duration/
    count fields, there's no physical reason to reject a negative reading here)."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _whole(value: float | None) -> float | int | None:
    return int(value) if value is not None and value.is_integer() else value


def _str(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


_TIME_OF_DAY_RE_LEN = 8  # "HH:MM:SS"


def _time_of_day(value: Any) -> str | None:
    """Validate the HH:MM:SS shape confirmed against a real response (2026-08-28) before
    trusting it as a time-of-day value -- reject anything that doesn't match rather than
    passing an unexpected shape through as if it were one."""
    if not isinstance(value, str) or len(value) != _TIME_OF_DAY_RE_LEN:
        return None
    parts = value.split(":")
    if len(parts) != 3 or not all(p.isdigit() and len(p) == 2 for p in parts):
        return None
    hh, mm, ss = (int(p) for p in parts)
    if not (0 <= hh < 24 and 0 <= mm < 60 and 0 <= ss < 60):
        return None
    return value


def _dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        raise EightSleepSchemaError(
            "Eight Sleep presenceStart is timezone-naive; refusing ambiguous date attribution."
        )
    return parsed


def _source_id(day: dict[str, Any], logical_date: str, start: datetime | None) -> str:
    for key in ("id", "sessionId", "sleepSessionId", "recordId"):
        if day.get(key) is not None and str(day[key]).strip():
            return str(day[key])
    return f"{logical_date}:{start.isoformat()}" if start else logical_date


def _hash(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()
