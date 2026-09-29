import type {
    ActivityPowerDurationPeak,
    ActivityPrescribedTarget,
    ActivityResponseTelemetry,
    ActivitySegmentIdentitySource,
    ActivitySegmentSummary,
    ActivitySegmentType,
    ActivitySessionCost,
    ActivitySteadyHalfSummary,
    ActivityStimulusDomain,
    DailyRecommendation,
    FitWorkoutFingerprintKind,
    HrMeasurement,
    NormalizedGarminActivity,
    RunningDynamics,
    ShadowVerdict,
} from '../../engine/models';
import { FIT_WORKOUT_FINGERPRINT_KINDS, SHADOW_VERDICTS } from '../../engine/models';
import type { DataIssue, DataState } from '../../engine/dataState';
import { validateRecommendation, isValidDate } from '../../engine/validation';

type RawDocument = Record<string, unknown>;
type RecommendationWithEngineVerdict = DailyRecommendation & { engineVerdict?: ShadowVerdict };
const FIT_WORKOUT_FINGERPRINT_PATTERN = /^fit-workout-v2:[0-9a-f]{32}$/;

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

function optionalPercentage(value: unknown): number | null | undefined {
    const parsed = optionalNonNegativeNumber(value);
    return typeof parsed === 'number' && parsed > 100 ? undefined : parsed;
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
        const distanceMeters = entry.distanceMeters === undefined ? undefined : telemetryNumber(entry.distanceMeters);
        const averageSpeedMps = entry.averageSpeedMps === undefined ? undefined : telemetryNumber(entry.averageSpeedMps);
        if (lapIndex === undefined || !Number.isInteger(lapIndex) || lapIndex < 1 || durationSeconds === undefined) return undefined;
        if (entry.averagePowerWatts !== undefined && averagePowerWatts === undefined) return undefined;
        if (entry.averageHrBpm !== undefined && averageHrBpm === undefined) return undefined;
        if (entry.distanceMeters !== undefined && distanceMeters === undefined) return undefined;
        if (entry.averageSpeedMps !== undefined && averageSpeedMps === undefined) return undefined;
        return {
            lapIndex,
            durationSeconds,
            ...(averagePowerWatts !== undefined ? { averagePowerWatts } : {}),
            ...(averageHrBpm !== undefined ? { averageHrBpm } : {}),
            ...(distanceMeters !== undefined ? { distanceMeters } : {}),
            ...(averageSpeedMps !== undefined ? { averageSpeedMps } : {}),
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

const HR_SENSOR_TECHNOLOGIES = ['electrode_chest_strap', 'optical_armband', 'wrist_ppg', 'external_unknown', 'unknown'] as const;
const HR_SOURCES_FOR_ACTIVITY = ['external', 'wrist', 'mixed_possible', 'unknown'] as const;
const HR_PROVENANCE_CONFIDENCES = ['confirmed', 'inferred', 'ambiguous', 'unknown'] as const;
const HR_ACTIVITY_MOTION_RISKS = ['low', 'moderate', 'high', 'unknown'] as const;
const HR_SIGNAL_QUALITIES = ['clean', 'suspect', 'poor', 'unknown'] as const;
const HR_MEASUREMENT_CONFIDENCES = ['high', 'moderate', 'low', 'unreliable', 'unknown'] as const;
const HR_SUMMARY_COMPATIBILITIES = ['verified_same_effective_trace', 'consistent_unproven', 'discordant', 'not_comparable', 'unknown'] as const;

function enumValue<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
    return typeof value === 'string' && choices.includes(value as T) ? value as T : undefined;
}

function parseHrMeasurement(value: unknown): HrMeasurement | undefined {
    if (!isObject(value)) return undefined;
    const externalHrSensorPresent = value.externalHrSensorPresent;
    const sourceForActivity = enumValue(value.sourceForActivity, HR_SOURCES_FOR_ACTIVITY);
    const provenanceConfidence = enumValue(value.provenanceConfidence, HR_PROVENANCE_CONFIDENCES);
    const sensorTechnology = enumValue(value.sensorTechnology, HR_SENSOR_TECHNOLOGIES);
    const activityMotionRisk = enumValue(value.activityMotionRisk, HR_ACTIVITY_MOTION_RISKS);
    const coveragePct = optionalPercentage(value.coveragePct);
    const longestGapSeconds = optionalNonNegativeNumber(value.longestGapSeconds);
    const signalQuality = enumValue(value.signalQuality, HR_SIGNAL_QUALITIES);
    const measurementConfidence = enumValue(value.measurementConfidence, HR_MEASUREMENT_CONFIDENCES);
    const summaryCompatibility = enumValue(value.summaryCompatibility, HR_SUMMARY_COMPATIBILITIES);
    const artifactFlags = value.artifactFlags;
    const reasons = value.reasons;
    const diagnosticVersion = value.diagnosticVersion;

    if (
        (externalHrSensorPresent !== null && typeof externalHrSensorPresent !== 'boolean')
        || sourceForActivity === undefined
        || provenanceConfidence === undefined
        || sensorTechnology === undefined
        || activityMotionRisk === undefined
        || coveragePct === undefined
        || longestGapSeconds === undefined
        || signalQuality === undefined
        || measurementConfidence === undefined
        || summaryCompatibility === undefined
        || !Array.isArray(artifactFlags)
        || !artifactFlags.every(flag => typeof flag === 'string')
        || !Array.isArray(reasons)
        || !reasons.every(reason => typeof reason === 'string')
        || typeof diagnosticVersion !== 'string'
        || diagnosticVersion.trim() === ''
    ) return undefined;

    return {
        externalHrSensorPresent,
        sourceForActivity,
        provenanceConfidence,
        sensorTechnology,
        activityMotionRisk,
        coveragePct,
        longestGapSeconds,
        signalQuality,
        measurementConfidence,
        summaryCompatibility,
        artifactFlags,
        reasons,
        diagnosticVersion,
    };
}

const SEGMENT_TYPES: readonly ActivitySegmentType[] = ['work', 'recovery', 'sprint', 'steady', 'surge', 'warmup', 'cooldown', 'unknown'];
const SEGMENT_IDENTITY_SOURCES: readonly ActivitySegmentIdentitySource[] = ['fit_workout_step', 'manual_lap', 'detected', 'unknown'];
const EVIDENCE_CONFIDENCES = ['high', 'moderate', 'low'] as const;
const ACTIVITY_RESPONSE_DERIVATION_VERSION = 'multi-resolution-v1';
const MAX_ACTIVITY_RESPONSE_SEGMENTS = 64;
const ACTIVITY_RESPONSE_POWER_WINDOWS_SECONDS = new Set([1, 5, 10, 30, 60, 180, 300, 1200]);

function parsePrescribedTarget(value: unknown): ActivityPrescribedTarget | undefined {
    if (!isObject(value) || typeof value.kind !== 'string' || value.kind.trim() === '') return undefined;

    const targetValue = value.value === undefined ? undefined : telemetryNumber(value.value);
    const low = value.low === undefined ? undefined : telemetryNumber(value.low);
    const high = value.high === undefined ? undefined : telemetryNumber(value.high);

    if (
        (value.value !== undefined && targetValue === undefined)
        || (value.low !== undefined && low === undefined)
        || (value.high !== undefined && high === undefined)
        || (value.text !== undefined && typeof value.text !== 'string')
    ) return undefined;

    return {
        kind: value.kind,
        ...(targetValue !== undefined ? { value: targetValue } : {}),
        ...(low !== undefined ? { low } : {}),
        ...(high !== undefined ? { high } : {}),
        ...(typeof value.text === 'string' ? { text: value.text } : {}),
    };
}

function parseActivitySegments(value: unknown): ActivitySegmentSummary[] | undefined {
    if (!Array.isArray(value) || value.length > MAX_ACTIVITY_RESPONSE_SEGMENTS) return undefined;
    const parsed = value.map((entry): ActivitySegmentSummary | undefined => {
        if (!isObject(entry)) return undefined;

        const segmentIndex = telemetryNumber(entry.segmentIndex);
        const segmentType = enumValue(entry.segmentType, SEGMENT_TYPES);
        const identitySource = enumValue(entry.identitySource, SEGMENT_IDENTITY_SOURCES);
        const durationSeconds = telemetryNumber(entry.durationSeconds);
        const evidenceConfidence = enumValue(entry.evidenceConfidence, EVIDENCE_CONFIDENCES);

        if (
            segmentIndex === undefined
            || !Number.isInteger(segmentIndex)
            || segmentIndex < 1
            || segmentType === undefined
            || identitySource === undefined
            || durationSeconds === undefined
            || durationSeconds <= 0
            || evidenceConfidence === undefined
        ) return undefined;

        const startOffset = entry.startOffsetSeconds === undefined ? undefined : telemetryNumber(entry.startOffsetSeconds);
        const target = entry.prescribedTarget === undefined ? undefined : parsePrescribedTarget(entry.prescribedTarget);
        const avgPwr = entry.averagePowerWatts === undefined ? undefined : telemetryNumber(entry.averagePowerWatts);
        const p1s = entry.peak1sPowerWatts === undefined ? undefined : telemetryNumber(entry.peak1sPowerWatts);
        const p5s = entry.peak5sPowerWatts === undefined ? undefined : telemetryNumber(entry.peak5sPowerWatts);
        const p10s = entry.peak10sPowerWatts === undefined ? undefined : telemetryNumber(entry.peak10sPowerWatts);
        const avgHr = entry.averageHrBpm === undefined ? undefined : telemetryNumber(entry.averageHrBpm);
        const endHr = entry.endHrBpm === undefined ? undefined : telemetryNumber(entry.endHrBpm);
        const maxHr = entry.maxHrBpm === undefined ? undefined : telemetryNumber(entry.maxHrBpm);
        const avgCad = entry.averageCadenceRpm === undefined ? undefined : telemetryNumber(entry.averageCadenceRpm);
        const maxCad = entry.maxCadenceRpm === undefined ? undefined : telemetryNumber(entry.maxCadenceRpm);
        const firstPwr = entry.firstThirdPowerWatts === undefined ? undefined : telemetryNumber(entry.firstThirdPowerWatts);
        const midPwr = entry.middleThirdPowerWatts === undefined ? undefined : telemetryNumber(entry.middleThirdPowerWatts);
        const lastPwr = entry.lastThirdPowerWatts === undefined ? undefined : telemetryNumber(entry.lastThirdPowerWatts);
        const lastHr = entry.lastThirdHrBpm === undefined ? undefined : telemetryNumber(entry.lastThirdHrBpm);

        if (
            (entry.startOffsetSeconds !== undefined && startOffset === undefined)
            || (entry.prescribedTarget !== undefined && target === undefined)
            || (entry.averagePowerWatts !== undefined && avgPwr === undefined)
            || (entry.peak1sPowerWatts !== undefined && p1s === undefined)
            || (entry.peak5sPowerWatts !== undefined && p5s === undefined)
            || (entry.peak10sPowerWatts !== undefined && p10s === undefined)
            || (entry.averageHrBpm !== undefined && avgHr === undefined)
            || (entry.endHrBpm !== undefined && endHr === undefined)
            || (entry.maxHrBpm !== undefined && maxHr === undefined)
            || (entry.averageCadenceRpm !== undefined && avgCad === undefined)
            || (entry.maxCadenceRpm !== undefined && maxCad === undefined)
            || (entry.firstThirdPowerWatts !== undefined && firstPwr === undefined)
            || (entry.middleThirdPowerWatts !== undefined && midPwr === undefined)
            || (entry.lastThirdPowerWatts !== undefined && lastPwr === undefined)
            || (entry.lastThirdHrBpm !== undefined && lastHr === undefined)
        ) return undefined;

        return {
            segmentIndex,
            segmentType,
            identitySource,
            durationSeconds,
            evidenceConfidence,
            ...(startOffset !== undefined ? { startOffsetSeconds: startOffset } : {}),
            ...(target !== undefined ? { prescribedTarget: target } : {}),
            ...(avgPwr !== undefined ? { averagePowerWatts: avgPwr } : {}),
            ...(p1s !== undefined ? { peak1sPowerWatts: p1s } : {}),
            ...(p5s !== undefined ? { peak5sPowerWatts: p5s } : {}),
            ...(p10s !== undefined ? { peak10sPowerWatts: p10s } : {}),
            ...(avgHr !== undefined ? { averageHrBpm: avgHr } : {}),
            ...(endHr !== undefined ? { endHrBpm: endHr } : {}),
            ...(maxHr !== undefined ? { maxHrBpm: maxHr } : {}),
            ...(avgCad !== undefined ? { averageCadenceRpm: avgCad } : {}),
            ...(maxCad !== undefined ? { maxCadenceRpm: maxCad } : {}),
            ...(firstPwr !== undefined ? { firstThirdPowerWatts: firstPwr } : {}),
            ...(midPwr !== undefined ? { middleThirdPowerWatts: midPwr } : {}),
            ...(lastPwr !== undefined ? { lastThirdPowerWatts: lastPwr } : {}),
            ...(lastHr !== undefined ? { lastThirdHrBpm: lastHr } : {}),
        };
    });

    if (!parsed.every((entry): entry is ActivitySegmentSummary => entry !== undefined)) return undefined;
    if (new Set(parsed.map((entry) => entry.segmentIndex)).size !== parsed.length) return undefined;
    return parsed;
}

function parsePowerDurationPeaks(value: unknown): ActivityPowerDurationPeak[] | undefined {
    if (!Array.isArray(value) || value.length > ACTIVITY_RESPONSE_POWER_WINDOWS_SECONDS.size) return undefined;
    const parsed = value.map((entry): ActivityPowerDurationPeak | undefined => {
        if (!isObject(entry)) return undefined;
        const durationSeconds = telemetryNumber(entry.durationSeconds);
        const powerWatts = telemetryNumber(entry.powerWatts);
        const confidence = enumValue(entry.confidence, EVIDENCE_CONFIDENCES);
        const elapsed = entry.elapsedBeforeSeconds === undefined ? undefined : telemetryNumber(entry.elapsedBeforeSeconds);
        const half = entry.activityHalf === undefined
            ? undefined
            : entry.activityHalf === 'first' || entry.activityHalf === 'second'
                ? entry.activityHalf
                : null;

        if (
            durationSeconds === undefined
            || !Number.isInteger(durationSeconds)
            || !ACTIVITY_RESPONSE_POWER_WINDOWS_SECONDS.has(durationSeconds)
            || powerWatts === undefined
            || confidence === undefined
            || (entry.elapsedBeforeSeconds !== undefined && elapsed === undefined)
            || half === null
        ) return undefined;

        return {
            durationSeconds,
            powerWatts,
            confidence,
            ...(elapsed !== undefined ? { elapsedBeforeSeconds: elapsed } : {}),
            ...(half !== undefined ? { activityHalf: half } : {}),
        };
    });

    if (!parsed.every((entry): entry is ActivityPowerDurationPeak => entry !== undefined)) return undefined;
    if (new Set(parsed.map((entry) => entry.durationSeconds)).size !== parsed.length) return undefined;
    return parsed;
}

function parseSteadyHalves(value: unknown): ActivitySteadyHalfSummary | undefined {
    if (!isObject(value)) return undefined;

    const firstPwr = value.firstPowerWatts === undefined ? undefined : telemetryNumber(value.firstPowerWatts);
    const secPwr = value.secondPowerWatts === undefined ? undefined : telemetryNumber(value.secondPowerWatts);
    const firstHr = value.firstHrBpm === undefined ? undefined : telemetryNumber(value.firstHrBpm);
    const secHr = value.secondHrBpm === undefined ? undefined : telemetryNumber(value.secondHrBpm);
    const firstCad = value.firstCadenceRpm === undefined ? undefined : telemetryNumber(value.firstCadenceRpm);
    const secCad = value.secondCadenceRpm === undefined ? undefined : telemetryNumber(value.secondCadenceRpm);

    if (
        (value.firstPowerWatts !== undefined && firstPwr === undefined)
        || (value.secondPowerWatts !== undefined && secPwr === undefined)
        || (value.firstHrBpm !== undefined && firstHr === undefined)
        || (value.secondHrBpm !== undefined && secHr === undefined)
        || (value.firstCadenceRpm !== undefined && firstCad === undefined)
        || (value.secondCadenceRpm !== undefined && secCad === undefined)
    ) return undefined;

    return {
        ...(firstPwr !== undefined ? { firstPowerWatts: firstPwr } : {}),
        ...(secPwr !== undefined ? { secondPowerWatts: secPwr } : {}),
        ...(firstHr !== undefined ? { firstHrBpm: firstHr } : {}),
        ...(secHr !== undefined ? { secondHrBpm: secHr } : {}),
        ...(firstCad !== undefined ? { firstCadenceRpm: firstCad } : {}),
        ...(secCad !== undefined ? { secondCadenceRpm: secCad } : {}),
    };
}

function parseSourceResolution(value: unknown): ActivityResponseTelemetry['sourceResolution'] | undefined {
    if (!isObject(value)) return undefined;

    const powerSeconds = value.powerSeconds === undefined ? undefined : telemetryNumber(value.powerSeconds);
    const hrSeconds = value.hrSeconds === undefined ? undefined : telemetryNumber(value.hrSeconds);
    const cadenceSeconds = value.cadenceSeconds === undefined ? undefined : telemetryNumber(value.cadenceSeconds);

    if (
        (value.powerSeconds !== undefined && (powerSeconds === undefined || powerSeconds <= 0))
        || (value.hrSeconds !== undefined && (hrSeconds === undefined || hrSeconds <= 0))
        || (value.cadenceSeconds !== undefined && (cadenceSeconds === undefined || cadenceSeconds <= 0))
    ) return undefined;

    return {
        ...(powerSeconds !== undefined ? { powerSeconds } : {}),
        ...(hrSeconds !== undefined ? { hrSeconds } : {}),
        ...(cadenceSeconds !== undefined ? { cadenceSeconds } : {}),
    };
}

function parseActivityResponse(value: unknown): ActivityResponseTelemetry | undefined {
    if (!isObject(value)) return undefined;
    if (value.derivationVersion !== ACTIVITY_RESPONSE_DERIVATION_VERSION) return undefined;

    const segmentCountTotal = telemetryNumber(value.segmentCountTotal);
    if (segmentCountTotal === undefined || !Number.isInteger(segmentCountTotal)) return undefined;
    if (typeof value.segmentsTruncated !== 'boolean') return undefined;

    const sourceResolution = parseSourceResolution(value.sourceResolution);
    const segments = parseActivitySegments(value.segments);
    const powerDurationPeaks = parsePowerDurationPeaks(value.powerDurationPeaks);
    if (sourceResolution === undefined || segments === undefined || powerDurationPeaks === undefined) return undefined;

    if (segments.length > segmentCountTotal) return undefined;
    if (!value.segmentsTruncated && segments.length !== segmentCountTotal) return undefined;
    if (
        value.segmentsTruncated
        && (segmentCountTotal <= MAX_ACTIVITY_RESPONSE_SEGMENTS || segments.length !== MAX_ACTIVITY_RESPONSE_SEGMENTS)
    ) return undefined;

    const steadyHalves = value.steadyHalves === undefined ? undefined : parseSteadyHalves(value.steadyHalves);
    if (value.steadyHalves !== undefined && steadyHalves === undefined) return undefined;

    return {
        derivationVersion: value.derivationVersion,
        segmentCountTotal,
        segmentsTruncated: value.segmentsTruncated,
        sourceResolution,
        segments,
        powerDurationPeaks,
        ...(steadyHalves !== undefined ? { steadyHalves } : {}),
    };
}

const STIMULUS_DOMAINS: readonly ActivityStimulusDomain[] = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'anaerobic', 'mixed', 'race', 'strength', 'unknown'];
const SESSION_COSTS: readonly ActivitySessionCost[] = ['low', 'moderate', 'high', 'very_high', 'unknown'];

