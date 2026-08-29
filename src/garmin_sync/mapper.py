"""Provider-neutral snapshot assembly. Operates only on canonical.py types -- no
provider-specific (e.g. Garmin) response shape knowledge belongs in this module; that
lives in garmin_provider.py (or a future provider's own adapter module)."""

import logging
from datetime import datetime, timezone
from typing import Any

from .canonical import (
    CanonicalActivity,
    CanonicalActivityDetail,
    CanonicalDailyMetrics,
    CanonicalHrMeasurementQuality,
)
from .dates import get_date_string, n_days_ago, parse_date_string
from .models import (
    SCHEMA_VERSION,
    DailyRecoverySnapshot,
    DataQuality,
    DerivedMetrics,
    HeartRateZonesSummary,
    MetricDates,
    PrimaryActivity,
    RawMetrics,
    SourceMetadata,
    Spo2Summary,
    StressSummary,
    TrainingReadinessSummary,
    TrainingStatusSummary,
    YesterdayTraining,
)

logger = logging.getLogger(__name__)


def _is_running_activity_type(activity_type: str) -> bool:
    """Keep running-only telemetry out of activities that share generic power keys."""
    normalized = activity_type.strip().lower()
    return (
        normalized in {"run", "running"}
        or normalized.endswith("_run")
        or normalized.endswith("_running")
    )


def normalize_activity(
    activity: CanonicalActivity,
    sync_run_id: str,
    detail: CanonicalActivityDetail | None = None,
    hr_measurement: CanonicalHrMeasurementQuality | None = None,
) -> dict[str, Any]:
    """Normalize a canonical activity into the standalone per-activity record stored at
    users/{userId}/activities/{activityId} -- decoupled from any one day's recovery
    snapshot so full activity history isn't lost/truncated by the 3-day window used for
    yesterdayTraining/last3DaysHardSessionsCount."""
    payload: dict[str, Any] = {
        "activityId": activity.activity_id,
        "date": activity.date or None,
        "type": activity.type,
        "durationMin": activity.duration_min,
        "trainingEffectAerobic": activity.training_effect_aerobic,
        "trainingEffectAnaerobic": activity.training_effect_anaerobic,
        "averageHr": activity.average_hr,
        "activityTrainingLoad": activity.training_load,
        "intensityTag": activity.intensity_tag,
        **(
            {"primaryBenefit": activity.primary_benefit}
            if activity.primary_benefit is not None
            else {}
        ),
        **({"epoc": activity.epoc} if activity.epoc is not None else {}),
        **(
            {"recoveryTimeHours": activity.recovery_time_hours}
            if activity.recovery_time_hours is not None
            else {}
        ),
        **(
            {"trainingEffectLabel": activity.training_effect_label}
            if activity.training_effect_label is not None
            else {}
        ),
        "syncRunId": sync_run_id,
        "syncedAt": datetime.now(timezone.utc).isoformat(),
    }
    if activity.running_dynamics is not None and _is_running_activity_type(activity.type):
        rd = activity.running_dynamics
        rd_dict = {
            key: value
            for key, value in {
                "groundContactTimeMs": rd.ground_contact_time_ms,
                "groundContactBalanceLeftPct": rd.ground_contact_balance_left_pct,
                "verticalOscillationCm": rd.vertical_oscillation_cm,
                "verticalRatioPct": rd.vertical_ratio_pct,
                "strideLengthM": rd.stride_length_m,
                "avgRunningPowerWatts": rd.avg_running_power_watts,
                "maxRunningPowerWatts": rd.max_running_power_watts,
            }.items()
            if value is not None
        }
        if rd_dict:
            payload["runningDynamics"] = rd_dict

    if hr_measurement is not None:
        payload["hrMeasurement"] = {
            "externalHrSensorPresent": hr_measurement.source.external_hr_sensor_present,
            "sourceForActivity": hr_measurement.source.source_for_activity,
            "provenanceConfidence": hr_measurement.source.provenance_confidence,
            "sensorTechnology": hr_measurement.source.sensor_technology,
            "activityMotionRisk": hr_measurement.activity_motion_risk,
            "coveragePct": hr_measurement.coverage_pct,
            "longestGapSeconds": hr_measurement.longest_gap_seconds,
            "signalQuality": hr_measurement.signal_quality,
            "measurementConfidence": hr_measurement.measurement_confidence,
            "summaryCompatibility": hr_measurement.summary_compatibility,
            "artifactFlags": list(hr_measurement.artifact_flags),
            "reasons": list(hr_measurement.reasons),
            "diagnosticVersion": hr_measurement.diagnostic_version,
        }

    if detail is None:
        return payload

    if detail.power_zones:
        payload["powerInZones"] = [
            {
                "zoneNumber": bucket.zone_number,
                "secondsInZone": bucket.seconds_in_zone,
                **({"lowBoundary": bucket.low_boundary} if bucket.low_boundary is not None else {}),
            }
            for bucket in detail.power_zones
        ]
    if detail.hr_zones:
        payload["hrInZones"] = [
            {
                "zoneNumber": bucket.zone_number,
                "secondsInZone": bucket.seconds_in_zone,
                **({"lowBoundary": bucket.low_boundary} if bucket.low_boundary is not None else {}),
            }
            for bucket in detail.hr_zones
        ]
    if detail.normalized_power_watts is not None:
        payload["normalizedPower"] = detail.normalized_power_watts
    if detail.intensity_factor is not None:
        payload["intensityFactor"] = detail.intensity_factor
    if detail.variability_index is not None:
        payload["variabilityIndex"] = detail.variability_index
    if detail.laps:
        payload["laps"] = [
            {
                "lapIndex": lap.lap_index,
                "durationSeconds": lap.duration_seconds,
                **(
                    {"averagePowerWatts": lap.average_power_watts}
                    if lap.average_power_watts is not None
                    else {}
                ),
                **({"averageHrBpm": lap.average_hr_bpm} if lap.average_hr_bpm is not None else {}),
            }
            for lap in detail.laps
        ]
    # None means the endpoint was not fetched / detail enrichment failed, so omitting
    # the key preserves any previously-synced value under Firestore merge semantics.
    # [] means the endpoint succeeded and Garmin now reports zero work sets, so writing
    # the empty array deliberately clears a stale older exerciseSets value.
    if detail.exercise_sets is not None:
        payload["exerciseSets"] = [
            {
                key: value
                for key, value in {
                    "setOrder": es.set_order,
                    "setType": es.set_type,
                    "repetitionCount": es.repetition_count,
                    "weightKg": es.weight_kg,
                    "exerciseCategory": es.exercise_category,
                    "exerciseName": es.exercise_name,
                    "durationSeconds": es.duration_seconds,
                    "restDurationSeconds": es.rest_duration_seconds,
                }.items()
                if value is not None
            }
            for es in detail.exercise_sets
        ]
    return payload


