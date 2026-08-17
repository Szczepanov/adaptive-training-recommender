import type { DailyRecommendation, NormalizedGarminActivity, ShadowVerdict } from '../../engine/models';
import { SHADOW_VERDICTS } from '../../engine/models';
import type { DataIssue, DataState } from '../../engine/dataState';
import { validateRecommendation, isValidDate } from '../../engine/validation';

type RawDocument = Record<string, unknown>;
type RecommendationWithEngineVerdict = DailyRecommendation & { engineVerdict?: ShadowVerdict };

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

function telemetryNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseZoneBuckets(value: unknown): NormalizedGarminActivity['powerInZones'] | undefined {
    if (!Array.isArray(value)) return undefined;
    const parsed = value.map((entry) => {
        if (!isObject(entry)) return undefined;
        const zoneNumber = telemetryNumber(entry.zoneNumber);
        const secondsInZone = telemetryNumber(entry.secondsInZone);
        const lowBoundary = entry.lowBoundary === undefined ? undefined : telemetryNumber(entry.lowBoundary);
        if (zoneNumber === undefined || !Number.isInteger(zoneNumber) || zoneNumber < 1 || secondsInZone === undefined) return undefined;
        if (entry.lowBoundary !== undefined && lowBoundary === undefined) return undefined;
        return { zoneNumber, secondsInZone, ...(lowBoundary !== undefined ? { lowBoundary } : {}) };
    });
    return parsed.every((entry) => entry !== undefined)
        ? parsed as NonNullable<NormalizedGarminActivity['powerInZones']>
        : undefined;
}

function parseLaps(value: unknown): NormalizedGarminActivity['laps'] | undefined {
    if (!Array.isArray(value)) return undefined;
    const parsed = value.map((entry) => {
        if (!isObject(entry)) return undefined;
        const lapIndex = telemetryNumber(entry.lapIndex);
        const durationSeconds = telemetryNumber(entry.durationSeconds);
        const averagePowerWatts = entry.averagePowerWatts === undefined ? undefined : telemetryNumber(entry.averagePowerWatts);
        const averageHrBpm = entry.averageHrBpm === undefined ? undefined : telemetryNumber(entry.averageHrBpm);
        if (lapIndex === undefined || !Number.isInteger(lapIndex) || lapIndex < 1 || durationSeconds === undefined) return undefined;
        if (entry.averagePowerWatts !== undefined && averagePowerWatts === undefined) return undefined;
        if (entry.averageHrBpm !== undefined && averageHrBpm === undefined) return undefined;
        return {
            lapIndex,
            durationSeconds,
            ...(averagePowerWatts !== undefined ? { averagePowerWatts } : {}),
            ...(averageHrBpm !== undefined ? { averageHrBpm } : {}),
        };
    });
    return parsed.every((entry) => entry !== undefined)
        ? parsed as NonNullable<NormalizedGarminActivity['laps']>
        : undefined;
}

function isShadowVerdict(value: unknown): value is ShadowVerdict {
    return typeof value === 'string' && (SHADOW_VERDICTS as readonly string[]).includes(value);
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

    const powerInZones = parseZoneBuckets(raw.powerInZones);
    const hrInZones = parseZoneBuckets(raw.hrInZones);
    const normalizedPower = telemetryNumber(raw.normalizedPower);
    const intensityFactor = telemetryNumber(raw.intensityFactor);
    const variabilityIndex = telemetryNumber(raw.variabilityIndex);
    const laps = parseLaps(raw.laps);

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
            ...(powerInZones !== undefined ? { powerInZones } : {}),
            ...(hrInZones !== undefined ? { hrInZones } : {}),
            ...(normalizedPower !== undefined ? { normalizedPower } : {}),
            ...(intensityFactor !== undefined ? { intensityFactor } : {}),
            ...(variabilityIndex !== undefined ? { variabilityIndex } : {}),
            ...(laps !== undefined ? { laps } : {}),
            ...(typeof raw.syncRunId === 'string' ? { syncRunId: raw.syncRunId } : {}),
            ...(typeof raw.syncedAt === 'string' ? { syncedAt: raw.syncedAt } : {}),
        },
        revision: typeof raw.syncedAt === 'string' ? raw.syncedAt : null,
    };
}

/** v1/v2/v3 persisted recommendations are accepted through the existing strict validator;
 * newer schemas must not silently enter the engine before an explicit migration exists.
 * Phase 9.0 adds one backward-compatible evidence-only field, `engineVerdict`, validated
 * here because the historical recommendation validator intentionally owns only the v1-v3
 * decision shape. */
export function parseDailyRecommendation(raw: unknown, documentPath: string): DataState<DailyRecommendation> {
    if (!isObject(raw)) return invalid(documentPath, 'not-an-object');
    const schemaVersion = raw.schemaVersion;
    if (schemaVersion !== undefined && schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
        return invalid(documentPath, 'unsupported-schema-version', 'schemaVersion', typeof schemaVersion === 'number' ? schemaVersion : undefined);
    }
    if (raw.engineVerdict !== undefined && !isShadowVerdict(raw.engineVerdict)) {
        return invalid(documentPath, 'invalid-engine-verdict', 'engineVerdict', typeof schemaVersion === 'number' ? schemaVersion : undefined);
    }
    const result = validateRecommendation(raw);
    if (!result.isValid || !result.data) {
        return {
            status: 'INVALID',
            issues: result.errors.map(error => ({ code: 'schema-validation-failed', field: error.field, documentPath, ...(typeof schemaVersion === 'number' ? { schemaVersion } : {}) })),
        };
    }
    const recommendation: RecommendationWithEngineVerdict = {
        ...result.data,
        ...(isShadowVerdict(raw.engineVerdict) ? { engineVerdict: raw.engineVerdict } : {}),
    };
    return {
        status: 'AVAILABLE',
        data: recommendation,
        revision: recommendation.revision ? `r${recommendation.revision}:${recommendation.updatedAt}` : (recommendation.updatedAt || null),
    };
}