/** Issue #809 classification fields are optional and additive: an unrecognised value is
 * dropped (legacy semantics apply) rather than failing the whole activity document. */
function parseEnumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : undefined;
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
    if (raw.startedAt !== undefined && typeof raw.startedAt !== 'string') return invalid(documentPath, 'invalid-type', 'startedAt');
    if (raw.endedAt !== undefined && typeof raw.endedAt !== 'string') return invalid(documentPath, 'invalid-type', 'endedAt');
    // Fingerprint-only rows predate the evidence-kind field and remain readable for
    // backward compatibility. Once a kind is present, however, the pair becomes eligible
    // for reconciliation, so require a valid v2 fingerprint as well.
    if (raw.fitWorkoutFingerprint !== undefined && typeof raw.fitWorkoutFingerprint !== 'string') return invalid(documentPath, 'invalid-type', 'fitWorkoutFingerprint');
    if (raw.fitWorkoutFingerprintKind !== undefined) {
        if (typeof raw.fitWorkoutFingerprintKind !== 'string' || !FIT_WORKOUT_FINGERPRINT_KINDS.includes(raw.fitWorkoutFingerprintKind as FitWorkoutFingerprintKind)) {
            return invalid(documentPath, 'invalid-type', 'fitWorkoutFingerprintKind');
        }
        if (typeof raw.fitWorkoutFingerprint !== 'string' || !FIT_WORKOUT_FINGERPRINT_PATTERN.test(raw.fitWorkoutFingerprint)) {
            return invalid(documentPath, 'invalid-type', 'fitWorkoutFingerprint');
        }
    }

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
    const maxHr = optionalNonNegativeNumber(raw.maxHr);
    const exerciseSets = parseExerciseSets(raw.exerciseSets);
    const hrMeasurement = parseHrMeasurement(raw.hrMeasurement);
    const activityResponse = parseActivityResponse(raw.activityResponse);
    const stimulusDomain = parseEnumValue(raw.stimulusDomain, STIMULUS_DOMAINS);
    const sessionCost = parseEnumValue(raw.sessionCost, SESSION_COSTS);
    const intensityEvidence = parseOptionalString(raw.intensityEvidence) ?? undefined;
    const intensityClassificationVersion = optionalNonNegativeNumber(raw.intensityClassificationVersion);

    return {
        status: 'AVAILABLE',
        data: {
            activityId,
            date: raw.date,
            ...(typeof raw.startedAt === 'string' ? { startedAt: raw.startedAt } : {}),
            ...(typeof raw.endedAt === 'string' ? { endedAt: raw.endedAt } : {}),
            ...(typeof raw.fitWorkoutFingerprint === 'string' ? { fitWorkoutFingerprint: raw.fitWorkoutFingerprint } : {}),
            ...(typeof raw.fitWorkoutFingerprintKind === 'string' && FIT_WORKOUT_FINGERPRINT_KINDS.includes(raw.fitWorkoutFingerprintKind as FitWorkoutFingerprintKind) ? { fitWorkoutFingerprintKind: raw.fitWorkoutFingerprintKind as FitWorkoutFingerprintKind } : {}),
            type: raw.type,
            durationMin: durationMin ?? null,
            trainingEffectAerobic: trainingEffectAerobic ?? null,
            trainingEffectAnaerobic: trainingEffectAnaerobic ?? null,
            averageHr: averageHr ?? null,
            ...(maxHr !== undefined && maxHr !== null && maxHr > 0 ? { maxHr } : {}),
            activityTrainingLoad: activityTrainingLoad ?? null,
            intensityTag: raw.intensityTag,
            ...(stimulusDomain !== undefined ? { stimulusDomain } : {}),
            ...(sessionCost !== undefined ? { sessionCost } : {}),
            ...(intensityEvidence !== undefined ? { intensityEvidence } : {}),
            ...(intensityClassificationVersion !== undefined && intensityClassificationVersion !== null ? { intensityClassificationVersion } : {}),
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
            ...(hrMeasurement !== undefined ? { hrMeasurement } : {}),
            ...(activityResponse !== undefined ? { activityResponse } : {}),
            ...(typeof raw.syncRunId === 'string' ? { syncRunId: raw.syncRunId } : {}),
            ...(typeof raw.syncedAt === 'string' ? { syncedAt: raw.syncedAt } : {}),
        },
        revision: typeof raw.syncedAt === 'string' ? raw.syncedAt : null,
    };
}

/** v1/v2/v3/v4 persisted recommendations are accepted through the existing strict
 * validator (v4 adds `recommendationAudit.knowledgeLineage`, written since the "persist
 * recommendation knowledge lineage" change and fully validated by validateRecommendation);
 * newer schemas must not silently enter the engine before an explicit migration exists.
 * Phase 9.0 adds one backward-compatible evidence-only field, `engineVerdict`, validated
 * here because the historical recommendation validator intentionally owns only the v1-v4
 * decision shape. */
export function parseDailyRecommendation(raw: unknown, documentPath: string): DataState<DailyRecommendation> {
    if (!isObject(raw)) return invalid(documentPath, 'not-an-object');
    const schemaVersion = raw.schemaVersion;
    if (schemaVersion !== undefined && schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4) {
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
