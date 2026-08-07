import type { DailyRecommendation, NormalizedGarminActivity } from '../../engine/models';
import type { DataIssue, DataState } from '../../engine/dataState';
import { validateRecommendation, isValidDate } from '../../engine/validation';

type RawDocument = Record<string, unknown>;

function invalid(documentPath: string, code: string, field?: string, schemaVersion?: number): DataState<never> {
    const issue: DataIssue = { code, documentPath, ...(field ? { field } : {}), ...(schemaVersion !== undefined ? { schemaVersion } : {}) };
    return { status: 'INVALID', issues: [issue] };
}

function isObject(value: unknown): value is RawDocument {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNonNegativeNumber(value: unknown): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Parses only the backend's normalized activity contract. Schema-less records are a
 * deliberate legacy allowance because existing backend payloads predate a version field. */
export function parseNormalizedGarminActivity(
    raw: unknown,
    documentPath: string,
    documentId: string,
): DataState<NormalizedGarminActivity> {
    if (!isObject(raw)) return invalid(documentPath, 'not-an-object');
    const schemaVersion = raw.schemaVersion;
    if (schemaVersion !== undefined && schemaVersion !== 1) {
        return invalid(documentPath, 'unsupported-schema-version', 'schemaVersion', typeof schemaVersion === 'number' ? schemaVersion : undefined);
    }
    const activityId = typeof raw.activityId === 'string' || typeof raw.activityId === 'number' ? String(raw.activityId) : documentId;
    if (!activityId) return invalid(documentPath, 'missing-required-field', 'activityId');
    if (typeof raw.date !== 'string' || !isValidDate(raw.date)) return invalid(documentPath, 'invalid-date', 'date');
    if (typeof raw.type !== 'string' || raw.type.trim() === '') return invalid(documentPath, 'missing-required-field', 'type');
    if (typeof raw.intensityTag !== 'string') return invalid(documentPath, 'invalid-type', 'intensityTag');

    const durationMin = optionalNonNegativeNumber(raw.durationMin);
    const trainingEffectAerobic = optionalNonNegativeNumber(raw.trainingEffectAerobic);
    const trainingEffectAnaerobic = optionalNonNegativeNumber(raw.trainingEffectAnaerobic);
    const averageHr = optionalNonNegativeNumber(raw.averageHr);
    const activityTrainingLoad = optionalNonNegativeNumber(raw.activityTrainingLoad);
    if ([durationMin, trainingEffectAerobic, trainingEffectAnaerobic, averageHr, activityTrainingLoad].some(value => value === undefined)) {
        return invalid(documentPath, 'invalid-numeric-field');
    }
    if (raw.syncRunId !== undefined && typeof raw.syncRunId !== 'string') return invalid(documentPath, 'invalid-type', 'syncRunId');
    if (raw.syncedAt !== undefined && typeof raw.syncedAt !== 'string') return invalid(documentPath, 'invalid-type', 'syncedAt');

    return {
        status: 'AVAILABLE',
        data: {
            activityId,
            date: raw.date,
            type: raw.type,
            durationMin: durationMin ?? null,
            trainingEffectAerobic: trainingEffectAerobic ?? null,
            trainingEffectAnaerobic: trainingEffectAnaerobic ?? null,
            averageHr: averageHr ?? null,
            activityTrainingLoad: activityTrainingLoad ?? null,
            intensityTag: raw.intensityTag,
            ...(typeof raw.syncRunId === 'string' ? { syncRunId: raw.syncRunId } : {}),
            ...(typeof raw.syncedAt === 'string' ? { syncedAt: raw.syncedAt } : {}),
        },
        revision: typeof raw.syncedAt === 'string' ? raw.syncedAt : null,
    };
}

/** v1/v2/v3 persisted recommendations are accepted through the existing strict validator;
 * newer schemas must not silently enter the engine before an explicit migration exists. */
export function parseDailyRecommendation(raw: unknown, documentPath: string): DataState<DailyRecommendation> {
    if (!isObject(raw)) return invalid(documentPath, 'not-an-object');
    const schemaVersion = raw.schemaVersion;
    if (schemaVersion !== undefined && schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
        return invalid(documentPath, 'unsupported-schema-version', 'schemaVersion', typeof schemaVersion === 'number' ? schemaVersion : undefined);
    }
    const result = validateRecommendation(raw);
    if (!result.isValid || !result.data) {
        return {
            status: 'INVALID',
            issues: result.errors.map(error => ({ code: 'schema-validation-failed', field: error.field, documentPath, ...(typeof schemaVersion === 'number' ? { schemaVersion } : {}) })),
        };
    }
    return { status: 'AVAILABLE', data: result.data, revision: result.data.updatedAt || null };
}
