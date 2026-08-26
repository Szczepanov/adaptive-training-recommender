import { getPreviousLocalDateString } from '../utils/localDate';
import type { DailyDecisionInput, DailyRecoverySnapshot } from './models';

/**
 * Dashboard-facing observability only. This evaluator describes the evidence available
 * at composition time; it does not change readiness mode, eligibility, dose, or ranking.
 * Existing safety rules remain the sole decision authority.
 */
export type ConfidenceRating = 'HIGH' | 'MODERATE' | 'LOW' | 'INSUFFICIENT';
export type SensorTier = 'FULL_WEARABLE' | 'BASIC_WEARABLE' | 'SUBJECTIVE_ONLY';
export type SignalStatus = 'PRESENT' | 'DEGRADED' | 'STALE' | 'MISSING' | 'INVALID';

export interface SignalQualityDetail {
    signal: string;
    displayName: string;
    status: SignalStatus;
    value: number | string | boolean | null;
    unit?: string;
    freshnessHours?: number | null;
    historyDays?: number | null;
    observedDate?: string | null;
    expectedDate?: string;
    validRange?: [number, number];
    isPlausible: boolean;
    issues?: string[];
}

export interface ConfidenceBreakdown {
    completenessScore: number;
    freshnessScore: number;
    baselineMaturityScore: number;
    plausibilityScore: number;
}

export interface DataConfidenceScore {
    rating: ConfidenceRating;
    score: number;
    sensorTier: SensorTier;
    breakdown: ConfidenceBreakdown;
    signals: Record<string, SignalQualityDetail>;
    activeSafeguards: string[];
    summaryMessage: string;
}

export const PHYSIOLOGICAL_BOUNDS = {
    hrv: { min: 8, max: 300, warnMin: 15, warnMax: 200, unit: 'ms' },
    rhr: { min: 28, max: 140, warnMin: 35, warnMax: 100, unit: 'bpm' },
    sleepScore: { min: 0, max: 100, unit: 'pts' },
    sleepDurationMin: { min: 60, max: 900, warnMin: 180, warnMax: 720, unit: 'min' },
    respiration: { min: 6, max: 35, warnMin: 8, warnMax: 25, unit: 'brpm' },
    bodyBattery: { min: 0, max: 100, unit: 'pts' },
    steps: { min: 0, max: 100000, warnMax: 50000, unit: 'steps' },
    subjectiveScale: { min: 1, max: 10, unit: '1-10' },
} as const;

export const FRESHNESS_LIMITS_HOURS = {
    sleep: 18,
    biometrics: 18,
    bodyBatteryWake: 14,
    stepsD1: 36,
    subjectiveCheckin: 24,
} as const;

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isWithinRange(value: unknown, min: number, max: number): value is number {
    return isFiniteNumber(value) && value >= min && value <= max;
}

function ageHours(timestamp: string | null | undefined, now: Date): number | null {
    if (!timestamp) return null;
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.getTime())) return null;
    const age = (now.getTime() - parsed.getTime()) / 3_600_000;
    if (age < -(5 / 60)) return null;
    return Math.max(0, age);
}

function statusForCurrentSignal(options: {
    plausible: boolean;
    freshnessHours: number | null;
    freshnessLimitHours: number;
    observedDate: string | null;
    expectedDate: string;
    degraded?: boolean;
}): SignalStatus {
    if (!options.plausible) return 'INVALID';
    if (options.observedDate !== null && options.observedDate !== options.expectedDate) return 'STALE';
    if (options.freshnessHours !== null && options.freshnessHours > options.freshnessLimitHours) return 'STALE';
    if (options.freshnessHours === null || options.degraded) return 'DEGRADED';
    return 'PRESENT';
}

function historyDays(
    snapshot: DailyRecoverySnapshot,
    sevenDayValue: unknown,
    twentyEightDayValue: unknown,
    twentyEightDaySpread: unknown,
): number {
    if (
        snapshot.dataQuality?.baseline28dReady === true
        && isFiniteNumber(twentyEightDayValue)
        && isFiniteNumber(twentyEightDaySpread)
    ) return 28;
    if (snapshot.dataQuality?.baseline7dReady === true && isFiniteNumber(sevenDayValue)) return 7;
    return 0;
}

