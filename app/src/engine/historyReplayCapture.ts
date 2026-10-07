import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { ROLLING_LOAD_BUDGET_LOOKBACK_DAYS } from './rollingLoadBudget';
import { canonicalise } from './externalPlanHash';
import { addDaysToLocalDateString } from '../utils/localDate';

export const TRAINING_HISTORY_REPLAY_CAPTURE_SCHEMA_VERSION = 1 as const;
export const MAX_TRAINING_HISTORY_REPLAY_WINDOW_DAYS = ROLLING_LOAD_BUDGET_LOOKBACK_DAYS;

export type CapturedTrainingHistoryRequest =
    | {
        kind: 'snapshot';
        throughDateExclusive: string;
        windowDays: number;
        snapshot: TrainingHistorySnapshot;
    }
    | {
        kind: 'reconstruct';
        throughDateExclusive: string;
        windowDays: number;
        exposures: CompletedExposure[];
    };

/**
 * Exact normalized responses requested by one same-day evaluator beyond its already-prepared
 * operational snapshot. The capture is intentionally bounded to the engine's current maximum
 * rolling-history lookback and contains engine-shaped rows only -- never raw activity,
 * recommendation, execution, or Firestore documents.
 */
export interface TrainingHistoryReplayCapture {
    schemaVersion: typeof TRAINING_HISTORY_REPLAY_CAPTURE_SCHEMA_VERSION;
    requests: CapturedTrainingHistoryRequest[];
}

function copyJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validLocalDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function numericProfile(value: unknown, keys: readonly string[], required = false): boolean {
    return isObject(value) && Object.entries(value).every(([key, number]) => keys.includes(key) && nonNegative(number))
        && (!required || keys.every(key => Object.hasOwn(value, key)));
}

const COST_KEYS = ['systemic', 'cardiovascular', 'lowerBody', 'upperBody', 'impactTissue', 'neuromuscular'];
const STIMULUS_KEYS = ['aerobicEndurance', 'thresholdPower', 'vo2MaxPower', 'repeatedSurges', 'sprintPower', 'fatigueResistance', 'maxStrength', 'hypertrophy'];
const EXPOSURE_KEYS = ['occurrenceKey', 'date', 'costProfile', 'trainingRecordLike', 'deliveredDose', 'templateId', 'workoutId',
    'recoveryHours', 'stimulusProfile', 'stimulusConfidence', 'stimulusDomain', 'sessionCost', 'intensityEvidence',
    'intensityClassificationVersion', 'modality', 'category'];

