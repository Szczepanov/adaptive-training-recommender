"""The Garmin-specific WearableProvider adapter. This is the only module in the
codebase allowed to know Garmin Connect response shapes (dailySleepDTO, sleepScores,
hrvSummary, activityType, etc.) -- everything downstream (mapper.py, service.py, the
recommendation engine) operates on canonical.py types only."""
import logging
from typing import Any
from .canonical import CanonicalActivity, CanonicalDailyMetrics
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


def canonicalize_from_raw(
    stats_today: dict[str, Any],
    stats_fallback: dict[str, Any] | None,
    sleep_today: dict[str, Any],
    sleep_fallback: dict[str, Any] | None,
    hrv_today: dict[str, Any],
    target_date_iso: str,
    yesterday_iso: str,
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

    def _get_stats(self, date_iso: str) -> dict[str, Any]:
        if date_iso not in self._stats_cache:
            self._stats_cache[date_iso] = self.client.get_stats(date_iso)
        return self._stats_cache[date_iso]

    def _get_sleep_data(self, date_iso: str) -> dict[str, Any]:
        if date_iso not in self._sleep_cache:
            self._sleep_cache[date_iso] = self.client.get_sleep_data(date_iso)
        return self._sleep_cache[date_iso]

    def fetch_daily_metrics(self, target_date_iso: str, yesterday_iso: str) -> ProviderFetchResult:
        stats_today = self._get_stats(target_date_iso)
        # Always fetch D-1 stats: totalSteps must reflect the previous completed day per
        # the snapshot date contract, not just serve as an RHR fallback.
        stats_fallback = self._get_stats(yesterday_iso)

        sleep_today = self._get_sleep_data(target_date_iso)
        sleep_fallback = self._get_sleep_data(yesterday_iso) if not sleep_today else None

        hrv_today = self.client.get_hrv_data(target_date_iso)

        canonical = canonicalize_from_raw(
            stats_today=stats_today,
            stats_fallback=stats_fallback,
            sleep_today=sleep_today,
            sleep_fallback=sleep_fallback,
            hrv_today=hrv_today,
            target_date_iso=target_date_iso,
            yesterday_iso=yesterday_iso,
        )

        raw_payloads: dict[str, Any] = {
            "stats": stats_today,
            "stats_fallback": stats_fallback,
            "sleep": sleep_today,
            "hrv": hrv_today,
        }
        if sleep_fallback is not None:
            raw_payloads["sleep_fallback"] = sleep_fallback

        return ProviderFetchResult(canonical=canonical, raw_payloads=raw_payloads)

    def fetch_activities(self, start_date_iso: str, end_date_iso: str) -> ProviderActivitiesResult:
        raw_activities = self.client.get_activities_window(start_date_iso, end_date_iso)
        return ProviderActivitiesResult(canonical=canonicalize_activities(raw_activities), raw_payload=raw_activities)
