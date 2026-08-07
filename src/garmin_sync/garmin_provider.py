"""The Garmin-specific WearableProvider adapter. This is the only module in the
codebase allowed to know Garmin Connect response shapes (dailySleepDTO, sleepScores,
hrvSummary, activityType, etc.) -- everything downstream (mapper.py, service.py, the
recommendation engine) operates on canonical.py types only."""
import logging
from typing import Any
from .canonical import (
    CanonicalActivity,
    CanonicalBodyBattery,
    CanonicalDailyMetrics,
    CanonicalHeartRateZones,
    CanonicalStress,
    CanonicalTrainingReadiness,
    CanonicalTrainingStatus,
)
from .garmin_client import GarminClientWrapper
from .metrics import classify_activity_intensity
from .provider import ProviderActivitiesResult, ProviderCapabilities, ProviderFetchResult

logger = logging.getLogger(__name__)


def extract_sleep_metrics(sleep_obj: dict[str, Any]) -> tuple[int | float | None, int | None, float | None]:
    """Extract (sleep_score, sleep_sec, avg_resp) from a raw Garmin sleep response.
    Handles both known Garmin response shapes (nested dailySleepDTO.sleepScores.overall
    and top-level overallSleepScore)."""
    if not sleep_obj:
        return None, None, None

    daily_sleep = sleep_obj.get("dailySleepDTO", {})
    scores = daily_sleep.get("sleepScores", {}) or sleep_obj.get("overallSleepScore", {})

    sleep_score = scores.get("overall", {}).get("value") if isinstance(scores.get("overall"), dict) else scores.get("value")
    if sleep_score is None and isinstance(daily_sleep.get("sleepQualityScore"), (int, float)):
        sleep_score = daily_sleep.get("sleepQualityScore")

    sleep_sec = daily_sleep.get("sleepTimeSeconds") or sleep_obj.get("totalSleepSeconds")
    avg_resp = daily_sleep.get("averageRespirationValue") or sleep_obj.get("averageRespirationValue")

    return sleep_score, sleep_sec, avg_resp


def _canonicalize_stress(stress_today: dict[str, Any] | None) -> CanonicalStress | None:
    if not stress_today:
        return None
    return CanonicalStress(avg=stress_today.get("avgStressLevel"), max=stress_today.get("maxStressLevel"))


def _canonicalize_body_battery(body_battery_today: list[dict[str, Any]] | None) -> CanonicalBodyBattery | None:
    """get_body_battery(date, date) returns a list (one entry per requested day)."""
    if not body_battery_today:
        return None
    entry = body_battery_today[0]
    charged = entry.get("charged")
    drained = entry.get("drained")
    change = charged - drained if charged is not None and drained is not None else None
    return CanonicalBodyBattery(charged=charged, drained=drained, change=change)


def _canonicalize_training_readiness(readings: list[dict[str, Any]] | None) -> CanonicalTrainingReadiness | None:
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


def _canonicalize_training_status(training_status_today: dict[str, Any] | None) -> CanonicalTrainingStatus | None:
    """Deeply nested and device-ID-keyed -- every level extracted defensively, since a
    missing device/metric must degrade to None fields, never a KeyError."""
    if not training_status_today:
        return None

    status_data = (training_status_today.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}
    device_status = next(iter(status_data.values()), {}) if status_data else {}
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