def _build_training_summary(
    activities: list[CanonicalActivity], date_iso: str
) -> YesterdayTraining | None:
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


def _build_metric_dates(
    canonical: CanonicalDailyMetrics,
    target_date_iso: str,
    activities_through_iso: str | None,
) -> MetricDates:
    # SpO2 and skin-temperature deviation either belong to target-date sleep or, when
    # canonicalization selected the D-1 sleep fallback, to that fallback night. Daily
    # Pulse Ox is suppressed in the fallback case, so a single provenance date remains
    # truthful for the entire optional SpO2 object.
    selected_sleep_date = canonical.sleep_date or target_date_iso
    return MetricDates(
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
        stress=target_date_iso if canonical.stress is not None else None,
        bodyBattery=target_date_iso if canonical.body_battery is not None else None,
        trainingReadiness=target_date_iso if canonical.training_readiness is not None else None,
        trainingStatus=target_date_iso if canonical.training_status is not None else None,
        weight=canonical.weight_date if canonical.weight_kg is not None else None,
        spo2=selected_sleep_date if canonical.spo2 is not None else None,
        skinTempDeviation=(
            selected_sleep_date if canonical.skin_temp_deviation_celsius is not None else None
        ),
    )


def _build_raw_metrics(
    canonical: CanonicalDailyMetrics,
    canonical_activities: list[CanonicalActivity],
    target_date_iso: str,
    yesterday_iso: str,
    three_days_ago_iso: str,
) -> RawMetrics:
    # 3-day hard-session lookback stays yesterday-and-earlier by design: it measures
    # accumulated load *going into* today, not today's own session.
    hard_sessions_count = sum(
        1
        for act in canonical_activities
        if act.date
        and three_days_ago_iso <= act.date <= yesterday_iso
        and act.intensity_tag == "hard"
    )

    y_train = _build_training_summary(canonical_activities, yesterday_iso)
    today_train = _build_training_summary(canonical_activities, target_date_iso)

    stress_summary = (
        StressSummary(avg=canonical.stress.avg, max=canonical.stress.max)
        if canonical.stress is not None
        else None
    )
    training_readiness_summary = (
        TrainingReadinessSummary(
            score=canonical.training_readiness.score,
            level=canonical.training_readiness.level,
            feedback=canonical.training_readiness.feedback,
        )
        if canonical.training_readiness is not None
        else None
    )
    training_status_summary = (
        TrainingStatusSummary(
            statusPhrase=canonical.training_status.status_phrase,
            acuteTrainingLoad=canonical.training_status.acute_training_load,
            acwrStatus=canonical.training_status.acwr_status,
            vo2MaxRunning=canonical.training_status.vo2max_running,
            vo2MaxRunningDate=canonical.training_status.vo2max_running_date,
            vo2MaxCycling=canonical.training_status.vo2max_cycling,
            vo2MaxCyclingDate=canonical.training_status.vo2max_cycling_date,
        )
        if canonical.training_status is not None
        else None
    )
    heart_rate_zones_summary = (
        HeartRateZonesSummary(
            restingHrUsed=canonical.heart_rate_zones.resting_hr_used,
            maxHrUsed=canonical.heart_rate_zones.max_hr_used,
            zone4Floor=canonical.heart_rate_zones.zone4_floor,
            sport=canonical.heart_rate_zones.sport,
        )
        if canonical.heart_rate_zones is not None
        else None
    )

    spo2_summary = (
        Spo2Summary(
            avgPct=canonical.spo2.avg_pct,
            minPct=canonical.spo2.min_pct,
            sleepAvgPct=canonical.spo2.sleep_avg_pct,
        )
        if canonical.spo2 is not None
        else None
    )

    return RawMetrics(
        sleepScore=canonical.sleep_score,
        sleepDurationSec=canonical.sleep_duration_seconds,
        sleepSessionStart=canonical.sleep_session_start.isoformat()
        if canonical.sleep_session_start is not None
        else None,
        sleepSessionEnd=canonical.sleep_session_end.isoformat()
        if canonical.sleep_session_end is not None
        else None,
        deepSleepSec=canonical.deep_sleep_seconds,
        remSleepSec=canonical.rem_sleep_seconds,
        lightSleepSec=canonical.light_sleep_seconds,
        awakeSleepSec=canonical.awake_sleep_seconds,
        restlessMomentsCount=canonical.restless_moments_count,
        awakeCount=canonical.awake_count,
        restingHr=canonical.resting_heart_rate_bpm,
        hrvOvernightAvg=canonical.hrv_overnight_avg_ms,
        hrvStatus=canonical.hrv_status,
        respirationAvg=canonical.respiration_rate_brpm,
        bodyBatteryWake=canonical.body_battery_wake,
        bodyBatteryChange=canonical.body_battery.change
        if canonical.body_battery is not None
        else None,
        bodyBatteryCharged=canonical.body_battery.charged
        if canonical.body_battery is not None
        else None,
        bodyBatteryDrained=canonical.body_battery.drained
        if canonical.body_battery is not None
        else None,
        totalSteps=canonical.steps_count,
        last3DaysHardSessionsCount=hard_sessions_count,
        yesterdayTraining=y_train,
        todayTraining=today_train,
        stress=stress_summary,
        trainingReadiness=training_readiness_summary,
        trainingStatus=training_status_summary,
        heartRateZones=heart_rate_zones_summary,
        weightKg=canonical.weight_kg,
        bodyFatPct=canonical.body_fat_pct,
        spo2=spo2_summary,
        skinTempDeviationCelsius=canonical.skin_temp_deviation_celsius,
        recoveryTimeHours=canonical.recovery_time_hours,
    )


