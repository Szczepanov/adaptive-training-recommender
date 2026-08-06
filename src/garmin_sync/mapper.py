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


def build_snapshot_from_canonical(
    user_id: str,
    target_date_iso: str,
    canonical: CanonicalDailyMetrics,
    canonical_activities: list[CanonicalActivity],
    derived_metrics: DerivedMetrics,
    timezone_name: str = "Europe/Warsaw",
    garminconnect_version: str | None = None,
    synced_at_iso: str | None = None,
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
        activitiesThrough=yesterday_iso,
    )

    # Activities (3-day lookback ending at yesterday)
    hard_sessions_count = 0
    yesterday_acts: list[CanonicalActivity] = []

    for act in canonical_activities:
        if not act.date:
            continue
        if three_days_ago_iso <= act.date <= yesterday_iso:
            if act.intensity_tag == "hard":
                hard_sessions_count += 1
            if act.date == yesterday_iso:
                yesterday_acts.append(act)

    y_train: YesterdayTraining | None = None
    if yesterday_acts:
        y_hard_count = sum(1 for act in yesterday_acts if act.intensity_tag == "hard")
        total_dur_sec = sum(act.duration_seconds for act in yesterday_acts)

        def primary_sort_key(act: CanonicalActivity) -> tuple[float, float, int, str]:
            load = act.training_load or 0.0
            te_max = max(act.training_effect_aerobic, act.training_effect_anaerobic)
            return (load, te_max, act.duration_seconds, act.activity_id)

        best_act = max(yesterday_acts, key=primary_sort_key)
        te_best = max(best_act.training_effect_aerobic, best_act.training_effect_anaerobic)

        primary_act = PrimaryActivity(
            activityId=best_act.activity_id,
            type=best_act.type,
            durationMin=best_act.duration_min,
            trainingEffect=te_best,
            intensityTag=best_act.intensity_tag,
        )

        y_train = YesterdayTraining(
            activityCount=len(yesterday_acts),
            totalDurationMin=round(total_dur_sec / 60),
            hardActivityCount=y_hard_count,
            primaryActivity=primary_act,
        )

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
