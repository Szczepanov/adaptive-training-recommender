import importlib.metadata
import logging
from datetime import datetime, timezone
from typing import Any
from .dates import parse_date_string, n_days_ago, get_date_string
from .metrics import classify_activity_intensity
from .models import (
    DailyRecoverySnapshot,
    DataQuality,
    DerivedMetrics,
    MetricDates,
    PrimaryActivity,
    RawMetrics,
    SCHEMA_VERSION,
    SourceMetadata,
    YesterdayTraining,
)

logger = logging.getLogger(__name__)


def extract_sleep_metrics(sleep_obj: dict[str, Any]) -> tuple[int | float | None, int | None, float | None]:
    """Extract (sleep_score, sleep_sec, avg_resp) from Garmin sleep response."""
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


def normalize_current_metrics(
    stats_today: dict[str, Any],
    stats_fallback: dict[str, Any] | None,
    sleep_today: dict[str, Any],
    sleep_fallback: dict[str, Any] | None,
    hrv_today: dict[str, Any],
    target_date_iso: str,
    yesterday_iso: str,
) -> tuple[dict[str, Any], MetricDates]:
    """Consolidate current metrics extraction and fallback logic into a single normalized view."""
    # 1. RHR & Waking Body Battery
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

    # Steps semantics: Use D-1 completed day steps
    steps_date = yesterday_iso
    total_steps = stats_fallback.get("totalSteps") if stats_fallback else None
    if total_steps is None:
        total_steps = stats_today.get("totalSteps")
        steps_date = target_date_iso

    # 2. Sleep Metrics
    sleep_score, sleep_sec, avg_resp = extract_sleep_metrics(sleep_today)
    sleep_date = target_date_iso
    if sleep_score is None and sleep_fallback:
        fb_score, fb_sec, fb_resp = extract_sleep_metrics(sleep_fallback)
        if fb_score is not None:
            sleep_score, sleep_sec, avg_resp = fb_score, fb_sec, fb_resp
            sleep_date = yesterday_iso

    # 3. HRV
    hrv_summary = hrv_today.get("hrvSummary", {}) if hrv_today else {}
    hrv_last = hrv_summary.get("lastNightAvg")
    hrv_status = hrv_summary.get("status")
    hrv_date = target_date_iso if hrv_last is not None else None

    normalized_dict = {
        "sleepScore": sleep_score,
        "sleepDurationSec": sleep_sec,
        "restingHr": rhr,
        "hrvOvernightAvg": hrv_last,
        "hrvStatus": hrv_status,
        "respirationAvg": avg_resp,
        "bodyBatteryWake": bb_wake,
        "totalSteps": total_steps,
    }

    metric_dates = MetricDates(
        sleep=sleep_date if sleep_score is not None else None,
        hrv=hrv_date,
        restingHr=rhr_date if rhr is not None else None,
        bodyBatteryWake=bb_wake_date if bb_wake is not None else None,
        steps=steps_date,
        activitiesThrough=yesterday_iso,
    )

    return normalized_dict, metric_dates


