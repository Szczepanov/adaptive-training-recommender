"""Map Eight Sleep trend payloads into ADR-0027 source-aware observations."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from garmin_sync.canonical import (
    METRIC_HRV_RMSSD_MS,
    METRIC_SLEEP_DURATION_SECONDS,
    METRIC_SLEEP_RESPIRATION_SUMMARY,
    METRIC_SLEEP_SESSION,
    METRIC_SLEEP_STAGE_AWAKE_SECONDS,
    METRIC_SLEEP_STAGE_DEEP_SECONDS,
    METRIC_SLEEP_STAGE_LIGHT_SECONDS,
    METRIC_SLEEP_STAGE_REM_SECONDS,
    METRIC_SLEEPING_HEART_RATE_BPM,
    CanonicalHealthObservation,
    ObservationBatch,
    ObservationSource,
)
from garmin_sync.eight_sleep_client import EightSleepSchemaError

PROVIDER = "eight_sleep"
TRANSPORT = "eight_sleep_direct"
ORIGIN_APPLICATION = "eight_sleep_private_api"
NORMALIZER_VERSION = 1


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
    start = _dt(_first(selected, "presenceStart", "presence_start"))
    presence = _num(
        _first(selected, "presenceDurationSeconds", "presenceDuration", "presence_duration")
    )
    sleep = _num(_first(selected, "sleepDurationSeconds", "sleepDuration", "sleep_duration"))
    light = _num(_first(selected, "lightDurationSeconds", "lightDuration", "light_duration"))
    deep = _num(_first(selected, "deepDurationSeconds", "deepDuration", "deep_duration"))
    rem = _num(_first(selected, "remDurationSeconds", "remDuration", "rem_duration"))
    end = start + timedelta(seconds=presence) if start and presence is not None else None
    quality_score = selected.get("sleepQualityScore")
    score = quality_score if isinstance(quality_score, dict) else {}
    hrv = _num(_current(score, "hrv"))
    hr = _num(_first(selected, "heartRate", "heart_rate") or _current(score, "heartRate"))
    resp = _num(
        _first(selected, "respiratoryRate", "respiratory_rate")
        or _current(score, "respiratoryRate")
    )
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


def _whole(value: float | None) -> float | int | None:
    return int(value) if value is not None and value.is_integer() else value


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
