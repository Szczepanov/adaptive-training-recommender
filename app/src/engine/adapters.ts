import type { DailyRecoverySnapshot, EngineObjectiveInput } from './models';

/**
 * Maps the Firestore canonical model (DailyRecoverySnapshot) to the internal engine 
 * input model (EngineObjectiveInput) expected by the rules engine.
 * This decouples the rules engine from the Firestore schema.
 */
export function mapSnapshotToEngineInput(snapshot: DailyRecoverySnapshot): EngineObjectiveInput {
    // Determine the sleep_min: convert from seconds
    const sleepDurationMin = snapshot.raw.sleepDurationSec 
        ? Math.round(snapshot.raw.sleepDurationSec / 60) 
        : null;

    // Convert intensityTag to lowercase to match engine expectations if needed, but the backend provides it as standard.
    const yesterdayTrainingObj = snapshot.raw.yesterdayTraining ? {
        type: snapshot.raw.yesterdayTraining.type,
        duration_min: snapshot.raw.yesterdayTraining.durationMin,
        training_effect: snapshot.raw.yesterdayTraining.trainingEffect,
        intensity_tag: snapshot.raw.yesterdayTraining.intensityTag
    } : null;

    return {
        total_steps: snapshot.raw.totalSteps,
        sleep_score: snapshot.raw.sleepScore,
        sleep_duration_min: sleepDurationMin,
        rhr: snapshot.raw.restingHr,
        rhr_7d_avg: snapshot.derived.restingHr7dAvg,
        rhr_delta: snapshot.derived.deltas.restingHrVs7d,
        hrv_weekly_avg: snapshot.derived.hrv7dAvg, // engine used hrv_weekly_avg, maps to 7dAvg
        hrv_last_night: snapshot.raw.hrvOvernightAvg,
        hrv_delta: snapshot.derived.deltas.hrvVs7d,
        respiration: snapshot.raw.respirationAvg,
        body_battery_wake: snapshot.raw.bodyBatteryWake,
        last_3_days_hard_sessions_count: snapshot.raw.last3DaysHardSessionsCount,
        yesterday_training: yesterdayTrainingObj,
    };
}
