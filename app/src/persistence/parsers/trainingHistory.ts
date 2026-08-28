import type { DailyRecommendation, NormalizedGarminActivity, RunningDynamics, ShadowVerdict } from '../../engine/models';
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
        // Garmin's power (7-zone Coggan) and HR (5-zone) models never exceed zone 7; this
        // mirrors the upper bound extractPowerZoneFeatures enforces in garminTelemetryEvidence.ts
        // and the ingestion-side bound in garmin_provider.py, so all three layers agree.
        if (zoneNumber === undefined || !Number.isInteger(zoneNumber) || zoneNumber < 1 || zoneNumber > 7 || secondsInZone === undefined) return undefined;
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

function isRunningActivityType(activityType: string): boolean {
    const normalized = activityType.trim().toLowerCase();
    return normalized === 'run'
        || normalized === 'running'
        || normalized.endsWith('_run')
        || normalized.endsWith('_running');
}

function parseRunningDynamics(value: unknown, activityType: string): RunningDynamics | undefined {
    // Defensive read-side gate: Garmin's generic avgPower/maxPower keys are also present
    // on cycling activities. A malformed or legacy record must never surface cycling
    // power under a biomechanical running-dynamics label.
    if (!isRunningActivityType(activityType) || !isObject(value)) return undefined;

    const keys = [
        'groundContactTimeMs',
        'groundContactBalanceLeftPct',
        'verticalOscillationCm',
        'verticalRatioPct',
        'strideLengthM',
        'avgRunningPowerWatts',
        'maxRunningPowerWatts',
    ] as const;
    const parsed: RunningDynamics = {};

    for (const key of keys) {
        const rawValue = value[key];
        if (rawValue === undefined) continue;
        if (rawValue === null) {
            parsed[key] = null;
            continue;
        }
        const numericValue = telemetryNumber(rawValue);
        if (numericValue === undefined) return undefined;
        parsed[key] = numericValue;
    }

    // Bounds mirror the backend's canonical extraction (garmin_provider.py
    // extract_running_dynamics): a value outside these ranges is not a plausible
    // reading and must not be persisted as valid telemetry.
    if (
        typeof parsed.groundContactBalanceLeftPct === 'number'
        && (parsed.groundContactBalanceLeftPct < 35.0 || parsed.groundContactBalanceLeftPct > 65.0)
    ) return undefined;
    if (
        typeof parsed.verticalRatioPct === 'number'
        && (parsed.verticalRatioPct < 1.0 || parsed.verticalRatioPct > 25.0)
    ) return undefined;

    // These metrics are physically strictly positive when measured. Garmin and legacy
    // imports can use zero as a missing-value sentinel, so do not render it as genuine
    // biomechanics/running power telemetry.
    const strictlyPositiveKeys = [
        'groundContactTimeMs',
        'verticalOscillationCm',
        'strideLengthM',
        'avgRunningPowerWatts',
        'maxRunningPowerWatts',
    ] as const;
    if (strictlyPositiveKeys.some((key) => {
        const metric = parsed[key];
        return typeof metric === 'number' && metric <= 0;
    })) return undefined;

    return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseExerciseSets(value: unknown): NormalizedGarminActivity['exerciseSets'] | undefined {
    if (!Array.isArray(value)) return undefined;
    const parsed = value.map((entry) => {
        if (!isObject(entry)) return undefined;
        const setOrder = typeof entry.setOrder === 'number' && Number.isInteger(entry.setOrder) && entry.setOrder >= 0 ? entry.setOrder : undefined;
        if (setOrder === undefined) return undefined;
        const setType = typeof entry.setType === 'string' ? entry.setType : undefined;
        const repetitionCount = typeof entry.repetitionCount === 'number' && Number.isFinite(entry.repetitionCount) && entry.repetitionCount >= 0 ? entry.repetitionCount : undefined;
        const weightKg = typeof entry.weightKg === 'number' && Number.isFinite(entry.weightKg) && entry.weightKg >= 0 ? entry.weightKg : undefined;
        const exerciseCategory = typeof entry.exerciseCategory === 'string' ? entry.exerciseCategory : undefined;
        const exerciseName = typeof entry.exerciseName === 'string' ? entry.exerciseName : undefined;
        const durationSeconds = typeof entry.durationSeconds === 'number' && Number.isFinite(entry.durationSeconds) && entry.durationSeconds >= 0 ? entry.durationSeconds : undefined;
        const restDurationSeconds = typeof entry.restDurationSeconds === 'number' && Number.isFinite(entry.restDurationSeconds) && entry.restDurationSeconds >= 0 ? entry.restDurationSeconds : undefined;
        return {
            setOrder,
            ...(setType !== undefined ? { setType } : {}),
            ...(repetitionCount !== undefined ? { repetitionCount } : {}),
            ...(weightKg !== undefined ? { weightKg } : {}),
            ...(exerciseCategory !== undefined ? { exerciseCategory } : {}),
            ...(exerciseName !== undefined ? { exerciseName } : {}),
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
            ...(restDurationSeconds !== undefined ? { restDurationSeconds } : {}),
        };
    });
    return parsed.every((entry) => entry !== undefined)
        ? parsed as NonNullable<NormalizedGarminActivity['exerciseSets']>
        : undefined;
}

function parseOptionalString(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'string' ? value : undefined;
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
    const runningDynamics = parseRunningDynamics(raw.runningDynamics, raw.type);
    const primaryBenefit = parseOptionalString(raw.primaryBenefit);
    const trainingEffectLabel = parseOptionalString(raw.trainingEffectLabel);
    const epoc = optionalNonNegativeNumber(raw.epoc);
    const recoveryTimeHours = optionalNonNegativeNumber(raw.recoveryTimeHours);
    const exerciseSets = parseExerciseSets(raw.exerciseSets);

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
            ...(primaryBenefit !== undefined ? { primaryBenefit } : {}),
            ...(trainingEffectLabel !== undefined ? { trainingEffectLabel } : {}),
            ...(epoc !== undefined ? { epoc } : {}),
            ...(recoveryTimeHours !== undefined ? { recoveryTimeHours } : {}),
            ...(powerInZones !== undefined ? { powerInZones } : {}),
            ...(hrInZones !== undefined ? { hrInZones } : {}),
            ...(normalizedPower !== undefined ? { normalizedPower } : {}),
            ...(intensityFactor !== undefined ? { intensityFactor } : {}),
            ...(variabilityIndex !== undefined ? { variabilityIndex } : {}),
            ...(laps !== undefined ? { laps } : {}),
            ...(runningDynamics !== undefined ? { runningDynamics } : {}),
            ...(exerciseSets !== undefined ? { exerciseSets } : {}),
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
