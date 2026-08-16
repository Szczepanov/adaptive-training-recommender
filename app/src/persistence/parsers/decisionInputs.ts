import type { DataState } from '../../engine/dataState';
import type { DailyRecoverySnapshot, DailySubjectiveCheckin } from '../../engine/models';
import { isValidDate } from '../../engine/validation';

type RawDocument = Record<string, unknown>;

function isObject(value: unknown): value is RawDocument {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(documentPath: string, code: string, field?: string): DataState<never> {
    return { status: 'INVALID', issues: [{ code, documentPath, ...(field ? { field } : {}) }] };
}

function nullableNumber(value: unknown): boolean {
    return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function hasNullableNumbers(data: RawDocument, fields: string[]): boolean {
    return fields.every(field => nullableNumber(data[field]));
}

/** Validates the subset of the backend recovery contract consumed by the browser
 * engine. A malformed record is never cast into neutral readiness values. */
export function parseRecoverySnapshot(raw: unknown, documentPath: string, userId: string, date: string): DataState<DailyRecoverySnapshot> {
    if (!isObject(raw)) return issue(documentPath, 'not-an-object');
    if (raw.userId !== userId) return issue(documentPath, 'user-id-mismatch', 'userId');
    if (raw.date !== date || typeof raw.date !== 'string' || !isValidDate(raw.date)) return issue(documentPath, 'invalid-date', 'date');
    const source = raw.source;
    const metrics = raw.raw;
    const derived = raw.derived;
    const dataQuality = raw.dataQuality;
    if (!isObject(source) || typeof source.garminSyncedAt !== 'string' || ![2, 3].includes(source.sourceSchemaVersion as number)) {
        return issue(documentPath, 'invalid-source', 'source');
    }
    if (!isObject(metrics) || !isObject(derived) || !isObject(derived.deltas) || !isObject(dataQuality)) {
        return issue(documentPath, 'missing-engine-input-block');
    }
    if (!hasNullableNumbers(metrics, ['sleepScore', 'sleepDurationSec', 'restingHr', 'hrvOvernightAvg', 'respirationAvg', 'bodyBatteryWake', 'bodyBatteryChange', 'totalSteps'])
        || typeof metrics.last3DaysHardSessionsCount !== 'number'
        || !hasNullableNumbers(derived, ['sleepScore7dAvg', 'sleepScore28dAvg', 'restingHr7dAvg', 'restingHr28dAvg', 'hrv7dAvg', 'hrv28dAvg', 'respiration7dAvg', 'respiration28dAvg'])
        || !hasNullableNumbers(derived.deltas, ['sleepScoreVs7d', 'sleepScoreVs28d', 'restingHrVs7d', 'restingHrVs28d', 'hrvVs7d', 'hrvVs28d', 'respirationVs7d', 'respirationVs28d'])) {
        return issue(documentPath, 'invalid-engine-metric');
    }
    if (!['sleepScoreAvailable', 'restingHrAvailable', 'hrvAvailable', 'baseline7dReady', 'baseline28dReady']
        .every(field => typeof dataQuality[field] === 'boolean')) {
        return issue(documentPath, 'invalid-data-quality', 'dataQuality');
    }
    return {
        status: 'AVAILABLE',
        data: raw as unknown as DailyRecoverySnapshot,
        revision: typeof raw.updatedAt === 'string' ? raw.updatedAt : source.garminSyncedAt,
    };
}

/** Checks a persisted check-in without applying write-time defaults. This preserves the
 * distinction between an absent field and a deliberately answered `false`. */
export function parseSubjectiveCheckin(raw: unknown, documentPath: string, userId: string, date: string): DataState<DailySubjectiveCheckin> {
    if (!isObject(raw)) return issue(documentPath, 'not-an-object');
    if (raw.userId !== userId) return issue(documentPath, 'user-id-mismatch', 'userId');
    if (raw.date !== date || typeof raw.date !== 'string' || !isValidDate(raw.date)) return issue(documentPath, 'invalid-date', 'date');
    if (!isObject(raw.availability) || !isObject(raw.dataQuality)) return issue(documentPath, 'missing-checkin-block');
    if (!['painOrInjury', 'illnessSymptoms', 'unusuallyLimitedTime', 'alreadyTrainedToday'].every(field => typeof raw[field] === 'boolean')) {
        return issue(documentPath, 'invalid-safety-flag');
    }
    if (!hasNullableNumbers(raw, ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'mentalStress', 'motivation'])
        || !nullableNumber(raw.availability.timeAvailableMin)
        || !(raw.availability.preferredModalityToday === null || typeof raw.availability.preferredModalityToday === 'string')
        || typeof raw.availability.indoorOnly !== 'boolean'
        || typeof raw.dataQuality.isComplete !== 'boolean'
        || !Array.isArray(raw.dataQuality.missingFields)) {
        return issue(documentPath, 'invalid-checkin-field');
    }
    return {
        status: 'AVAILABLE',
        data: raw as unknown as DailySubjectiveCheckin,
        revision: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    };
}
