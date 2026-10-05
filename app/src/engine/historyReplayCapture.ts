import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { ROLLING_LOAD_BUDGET_LOOKBACK_DAYS } from './rollingLoadBudget';
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

function validExposureArray(value: unknown, throughDateExclusive: string, windowDays: number): value is CompletedExposure[] {
    if (!Array.isArray(value)) return false;
    const start = addDaysToLocalDateString(throughDateExclusive, -windowDays);
    return value.every(exposure => isObject(exposure)
        && validLocalDate(exposure.date)
        && exposure.date >= start
        && exposure.date < throughDateExclusive);
}

function validSnapshot(value: unknown, throughDateExclusive: string, windowDays: number): value is TrainingHistorySnapshot {
    if (!isObject(value)
        || value.throughDateExclusive !== throughDateExclusive
        || value.windowDays !== windowDays
        || !Array.isArray(value.completedEvents)
        || !validExposureArray(value.exposures, throughDateExclusive, windowDays)
        || !isObject(value.sourceStates)
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
            return validSnapshot(request.snapshot, expectedThroughDateExclusive, request.windowDays as number);
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

    const provider: TrainingHistoryProvider = {
        async reconstruct(userId, throughDateExclusive, windowDays) {
            const exposures = await source.reconstruct(userId, throughDateExclusive, windowDays);
            if (requestIsBounded(userId, throughDateExclusive, windowDays)) {
                requests.push({
                    kind: 'reconstruct',
                    throughDateExclusive,
                    windowDays,
                    exposures: copyJson(exposures),
                });
            }
            return exposures;
        },
        ...(source.getSnapshot ? {
            async getSnapshot(userId: string, throughDateExclusive: string, windowDays: number) {
                const snapshot = await source.getSnapshot!(userId, throughDateExclusive, windowDays);
                if (requestIsBounded(userId, throughDateExclusive, windowDays)) {
                    requests.push({
                        kind: 'snapshot' as const,
                        throughDateExclusive,
                        windowDays,
                        snapshot: copyJson(snapshot),
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

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
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
    if (!validateTrainingHistoryReplayCapture(capture, date)) {
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
        if (stableJson(expected) !== stableJson(candidate.exposures)) {
            throw new Error('captured_history_replay_inconsistent');
        }
    }
    return {
        windowDays: widest.windowDays,
        revision: widest.revision ?? `${preparedSnapshot.revision}:captured:${widest.windowDays}`,
        exposures: copyJson(widest.exposures),
    };
}