function baselineScore(days: number): number {
    if (days >= 28) return 100;
    if (days >= 7) return 60;
    return 20;
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function statusCompleteness(status: SignalStatus): number {
    if (status === 'PRESENT') return 1;
    if (status === 'DEGRADED') return 0.75;
    if (status === 'STALE') return 0.25;
    return 0;
}

function statusFreshness(status: SignalStatus): number {
    if (status === 'PRESENT') return 100;
    if (status === 'DEGRADED') return 70;
    return 0;
}

export function evaluateDataConfidence(
    input: DailyDecisionInput,
    evaluationTimestampIso: string = new Date().toISOString(),
): DataConfidenceScore {
    const signals: Record<string, SignalQualityDetail> = {};
    const activeSafeguards: string[] = [];
    const snapshot = input.recoverySnapshot;
    const checkin = input.subjectiveCheckin;
    const evaluationTime = new Date(evaluationTimestampIso);
    if (!Number.isFinite(evaluationTime.getTime())) {
        throw new Error('Data-confidence evaluation timestamp must be a valid ISO date-time.');
    }

    const subjectiveValues = checkin
        ? [checkin.readiness, checkin.fatigue, checkin.soreness, checkin.mentalStress, checkin.sleepQuality, checkin.motivation]
        : [];
    const subjectiveScalesValid = subjectiveValues.length > 0
        && subjectiveValues.every(value => isWithinRange(value, PHYSIOLOGICAL_BOUNDS.subjectiveScale.min, PHYSIOLOGICAL_BOUNDS.subjectiveScale.max));
    const subjectiveTimeValid = checkin !== null && isWithinRange(checkin.availability?.timeAvailableMin, 0, 360);
    const subjectiveShapeValid = checkin !== null
        && typeof checkin.painOrInjury === 'boolean'
        && typeof checkin.illnessSymptoms === 'boolean';
    const subjectivePlausible = subjectiveScalesValid && subjectiveTimeValid && subjectiveShapeValid;
    const subjectiveAge = ageHours(checkin?.submittedAt, evaluationTime);
    const subjectiveIssues: string[] = [];
    if (checkin && !subjectiveScalesValid) subjectiveIssues.push('Check-in scale values must be between 1 and 10.');
    if (checkin && !subjectiveTimeValid) subjectiveIssues.push('Available time must be between 0 and 360 minutes.');
    if (checkin && !subjectiveShapeValid) subjectiveIssues.push('Required safety answers are missing.');
    if (checkin && checkin.date !== input.date) subjectiveIssues.push(`Check-in is for ${checkin.date}, not ${input.date}.`);
    if (checkin?.dataQuality.isComplete === false) subjectiveIssues.push('Check-in is incomplete; minimum safety fields remain available.');
    if (checkin && subjectiveAge === null) subjectiveIssues.push('Check-in submission time is unavailable or invalid.');

    let subjectiveStatus: SignalStatus = 'MISSING';
    if (checkin) {
        if (!subjectivePlausible) subjectiveStatus = 'INVALID';
        else if (checkin.date !== input.date || (subjectiveAge !== null && subjectiveAge > FRESHNESS_LIMITS_HOURS.subjectiveCheckin)) subjectiveStatus = 'STALE';
        else if (subjectiveAge === null || !checkin.dataQuality.isComplete) subjectiveStatus = 'DEGRADED';
        else subjectiveStatus = 'PRESENT';
    }
    signals.subjectiveCheckin = {
        signal: 'subjectiveCheckin', displayName: 'Daily Check-in', status: subjectiveStatus,
        value: checkin ? (checkin.dataQuality.isComplete ? 'Complete' : 'Minimum safety only') : null,
        freshnessHours: subjectiveAge,
        observedDate: checkin?.date ?? null, expectedDate: input.date, validRange: [1, 10],
        isPlausible: subjectivePlausible,
        issues: checkin ? subjectiveIssues : ['Subjective check-in has not been submitted today.'],
    };
    if (!checkin) activeSafeguards.push('Missing check-in: normal plan generation remains blocked by the existing safety gate.');
    else if (subjectiveStatus === 'INVALID' || subjectiveStatus === 'STALE') activeSafeguards.push('Unusable check-in: current subjective safety evidence is insufficient.');

    let hasPlausibleHrv = false;
    let hasPlausibleRhr = false;
    let hasPlausibleSleep = false;
    let hasPlausibleSteps = false;
    const baselineScores: number[] = [];

    if (snapshot?.raw && snapshot.derived) {
        const { raw, derived } = snapshot;
        const metricDates = snapshot.source?.metricDates;
        const syncAge = ageHours(snapshot.source?.garminSyncedAt, evaluationTime);

        const hrvValue = raw.hrvOvernightAvg;
        const hrvHistoryDays = historyDays(snapshot, derived.hrv7dAvg, derived.hrv28dAvg, derived.hrv28dStdev);
        if (hrvValue === null || hrvValue === undefined) {
            signals.hrv = { signal: 'hrv', displayName: 'Overnight HRV', status: 'MISSING', value: null, unit: 'ms', historyDays: hrvHistoryDays, isPlausible: false, issues: ['Overnight HRV was not recorded.'] };
        } else {
            const plausible = isWithinRange(hrvValue, PHYSIOLOGICAL_BOUNDS.hrv.min, PHYSIOLOGICAL_BOUNDS.hrv.max);
            const warning = plausible && (hrvValue < PHYSIOLOGICAL_BOUNDS.hrv.warnMin || hrvValue > PHYSIOLOGICAL_BOUNDS.hrv.warnMax);
            const observedDate = metricDates?.hrv ?? snapshot.date;
            const status = statusForCurrentSignal({ plausible, freshnessHours: syncAge, freshnessLimitHours: FRESHNESS_LIMITS_HOURS.biometrics, observedDate, expectedDate: input.date, degraded: warning });
            hasPlausibleHrv = plausible;
            baselineScores.push(baselineScore(hrvHistoryDays));
            signals.hrv = {
                signal: 'hrv', displayName: 'Overnight HRV', status, value: hrvValue, unit: 'ms', freshnessHours: syncAge,
                historyDays: hrvHistoryDays, observedDate, expectedDate: input.date,
                validRange: [PHYSIOLOGICAL_BOUNDS.hrv.min, PHYSIOLOGICAL_BOUNDS.hrv.max], isPlausible: plausible,
                issues: !plausible ? [`HRV ${hrvValue} ms is outside the physiological range.`] : warning ? ['HRV is within hard bounds but unusually extreme.'] : [],
            };
        }

        const rhrValue = raw.restingHr;
        const rhrHistoryDays = historyDays(snapshot, derived.restingHr7dAvg, derived.restingHr28dAvg, derived.restingHr28dStdev);
        if (rhrValue === null || rhrValue === undefined) {
            signals.rhr = { signal: 'rhr', displayName: 'Resting Heart Rate', status: 'MISSING', value: null, unit: 'bpm', historyDays: rhrHistoryDays, isPlausible: false, issues: ['Resting heart rate was not recorded.'] };
        } else {
            const plausible = isWithinRange(rhrValue, PHYSIOLOGICAL_BOUNDS.rhr.min, PHYSIOLOGICAL_BOUNDS.rhr.max);
            const warning = plausible && (rhrValue < PHYSIOLOGICAL_BOUNDS.rhr.warnMin || rhrValue > PHYSIOLOGICAL_BOUNDS.rhr.warnMax);
            const observedDate = metricDates?.restingHr ?? snapshot.date;
            const status = statusForCurrentSignal({ plausible, freshnessHours: syncAge, freshnessLimitHours: FRESHNESS_LIMITS_HOURS.biometrics, observedDate, expectedDate: input.date, degraded: warning });
            hasPlausibleRhr = plausible;
            baselineScores.push(baselineScore(rhrHistoryDays));
            signals.rhr = {
                signal: 'rhr', displayName: 'Resting Heart Rate', status, value: rhrValue, unit: 'bpm', freshnessHours: syncAge,
                historyDays: rhrHistoryDays, observedDate, expectedDate: input.date,
                validRange: [PHYSIOLOGICAL_BOUNDS.rhr.min, PHYSIOLOGICAL_BOUNDS.rhr.max], isPlausible: plausible,
                issues: !plausible ? [`Resting heart rate ${rhrValue} bpm is outside the physiological range.`] : warning ? ['Resting heart rate is within hard bounds but unusually extreme.'] : [],
            };
        }

        const sleepSeconds = raw.sleepDurationSec;
        const sleepMinutes = isFiniteNumber(sleepSeconds) ? Math.round(sleepSeconds / 60) : null;
        const sleepScore = raw.sleepScore;
        const durationPlausible = isWithinRange(sleepMinutes, PHYSIOLOGICAL_BOUNDS.sleepDurationMin.min, PHYSIOLOGICAL_BOUNDS.sleepDurationMin.max);
        const scorePlausible = sleepScore === null || sleepScore === undefined
            || isWithinRange(sleepScore, PHYSIOLOGICAL_BOUNDS.sleepScore.min, PHYSIOLOGICAL_BOUNDS.sleepScore.max);
        const sleepHistoryDays = historyDays(snapshot, derived.sleepScore7dAvg, derived.sleepScore28dAvg, derived.sleepScore28dStdev);
        if (sleepMinutes === null) {
            signals.sleep = { signal: 'sleep', displayName: 'Sleep Duration & Score', status: 'MISSING', value: null, unit: 'min', historyDays: sleepHistoryDays, isPlausible: false, issues: ['No sleep duration was recorded for last night.'] };
        } else {
            const plausible = durationPlausible && scorePlausible;
            const durationWarning = durationPlausible && (sleepMinutes < PHYSIOLOGICAL_BOUNDS.sleepDurationMin.warnMin || sleepMinutes > PHYSIOLOGICAL_BOUNDS.sleepDurationMin.warnMax);
            const observedDate = metricDates?.sleep ?? snapshot.date;
            const status = statusForCurrentSignal({
                plausible, freshnessHours: syncAge, freshnessLimitHours: FRESHNESS_LIMITS_HOURS.sleep,
                observedDate, expectedDate: input.date,
                degraded: durationWarning || sleepScore === null || sleepScore === undefined,
            });
            hasPlausibleSleep = plausible;
            baselineScores.push(baselineScore(sleepHistoryDays));
            const issues: string[] = [];
            if (!durationPlausible) issues.push(`Sleep duration ${sleepMinutes} minutes is outside the physiological range.`);
            if (!scorePlausible) issues.push(`Sleep score ${sleepScore} is outside 0-100.`);
            if (plausible && durationWarning) issues.push('Sleep duration is within hard bounds but unusually extreme.');
            if (plausible && (sleepScore === null || sleepScore === undefined)) issues.push('Sleep score is missing; duration-only evidence is available.');
            signals.sleep = {
                signal: 'sleep', displayName: 'Sleep Duration & Score', status,
                value: sleepScore === null || sleepScore === undefined ? `${sleepMinutes}m` : `${sleepMinutes}m (Score: ${sleepScore})`,
                unit: 'min', freshnessHours: syncAge, historyDays: sleepHistoryDays, observedDate, expectedDate: input.date,
                validRange: [PHYSIOLOGICAL_BOUNDS.sleepDurationMin.min, PHYSIOLOGICAL_BOUNDS.sleepDurationMin.max], isPlausible: plausible, issues,
            };
        }

        const expectedStepsDate = getPreviousLocalDateString(input.date);
        const stepsValue = raw.totalSteps;
        if (stepsValue === null || stepsValue === undefined) {
            signals.steps = { signal: 'steps', displayName: 'Ambient Steps (D-1)', status: 'MISSING', value: null, unit: 'steps', expectedDate: expectedStepsDate, isPlausible: false, issues: ['No step summary was recorded for D-1.'] };
        } else {
            const plausible = isWithinRange(stepsValue, PHYSIOLOGICAL_BOUNDS.steps.min, PHYSIOLOGICAL_BOUNDS.steps.max);
            const suspicious = plausible && stepsValue > PHYSIOLOGICAL_BOUNDS.steps.warnMax;
            const observedDate = metricDates?.steps ?? expectedStepsDate;
            const status = statusForCurrentSignal({ plausible, freshnessHours: syncAge, freshnessLimitHours: FRESHNESS_LIMITS_HOURS.stepsD1, observedDate, expectedDate: expectedStepsDate, degraded: suspicious });
            hasPlausibleSteps = plausible;
            signals.steps = {
                signal: 'steps', displayName: 'Ambient Steps (D-1)', status, value: stepsValue, unit: 'steps', freshnessHours: syncAge,
                observedDate, expectedDate: expectedStepsDate, validRange: [PHYSIOLOGICAL_BOUNDS.steps.min, PHYSIOLOGICAL_BOUNDS.steps.max], isPlausible: plausible,
                issues: !plausible ? [`Total steps ${stepsValue} exceeds the physiological bound.`] : suspicious ? ['Step count exceeds the suspicious-surge threshold and needs corroboration.'] : [],
            };
        }

        const respirationValue = raw.respirationAvg;
        if (respirationValue !== null && respirationValue !== undefined) {
            const plausible = isWithinRange(respirationValue, PHYSIOLOGICAL_BOUNDS.respiration.min, PHYSIOLOGICAL_BOUNDS.respiration.max);
            const warning = plausible && (respirationValue < PHYSIOLOGICAL_BOUNDS.respiration.warnMin || respirationValue > PHYSIOLOGICAL_BOUNDS.respiration.warnMax);
            const observedDate = metricDates?.sleep ?? snapshot.date;
            signals.respiration = {
                signal: 'respiration', displayName: 'Sleeping Respiration',
                status: statusForCurrentSignal({ plausible, freshnessHours: syncAge, freshnessLimitHours: FRESHNESS_LIMITS_HOURS.biometrics, observedDate, expectedDate: input.date, degraded: warning }),
                value: respirationValue, unit: 'brpm', freshnessHours: syncAge, observedDate, expectedDate: input.date,
                validRange: [PHYSIOLOGICAL_BOUNDS.respiration.min, PHYSIOLOGICAL_BOUNDS.respiration.max], isPlausible: plausible,
                issues: !plausible ? [`Respiration ${respirationValue} brpm is outside the physiological range.`] : warning ? ['Respiration is within hard bounds but unusually extreme.'] : [],
            };
        } else {
            signals.respiration = { signal: 'respiration', displayName: 'Sleeping Respiration', status: 'MISSING', value: null, unit: 'brpm', isPlausible: false };
        }

        const bodyBatteryValue = raw.bodyBatteryWake;
        if (bodyBatteryValue !== null && bodyBatteryValue !== undefined) {
            const plausible = isWithinRange(bodyBatteryValue, PHYSIOLOGICAL_BOUNDS.bodyBattery.min, PHYSIOLOGICAL_BOUNDS.bodyBattery.max);
            const observedDate = metricDates?.bodyBatteryWake ?? snapshot.date;
            signals.bodyBattery = {
                signal: 'bodyBattery', displayName: 'Body Battery (Wake)',
                status: statusForCurrentSignal({ plausible, freshnessHours: syncAge, freshnessLimitHours: FRESHNESS_LIMITS_HOURS.bodyBatteryWake, observedDate, expectedDate: input.date }),
                value: bodyBatteryValue, unit: 'pts', freshnessHours: syncAge, observedDate, expectedDate: input.date,
                validRange: [PHYSIOLOGICAL_BOUNDS.bodyBattery.min, PHYSIOLOGICAL_BOUNDS.bodyBattery.max], isPlausible: plausible,
                issues: plausible ? [] : [`Body Battery ${bodyBatteryValue} is outside 0-100.`],
            };
        } else {
            signals.bodyBattery = { signal: 'bodyBattery', displayName: 'Body Battery (Wake)', status: 'MISSING', value: null, unit: 'pts', isPlausible: false };
        }
    } else {
        signals.hrv = { signal: 'hrv', displayName: 'Overnight HRV', status: 'MISSING', value: null, unit: 'ms', isPlausible: false };
        signals.rhr = { signal: 'rhr', displayName: 'Resting Heart Rate', status: 'MISSING', value: null, unit: 'bpm', isPlausible: false };
        signals.sleep = { signal: 'sleep', displayName: 'Sleep Duration & Score', status: 'MISSING', value: null, unit: 'min', isPlausible: false };
        signals.steps = { signal: 'steps', displayName: 'Ambient Steps (D-1)', status: 'MISSING', value: null, unit: 'steps', expectedDate: getPreviousLocalDateString(input.date), isPlausible: false };
        signals.respiration = { signal: 'respiration', displayName: 'Sleeping Respiration', status: 'MISSING', value: null, unit: 'brpm', isPlausible: false };
        signals.bodyBattery = { signal: 'bodyBattery', displayName: 'Body Battery (Wake)', status: 'MISSING', value: null, unit: 'pts', isPlausible: false };
    }

    const sensorTier: SensorTier = hasPlausibleHrv && hasPlausibleRhr && hasPlausibleSleep
        ? 'FULL_WEARABLE'
        : hasPlausibleSleep || hasPlausibleRhr || hasPlausibleSteps
            ? 'BASIC_WEARABLE'
            : 'SUBJECTIVE_ONLY';
    const coreSignals = [signals.subjectiveCheckin, signals.sleep, signals.rhr, signals.hrv, signals.steps];
    const completenessScore = average(coreSignals.map(signal => statusCompleteness(signal.status) * 100));
    const timestampedSignals = coreSignals.filter(signal => signal.status !== 'MISSING');
    const freshnessScore = average(timestampedSignals.map(signal => statusFreshness(signal.status)));
    const baselineMaturityScore = average(baselineScores);
    const assessedSignals = Object.values(signals).filter(signal => signal.value !== null);
    const plausibilityScore = assessedSignals.length === 0
        ? 0
        : Math.round(assessedSignals.filter(signal => signal.isPlausible).length / assessedSignals.length * 100);

    const invalidCount = Object.values(signals).filter(signal => signal.status === 'INVALID').length;
    const staleCount = Object.values(signals).filter(signal => signal.status === 'STALE').length;
    if (!hasPlausibleHrv && hasPlausibleRhr && (snapshot?.derived?.deltas?.restingHrVs7d ?? 0) >= 3) {
        activeSafeguards.push('HRV is unavailable while RHR is elevated; the existing RHR safety signal remains active.');
    }
    if (!hasPlausibleSleep && subjectivePlausible) activeSafeguards.push('Sleep telemetry is unavailable; the dashboard can only show subjective sleep evidence.');
    if (invalidCount > 0) activeSafeguards.push(`${invalidCount} signal(s) are excluded from confidence because they are physiologically implausible.`);
    if (staleCount > 0) activeSafeguards.push(`${staleCount} signal(s) are stale for the target calendar date or freshness window.`);
    if (sensorTier === 'FULL_WEARABLE' && baselineMaturityScore < 80) activeSafeguards.push('Wearable baselines are still maturing; positive biometrics are not presented as high-confidence evidence.');
    if (sensorTier === 'BASIC_WEARABLE') activeSafeguards.push('Partial wearable coverage: confidence relies on the objective channels available today.');
    else if (sensorTier === 'SUBJECTIVE_ONLY') activeSafeguards.push('Subjective-only coverage: wearable telemetry is absent or unusable.');

    const score = Math.round(
        completenessScore * 0.35
        + freshnessScore * 0.25
        + baselineMaturityScore * 0.20
        + plausibilityScore * 0.20,
    );
    const subjectiveUsable = subjectiveStatus === 'PRESENT' || subjectiveStatus === 'DEGRADED';
    const fullFreshCoverage = subjectiveStatus === 'PRESENT'
        && signals.hrv.status === 'PRESENT'
        && signals.rhr.status === 'PRESENT'
        && signals.sleep.status === 'PRESENT'
        && signals.steps.status === 'PRESENT';
    const rating: ConfidenceRating = !subjectiveUsable
        ? 'INSUFFICIENT'
        : score >= 80 && sensorTier === 'FULL_WEARABLE' && fullFreshCoverage && baselineMaturityScore >= 80 && plausibilityScore === 100
            ? 'HIGH'
            : score >= 55 && (signals.sleep.status === 'PRESENT' || signals.sleep.status === 'DEGRADED' || signals.rhr.status === 'PRESENT' || signals.rhr.status === 'DEGRADED')
                ? 'MODERATE'
                : 'LOW';
    const summaryMessage: Record<ConfidenceRating, string> = {
        HIGH: 'Complete, current, plausible core signals with mature wearable baselines.',
        MODERATE: 'Key evidence is usable, with gaps, reduced freshness, or maturing baselines.',
        LOW: 'Several signals are missing, stale, or degraded; interpret the recommendation cautiously.',
        INSUFFICIENT: 'A current, usable safety check-in is missing; normal plan generation remains blocked.',
    };

    return {
        rating,
        score,
        sensorTier,
        breakdown: { completenessScore, freshnessScore, baselineMaturityScore, plausibilityScore },
        signals,
        activeSafeguards,
        summaryMessage: summaryMessage[rating],
    };
}