def _canonicalize_heart_rate_zones(zones_list: list[dict[str, Any]] | None) -> CanonicalHeartRateZones | None:
    """get_heart_rate_zones() returns one entry per sport profile (DEFAULT, RUNNING,
    CYCLING, ...); DEFAULT is used as the single representative value -- extracted
    defensively (never assume the shape/type Garmin actually returned), matching
    _canonicalize_training_status's degrade-to-None-fields precedent."""
    if not isinstance(zones_list, list) or not zones_list:
        return None

    default_entry = next((z for z in zones_list if isinstance(z, dict) and z.get("sport") == "DEFAULT"), None)
    entry = default_entry or (zones_list[0] if isinstance(zones_list[0], dict) else None)
    if entry is None:
        return None

    return CanonicalHeartRateZones(
        resting_hr_used=entry.get("restingHeartRateUsed"),
        max_hr_used=entry.get("maxHeartRateUsed"),
        zone4_floor=entry.get("zone4Floor"),
        sport=entry.get("sport"),
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
    if sleep_score is None and sleep_fallback:
        fb_score, fb_sec, fb_resp = extract_sleep_metrics(sleep_fallback)
        if fb_score is not None:
            sleep_score, sleep_sec, avg_resp = fb_score, fb_sec, fb_resp
            sleep_date = yesterday_iso

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


def canonicalize_activities(raw_activities: list[dict[str, Any]]) -> list[CanonicalActivity]:
    """Public so both GarminProviderAdapter.fetch_activities (live fetch) and
    service.rebuild() (archive replay) share the exact same activity canonicalization."""
    return [_canonicalize_activity(act) for act in raw_activities]


def _canonicalize_activity(act: dict[str, Any]) -> CanonicalActivity:
    te_aero = float(act.get("aerobicTrainingEffect", 0.0) or 0.0)
    te_anaero = float(act.get("anaerobicTrainingEffect", 0.0) or 0.0)
    avg_hr = act.get("averageHeartRate")
    # Use whichever training effect is higher: an interval/strength session can be a hard
    # stimulus through anaerobic load alone even when its aerobic TE stays moderate, and
    # only consulting aerobic TE (as the pre-canonical-layer code did) would silently
    # under-count those sessions as "hard" for last3DaysHardSessionsCount purposes. See
    # tests/test_garmin_provider.py for the discriminating case this covers.
    _, intensity_tag = classify_activity_intensity(max(te_aero, te_anaero), avg_hr)
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

    def clear_cache(self) -> None:
        """Called by GarminSyncService at the start of each sync_daily/backfill
        operation -- see WearableProvider.clear_cache. Caching is only safe *within*
        one such operation's chronological date loop; across separate operations
        (e.g. two --force sync_daily calls reusing the same service/provider instance)
        the cache must not leak stale data."""
        self._stats_cache.clear()
        self._sleep_cache.clear()

    def _get_stats(self, date_iso: str) -> dict[str, Any]:
        if date_iso not in self._stats_cache:
            self._stats_cache[date_iso] = self.client.get_stats(date_iso)
        return self._stats_cache[date_iso]

    def _get_sleep_data(self, date_iso: str) -> dict[str, Any]:
        if date_iso not in self._sleep_cache:
            self._sleep_cache[date_iso] = self.client.get_sleep_data(date_iso)
        return self._sleep_cache[date_iso]

    def _fetch_enrichment(self, name: str, fetch_fn) -> Any:
        """Best-effort fetch for metric-enrichment endpoints (stress/body battery/
        training readiness/training status): log and continue on failure rather than
        aborting the whole sync. Unlike stats/sleep/hrv/activities, these are
        supplementary and not yet consumed by anything downstream."""
        try:
            return fetch_fn()
        except Exception as e:
            logger.warning(f"Enrichment fetch '{name}' failed for this sync, continuing without it: {e}")
            return None

    def fetch_daily_metrics(self, target_date_iso: str, yesterday_iso: str) -> ProviderFetchResult:
        stats_today = self._get_stats(target_date_iso)
        # Always fetch D-1 stats: totalSteps must reflect the previous completed day per
        # the snapshot date contract, not just serve as an RHR fallback.
        stats_fallback = self._get_stats(yesterday_iso)

        sleep_today = self._get_sleep_data(target_date_iso)
        sleep_fallback = self._get_sleep_data(yesterday_iso) if not sleep_today else None

        hrv_today = self.client.get_hrv_data(target_date_iso)

        stress_today = self._fetch_enrichment("stress", lambda: self.client.get_stress_data(target_date_iso))
        body_battery_today = self._fetch_enrichment("body_battery", lambda: self.client.get_body_battery(target_date_iso))
        training_readiness_today = self._fetch_enrichment("training_readiness", lambda: self.client.get_training_readiness(target_date_iso))
        training_status_today = self._fetch_enrichment("training_status", lambda: self.client.get_training_status(target_date_iso))
        # Not actually date-scoped (a profile setting, not per-day telemetry) but fetched
        # on the same daily cadence as the other enrichment endpoints for simplicity --
        # see GarminClientWrapper.get_heart_rate_zones.
        heart_rate_zones = self._fetch_enrichment("heart_rate_zones", lambda: self.client.get_heart_rate_zones())

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
        if body_battery_today is not None:
            raw_payloads["body_battery"] = body_battery_today
        if training_readiness_today is not None:
            raw_payloads["training_readiness"] = training_readiness_today
        if training_status_today is not None:
            raw_payloads["training_status"] = training_status_today
        if heart_rate_zones is not None:
            raw_payloads["heart_rate_zones"] = heart_rate_zones

        return ProviderFetchResult(canonical=canonical, raw_payloads=raw_payloads)

    def fetch_activities(self, start_date_iso: str, end_date_iso: str) -> ProviderActivitiesResult:
        raw_activities = self.client.get_activities_window(start_date_iso, end_date_iso)
        return ProviderActivitiesResult(canonical=canonicalize_activities(raw_activities), raw_payload=raw_activities)
