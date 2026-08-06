"""Provider-neutral snapshot assembly. Operates only on canonical.py types -- no
provider-specific (e.g. Garmin) response shape knowledge belongs in this module; that
lives in garmin_provider.py (or a future provider's own adapter module)."""
import logging
from datetime import datetime, timezone
from typing import Any
from .canonical import CanonicalActivity, CanonicalDailyMetrics
from .dates import parse_date_string, n_days_ago, get_date_string
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


def normalize_activity(activity: CanonicalActivity, sync_run_id: str) -> dict[str, Any]:
    """Normalize a canonical activity into the standalone per-activity record stored at
    users/{userId}/activities/{activityId} -- decoupled from any one day's recovery
    snapshot so full activity history isn't lost/truncated by the 3-day window used for
    yesterdayTraining/last3DaysHardSessionsCount."""
    return {
        "activityId": activity.activity_id,
        "date": activity.date or None,
        "type": activity.type,
        "durationMin": activity.duration_min,
        "trainingEffectAerobic": activity.training_effect_aerobic,
        "trainingEffectAnaerobic": activity.training_effect_anaerobic,
        "averageHr": activity.average_hr,
        "activityTrainingLoad": activity.training_load,
        "intensityTag": activity.intensity_tag,
        "syncRunId": sync_run_id,
        "syncedAt": datetime.now(timezone.utc).isoformat(),
    }


def _build_training_summary(activities: list[CanonicalActivity], date_iso: str) -> YesterdayTraining | None:
    """Summarize all canonical activities that occurred on a single date (used for both
    `yesterdayTraining` and `todayTraining` -- the shape is identical, only which date
    is being summarized differs)."""
    day_acts = [act for act in activities if act.date == date_iso]
    if not day_acts:
        return None

    hard_count = sum(1 for act in day_acts if act.intensity_tag == "hard")
    total_dur_sec = sum(act.duration_seconds for act in day_acts)

    def primary_sort_key(act: CanonicalActivity) -> tuple[float, float, int, str]:
        load = act.training_load or 0.0
        te_max = max(act.training_effect_aerobic, act.training_effect_anaerobic)
        # An activity missing its Garmin activityId sorts last on ties (empty string),
        # matching how it's excluded from archiving -- it must never win a tie over a
        # legitimately-identified activity for the displayed "primary" session.
        return (load, te_max, act.duration_seconds, act.activity_id or "")

    best_act = max(day_acts, key=primary_sort_key)
    te_best = max(best_act.training_effect_aerobic, best_act.training_effect_anaerobic)

    primary_act = PrimaryActivity(
        activityId=best_act.activity_id or "unknown",
        type=best_act.type,
        durationMin=best_act.duration_min,
        trainingEffect=te_best,
        intensityTag=best_act.intensity_tag,
    )

    return YesterdayTraining(
        activityCount=len(day_acts),
        totalDurationMin=round(total_dur_sec / 60),
        hardActivityCount=hard_count,
        primaryActivity=primary_act,
    )


def build_snapshot_from_canonical(
    user_id: str,
    target_date_iso: str,
    canonical: CanonicalDailyMetrics,
    canonical_activities: list[CanonicalActivity],
    derived_metrics: DerivedMetrics,
    timezone_name: str = "Europe/Warsaw",
    garminconnect_version: str | None = None,
    synced_at_iso: str | None = None,
    activities_through_iso: str | None = None,
) -> DailyRecoverySnapshot:
    """Map a CanonicalDailyMetrics + activity list into a normalized DailyRecoverySnapshot
    with explicit provenance. Same logic/output shape as the pre-canonical-layer
    map_garmin_payload_to_snapshot, just reading canonical fields instead of raw
    provider dicts."""
    target_date = parse_date_string(target_date_iso)
    yesterday_iso = get_date_string(n_days_ago(target_date, 1))
    three_days_ago_iso = get_date_string(n_days_ago(target_date, 3))

    metric_dates = MetricDates(
        sleep=canonical.sleep_date,
        hrv=canonical.hrv_date,
        restingHr=canonical.resting_heart_rate_date,
        bodyBatteryWake=canonical.body_battery_wake_date,
        steps=canonical.steps_date,
        # Defaults to target_date_iso because that's accurate for sync_daily and
        # backfill's live fetch -- both actually fetch activities through target_date_iso
        # (see service.py). rebuild() passes an explicit, more conservative value: it can
        # only replay whatever was archived for this date, and an archive entry written
        # before same-day activity fetching existed may only cover through yesterday, so
        # rebuild must not assume the newer, wider guarantee applies to old archives.
        activitiesThrough=activities_through_iso or target_date_iso,
    )

    # 3-day hard-session lookback stays yesterday-and-earlier by design: it measures
    # accumulated load *going into* today, not today's own session.
    hard_sessions_count = sum(
        1 for act in canonical_activities
        if act.date and three_days_ago_iso <= act.date <= yesterday_iso and act.intensity_tag == "hard"
    )

    y_train = _build_training_summary(canonical_activities, yesterday_iso)
    today_train = _build_training_summary(canonical_activities, target_date_iso)

    now_iso = synced_at_iso or datetime.now(timezone.utc).isoformat()

    source = SourceMetadata(
        garminSyncedAt=now_iso,
        sourceSchemaVersion=SCHEMA_VERSION,
        timezone=timezone_name,
        metricDates=metric_dates,
        garminconnectVersion=garminconnect_version,
    )

    raw = RawMetrics(
        sleepScore=canonical.sleep_score,
        sleepDurationSec=canonical.sleep_duration_seconds,
        restingHr=canonical.resting_heart_rate_bpm,
        hrvOvernightAvg=canonical.hrv_overnight_avg_ms,
        hrvStatus=canonical.hrv_status,
        respirationAvg=canonical.respiration_rate_brpm,
        bodyBatteryWake=canonical.body_battery_wake,
        bodyBatteryChange=None,
        totalSteps=canonical.steps_count,
        last3DaysHardSessionsCount=hard_sessions_count,
        yesterdayTraining=y_train,
        todayTraining=today_train,
    )

    data_quality = DataQuality(
        sleepScoreAvailable=canonical.sleep_score is not None,
        restingHrAvailable=canonical.resting_heart_rate_bpm is not None,
        hrvAvailable=canonical.hrv_overnight_avg_ms is not None,
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
