"""The Garmin-specific WearableProvider adapter. This is the only module in the
codebase allowed to know Garmin Connect response shapes (dailySleepDTO, sleepScores,
hrvSummary, activityType, etc.) -- everything downstream (mapper.py, service.py, the
recommendation engine) operates on canonical.py types only."""

import logging
import math
from typing import Any, Callable, TypeVar

from .canonical import (
    CanonicalActivity,
    CanonicalActivityDetail,
    CanonicalBodyBattery,
    CanonicalDailyMetrics,
    CanonicalHeartRateZones,
    CanonicalLapSummary,
    CanonicalPerformanceTargets,
    CanonicalStress,
    CanonicalTrainingReadiness,
    CanonicalTrainingStatus,
    CanonicalZoneBucket,
)
from .garmin_client import GarminClientWrapper
from .metrics import classify_activity_intensity
from .provider import (
    ProviderActivitiesResult,
    ProviderActivityDetailResult,
    ProviderCapabilities,
    ProviderFetchResult,
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


def extract_sleep_metrics(
    sleep_obj: dict[str, Any],
) -> tuple[int | float | None, int | None, float | None]:
    """Extract (sleep_score, sleep_sec, avg_resp) from a raw Garmin sleep response.
    Handles both known Garmin response shapes (nested dailySleepDTO.sleepScores.overall
    and top-level overallSleepScore)."""
    if not sleep_obj:
        return None, None, None

    daily_sleep = sleep_obj.get("dailySleepDTO", {})
    scores = daily_sleep.get("sleepScores", {}) or sleep_obj.get("overallSleepScore", {})

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

    return sleep_score, sleep_sec, avg_resp


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


def average_sleep_respiration_from_intervals(
    respiration_data: dict[str, Any] | None,
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

    Returns None (never raises) on any missing/malformed input -- including too few
    in-window samples to trust -- so callers fall back to the sleep DTO's own average.
    Same defensive-extraction policy as the rest of this module."""
    if not respiration_data or sleep_start_gmt_ms is None or sleep_end_gmt_ms is None:
        return None
    samples = respiration_data.get("respirationValuesArray")
    if not isinstance(samples, list):
        return None

    values: list[float] = []
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
            values.append(float(value))

    # ~1 reading every 2 minutes -- require a real night's worth of coverage so a
    # handful of samples near sleep onset/wake can't dominate the average.
    if len(values) < 30:
        return None

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


def _canonicalize_training_readiness(
    readings: list[dict[str, Any]] | None,
) -> CanonicalTrainingReadiness | None:
    """get_training_readiness(date) returns multiple intraday readings (the device
    re-evaluates through the day); readings[0] is the newest per the observed API
    ordering -- used as the day's representative value."""
    if not readings:
        return None
    latest = readings[0]
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
    return float(value) if value > 0 else None


def _non_negative_number(value: Any) -> float | None:
    """Return a finite non-negative number without coercing strings or booleans."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    return numeric if math.isfinite(numeric) and numeric >= 0 else None


def _positive_integer(value: Any) -> int | None:
    numeric = _non_negative_number(value)
    if numeric is None or numeric < 1 or not numeric.is_integer():
        return None
    return int(numeric)


def qualifies_for_activity_detail(activity: CanonicalActivity) -> bool:
    """Accepted D-DETAIL-GATE predicate for the opt-in live detail fetch.

    The daily target-date fetch is the only caller. At three endpoints per qualifying
    activity, the worst-case incremental request budget is ``3 * N`` for that run;
    backfill and rebuild remain at zero.
    """
    return (
        activity.activity_id is not None
        and activity.type.lower() in _POWER_ACTIVITY_TYPES
        and activity.intensity_tag != "easy"
    )


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


def canonicalize_activity_detail(
    activity_id: str,
    activity_summary: Any,
    power_zones: Any,
    hr_zones: Any,
    splits: Any,
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
    )


def _first_mapping(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, list):
        return next((entry for entry in payload if isinstance(entry, dict)), {})
    return {}


def canonicalize_performance_targets(
    cycling_ftp: dict[str, Any] | list[dict[str, Any]] | None,
    lactate_threshold: dict[str, Any] | None,
    heart_rate_zones: list[dict[str, Any]] | None,
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

    return CanonicalPerformanceTargets(
        cycling_ftp_watts=round(ftp) if ftp is not None else None,
        running_threshold_pace_sec_per_km=pace,
        running_lthr_bpm=round(lthr) if lthr is not None else None,
        ftp_measured_at=ftp_data.get("calendarDate")
        if isinstance(ftp_data.get("calendarDate"), str)
        else None,
        threshold_measured_at=threshold_data.get("calendarDate")
        if isinstance(threshold_data.get("calendarDate"), str)
        else None,
        lthr_measured_at=threshold_data.get("calendarDate")
        if isinstance(threshold_data.get("calendarDate"), str)
        else None,
    )


def canonicalize_from_raw(
    stats_today: dict[str, Any],
    stats_fallback: dict[str, Any] | None,
    sleep_today: dict[str, Any],
    sleep_fallback: dict[str, Any] | None,
    hrv_today: dict[str, Any],
    target_date_iso: str,
    yesterday_iso: str,
    stress_today: dict[str, Any] | None = None,
    body_battery_today: list[dict[str, Any]] | None = None,
    training_readiness_today: list[dict[str, Any]] | None = None,
    training_status_today: dict[str, Any] | None = None,
    heart_rate_zones: list[dict[str, Any]] | None = None,
    respiration_today: dict[str, Any] | None = None,
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
    sleep_score, sleep_sec, avg_resp = extract_sleep_metrics(sleep_today)
    sleep_date = target_date_iso
    used_sleep_fallback = False
    if sleep_score is None and sleep_fallback:
        fb_score, fb_sec, fb_resp = extract_sleep_metrics(sleep_fallback)
        if fb_score is not None:
            sleep_score, sleep_sec, avg_resp = fb_score, fb_sec, fb_resp
            sleep_date = yesterday_iso
            used_sleep_fallback = True

    # Prefer a precise average computed from the dedicated respiration endpoint's raw
    # per-interval readings over dailySleepDTO's own (coarser) summary value -- see
    # average_sleep_respiration_from_intervals. Only attempted against sleep_today's own
    # window: respiration_today is fetched for target_date_iso, so it has no
    # correspondence to sleep_fallback's (D-1) window.
    if not used_sleep_fallback:
        sleep_start_gmt_ms, sleep_end_gmt_ms = _sleep_window_gmt_ms(sleep_today)
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
        respiration_rate_brpm=avg_resp,
        body_battery_wake=bb_wake,
        body_battery_wake_date=bb_wake_date if bb_wake is not None else None,
        steps_count=total_steps,
        steps_date=steps_date,
        stress=_canonicalize_stress(stress_today),
        body_battery=_canonicalize_body_battery(body_battery_today),
        training_readiness=_canonicalize_training_readiness(training_readiness_today),
        training_status=_canonicalize_training_status(training_status_today),
        heart_rate_zones=_canonicalize_heart_rate_zones(heart_rate_zones),
    )


def canonicalize_activities(
    raw_activities: list[dict[str, Any]],
    zone4_floor: int | None = None,
) -> list[CanonicalActivity]:
    """Public so both GarminProviderAdapter.fetch_activities (live fetch) and
    service.rebuild() (archive replay) share the exact same activity canonicalization."""
    return [_canonicalize_activity(act, zone4_floor=zone4_floor) for act in raw_activities]


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

    return CanonicalActivity(
        activity_id=str(raw_activity_id) if raw_activity_id is not None else None,
        date=act.get("startTimeLocal", "")[:10] or "",
        type=act.get("activityType", {}).get("typeKey", "unknown"),
        duration_min=round(duration_sec / 60) if duration_sec else None,
        duration_seconds=int(duration_sec or 0),
        training_effect_aerobic=te_aero,
        training_effect_anaerobic=te_anaero,
        average_hr=avg_hr,
        training_load=act.get("activityTrainingLoad"),
        intensity_tag=intensity_tag,
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

    def _fetch_enrichment(self, name: str, fetch_fn: Callable[[], Any]) -> Any:
        """Best-effort fetch for metric-enrichment endpoints (stress/body battery/
        training readiness/training status): log and continue on failure rather than
        aborting the whole sync. Unlike stats/sleep/hrv/activities, these are
        supplementary and not yet consumed by anything downstream."""
        try:
            return fetch_fn()
        except Exception as e:
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
        zones = self._heart_rate_zones_cache
        if zones is None:
            fetched = self._fetch_enrichment("heart_rate_zones", self.client.get_heart_rate_zones)
            zones = fetched if isinstance(fetched, list) else None
            self._heart_rate_zones_cache = zones
        return ProviderPerformanceTargetsResult(
            canonical=canonicalize_performance_targets(cycling_ftp, lactate_threshold, zones),
            raw_payloads={"cycling_ftp": cycling_ftp, "lactate_threshold": lactate_threshold},
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
        power_zones = self.client.get_activity_power_zones(activity_id)
        hr_zones = self.client.get_activity_hr_zones(activity_id)
        splits = self.client.get_activity_splits(activity_id)
        raw_payloads = {
            "activity_power_zones": power_zones,
            "activity_hr_zones": hr_zones,
            "activity_splits": splits,
        }
        return ProviderActivityDetailResult(
            canonical=canonicalize_activity_detail(
                activity_id=activity_id,
                activity_summary=self._activity_summary_cache.get(activity_id),
                power_zones=power_zones,
                hr_zones=hr_zones,
                splits=splits,
            ),
            raw_payloads=raw_payloads,
        )