def map_garmin_payload_to_snapshot(
    user_id: str,
    target_date_iso: str,
    stats_today: dict[str, Any],
    stats_fallback: dict[str, Any] | None,
    sleep_today: dict[str, Any],
    sleep_fallback: dict[str, Any] | None,
    hrv_today: dict[str, Any],
    activities_window: list[dict[str, Any]],
    derived_metrics: DerivedMetrics,
    timezone_name: str = "Europe/Warsaw",
    synced_at_iso: str | None = None,
) -> DailyRecoverySnapshot:
    """Map raw Garmin responses into normalized DailyRecoverySnapshot with explicit provenance."""
    target_date = parse_date_string(target_date_iso)
    yesterday_iso = get_date_string(n_days_ago(target_date, 1))
    three_days_ago_iso = get_date_string(n_days_ago(target_date, 3))

    normalized, metric_dates = normalize_current_metrics(
        stats_today=stats_today,
        stats_fallback=stats_fallback,
        sleep_today=sleep_today,
        sleep_fallback=sleep_fallback,
        hrv_today=hrv_today,
        target_date_iso=target_date_iso,
        yesterday_iso=yesterday_iso,
    )

    # Activities (3-day lookback ending at yesterday)
    hard_sessions_count = 0
    yesterday_acts: list[dict[str, Any]] = []

    for act in activities_window:
        act_date = act.get("startTimeLocal", "")[:10]
        if not act_date:
            continue

        if three_days_ago_iso <= act_date <= yesterday_iso:
            is_hard, _ = classify_activity_intensity(act)
            if is_hard:
                hard_sessions_count += 1
            if act_date == yesterday_iso:
                yesterday_acts.append(act)

    y_train: YesterdayTraining | None = None
    if yesterday_acts:
        y_hard_count = sum(1 for act in yesterday_acts if classify_activity_intensity(act)[0])
        total_dur_sec = sum(act.get("duration", 0) or 0 for act in yesterday_acts)

        def primary_sort_key(act: dict[str, Any]) -> tuple[float, float, int, str]:
            load = float(act.get("activityTrainingLoad", 0.0) or 0.0)
            te_aero = float(act.get("aerobicTrainingEffect", 0.0) or 0.0)
            te_anaero = float(act.get("anaerobicTrainingEffect", 0.0) or 0.0)
            te_max = max(te_aero, te_anaero)
            duration = int(act.get("duration", 0) or 0)
            act_id = str(act.get("activityId", ""))
            return (load, te_max, duration, act_id)

        best_act = max(yesterday_acts, key=primary_sort_key)
        te_best = float(best_act.get("aerobicTrainingEffect", 0.0) or 0.0)
        dur_sec = best_act.get("duration", 0)
        dur_min = round(dur_sec / 60) if dur_sec else None
        act_type = best_act.get("activityType", {}).get("typeKey", "unknown")
        _, intensity_tag = classify_activity_intensity(best_act)

        primary_act = PrimaryActivity(
            activityId=best_act.get("activityId", "unknown"),
            type=act_type,
            durationMin=dur_min,
            trainingEffect=te_best,
            intensityTag=intensity_tag,
        )

        y_train = YesterdayTraining(
            activityCount=len(yesterday_acts),
            totalDurationMin=round(total_dur_sec / 60),
            hardActivityCount=y_hard_count,
            primaryActivity=primary_act,
        )

    now_iso = synced_at_iso or datetime.now(timezone.utc).isoformat()

    try:
        gc_version = importlib.metadata.version("garminconnect")
    except Exception:
        gc_version = None

    source = SourceMetadata(
        garminSyncedAt=now_iso,
        sourceSchemaVersion=SCHEMA_VERSION,
        timezone=timezone_name,
        metricDates=metric_dates,
        garminconnectVersion=gc_version,
    )

    raw = RawMetrics(
        sleepScore=normalized["sleepScore"],
        sleepDurationSec=normalized["sleepDurationSec"],
        restingHr=normalized["restingHr"],
        hrvOvernightAvg=normalized["hrvOvernightAvg"],
        hrvStatus=normalized["hrvStatus"],
        respirationAvg=normalized["respirationAvg"],
        bodyBatteryWake=normalized["bodyBatteryWake"],
        bodyBatteryChange=None,
        totalSteps=normalized["totalSteps"],
        last3DaysHardSessionsCount=hard_sessions_count,
        yesterdayTraining=y_train,
    )

    data_quality = DataQuality(
        sleepScoreAvailable=normalized["sleepScore"] is not None,
        restingHrAvailable=normalized["restingHr"] is not None,
        hrvAvailable=normalized["hrvOvernightAvg"] is not None,
        baseline7dReady=derived_metrics.restingHr7dAvg is not None,
        baseline28dReady=derived_metrics.restingHr28dAvg is not None,
    )

    return DailyRecoverySnapshot(
        userId=user_id,
        date=target_date_iso,
        source=source,
        raw=raw,
        derived=derived_metrics,
        dataQuality=data_quality,
        createdAt=now_iso,
        updatedAt=now_iso,
    )