def _build_data_quality(
    canonical: CanonicalDailyMetrics,
    derived_metrics: DerivedMetrics,
) -> DataQuality:
    spo2_available = canonical.spo2 is not None and any(
        value is not None
        for value in (
            canonical.spo2.avg_pct,
            canonical.spo2.min_pct,
            canonical.spo2.sleep_avg_pct,
        )
    )
    return DataQuality(
        sleepScoreAvailable=canonical.sleep_score is not None,
        sleepTimingAvailable=canonical.sleep_session_start is not None
        and canonical.sleep_session_end is not None,
        restingHrAvailable=canonical.resting_heart_rate_bpm is not None,
        hrvAvailable=canonical.hrv_overnight_avg_ms is not None,
        baseline7dReady=derived_metrics.restingHr7dAvg is not None,
        baseline28dReady=derived_metrics.restingHr28dAvg is not None,
        stressAvailable=canonical.stress is not None and canonical.stress.avg is not None,
        bodyBatteryDetailAvailable=canonical.body_battery is not None
        and canonical.body_battery.change is not None,
        trainingReadinessAvailable=canonical.training_readiness is not None
        and canonical.training_readiness.score is not None,
        trainingStatusAvailable=canonical.training_status is not None
        and canonical.training_status.status_phrase is not None,
        heartRateZonesAvailable=canonical.heart_rate_zones is not None
        and canonical.heart_rate_zones.max_hr_used is not None,
        spo2Available=spo2_available,
        skinTempAvailable=canonical.skin_temp_deviation_celsius is not None,
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

    metric_dates = _build_metric_dates(canonical, target_date_iso, activities_through_iso)

    raw = _build_raw_metrics(
        canonical,
        canonical_activities,
        target_date_iso,
        yesterday_iso,
        three_days_ago_iso,
    )

    data_quality = _build_data_quality(canonical, derived_metrics)

    now_iso = synced_at_iso or datetime.now(timezone.utc).isoformat()

    source = SourceMetadata(
        garminSyncedAt=now_iso,
        sourceSchemaVersion=SCHEMA_VERSION,
        timezone=timezone_name,
        metricDates=metric_dates,
        garminconnectVersion=garminconnect_version,
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
