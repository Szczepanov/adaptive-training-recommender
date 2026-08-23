"""The Garmin-specific WearableProvider adapter. This is the only module in the
codebase allowed to know Garmin Connect response shapes (dailySleepDTO, sleepScores,
hrvSummary, activityType, etc.) -- everything downstream (mapper.py, service.py, the
recommendation engine) operates on canonical.py types only."""

import logging
import math
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

from .canonical import (
    CanonicalActivity,
    CanonicalActivityDetail,
    CanonicalBodyBattery,
    CanonicalDailyMetrics,
    CanonicalExerciseSet,
    CanonicalGearItem,
    CanonicalHeartRateZones,
    CanonicalLapSummary,
    CanonicalPerformanceTargets,
    CanonicalRacePredictions,
    CanonicalRunningDynamics,
    CanonicalSpo2,
    CanonicalStress,
    CanonicalTrainingReadiness,
    CanonicalTrainingStatus,
    CanonicalZoneBucket,
)
from .dates import get_date_string, local_today, n_days_ago
from .garmin_client import GarminClientWrapper
from .metrics import classify_activity_intensity
from .provider import (
    ProviderActivitiesResult,
    ProviderActivityDetailResult,
    ProviderCapabilities,
    ProviderFetchResult,
    ProviderGearResult,
    ProviderPerformanceTargetsResult,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

_POWER_ACTIVITY_TYPES = {
    "cycling",
    "cyclocross",
    "gravel_cycling",
    "indoor_cycling",
    "mountain_biking",
    "road_biking",
    "virtual_ride",
}
_STRENGTH_ACTIVITY_TYPES = {"strength_training", "fitness_equipment"}


def _activity_type_key(act: dict[str, Any]) -> str:
    """Extract Garmin's activity type without trusting the nested response shape."""
    raw_activity_type = act.get("activityType")
    if not isinstance(raw_activity_type, dict):
        return "unknown"
    raw_type_key = raw_activity_type.get("typeKey")
    if not isinstance(raw_type_key, str) or not raw_type_key.strip():
        return "unknown"
    return raw_type_key.strip()


def _is_running_activity_type(activity_type: str) -> bool:
    """Return whether a Garmin type key represents a running activity family."""
    normalized = activity_type.strip().lower()
    return (
        normalized in {"run", "running"}
        or normalized.endswith("_run")
        or normalized.endswith("_running")
    )


def _optional_non_negative_int(value: Any) -> int | None:
    """Accept Garmin count/duration fields only when they are real non-negative ints."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def extract_sleep_metrics(
    sleep_obj: dict[str, Any] | None,
) -> tuple[
    int | float | None,
    int | None,
    float | None,
    int | None,
    int | None,
    int | None,
    int | None,
    int | None,
]:
    """Extract (sleep_score, sleep_sec, avg_resp, deep_sec, rem_sec, light_sec, awake_sec, restless_count)
    from a raw Garmin sleep response.
    Handles both known Garmin response shapes (nested dailySleepDTO.sleepScores.overall
    and top-level overallSleepScore), and tolerates stage/restlessness fields appearing
    either in dailySleepDTO or at the response root."""
    if not sleep_obj:
        return None, None, None, None, None, None, None, None

    raw_daily_sleep = sleep_obj.get("dailySleepDTO")
    daily_sleep = raw_daily_sleep if isinstance(raw_daily_sleep, dict) else {}
    raw_scores = daily_sleep.get("sleepScores") or sleep_obj.get("overallSleepScore")
    scores = raw_scores if isinstance(raw_scores, dict) else {}

    sleep_score = (
        scores.get("overall", {}).get("value")
        if isinstance(scores.get("overall"), dict)
        else scores.get("value")
    )
    if sleep_score is None and isinstance(daily_sleep.get("sleepQualityScore"), (int, float)):
        sleep_score = daily_sleep.get("sleepQualityScore")

    sleep_sec = daily_sleep.get("sleepTimeSeconds") or sleep_obj.get("totalSleepSeconds")
    avg_resp = daily_sleep.get("averageRespirationValue") or sleep_obj.get(
        "averageRespirationValue"
    )

    def sleep_int(field: str) -> int | None:
        nested = _optional_non_negative_int(daily_sleep.get(field))
        return nested if nested is not None else _optional_non_negative_int(sleep_obj.get(field))

    deep_sec = sleep_int("deepSleepSeconds")
    rem_sec = sleep_int("remSleepSeconds")
    light_sec = sleep_int("lightSleepSeconds")
    awake_sec = sleep_int("awakeSleepSeconds")
    restless_count = sleep_int("restlessMomentsCount")

    return (
        sleep_score,
        sleep_sec,
        avg_resp,
        deep_sec,
        rem_sec,
        light_sec,
        awake_sec,
        restless_count,
    )


def _sleep_window_gmt_ms(
    sleep_obj: dict[str, Any] | None,
) -> tuple[int | float | None, int | float | None]:
    """(sleepStartTimestampGMT, sleepEndTimestampGMT) in epoch ms from a raw Garmin
    sleep response, or (None, None) if absent/malformed."""
    if not sleep_obj:
        return None, None
    daily_sleep = sleep_obj.get("dailySleepDTO", {}) or {}
    start = daily_sleep.get("sleepStartTimestampGMT")
    end = daily_sleep.get("sleepEndTimestampGMT")
    return (
        start if isinstance(start, (int, float)) else None,
        end if isinstance(end, (int, float)) else None,
    )


# A cluster of readings from only part of the night (e.g. a sync gap, or the device
# coming back online well after sleep onset) can clear the sample-count floor below
# without describing the whole night -- so both this count and a minimum span of the
# sleep window (MIN_COVERAGE_RATIO) are required before trusting the interval average.
_MIN_RESPIRATION_SAMPLES = 30
_MIN_RESPIRATION_COVERAGE_RATIO = 0.5


def average_sleep_respiration_from_intervals(
    respiration_data: Any,
    sleep_start_gmt_ms: int | float | None,
    sleep_end_gmt_ms: int | float | None,
) -> float | None:
    """Average the full-resolution per-~2-minute respiration readings
    (`respirationValuesArray`, from the dedicated `get_respiration_data` endpoint)
    restricted to the night's actual sleep window, instead of trusting
    `dailySleepDTO.averageRespirationValue` -- a single value that in observed exports
    is often reported at whole-breath granularity. Averaging ~150-300 raw interval
    readings ourselves describes the exact same "respiration rate during sleep" signal
    at materially finer granularity, without changing what the metric means (see
    ADR-0024's discussion of respiration's undocumented measurement resolution).

    `respiration_data` is untrusted (an enrichment fetch result or an archived
    payload, either of which can carry an arbitrary shape), so it's typed `Any` and
    checked rather than assumed to be a dict.

    Returns None (never raises) on any missing/malformed input -- including too few
    in-window samples, or samples too clustered to represent the whole sleep window --
    so callers fall back to the sleep DTO's own average. Same defensive-extraction
    policy as the rest of this module."""
    if (
        not isinstance(respiration_data, dict)
        or sleep_start_gmt_ms is None
        or sleep_end_gmt_ms is None
    ):
        return None
    sleep_duration_ms = sleep_end_gmt_ms - sleep_start_gmt_ms
    if sleep_duration_ms <= 0:
        return None
    samples = respiration_data.get("respirationValuesArray")
    if not isinstance(samples, list):
        return None

    readings: list[tuple[int | float, float]] = []
    for entry in samples:
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            continue
        ts, value = entry
        if not isinstance(ts, (int, float)) or not isinstance(value, (int, float)):
            continue
        # Garmin uses <= 0 in this array as a "no reading" sentinel, not a real rate.
        if value <= 0:
            continue
        if sleep_start_gmt_ms <= ts <= sleep_end_gmt_ms:
            readings.append((ts, float(value)))

    if len(readings) < _MIN_RESPIRATION_SAMPLES:
        return None

    timestamps = [ts for ts, _ in readings]
    span_ms = max(timestamps) - min(timestamps)
    if span_ms < _MIN_RESPIRATION_COVERAGE_RATIO * sleep_duration_ms:
        return None

    values = [value for _, value in readings]
    return round(sum(values) / len(values), 1)


def _canonicalize_stress(stress_today: dict[str, Any] | None) -> CanonicalStress | None:
    if not stress_today:
        return None
    return CanonicalStress(
        avg=stress_today.get("avgStressLevel"), max=stress_today.get("maxStressLevel")
    )


def _canonicalize_body_battery(
    body_battery_today: list[dict[str, Any]] | None,
) -> CanonicalBodyBattery | None:
    """get_body_battery(date, date) returns a list (one entry per requested day)."""
    if not body_battery_today:
        return None
    entry = body_battery_today[0]
    charged = entry.get("charged")
    drained = entry.get("drained")
    change = charged - drained if charged is not None and drained is not None else None
    return CanonicalBodyBattery(charged=charged, drained=drained, change=change)


def _latest_training_readiness_entry(readings: Any) -> dict[str, Any] | None:
    """Return Garmin's newest training-readiness reading, defensively.

    The observed endpoint order is newest-first.  Some garminconnect versions/devices
    have returned a single object instead of a list, so accept both shapes while keeping
    this Garmin-specific variance inside the provider boundary.
    """
    if isinstance(readings, dict):
        return readings
    if not isinstance(readings, list):
        return None
    return next((entry for entry in readings if isinstance(entry, dict)), None)


def _canonicalize_training_readiness(
    readings: list[dict[str, Any]] | None,
) -> CanonicalTrainingReadiness | None:
    """get_training_readiness(date) returns multiple intraday readings (the device
    re-evaluates through the day); the newest reading is used as the day's
    representative value."""
    latest = _latest_training_readiness_entry(readings)
    if latest is None:
        return None
    return CanonicalTrainingReadiness(
        score=latest.get("score"),
        level=latest.get("level"),
        feedback=latest.get("feedbackLong"),
    )


def _canonicalize_training_status(
    training_status_today: dict[str, Any] | None,
) -> CanonicalTrainingStatus | None:
    """Deeply nested and device-ID-keyed -- every level extracted defensively, since a
    missing device/metric must degrade to None fields, never a KeyError."""
    if not training_status_today:
        return None

    status_data = (training_status_today.get("mostRecentTrainingStatus") or {}).get(
        "latestTrainingStatusData"
    ) or {}
    device_status: dict[str, Any] = next(iter(status_data.values()), {}) if status_data else {}
    acute_load_dto = device_status.get("acuteTrainingLoadDTO") or {}

    vo2max = training_status_today.get("mostRecentVO2Max") or {}
    generic_vo2max = vo2max.get("generic") or {}
    cycling_vo2max = vo2max.get("cycling") or {}

    return CanonicalTrainingStatus(
        status_phrase=device_status.get("trainingStatusFeedbackPhrase"),
        acute_training_load=acute_load_dto.get("dailyTrainingLoadAcute"),
        acwr_status=acute_load_dto.get("acwrStatus"),
        vo2max_running=generic_vo2max.get("vo2MaxValue"),
        vo2max_running_date=generic_vo2max.get("calendarDate"),
        vo2max_cycling=cycling_vo2max.get("vo2MaxValue"),
        vo2max_cycling_date=cycling_vo2max.get("calendarDate"),
    )


def _canonicalize_heart_rate_zones(
    zones_list: list[dict[str, Any]] | None,
) -> CanonicalHeartRateZones | None:
    """get_heart_rate_zones() returns one entry per sport profile (DEFAULT, RUNNING,
    CYCLING, ...); DEFAULT is used as the single representative value -- extracted
    defensively (never assume the shape/type Garmin actually returned), matching
    _canonicalize_training_status's degrade-to-None-fields precedent."""
    if not isinstance(zones_list, list) or not zones_list:
        return None

    default_entry = next(
        (z for z in zones_list if isinstance(z, dict) and z.get("sport") == "DEFAULT"), None
    )
    entry = default_entry or (zones_list[0] if isinstance(zones_list[0], dict) else None)
    if entry is None:
        return None

    return CanonicalHeartRateZones(
        resting_hr_used=entry.get("restingHeartRateUsed"),
        max_hr_used=entry.get("maxHeartRateUsed"),
        zone4_floor=entry.get("zone4Floor"),
        sport=entry.get("sport"),
    )


def _first_positive_number(value: Any) -> float | None:
    """Return a finite positive numeric value without accepting booleans or strings."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    return numeric if math.isfinite(numeric) and numeric > 0 else None


def _non_negative_number(value: Any) -> float | None:
    """Return a finite non-negative number without coercing strings or booleans."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    return numeric if math.isfinite(numeric) and numeric >= 0 else None


def _spo2_percentage(value: Any) -> float | None:
    """Return a physiologically valid Garmin SpO2 percentage without coercion."""
    numeric = _non_negative_number(value)
    return numeric if numeric is not None and 0 < numeric <= 100 else None


def _recovery_time_hours_from_minutes(
    value: Any,
    *,
    change_phrase: Any = None,
) -> int | None:
    """Convert Garmin ``recoveryTime`` minutes to canonical integer hours.

    Garmin's training-readiness/activity recoveryTime is a minute count.  Never infer
    units from magnitude: a valid 90-minute recommendation must not become 90 hours.
    Garmin can also retain the last assigned numeric recovery time after the countdown
    reaches zero; ``REACHED_ZERO`` is therefore authoritative for the daily reading.
    """
    if change_phrase == "REACHED_ZERO":
        return 0
    minutes = _non_negative_number(value)
    return round(minutes / 60) if minutes is not None else None


def _daily_recovery_time_hours(
    training_readiness_today: list[dict[str, Any]] | None,
    stats_today: dict[str, Any],
) -> int | None:
    """Extract current recovery advice, preferring the training-readiness endpoint.

    Live Garmin recoveryTime is supplied by training readiness and is measured in
    minutes.  ``recoveryTimeHours`` in stats is retained only as an explicit legacy
    archive/fixture fallback; the historical ambiguous ``stats.recoveryTime`` fallback
    remains for backward compatibility with snapshots created by this feature branch.
    """
    latest = _latest_training_readiness_entry(training_readiness_today)
    if latest is not None:
        recovery_hours = _recovery_time_hours_from_minutes(
            latest.get("recoveryTime"),
            change_phrase=latest.get("recoveryTimeChangePhrase"),
        )
        if recovery_hours is not None:
            return recovery_hours

    explicit_hours = _non_negative_number(stats_today.get("recoveryTimeHours"))
    if explicit_hours is not None:
        return round(explicit_hours)

    # Compatibility with early archived fixtures from this branch.  Real live Garmin
    # values are sourced above from training readiness, so this magnitude-based branch
    # must never decide the units of a live recoveryTime value.
    legacy_recovery = _non_negative_number(stats_today.get("recoveryTime"))
    if legacy_recovery is not None:
        return round(legacy_recovery / 60) if legacy_recovery > 100 else round(legacy_recovery)
    return None


def _positive_integer(value: Any) -> int | None:
    numeric = _non_negative_number(value)
    if numeric is None or numeric < 1 or not numeric.is_integer():
        return None
    return int(numeric)


def qualifies_for_activity_detail(activity: CanonicalActivity) -> bool:
    """Accepted D-DETAIL-GATE predicate for the opt-in power-detail fetch.

    At three endpoints per qualifying activity, the worst-case incremental request
    budget is ``3 * N`` for that run. Strength sets are deliberately handled by the
    separate one-endpoint predicate below so enabling their auto-sync does not silently
    turn on the more expensive cycling telemetry path.
    """
    return (
        activity.activity_id is not None
        and activity.type.lower() in _POWER_ACTIVITY_TYPES
        and activity.intensity_tag != "easy"
    )


def qualifies_for_strength_exercise_sets(activity: CanonicalActivity) -> bool:
    """Return whether Garmin can expose per-set strength data for this activity.

    Live Garmin observations and other consumers of the same endpoint confirm both
    ``strength_training`` and ``fitness_equipment`` can carry ``exerciseSets``. Unlike
    power detail, intensity is irrelevant: an easy strength session still has useful
    reps/set structure and costs just one extra endpoint call.
    """
    return activity.activity_id is not None and activity.type.lower() in _STRENGTH_ACTIVITY_TYPES


def _parse_records(raw_items: list[Any], build: Callable[[dict[str, Any]], T | None]) -> list[T]:
    """Shared per-item extraction loop: skip non-dict entries and entries `build` rejects
    (returns None for), keep everything else. Both zone buckets and laps degrade the same
    way -- a malformed individual entry is dropped, never a raised exception."""
    records: list[T] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        record = build(raw_item)
        if record is not None:
            records.append(record)
    return records


def _build_zone_bucket(raw_bucket: dict[str, Any]) -> CanonicalZoneBucket | None:
    zone_number = _positive_integer(raw_bucket.get("zoneNumber"))
    seconds = _non_negative_number(raw_bucket.get("secsInZone"))
    # Garmin's power (7-zone Coggan) and HR (5-zone) models never exceed zone 7; this
    # mirrors the upper bound `extractPowerZoneFeatures` enforces in
    # app/src/engine/garminTelemetryEvidence.ts so the persisted record and the
    # evidence-extraction layer agree on what a valid zone bucket is.
    if zone_number is None or zone_number > 7 or seconds is None:
        return None
    return CanonicalZoneBucket(
        zone_number=zone_number,
        seconds_in_zone=seconds,
        low_boundary=_non_negative_number(raw_bucket.get("zoneLowBoundary")),
    )


def _build_lap_summary(raw_lap: dict[str, Any]) -> CanonicalLapSummary | None:
    lap_index = _positive_integer(raw_lap.get("lapIndex"))
    duration = _non_negative_number(raw_lap.get("duration"))
    if lap_index is None or duration is None:
        return None
    return CanonicalLapSummary(
        lap_index=lap_index,
        duration_seconds=duration,
        average_power_watts=_non_negative_number(raw_lap.get("averagePower")),
        average_hr_bpm=_non_negative_number(raw_lap.get("averageHR")),
    )


def _canonicalize_zone_buckets(payload: Any) -> list[CanonicalZoneBucket] | None:
    if not isinstance(payload, list):
        return None
    return _parse_records(payload, _build_zone_bucket)


def _canonicalize_laps(payload: Any) -> list[CanonicalLapSummary] | None:
    if not isinstance(payload, dict):
        return None
    raw_laps = payload.get("lapDTOs")
    if not isinstance(raw_laps, list):
        return None
    return _parse_records(raw_laps, _build_lap_summary)


def _exercise_candidate_identity(item: dict[str, Any]) -> tuple[str | None, str | None]:
    """Extract a conservative Garmin exercise guess from an exercise-set row.

    Garmin's ``exercises`` array is an ML classification, not ground truth. Only a
    non-UNKNOWN candidate at >=50% confidence is surfaced, and a tie with the runner-up
    is treated as ambiguous. Payloads that already provide explicit flat
    ``exerciseCategory`` / ``exerciseName`` fields keep those values unchanged.
    """
    explicit_category = item.get("exerciseCategory")
    category = (
        explicit_category.strip()
        if isinstance(explicit_category, str) and explicit_category.strip()
        else None
    )
    explicit_name = item.get("exerciseName")
    name = (
        explicit_name.strip() if isinstance(explicit_name, str) and explicit_name.strip() else None
    )
    if category is not None or name is not None:
        return category, name

    raw_candidates = item.get("exercises")
    if not isinstance(raw_candidates, list):
        return None, None

    candidates: list[tuple[float | None, str | None, str | None]] = []
    for raw_candidate in raw_candidates:
        if not isinstance(raw_candidate, dict):
            continue
        raw_category = raw_candidate.get("category")
        candidate_category = (
            raw_category.strip() if isinstance(raw_category, str) and raw_category.strip() else None
        )
        if candidate_category == "UNKNOWN":
            continue
        raw_name = raw_candidate.get("name")
        candidate_name = (
            raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None
        )
        if candidate_category is None and candidate_name is None:
            continue

        confidence = _non_negative_number(raw_candidate.get("probability"))
        if confidence is not None and confidence <= 1.0:
            confidence *= 100.0
        if confidence is not None and confidence < 50.0:
            continue
        candidates.append((confidence, candidate_category, candidate_name))

    if not candidates:
        return None, None

    # Known probabilities sort first. A single unscored candidate is still useful, but
    # an unscored multi-candidate payload is ambiguous and therefore deliberately blank.
    candidates.sort(
        key=lambda candidate: candidate[0] if candidate[0] is not None else -1.0, reverse=True
    )
    top = candidates[0]
    if len(candidates) > 1:
        runner_up = candidates[1]
        if top[0] is None or runner_up[0] is None:
            return None, None
        if top[0] - runner_up[0] <= 0.01:
            return None, None
    return top[1], top[2]


def _set_duration(item: dict[str, Any], primary: str, fallback: str) -> float | None:
    value = item.get(primary)
    if value is None:
        value = item.get(fallback)
    return _non_negative_number(value)


def extract_exercise_sets(raw_sets: Any) -> list[CanonicalExerciseSet] | None:
    """Extract work sets/reps from Garmin's real interleaved ``exerciseSets`` shape.

    Garmin emits ACTIVE/WARM_UP/etc. rows interleaved with REST rows. The REST row's
    duration belongs to the preceding work set, so standalone REST rows are folded into
    ``rest_duration_seconds`` instead of becoming fake numbered exercises. Raw Garmin
    ``weight`` is grams; an explicit ``weightKg`` key is accepted only as a normalized
    compatibility shape. A valid empty ``exerciseSets`` list is preserved as ``[]`` so
    callers can distinguish "Garmin now reports no sets" from "detail was unavailable".
    """
    if isinstance(raw_sets, dict):
        sets_list = raw_sets.get("exerciseSets")
    elif isinstance(raw_sets, list):
        sets_list = raw_sets
    else:
        return None

    if not isinstance(sets_list, list):
        return None
    if not sets_list:
        return []

    results: list[CanonicalExerciseSet] = []
    for item in sets_list:
        if not isinstance(item, dict):
            continue

        raw_set_type = item.get("setType")
        set_type = str(raw_set_type).lower() if raw_set_type is not None else "active"
        duration = _set_duration(item, "duration", "durationSeconds")

        if set_type == "rest":
            rest_duration = duration
            if rest_duration is None:
                rest_duration = _set_duration(item, "restDuration", "restDurationSeconds")
            if results and rest_duration is not None:
                results[-1].rest_duration_seconds = rest_duration
            continue

        raw_set_order = item.get("setOrder")
        set_order = (
            raw_set_order
            if isinstance(raw_set_order, int) and not isinstance(raw_set_order, bool)
            else len(results)
        )

        raw_reps = item.get("repetitionCount")
        if raw_reps is None:
            raw_reps = item.get("reps")
        reps = _positive_integer(raw_reps)

        # The live Garmin endpoint's `weight` field is grams. Keep support for the PR's
        # earlier flat test/normalized shape only when it is unmistakably packed (a
        # same-row rest duration); real Garmin payloads represent rest as separate rows.
        raw_weight_kg = _first_positive_number(item.get("weightKg"))
        raw_weight_grams = _first_positive_number(item.get("weight"))
        legacy_packed_shape = (
            item.get("restDuration") is not None or item.get("restDurationSeconds") is not None
        )
        if raw_weight_kg is not None:
            weight_kg = round(raw_weight_kg, 2)
        elif raw_weight_grams is not None:
            if legacy_packed_shape and raw_weight_grams <= 500.0:
                weight_kg = round(raw_weight_grams, 2)
            else:
                weight_kg = round(raw_weight_grams / 1000.0, 2)
        else:
            weight_kg = None

        category, name = _exercise_candidate_identity(item)
        rest_duration = _set_duration(item, "restDuration", "restDurationSeconds")

        results.append(
            CanonicalExerciseSet(
                set_order=set_order,
                set_type=set_type,
                repetition_count=reps,
                weight_kg=weight_kg,
                exercise_category=category,
                exercise_name=name,
                duration_seconds=duration,
                rest_duration_seconds=rest_duration,
            )
        )

    return results if results else None


def canonicalize_activity_detail(
    activity_id: str,
    activity_summary: Any,
    power_zones: Any,
    hr_zones: Any,
    splits: Any,
    exercise_sets: Any = None,
) -> CanonicalActivityDetail:
    """Normalize additive per-activity telemetry without inventing missing values."""
    summary = activity_summary if isinstance(activity_summary, dict) else {}
    normalized_power = _non_negative_number(summary.get("normPower"))
    average_power = _non_negative_number(summary.get("avgPower"))
    intensity_factor = _non_negative_number(summary.get("intensityFactor"))
    variability_index = (
        normalized_power / average_power
        if normalized_power is not None and average_power is not None and average_power > 0
        else None
    )
    return CanonicalActivityDetail(
        activity_id=activity_id,
        power_zones=_canonicalize_zone_buckets(power_zones),
        hr_zones=_canonicalize_zone_buckets(hr_zones),
        normalized_power_watts=normalized_power,
        intensity_factor=intensity_factor,
        variability_index=variability_index,
        laps=_canonicalize_laps(splits),
        exercise_sets=extract_exercise_sets(exercise_sets),
    )


def _first_mapping(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, list):
        return next((entry for entry in payload if isinstance(entry, dict)), {})
    return {}


def extract_race_predictions(payload: Any) -> CanonicalRacePredictions | None:
    """Extract Garmin 5K/10K/half/full predictions, rejecting malformed numbers."""
    if not isinstance(payload, dict) or not payload:
        return None

    five_k: int | None = None
    ten_k: int | None = None
    half: int | None = None
    full: int | None = None

    items = payload.get("timePredictions") or payload.get("racePredictionDtoList")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            distance = _first_positive_number(item.get("distance"))
            predicted_time = next(
                (
                    value
                    for key in ("time", "predictedTime", "timeSeconds")
                    if (value := _first_positive_number(item.get(key))) is not None
                ),
                None,
            )
            if distance is None or predicted_time is None:
                continue
            seconds = round(predicted_time)
            if 4800 <= distance <= 5200:
                five_k = seconds
            elif 9800 <= distance <= 10200:
                ten_k = seconds
            elif 20500 <= distance <= 21500:
                half = seconds
            elif 41500 <= distance <= 43000:
                full = seconds
    else:
        # The current Garmin Connect latest endpoint exposes keys such as time5K,
        # time10K, timeHalfMarathon and timeMarathon. Keep tolerant aliases for the
        # previously observed keyed variants without coercing strings/bools/non-finite
        # values into plausible-looking predictions.
        for key, raw_value in payload.items():
            value = _first_positive_number(raw_value)
            if value is None:
                continue
            key_lower = str(key).lower()
            if "5k" in key_lower or key_lower == "5000":
                five_k = round(value)
            elif "10k" in key_lower or key_lower == "10000":
                ten_k = round(value)
            elif "half" in key_lower or "21k" in key_lower:
                half = round(value)
            elif "marathon" in key_lower or "42k" in key_lower:
                full = round(value)

    if not any(value is not None for value in (five_k, ten_k, half, full)):
        return None
    return CanonicalRacePredictions(
        five_km_sec=five_k,
        ten_km_sec=ten_k,
        half_marathon_sec=half,
        marathon_sec=full,
    )


def _body_composition_measured_at(entry: dict[str, Any]) -> str | None:
    calendar_date = entry.get("calendarDate")
    if isinstance(calendar_date, str) and len(calendar_date) >= 10:
        return calendar_date[:10]

    for key in ("timestampGMT", "date"):
        raw_timestamp = _first_positive_number(entry.get(key))
        if raw_timestamp is None:
            continue
        seconds = raw_timestamp / 1000.0 if raw_timestamp > 10_000_000_000 else raw_timestamp
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            continue
    return None


def _body_composition_sort_key(entry: dict[str, Any]) -> tuple[str, float]:
    measured_at = _body_composition_measured_at(entry) or ""
    timestamp = next(
        (
            numeric
            for key in ("timestampGMT", "date")
            if (numeric := _first_positive_number(entry.get(key))) is not None
        ),
        -1.0,
    )
    return measured_at, timestamp


def extract_body_composition(
    body_comp_data: dict[str, Any] | list[dict[str, Any]] | None,
    *,
    allow_total_average: bool = True,
) -> tuple[float | None, float | None, str | None]:
    """Extract (weight_kg, body_fat_pct, measured_at) from Garmin weight payloads.

    Individual weigh-ins are selected by their observation date/timestamp instead of
    assuming Garmin's list order. ``totalAverage`` is allowed for a single-day snapshot
    fallback, but callers that need the athlete's current profile weight should disable
    it because a multi-day dateRange average is not a latest measurement.
    """
    if not body_comp_data:
        return None, None, None

    entry: dict[str, Any] = {}
    if isinstance(body_comp_data, list):
        entries = [candidate for candidate in body_comp_data if isinstance(candidate, dict)]
        if entries:
            entry = max(entries, key=_body_composition_sort_key)
    elif isinstance(body_comp_data, dict):
        date_list = body_comp_data.get("dateWeightList")
        if isinstance(date_list, list) and date_list:
            entries = [candidate for candidate in date_list if isinstance(candidate, dict)]
            if entries:
                entry = max(entries, key=_body_composition_sort_key)
        elif allow_total_average and isinstance(body_comp_data.get("totalAverage"), dict):
            entry = body_comp_data["totalAverage"]
        elif any(
            key in body_comp_data
            for key in ("weight", "weightKg", "weight_kg", "bodyFat", "bodyFatPercentage")
        ):
            entry = body_comp_data

    if not entry:
        return None, None, None

    raw_weight = next(
        (
            numeric
            for key in ("weight", "weightKg", "weight_kg")
            if (numeric := _first_positive_number(entry.get(key))) is not None
        ),
        None,
    )
    weight_kg: float | None = None
    if raw_weight is not None:
        if raw_weight > 1000.0:
            weight_kg = round(raw_weight / 1000.0, 2)
        elif 20.0 <= raw_weight <= 350.0:
            weight_kg = round(raw_weight, 2)

    raw_fat = next(
        (
            numeric
            for key in ("bodyFat", "bodyFatPercentage", "bodyFatPercent", "body_fat_pct")
            if (numeric := _non_negative_number(entry.get(key))) is not None
        ),
        None,
    )
    body_fat_pct = round(raw_fat, 1) if raw_fat is not None and raw_fat <= 70.0 else None
    measured_at = _body_composition_measured_at(entry)

    return weight_kg, body_fat_pct, measured_at


def canonicalize_performance_targets(
    cycling_ftp: dict[str, Any] | list[dict[str, Any]] | None,
    lactate_threshold: dict[str, Any] | None,
    heart_rate_zones: list[dict[str, Any]] | None,
    body_composition: dict[str, Any] | list[dict[str, Any]] | None = None,
    race_predictions: dict[str, Any] | None = None,
) -> CanonicalPerformanceTargets:
    """Normalize Garmin's current FTP/running-lactate-threshold endpoints.

    Garmin's unofficial responses have varied between direct values and small wrapper
    objects, so extraction accepts the documented current keys plus known simple
    variants.  Missing or malformed values remain absent; no activity-derived estimate
    is substituted.
    """
    ftp_data = _first_mapping(cycling_ftp)
    ftp = next(
        (
            _first_positive_number(ftp_data.get(key))
            for key in (
                "functionalThresholdPower",
                "ftp",
                "value",
                "power",
            )
            if _first_positive_number(ftp_data.get(key)) is not None
        ),
        None,
    )

    threshold_root = lactate_threshold if isinstance(lactate_threshold, dict) else {}
    threshold_data = _first_mapping(threshold_root.get("speed_and_heart_rate"))
    threshold_pace_sec_per_metre = _first_positive_number(threshold_data.get("speed"))
    # Despite the endpoint field name, Garmin's latestLactateThreshold value is pace
    # in seconds per metre (e.g. 0.31666 = 5:16.7/km), not metres per second.  This is
    # confirmed against Garmin Connect's displayed threshold pace; treating it as m/s
    # would produce a 52:38/km value and reject the real target as implausible.
    pace = (
        int(1000 * threshold_pace_sec_per_metre)
        if threshold_pace_sec_per_metre is not None
        and 75 <= 1000 * threshold_pace_sec_per_metre <= 1200
        else None
    )
    lthr = _first_positive_number(threshold_data.get("heartRate"))

    if lthr is None and isinstance(heart_rate_zones, list):
        running = next(
            (
                zone
                for zone in heart_rate_zones
                if isinstance(zone, dict) and zone.get("sport") == "RUNNING"
            ),
            None,
        )
        default = next(
            (
                zone
                for zone in heart_rate_zones
                if isinstance(zone, dict) and zone.get("sport") == "DEFAULT"
            ),
            None,
        )
        fallback = running or default
        if fallback:
            lthr = _first_positive_number(fallback.get("lactateThresholdHeartRateUsed"))

    weight_kg, body_fat_pct, weight_measured_at = extract_body_composition(
        body_composition, allow_total_average=False
    )

    return CanonicalPerformanceTargets(
        cycling_ftp_watts=round(ftp) if ftp is not None else None,
        running_threshold_pace_sec_per_km=pace,
        running_lthr_bpm=round(lthr) if lthr is not None else None,
        weight_kg=weight_kg,
        body_fat_pct=body_fat_pct,
        race_predictions=extract_race_predictions(race_predictions),
        ftp_measured_at=ftp_data.get("calendarDate")
        if isinstance(ftp_data.get("calendarDate"), str)
        else None,
        threshold_measured_at=threshold_data.get("calendarDate")
        if isinstance(threshold_data.get("calendarDate"), str)
        else None,
        lthr_measured_at=threshold_data.get("calendarDate")
        if isinstance(threshold_data.get("calendarDate"), str)
        else None,
        weight_measured_at=weight_measured_at,
    )


def extract_spo2(spo2_payload: Any, sleep_payload: Any = None) -> CanonicalSpo2 | None:
    """Extract source-faithful SpO2 metrics from Garmin.

    ``avg_pct`` and ``min_pct`` describe the date-scoped Pulse Ox summary endpoint.
    ``sleep_avg_pct`` describes the selected sleep record. These fields intentionally
    do not backfill one another: doing so would make a sleep-only value look like a
    daily average (or vice versa) and would obscure the source-date semantics.
    """
    avg_val = None
    min_val = None
    sleep_avg = None

    if isinstance(spo2_payload, dict):
        user_spo2 = spo2_payload.get("userDailySpo2") or spo2_payload
        if isinstance(user_spo2, dict):
            avg_val = _spo2_percentage(user_spo2.get("averageSpO2"))
            if avg_val is None:
                avg_val = _spo2_percentage(user_spo2.get("averageSpo2"))
            min_val = _spo2_percentage(user_spo2.get("lowestSpO2"))
            if min_val is None:
                min_val = _spo2_percentage(user_spo2.get("lowestSpo2"))

    if isinstance(sleep_payload, dict):
        dto = (
            sleep_payload.get("dailySleepDTO", {})
            if isinstance(sleep_payload.get("dailySleepDTO"), dict)
            else sleep_payload
        )
        sleep_avg = _spo2_percentage(dto.get("averageSpO2Value"))

    if avg_val is not None or min_val is not None or sleep_avg is not None:
        return CanonicalSpo2(
            avg_pct=avg_val,
            min_pct=min_val,
            sleep_avg_pct=sleep_avg,
        )
    return None


def extract_skin_temp_deviation(sleep_payload: Any) -> float | None:
    """Extract Garmin's overnight skin-temperature deviation in Celsius.

    The supported garminconnect API exposes this metric on the sleep response (observed
    as top-level ``avgSkinTempDeviationC``), not through a separate skin-temperature
    endpoint. Known historical/alternate aliases are accepted defensively, including
    nested variants, without treating ``0.0`` as missing.
    """
    if not isinstance(sleep_payload, dict):
        return None

    dto = (
        sleep_payload.get("dailySleepDTO", {})
        if isinstance(sleep_payload.get("dailySleepDTO"), dict)
        else {}
    )
    candidates = (
        sleep_payload.get("avgSkinTempDeviationC"),
        sleep_payload.get("skinTempDeviationCelsius"),
        dto.get("avgSkinTempDeviationC"),
        dto.get("skinTempDeviationCelsius"),
        dto.get("avgSkinTempDeviation"),
    )
    for value in candidates:
        if value is None or isinstance(value, bool):
            continue
        try:
            numeric = float(value)
        except (ValueError, TypeError):
            continue
        if math.isfinite(numeric):
            return round(numeric, 2)
    return None


def extract_gear_items(raw_gear: Any) -> list[CanonicalGearItem]:
    """Extract canonical equipment records from Garmin gear API responses."""
    if not isinstance(raw_gear, list):
        if isinstance(raw_gear, dict) and isinstance(raw_gear.get("gearList"), list):
            raw_gear = raw_gear["gearList"]
        else:
            return []

    items: list[CanonicalGearItem] = []
    for entry in raw_gear:
        if not isinstance(entry, dict):
            continue
        gear_pk = entry.get("gearPk") or entry.get("uuid") or entry.get("gearId")
        if gear_pk is None:
            continue

        custom_make_model = entry.get("customMakeModel") or entry.get("displayName")
        display_name = entry.get("displayName") or custom_make_model
        gear_type_name = entry.get("gearTypeName") or entry.get("gearType")
        brand = entry.get("gearMakeName") or entry.get("brand")
        model = entry.get("gearModelName") or entry.get("model")

        total_dist_raw = _non_negative_number(entry.get("totalDistance"))
        total_dist_km = round(total_dist_raw / 1000.0, 1) if total_dist_raw is not None else 0.0

        max_dist_raw = _non_negative_number(entry.get("maximumMeters") or entry.get("maxDistance"))
        max_dist_km = round(max_dist_raw / 1000.0, 1) if max_dist_raw is not None else None

        date_begin = entry.get("dateBegin")
        if isinstance(date_begin, str) and len(date_begin) >= 10:
            date_begin = date_begin[:10]
        else:
            date_begin = None

        date_end = entry.get("dateEnd")
        if isinstance(date_end, str) and len(date_end) >= 10:
            date_end = date_end[:10]
        else:
            date_end = None

        raw_status = entry.get("gearStatusName") or entry.get("status")
        status = str(raw_status).lower() if raw_status is not None else "active"

        items.append(
            CanonicalGearItem(
                gear_pk=str(gear_pk),
                uuid=str(entry.get("uuid")) if entry.get("uuid") else None,
                custom_make_model=str(custom_make_model) if custom_make_model else None,
                display_name=str(display_name) if display_name else None,
                gear_type=str(gear_type_name).lower() if gear_type_name else None,
                brand=str(brand) if brand else None,
                model=str(model) if model else None,
                total_distance_km=total_dist_km,
                maximum_distance_km=max_dist_km,
                date_begin=date_begin,
                date_end=date_end,
                status=status,
            )
        )

    return items


def canonicalize_from_raw(
    stats_today: dict[str, Any],
    stats_fallback: dict[str, Any] | None,
    sleep_today: dict[str, Any] | None,
    sleep_fallback: dict[str, Any] | None,
    hrv_today: dict[str, Any] | None,
    target_date_iso: str,
    yesterday_iso: str,
    stress_today: dict[str, Any] | None = None,
    body_battery_today: list[dict[str, Any]] | None = None,
    training_readiness_today: list[dict[str, Any]] | None = None,
    training_status_today: dict[str, Any] | None = None,
    heart_rate_zones: list[dict[str, Any]] | None = None,
    respiration_today: dict[str, Any] | None = None,
    body_composition_today: dict[str, Any] | list[dict[str, Any]] | None = None,
    spo2_today: dict[str, Any] | None = None,
) -> CanonicalDailyMetrics:
    """Pure Garmin-shape parsing + fallback logic, producing a provider-neutral
    CanonicalDailyMetrics. Shared by GarminProviderAdapter.fetch_daily_metrics (live
    fetch) and service.rebuild() (archive replay) so both paths can never drift from
    each other -- same guarantee normalize_current_metrics gave the pre-canonical code."""
    # RHR & waking Body Battery
    rhr = stats_today.get("restingHeartRate")
    rhr_date = target_date_iso
    if rhr is None and stats_fallback:
        rhr = stats_fallback.get("restingHeartRate")
        rhr_date = yesterday_iso

    bb_wake = stats_today.get("bodyBatteryAtWakeTime")
    bb_wake_date = target_date_iso
    if bb_wake is None and stats_fallback:
        bb_wake = stats_fallback.get("bodyBatteryAtWakeTime")
        bb_wake_date = yesterday_iso

    # Steps semantics: use D-1 completed day steps
    steps_date = yesterday_iso
    total_steps = stats_fallback.get("totalSteps") if stats_fallback else None
    if total_steps is None:
        total_steps = stats_today.get("totalSteps")
        steps_date = target_date_iso

    # Sleep
    (
        sleep_score,
        sleep_sec,
        avg_resp,
        deep_sec,
        rem_sec,
        light_sec,
        awake_sec,
        restless_count,
    ) = extract_sleep_metrics(sleep_today)
    sleep_date = target_date_iso
    used_sleep_fallback = False
    if sleep_score is None and sleep_fallback:
        (
            fb_score,
            fb_sec,
            fb_resp,
            fb_deep,
            fb_rem,
            fb_light,
            fb_awake,
            fb_restless,
        ) = extract_sleep_metrics(sleep_fallback)
        if fb_score is not None:
            sleep_score, sleep_sec, avg_resp = fb_score, fb_sec, fb_resp
            deep_sec, rem_sec, light_sec, awake_sec, restless_count = (
                fb_deep,
                fb_rem,
                fb_light,
                fb_awake,
                fb_restless,
            )
            sleep_date = yesterday_iso
            used_sleep_fallback = True

    # Prefer a precise average computed from the dedicated respiration endpoint's raw
    # per-interval readings over dailySleepDTO's own (coarser) summary value -- see
    # average_sleep_respiration_from_intervals. Only attempted against sleep_today's own
    # window: respiration_today is fetched for target_date_iso, so it has no
    # correspondence to sleep_fallback's (D-1) window.
    if not used_sleep_fallback:
        sleep_start_gmt_ms, sleep_end_gmt_ms = _sleep_window_gmt_ms(sleep_today or {})
        precise_avg_resp = average_sleep_respiration_from_intervals(
            respiration_today, sleep_start_gmt_ms, sleep_end_gmt_ms
        )
        if precise_avg_resp is not None:
            avg_resp = precise_avg_resp

    # HRV
    hrv_summary = hrv_today.get("hrvSummary", {}) if hrv_today else {}
    hrv_last = hrv_summary.get("lastNightAvg")
    hrv_status = hrv_summary.get("status")
    hrv_date = target_date_iso if hrv_last is not None else None

    # Weight / Body Composition
    weight_kg, body_fat_pct, weight_date = extract_body_composition(body_composition_today)
    if weight_kg is not None and weight_date is None:
        weight_date = target_date_iso

    # Overnight metrics must follow the same selected sleep record. If target-date sleep
    # is unavailable and D-1 is selected, combining target-date Pulse Ox with D-1 sleep
    # fields would create a single CanonicalSpo2 containing values from two dates.
    selected_sleep = sleep_fallback if used_sleep_fallback else sleep_today
    canonical_spo2 = extract_spo2(None if used_sleep_fallback else spo2_today, selected_sleep)
    skin_temp_dev = extract_skin_temp_deviation(selected_sleep)

    daily_rec_hours = _daily_recovery_time_hours(training_readiness_today, stats_today)

    return CanonicalDailyMetrics(
        date=target_date_iso,
        resting_heart_rate_bpm=rhr,
        resting_heart_rate_date=rhr_date if rhr is not None else None,
        hrv_overnight_avg_ms=hrv_last,
        hrv_status=hrv_status,
        hrv_date=hrv_date,
        sleep_score=sleep_score,
        sleep_duration_seconds=sleep_sec,
        sleep_date=sleep_date if sleep_score is not None else None,
        deep_sleep_seconds=deep_sec,
        rem_sleep_seconds=rem_sec,
        light_sleep_seconds=light_sec,
        awake_sleep_seconds=awake_sec,
        restless_moments_count=restless_count,
        respiration_rate_brpm=avg_resp,
        body_battery_wake=bb_wake,
        body_battery_wake_date=bb_wake_date if bb_wake is not None else None,
        steps_count=total_steps,
        steps_date=steps_date,
        weight_kg=weight_kg,
        body_fat_pct=body_fat_pct,
        weight_date=weight_date,
        stress=_canonicalize_stress(stress_today),
        body_battery=_canonicalize_body_battery(body_battery_today),
        training_readiness=_canonicalize_training_readiness(training_readiness_today),
        training_status=_canonicalize_training_status(training_status_today),
        heart_rate_zones=_canonicalize_heart_rate_zones(heart_rate_zones),
        spo2=canonical_spo2,
        skin_temp_deviation_celsius=skin_temp_dev,
        recovery_time_hours=daily_rec_hours,
    )


def canonicalize_activities(
    raw_activities: list[dict[str, Any]],
    zone4_floor: int | None = None,
) -> list[CanonicalActivity]:
    """Public so both GarminProviderAdapter.fetch_activities (live fetch) and
    service.rebuild() (archive replay) share the exact same activity canonicalization."""
    return [_canonicalize_activity(act, zone4_floor=zone4_floor) for act in raw_activities]


def extract_running_dynamics(act: dict[str, Any]) -> CanonicalRunningDynamics | None:
    """Extract running-only dynamics metrics from a Garmin activity summary."""
    if not isinstance(act, dict) or not _is_running_activity_type(_activity_type_key(act)):
        return None

    raw_gct = act.get("avgGroundContactTime") or act.get("groundContactTime")
    gct = _first_positive_number(raw_gct)

    raw_gct_bal = (
        act.get("avgGroundContactBalance")
        or act.get("groundContactBalanceLeft")
        or act.get("groundContactBalance")
    )
    gct_bal_left: float | None = None
    if raw_gct_bal is not None:
        bal_val = _non_negative_number(raw_gct_bal)
        if bal_val is not None and 35.0 <= bal_val <= 65.0:
            gct_bal_left = round(bal_val, 1)

    # Garmin reports vertical oscillation in millimeters under both keys -- always
    # convert, never guess from magnitude (a real value can legitimately fall on
    # either side of any threshold, e.g. 84mm and 8.4mm are both plausible readings).
    raw_vert_osc = act.get("avgVerticalOscillation") or act.get("verticalOscillation")
    vert_osc: float | None = None
    if raw_vert_osc is not None:
        vo_val = _first_positive_number(raw_vert_osc)
        if vo_val is not None:
            vert_osc = round(vo_val / 10.0, 1)

    raw_vert_ratio = act.get("avgVerticalRatio") or act.get("verticalRatio")
    vert_ratio: float | None = None
    if raw_vert_ratio is not None:
        vr_val = _non_negative_number(raw_vert_ratio)
        if vr_val is not None and 1.0 <= vr_val <= 25.0:
            vert_ratio = round(vr_val, 1)

    # Garmin reports stride length in centimeters under both keys -- same
    # always-convert reasoning as vertical oscillation above.
    raw_stride = act.get("avgStrideLength") or act.get("strideLength")
    stride_m: float | None = None
    if raw_stride is not None:
        st_val = _first_positive_number(raw_stride)
        if st_val is not None:
            stride_m = round(st_val / 100.0, 2)

    raw_avg_power = act.get("avgPower") or act.get("averagePower") or act.get("avgRunningPower")
    avg_power_value = _first_positive_number(raw_avg_power)
    avg_power = round(avg_power_value) if avg_power_value is not None else None

    raw_max_power = act.get("maxPower") or act.get("maxRunningPower")
    max_power_value = _first_positive_number(raw_max_power)
    max_power = round(max_power_value) if max_power_value is not None else None

    if any(
        v is not None
        for v in (gct, gct_bal_left, vert_osc, vert_ratio, stride_m, avg_power, max_power)
    ):
        return CanonicalRunningDynamics(
            ground_contact_time_ms=round(gct, 1) if gct is not None else None,
            ground_contact_balance_left_pct=gct_bal_left,
            vertical_oscillation_cm=vert_osc,
            vertical_ratio_pct=vert_ratio,
            stride_length_m=stride_m,
            avg_running_power_watts=avg_power,
            max_running_power_watts=max_power,
        )
    return None


def _canonicalize_activity(
    act: dict[str, Any], zone4_floor: int | None = None
) -> CanonicalActivity:
    te_aero = float(act.get("aerobicTrainingEffect", 0.0) or 0.0)
    te_anaero = float(act.get("anaerobicTrainingEffect", 0.0) or 0.0)
    raw_avg_hr = act.get("averageHR") or act.get("averageHeartRate") or act.get("avgHR")
    avg_hr: float | None = None
    if raw_avg_hr is not None:
        try:
            avg_hr = float(raw_avg_hr)
        except (ValueError, TypeError):
            avg_hr = None
    # Use whichever training effect is higher: an interval/strength session can be a hard
    # stimulus through anaerobic load alone even when its aerobic TE stays moderate, and
    # only consulting aerobic TE (as the pre-canonical-layer code did) would silently
    # under-count those sessions as "hard" for last3DaysHardSessionsCount purposes. See
    # tests/test_garmin_provider.py for the discriminating case this covers.
    _, intensity_tag = classify_activity_intensity(
        max(te_aero, te_anaero), avg_hr, zone4_floor=zone4_floor
    )
    duration_sec = act.get("duration", 0)

    raw_activity_id = act.get("activityId")
    activity_type = _activity_type_key(act)

    # Primary benefit & training-effect descriptors.  Current activity-list payloads
    # expose trainingEffectLabel directly; older/alternate shapes use message-key names.
    primary_benefit = act.get("primaryBenefit") or act.get("primaryBenefitMessage")
    primary_benefit_str = str(primary_benefit).strip() if isinstance(primary_benefit, str) else None

    te_label = (
        act.get("trainingEffectLabel")
        or act.get("aerobicTrainingEffectMessageKey")
        or act.get("trainingEffectMessageKey")
    )
    te_label_str = str(te_label).strip() if isinstance(te_label, str) else None

    raw_epoc = act.get("epoc")
    epoc_val = _non_negative_number(raw_epoc)

    # Garmin recoveryTime is minutes; recoveryTimeHours is an explicit normalized
    # compatibility shape.  Key identity, never value magnitude, determines the unit.
    act_rec_hours = _recovery_time_hours_from_minutes(act.get("recoveryTime"))
    if act_rec_hours is None:
        explicit_hours = _non_negative_number(act.get("recoveryTimeHours"))
        act_rec_hours = round(explicit_hours) if explicit_hours is not None else None

    return CanonicalActivity(
        activity_id=str(raw_activity_id) if raw_activity_id is not None else None,
        date=act.get("startTimeLocal", "")[:10] or "",
        type=activity_type,
        duration_min=round(duration_sec / 60) if duration_sec else None,
        duration_seconds=int(duration_sec or 0),
        training_effect_aerobic=te_aero,
        training_effect_anaerobic=te_anaero,
        average_hr=avg_hr,
        training_load=act.get("activityTrainingLoad"),
        intensity_tag=intensity_tag,
        running_dynamics=extract_running_dynamics(act),
        primary_benefit=primary_benefit_str,
        epoc=epoc_val,
        recovery_time_hours=act_rec_hours,
        training_effect_label=te_label_str,
    )


class GarminProviderAdapter:
    """WearableProvider implementation backed by GarminClientWrapper. This is the
    boundary: everything above it (GarminSyncService, mapper.py) only ever sees
    canonical.py types, never Garmin response shapes."""

    capabilities = ProviderCapabilities(
        daily_summary=True,
        sleep=True,
        hrv=True,
        activities=True,
        activity_details=True,
        body_composition=True,
        gear_tracking=True,
        race_predictions=True,
    )

    def __init__(self, client: GarminClientWrapper):
        self.client = client
        # Per-instance, per-date cache for get_stats/get_sleep_data. A single
        # GarminSyncService (and its one provider instance) is reused across an entire
        # backfill's chronological date loop, where consecutive fetch_daily_metrics calls
        # overlap by one day (date D is fetched as "today" for D, then again as
        # "yesterday" fallback for D+1) -- caching by date halves those Garmin API calls
        # instead of re-fetching the same date twice.
        self._stats_cache: dict[str, dict[str, Any]] = {}
        self._sleep_cache: dict[str, dict[str, Any]] = {}
        self._heart_rate_zones_cache: list[dict[str, Any]] | None = None
        self._activity_summary_cache: dict[str, dict[str, Any]] = {}

    def clear_cache(self) -> None:
        """Called by GarminSyncService at the start of each sync_daily/backfill
        operation -- see WearableProvider.clear_cache. Caching is only safe *within*
        one such operation's chronological date loop; across separate operations
        (e.g. two --force sync_daily calls reusing the same service/provider instance)
        the cache must not leak stale data."""
        self._stats_cache.clear()
        self._sleep_cache.clear()
        self._heart_rate_zones_cache = None
        self._activity_summary_cache.clear()

    def _get_stats(self, date_iso: str) -> dict[str, Any]:
        if date_iso not in self._stats_cache:
            self._stats_cache[date_iso] = self.client.get_stats(date_iso)
        return self._stats_cache[date_iso]

    def _get_sleep_data(self, date_iso: str) -> dict[str, Any]:
        if date_iso not in self._sleep_cache:
            self._sleep_cache[date_iso] = self.client.get_sleep_data(date_iso)
        return self._sleep_cache[date_iso]

    def _fetch_enrichment(
        self,
        name: str,
        fetch_fn: Callable[[], Any],
        *,
        fatal_exceptions: tuple[type[Exception], ...] = (),
    ) -> Any:
        """Best-effort fetch for supplementary metric-enrichment endpoints.

        Normal Garmin/API failures are logged and omitted because these fields are not
        required for the recovery snapshot. ``fatal_exceptions`` is reserved for local
        dependency-contract/programming failures that must not be mislabeled as missing
        health data (for example, an installed garminconnect lacking a required method).
        """
        try:
            return fetch_fn()
        except Exception as e:
            if fatal_exceptions and isinstance(e, fatal_exceptions):
                raise
            logger.warning(
                f"Enrichment fetch '{name}' failed for this sync, continuing without it: {e}"
            )
            return None

    def fetch_daily_metrics(self, target_date_iso: str, yesterday_iso: str) -> ProviderFetchResult:
        stats_today = self._get_stats(target_date_iso)
        # Always fetch D-1 stats: totalSteps must reflect the previous completed day per
        # the snapshot date contract, not just serve as an RHR fallback.
        stats_fallback = self._get_stats(yesterday_iso)

        sleep_today = self._get_sleep_data(target_date_iso)
        sleep_fallback = self._get_sleep_data(yesterday_iso) if not sleep_today else None

        hrv_today = self.client.get_hrv_data(target_date_iso)

        stress_today = self._fetch_enrichment(
            "stress", lambda: self.client.get_stress_data(target_date_iso)
        )
        respiration_today = self._fetch_enrichment(
            "respiration", lambda: self.client.get_respiration_data(target_date_iso)
        )
        body_battery_today = self._fetch_enrichment(
            "body_battery", lambda: self.client.get_body_battery(target_date_iso)
        )
        training_readiness_today = self._fetch_enrichment(
            "training_readiness", lambda: self.client.get_training_readiness(target_date_iso)
        )
        training_status_today = self._fetch_enrichment(
            "training_status", lambda: self.client.get_training_status(target_date_iso)
        )
        # Not actually date-scoped (a profile setting, not per-day telemetry) but fetched
        # on the same daily cadence as the other enrichment endpoints for simplicity --
        # see GarminClientWrapper.get_heart_rate_zones.
        heart_rate_zones = self._fetch_enrichment(
            "heart_rate_zones", lambda: self.client.get_heart_rate_zones()
        )
        if isinstance(heart_rate_zones, list):
            self._heart_rate_zones_cache = heart_rate_zones

        body_comp_today = self._fetch_enrichment(
            "body_composition", lambda: self.client.get_daily_weigh_ins(target_date_iso)
        )

        spo2_today = self._fetch_enrichment(
            "spo2",
            lambda: self.client.get_spo2_data(target_date_iso),
            fatal_exceptions=(AttributeError,),
        )

        canonical = canonicalize_from_raw(
            stats_today=stats_today,
            stats_fallback=stats_fallback,
            sleep_today=sleep_today,
            sleep_fallback=sleep_fallback,
            hrv_today=hrv_today,
            target_date_iso=target_date_iso,
            yesterday_iso=yesterday_iso,
            stress_today=stress_today,
            body_battery_today=body_battery_today,
            training_readiness_today=training_readiness_today,
            training_status_today=training_status_today,
            heart_rate_zones=heart_rate_zones,
            respiration_today=respiration_today,
            body_composition_today=body_comp_today,
            spo2_today=spo2_today,
        )

        raw_payloads: dict[str, Any] = {
            "stats": stats_today,
            "stats_fallback": stats_fallback,
            "sleep": sleep_today,
            "hrv": hrv_today,
        }
        if sleep_fallback is not None:
            raw_payloads["sleep_fallback"] = sleep_fallback
        if stress_today is not None:
            raw_payloads["stress"] = stress_today
        if respiration_today is not None:
            raw_payloads["respiration"] = respiration_today
        if body_battery_today is not None:
            raw_payloads["body_battery"] = body_battery_today
        if training_readiness_today is not None:
            raw_payloads["training_readiness"] = training_readiness_today
        if training_status_today is not None:
            raw_payloads["training_status"] = training_status_today
        if heart_rate_zones is not None:
            raw_payloads["heart_rate_zones"] = heart_rate_zones
        if body_comp_today is not None:
            raw_payloads["body_composition"] = body_comp_today
        if spo2_today is not None:
            raw_payloads["spo2"] = spo2_today

        return ProviderFetchResult(canonical=canonical, raw_payloads=raw_payloads)

    def fetch_performance_targets(self) -> ProviderPerformanceTargetsResult:
        """Fetch current Garmin profile targets once per live daily sync.

        This is intentionally separate from fetch_daily_metrics: these values describe
        the athlete *now*, so the service never calls it during backfills/rebuilds.
        """
        cycling_ftp = self._fetch_enrichment("cycling_ftp", self.client.get_cycling_ftp)
        lactate_threshold = self._fetch_enrichment(
            "lactate_threshold", self.client.get_lactate_threshold
        )
        race_predictions = self._fetch_enrichment(
            "race_predictions", self.client.get_race_predictions
        )
        today = local_today()
        body_comp = self._fetch_enrichment(
            "body_composition",
            lambda: self.client.get_body_composition(
                get_date_string(n_days_ago(today, 30)), get_date_string(today)
            ),
        )
        zones = self._heart_rate_zones_cache
        if zones is None:
            fetched = self._fetch_enrichment("heart_rate_zones", self.client.get_heart_rate_zones)
            zones = fetched if isinstance(fetched, list) else None
            self._heart_rate_zones_cache = zones
        return ProviderPerformanceTargetsResult(
            canonical=canonicalize_performance_targets(
                cycling_ftp,
                lactate_threshold,
                zones,
                body_composition=body_comp,
                race_predictions=race_predictions,
            ),
            raw_payloads={
                "cycling_ftp": cycling_ftp,
                "lactate_threshold": lactate_threshold,
                "body_composition": body_comp,
                "race_predictions": race_predictions,
            },
        )

    def fetch_activities(
        self,
        start_date_iso: str,
        end_date_iso: str,
        zone4_floor: int | None = None,
    ) -> ProviderActivitiesResult:
        raw_activities = self.client.get_activities_window(start_date_iso, end_date_iso)
        self._activity_summary_cache = {
            str(activity["activityId"]): activity
            for activity in raw_activities
            if isinstance(activity, dict) and activity.get("activityId") is not None
        }
        return ProviderActivitiesResult(
            canonical=canonicalize_activities(raw_activities, zone4_floor=zone4_floor),
            raw_payload=raw_activities,
        )

    def fetch_activity_detail(self, activity_id: str) -> ProviderActivityDetailResult:
        summary = self._activity_summary_cache.get(activity_id, {})
        type_str = _activity_type_key(summary).lower()

        # Strength detail is a different one-endpoint data product from cycling power
        # telemetry. Fetching the three power-detail endpoints first wastes requests and
        # can fail before exercise sets are ever reached. Keep the paths disjoint.
        if type_str in _STRENGTH_ACTIVITY_TYPES:
            exercise_sets = self.client.get_activity_exercise_sets(activity_id)
            return ProviderActivityDetailResult(
                canonical=canonicalize_activity_detail(
                    activity_id=activity_id,
                    activity_summary=summary,
                    power_zones=None,
                    hr_zones=None,
                    splits=None,
                    exercise_sets=exercise_sets,
                ),
                raw_payloads={"activity_exercise_sets": exercise_sets},
            )

        power_zones = self.client.get_activity_power_zones(activity_id)
        hr_zones = self.client.get_activity_hr_zones(activity_id)
        splits = self.client.get_activity_splits(activity_id)
        return ProviderActivityDetailResult(
            canonical=canonicalize_activity_detail(
                activity_id=activity_id,
                activity_summary=summary,
                power_zones=power_zones,
                hr_zones=hr_zones,
                splits=splits,
            ),
            raw_payloads={
                "activity_power_zones": power_zones,
                "activity_hr_zones": hr_zones,
                "activity_splits": splits,
            },
        )

    def fetch_gear(self) -> ProviderGearResult:
        raw_gear = self._fetch_enrichment("gear", lambda: self.client.get_gear())
        raw_list = raw_gear if isinstance(raw_gear, list) else []
        return ProviderGearResult(
            canonical=extract_gear_items(raw_list),
            raw_payloads={"gear": raw_list},
        )