function validExposureArray(value: unknown, throughDateExclusive: string, windowDays: number): value is CompletedExposure[] {
    if (!Array.isArray(value)) return false;
    const start = addDaysToLocalDateString(throughDateExclusive, -windowDays);
    const optionalEnum = (row: Record<string, unknown>, key: string, values: readonly string[]) =>
        row[key] === undefined || (typeof row[key] === 'string' && values.includes(row[key] as string));
    return value.every(exposure => isObject(exposure)
        && Object.keys(exposure).every(key => EXPOSURE_KEYS.includes(key))
        && validLocalDate(exposure.date) && exposure.date >= start && exposure.date < throughDateExclusive
        && numericProfile(exposure.costProfile, COST_KEYS, true)
        && isObject(exposure.trainingRecordLike)
        && Object.keys(exposure.trainingRecordLike).every(key => ['type', 'duration_min', 'training_effect', 'intensity_tag'].includes(key))
        && typeof exposure.trainingRecordLike.type === 'string'
        && nonNegative(exposure.trainingRecordLike.duration_min)
        && nonNegative(exposure.trainingRecordLike.training_effect)
        && typeof exposure.trainingRecordLike.intensity_tag === 'string'
        && ['occurrenceKey', 'templateId', 'workoutId', 'intensityEvidence'].every(key => exposure[key] === undefined || typeof exposure[key] === 'string')
        && (exposure.recoveryHours === undefined || nonNegative(exposure.recoveryHours))
        && (exposure.intensityClassificationVersion === undefined || (Number.isSafeInteger(exposure.intensityClassificationVersion) && nonNegative(exposure.intensityClassificationVersion)))
        && (exposure.deliveredDose === undefined || numericProfile(exposure.deliveredDose, ['plannedDurationMin', 'completedDurationMin', 'completionRatio']))
        && (exposure.stimulusProfile === undefined || numericProfile(exposure.stimulusProfile, STIMULUS_KEYS, true))
        && optionalEnum(exposure, 'stimulusConfidence', ['exact', 'inferred', 'unknown'])
        && optionalEnum(exposure, 'stimulusDomain', ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'anaerobic', 'mixed', 'race', 'strength', 'unknown'])
        && optionalEnum(exposure, 'sessionCost', ['low', 'moderate', 'high', 'very_high', 'unknown'])
        && optionalEnum(exposure, 'modality', ['Running', 'Cycling', 'Swimming', 'Walking', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'])
        && optionalEnum(exposure, 'category', ['Hard Endurance', 'Moderate Endurance', 'Easy Endurance', 'Race-Specific Endurance', 'Upper-body Strength', 'Lower-body Strength', 'Full-body Strength', 'Power Maintenance', 'Field Maintenance', 'Technical Skill', 'Mobility/Recovery', 'Rest']));
}

/** Normalized event metadata is retained for audit parity; free-text feedback is not replay input. */
export function captureReplaySnapshot(snapshot: TrainingHistorySnapshot): TrainingHistorySnapshot {
    return copyJson({ ...snapshot, completedEvents: snapshot.completedEvents.map(event => ({
        ...event, athleteFeedback: { ...event.athleteFeedback, notes: null },
    })) });
}

export function validateReplaySnapshot(value: unknown, throughDateExclusive: string, windowDays: number): value is TrainingHistorySnapshot {
    if (!Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > MAX_TRAINING_HISTORY_REPLAY_WINDOW_DAYS
        || !isObject(value)
        || value.throughDateExclusive !== throughDateExclusive
        || value.windowDays !== windowDays
        || !Array.isArray(value.completedEvents)
        || !validExposureArray(value.exposures, throughDateExclusive, windowDays)
        || !value.completedEvents.every(event => isObject(event) && validLocalDate(event.date)
            && event.date >= addDaysToLocalDateString(throughDateExclusive, -windowDays)
            && event.date < throughDateExclusive
            && isObject(event.athleteFeedback) && event.athleteFeedback.notes === null)
        || !isObject(value.sourceStates)
        || !['activities', 'recommendations', 'manualTraining'].every(key => {
            const state = (value.sourceStates as Record<string, unknown>)[key];
            return isObject(state) && ['AVAILABLE', 'MISSING'].includes(String(state.status));
        })
        || (value.athleteStateEvidence !== undefined && (!isObject(value.athleteStateEvidence)
            || !Number.isSafeInteger(value.athleteStateEvidence.observedWindowDays)
            || (value.athleteStateEvidence.observedWindowDays as number) < 1
            || (value.athleteStateEvidence.observedWindowDays as number) > MAX_TRAINING_HISTORY_REPLAY_WINDOW_DAYS
            || !validExposureArray(value.athleteStateEvidence.exposures, throughDateExclusive,
                value.athleteStateEvidence.observedWindowDays as number)))
        || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
        || typeof value.revision !== 'string' || !value.revision) return false;
    return true;
}

export function validateTrainingHistoryReplayCapture(
    value: unknown,
    expectedThroughDateExclusive: string,
): value is TrainingHistoryReplayCapture {
    if (!isObject(value)
        || value.schemaVersion !== TRAINING_HISTORY_REPLAY_CAPTURE_SCHEMA_VERSION
        || !Array.isArray(value.requests)) return false;
    return value.requests.every(request => {
        if (!isObject(request)
            || request.throughDateExclusive !== expectedThroughDateExclusive
            || !Number.isSafeInteger(request.windowDays)
            || (request.windowDays as number) < 1
            || (request.windowDays as number) > MAX_TRAINING_HISTORY_REPLAY_WINDOW_DAYS) return false;
        if (request.kind === 'snapshot') {
            return validateReplaySnapshot(request.snapshot, expectedThroughDateExclusive, request.windowDays as number);
        }
        return request.kind === 'reconstruct'
            && validExposureArray(request.exposures, expectedThroughDateExclusive, request.windowDays as number);
    });
}

export interface TrainingHistoryReplayRecorder {
    provider: TrainingHistoryProvider;
    finish(): TrainingHistoryReplayCapture | null;
}

/**
 * Wrap one evaluator invocation, recording only the exact bounded provider responses it used.
 * Out-of-bound or cross-user/date requests are still delegated so athlete-facing behavior is
 * unchanged, but the capture is invalidated so persistence/replay fails closed instead of
 * claiming reproducibility it cannot prove.
 */
export function createTrainingHistoryReplayRecorder(
    source: TrainingHistoryProvider,
    expected: { userId: string; throughDateExclusive: string },
): TrainingHistoryReplayRecorder {
    const requests: CapturedTrainingHistoryRequest[] = [];
    let invalidated = false;

    const requestIsBounded = (userId: string, throughDateExclusive: string, windowDays: number) => {
        const valid = userId === expected.userId
            && throughDateExclusive === expected.throughDateExclusive
            && Number.isSafeInteger(windowDays)
            && windowDays >= 1
            && windowDays <= MAX_TRAINING_HISTORY_REPLAY_WINDOW_DAYS;
        if (!valid) invalidated = true;
        return valid;
    };

    const record = (request: CapturedTrainingHistoryRequest) => {
        try {
            const captured = request.kind === 'snapshot'
                ? { ...request, snapshot: captureReplaySnapshot(request.snapshot) } : copyJson(request);
            if (!validateTrainingHistoryReplayCapture({ schemaVersion: 1, requests: [captured] }, expected.throughDateExclusive)) {
                invalidated = true;
            } else requests.push(captured);
        } catch { invalidated = true; }
    };
    const provider: TrainingHistoryProvider = {
        async reconstruct(userId, throughDateExclusive, windowDays) {
            const exposures = await source.reconstruct(userId, throughDateExclusive, windowDays);
            if (requestIsBounded(userId, throughDateExclusive, windowDays)) {
                record({
                    kind: 'reconstruct',
                    throughDateExclusive,
                    windowDays,
                    exposures,
                });
            }
            return exposures;
        },
        ...(source.getSnapshot ? {
            async getSnapshot(userId: string, throughDateExclusive: string, windowDays: number) {
                const snapshot = await source.getSnapshot!(userId, throughDateExclusive, windowDays);
                if (requestIsBounded(userId, throughDateExclusive, windowDays)) {
                    record({
                        kind: 'snapshot' as const,
                        throughDateExclusive,
                        windowDays,
                        snapshot,
                    });
                }
                return snapshot;
            },
        } : {}),
    };

    return {
        provider,
        finish() {
            if (invalidated) return null;
            return copyJson({ schemaVersion: TRAINING_HISTORY_REPLAY_CAPTURE_SCHEMA_VERSION, requests });
        },
    };
}


function windowed(
    exposures: readonly CompletedExposure[],
    throughDateExclusive: string,
    windowDays: number,
): CompletedExposure[] {
    const start = addDaysToLocalDateString(throughDateExclusive, -windowDays);
    return exposures.filter(exposure => exposure.date >= start && exposure.date < throughDateExclusive);
}

export interface CollapsedTrainingHistoryReplay {
    windowDays: number;
    revision: string;
    exposures: CompletedExposure[];
}

/**
 * Proves that the prepared operational snapshot plus every captured provider response can be
 * represented by one immutable broad exposure set. If history changed between reads, the
 * responses will disagree under a shared window and replay must remain blocked.
 */
export function collapseTrainingHistoryReplay(
    preparedSnapshot: TrainingHistorySnapshot,
    capture: TrainingHistoryReplayCapture,
): CollapsedTrainingHistoryReplay {
    const date = preparedSnapshot.throughDateExclusive;
    if (!validateReplaySnapshot(preparedSnapshot, date, preparedSnapshot.windowDays)
        || !validateTrainingHistoryReplayCapture(capture, date)) {
        throw new Error('captured_history_replay_invalid');
    }
    const candidates: Array<{ windowDays: number; exposures: CompletedExposure[]; revision?: string }> = [{
        windowDays: preparedSnapshot.windowDays,
        exposures: preparedSnapshot.exposures,
        revision: preparedSnapshot.revision,
    }];
    for (const request of capture.requests) {
        candidates.push(request.kind === 'snapshot'
            ? { windowDays: request.windowDays, exposures: request.snapshot.exposures, revision: request.snapshot.revision }
            : { windowDays: request.windowDays, exposures: request.exposures });
    }
    const widest = candidates.reduce((best, candidate) => candidate.windowDays > best.windowDays ? candidate : best);
    for (const candidate of candidates) {
        const expected = windowed(widest.exposures, date, candidate.windowDays);
        if (JSON.stringify(canonicalise(expected)) !== JSON.stringify(canonicalise(candidate.exposures))) {
            throw new Error('captured_history_replay_inconsistent');
        }
    }
    return {
        windowDays: widest.windowDays,
        revision: widest.revision ?? `${preparedSnapshot.revision}:captured:${widest.windowDays}`,
        exposures: copyJson(widest.exposures),
    };
}
