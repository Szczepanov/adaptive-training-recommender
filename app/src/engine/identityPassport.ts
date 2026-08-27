/**
 * Versioned Physiological Identity Passport model + historical bootstrap (PI3, ADR-0028).
 *
 * A source-aware, lineage-aware, versioned robust-statistics profile of a shared source's
 * physiological readings (`sourceProfiles`) and its paired relationship to the personal-device
 * anchor (`crossSourceProfiles`). This module is descriptive/statistical only -- it never assigns
 * an identity label to a night; that is PI4's job, scoring a night's features against the
 * passport this module fits.
 *
 * SHADOW ONLY (PI3 task-board decision impact): nothing here is wired into baseline/fusion
 * (PI5) or an identity verdict (PI4). `bootstrapPassportFromHistory()` fits a v0 passport from
 * historical paired nights per the plan's 7-step bootstrap procedure; it does not, and must not,
 * label any excluded night `NOT_USER` (ADR-0028 P-PI-8) -- exclusion from the fitted "central
 * core" is recorded only as descriptive concordance data for PI8's replay report.
 */

import { calculateMad, calculateMedian } from './multisourceBaselines';
import type { IntervalOverlapMetrics, PhysiologicalRelationFeatures } from './identityFeatures';

// --- Robust estimators -----------------------------------------------------------------------

/** {median, mad, iqr, n} shape used for scalar physiological readings/residuals. */
export interface RobustScalarEstimate {
    median: number | null;
    mad: number | null; // scaled MAD, floored per DEFAULT_IDENTITY_FEATURE_SCALE_FLOORS (or caller override)
    iqr: number | null;
    n: number;
}

/** {median, mad, n} shape used for timing-location features (no IQR persisted). */
export interface RobustLocationEstimate {
    median: number | null;
    mad: number | null;
    n: number;
}

/** {median, iqr, n} shape used for bounded ratio features (e.g. session Jaccard); MAD omitted. */
export interface RobustRatioEstimate {
    median: number | null;
    iqr: number | null;
    n: number;
}

function calculatePercentile(sortedValues: readonly number[], p: number): number | null {
    if (sortedValues.length === 0) {
        return null;
    }
    if (sortedValues.length === 1) {
        return sortedValues[0];
    }
    const rank = p * (sortedValues.length - 1);
    const lowerIndex = Math.floor(rank);
    const upperIndex = Math.ceil(rank);
    if (lowerIndex === upperIndex) {
        return sortedValues[lowerIndex];
    }
    const weight = rank - lowerIndex;
    return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

export function calculateIqr(values: readonly number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = calculatePercentile(sorted, 0.25);
    const q3 = calculatePercentile(sorted, 0.75);
    if (q1 === null || q3 === null) {
        return null;
    }
    return q3 - q1;
}

/**
 * Robust scalar estimate with an explicit minimum-scale floor on `mad`. Near-zero historical
 * dispersion (e.g. an early passport with only 2-3 nights that happen to agree closely) must
 * never produce a near-zero scale, or a later ordinary night would compute a numerically
 * explosive z-score against it. The floor is a measurement/semantic safeguard, not an identity
 * threshold (ADR-0028 PI3).
 */
export function computeRobustScalarEstimate(
    values: readonly number[],
    scaleFloor: number,
): RobustScalarEstimate {
    const median = calculateMedian(values);
    const rawMad = calculateMad(values, median);
    return {
        median,
        mad: rawMad === null ? null : Math.max(rawMad, scaleFloor),
        iqr: calculateIqr(values),
        n: values.length,
    };
}

export function computeRobustLocationEstimate(
    values: readonly number[],
    scaleFloor: number,
): RobustLocationEstimate {
    const median = calculateMedian(values);
    const rawMad = calculateMad(values, median);
    return {
        median,
        mad: rawMad === null ? null : Math.max(rawMad, scaleFloor),
        n: values.length,
    };
}

export function computeRobustRatioEstimate(values: readonly number[]): RobustRatioEstimate {
    return {
        median: calculateMedian(values),
        iqr: calculateIqr(values),
        n: values.length,
    };
}

/**
 * Per-feature minimum-scale floors. Values are deliberately conservative starting points, not
 * fitted/validated thresholds -- revisit once PI8 replay evidence exists.
 */
export interface IdentityFeatureScaleFloors {
    rhrResidualBpm: number;
    respirationResidualBrpm: number;
    hrvLogResidual: number;
    startDeltaMinutes: number;
    endDeltaMinutes: number;
    durationDeltaMinutes: number;
}

export const DEFAULT_IDENTITY_FEATURE_SCALE_FLOORS: IdentityFeatureScaleFloors = {
    rhrResidualBpm: 1.0,
    respirationResidualBrpm: 0.5,
    hrvLogResidual: 0.02,
    startDeltaMinutes: 2,
    endDeltaMinutes: 2,
    durationDeltaMinutes: 3,
};

// --- Passport document model ------------------------------------------------------------------

export interface AnchorPolicy {
    primaryProvider: string;
    primaryTransport: string;
    role: string;
    requireIndependentLineage: boolean;
}

export interface SourceProfile {
    trustedNightCount: number;
    restingHeartRate: RobustScalarEstimate;
    respirationRate: RobustScalarEstimate;
    logHrv: RobustScalarEstimate;
    sleepStartMinutesLocal: RobustLocationEstimate;
    sleepDurationMinutes: RobustLocationEstimate;
}

export interface CrossSourceProfile {
    rhrResidual: RobustScalarEstimate;
    respirationResidual: RobustScalarEstimate;
    hrvLogResidual: RobustScalarEstimate;
    startDeltaMinutes: RobustLocationEstimate;
    endDeltaMinutes: RobustLocationEstimate;
    durationDeltaMinutes: RobustLocationEstimate;
    sessionJaccard: RobustRatioEstimate;
}

export interface PassportCalibrationSummary {
    manualUserCount: number;
    manualNotUserCount: number;
    mixedOccupancyCount: number;
    uncertainCount: number;
    shadowWindowStart: string | null;
    shadowWindowEnd: string | null;
}

/**
 * Provider-neutral: `sourceProfiles`/`crossSourceProfiles` are keyed generically, never hard-coded
 * to `eight_sleep`/`garmin_direct` (ADR-0028 exit criteria: "Garmin is a configured current
 * anchor, not a hard-coded universal assumption").
 */
export interface PhysiologicalIdentityPassport {
    schemaVersion: number;
    passportVersion: string;
    createdAt: string;
    policyVersion: string;
    featureSchemaVersion: string;
    anchorPolicy: AnchorPolicy;
    sourceProfiles: Readonly<Record<string, SourceProfile>>;
    crossSourceProfiles: Readonly<Record<string, CrossSourceProfile>>;
    calibration: PassportCalibrationSummary;
}

export function crossSourceProfileKey(
    sharedProvider: string,
    anchorProvider: string,
    anchorTransport: string,
): string {
    return `${sharedProvider}__${anchorProvider}_${anchorTransport}`;
}

function emptyCalibrationSummary(): PassportCalibrationSummary {
    return {
        manualUserCount: 0,
        manualNotUserCount: 0,
        mixedOccupancyCount: 0,
        uncertainCount: 0,
        shadowWindowStart: null,
        shadowWindowEnd: null,
    };
}

// --- Historical bootstrap ----------------------------------------------------------------------

/**
 * One historical shared-source/anchor night, already carrying PI2's pairing/lineage evaluation
 * outcome and derived features. `sharedSleepStartMinutesLocal` (Europe/Warsaw local minutes since
 * midnight) and `sharedSleepDurationMinutes` are computed by the caller (ingestion/replay code)
 * using the project's existing local-date utilities -- this module deals in already-derived
 * scalars, not raw timestamps, to keep robust-statistics logic independent of timezone handling.
 */
export interface PairedNightFeatureRecord {
    sourceNightKey: string;
    sharedProvider: string;
    anchorProvider: string;
    anchorTransport: string;
    lineageIndependent: boolean;
    anchorEligible: boolean;
    sharedRestingHeartRate: number | null;
    sharedRespirationRate: number | null;
    sharedHrv: number | null;
    sharedSleepStartMinutesLocal: number | null;
    sharedSleepDurationMinutes: number | null;
    relation: PhysiologicalRelationFeatures;
    overlap: IntervalOverlapMetrics | null;
}

export interface PassportBootstrapConfig {
    scaleFloors: IdentityFeatureScaleFloors;
    /** Robust z-score bound (|residual - median| / max(mad, floor)) for a feature to count as concordant. */
    concordanceZThreshold: number;
    /** Fraction of a night's *available* relation features that must be concordant to join the core. Conservative default: all of them. */
    minConcordantFeatureFraction: number;
}

export const DEFAULT_PASSPORT_BOOTSTRAP_CONFIG: PassportBootstrapConfig = {
    scaleFloors: DEFAULT_IDENTITY_FEATURE_SCALE_FLOORS,
    concordanceZThreshold: 3.0,
    minConcordantFeatureFraction: 1.0,
};

export interface NightConcordanceEvaluation {
    sourceNightKey: string;
    includedInCore: boolean;
    evaluatedFeatureCount: number;
    concordantFeatureCount: number;
    /**
     * Descriptive-only bucket, NEVER an identity verdict (ADR-0028 P-PI-8): a night with
     * `reason: 'DISCORDANT'` is excluded from fitting, not labelled `NOT_USER`.
     */
    reason: 'INSUFFICIENT_FEATURES' | 'CONCORDANT' | 'DISCORDANT';
}

function pluckNonNull<T>(
    records: readonly T[],
    select: (record: T) => number | null,
): number[] {
    const values: number[] = [];
    for (const record of records) {
        const value = select(record);
        if (value !== null && Number.isFinite(value)) {
            values.push(value);
        }
    }
    return values;
}

function logIfPositive(value: number | null): number | null {
    return value !== null && Number.isFinite(value) && value > 0 ? Math.log(value) : null;
}

interface PreliminaryRelationEstimates {
    rhr: RobustScalarEstimate;
    resp: RobustScalarEstimate;
    hrvLog: RobustScalarEstimate;
}

function fitPreliminaryRelationEstimates(
    nights: readonly PairedNightFeatureRecord[],
    floors: IdentityFeatureScaleFloors,
): PreliminaryRelationEstimates {
    return {
        rhr: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => n.relation.rhrResidual),
            floors.rhrResidualBpm,
        ),
        resp: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => n.relation.respResidual),
            floors.respirationResidualBrpm,
        ),
        hrvLog: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => n.relation.hrvLogResidual),
            floors.hrvLogResidual,
        ),
    };
}

function evaluateNightConcordance(
    night: PairedNightFeatureRecord,
    preliminary: PreliminaryRelationEstimates,
    config: PassportBootstrapConfig,
): NightConcordanceEvaluation {
    const checks: boolean[] = [];
    const evaluateFeature = (value: number | null, estimate: RobustScalarEstimate, floor: number) => {
        if (value === null || estimate.median === null || estimate.mad === null) {
            return; // an unavailable feature contributes no vote either way (no zero-fill)
        }
        const scale = Math.max(estimate.mad, floor);
        checks.push(Math.abs(value - estimate.median) / scale <= config.concordanceZThreshold);
    };

    evaluateFeature(night.relation.rhrResidual, preliminary.rhr, config.scaleFloors.rhrResidualBpm);
    evaluateFeature(night.relation.respResidual, preliminary.resp, config.scaleFloors.respirationResidualBrpm);
    evaluateFeature(night.relation.hrvLogResidual, preliminary.hrvLog, config.scaleFloors.hrvLogResidual);

    if (checks.length === 0) {
        return {
            sourceNightKey: night.sourceNightKey,
            includedInCore: false,
            evaluatedFeatureCount: 0,
            concordantFeatureCount: 0,
            reason: 'INSUFFICIENT_FEATURES',
        };
    }

    const concordantFeatureCount = checks.filter(Boolean).length;
    const includedInCore = concordantFeatureCount / checks.length >= config.minConcordantFeatureFraction;

    return {
        sourceNightKey: night.sourceNightKey,
        includedInCore,
        evaluatedFeatureCount: checks.length,
        concordantFeatureCount,
        reason: includedInCore ? 'CONCORDANT' : 'DISCORDANT',
    };
}

function fitSourceProfile(
    nights: readonly PairedNightFeatureRecord[],
    floors: IdentityFeatureScaleFloors,
): SourceProfile {
    return {
        trustedNightCount: nights.length,
        restingHeartRate: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => n.sharedRestingHeartRate),
            floors.rhrResidualBpm,
        ),
        respirationRate: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => n.sharedRespirationRate),
            floors.respirationResidualBrpm,
        ),
        logHrv: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => logIfPositive(n.sharedHrv)),
            floors.hrvLogResidual,
        ),
        sleepStartMinutesLocal: computeRobustLocationEstimate(
            pluckNonNull(nights, (n) => n.sharedSleepStartMinutesLocal),
            floors.startDeltaMinutes,
        ),
        sleepDurationMinutes: computeRobustLocationEstimate(
            pluckNonNull(nights, (n) => n.sharedSleepDurationMinutes),
            floors.durationDeltaMinutes,
        ),
    };
}

function fitCrossSourceProfile(
    nights: readonly PairedNightFeatureRecord[],
    floors: IdentityFeatureScaleFloors,
): CrossSourceProfile {
    return {
        rhrResidual: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => n.relation.rhrResidual),
            floors.rhrResidualBpm,
        ),
        respirationResidual: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => n.relation.respResidual),
            floors.respirationResidualBrpm,
        ),
        hrvLogResidual: computeRobustScalarEstimate(
            pluckNonNull(nights, (n) => n.relation.hrvLogResidual),
            floors.hrvLogResidual,
        ),
        startDeltaMinutes: computeRobustLocationEstimate(
            pluckNonNull(nights, (n) => n.overlap?.startDeltaMinutes ?? null),
            floors.startDeltaMinutes,
        ),
        endDeltaMinutes: computeRobustLocationEstimate(
            pluckNonNull(nights, (n) => n.overlap?.endDeltaMinutes ?? null),
            floors.endDeltaMinutes,
        ),
        durationDeltaMinutes: computeRobustLocationEstimate(
            pluckNonNull(nights, (n) => n.overlap?.durationDeltaMinutes ?? null),
            floors.durationDeltaMinutes,
        ),
        sessionJaccard: computeRobustRatioEstimate(pluckNonNull(nights, (n) => n.overlap?.jaccard ?? null)),
    };
}

function groupBySharedAndAnchor(
    nights: readonly PairedNightFeatureRecord[],
): Map<string, PairedNightFeatureRecord[]> {
    const groups = new Map<string, PairedNightFeatureRecord[]>();
    for (const night of nights) {
        const key = crossSourceProfileKey(night.sharedProvider, night.anchorProvider, night.anchorTransport);
        const existing = groups.get(key);
        if (existing) {
            existing.push(night);
        } else {
            groups.set(key, [night]);
        }
    }
    return groups;
}

export interface FitPassportParams {
    nights: readonly PairedNightFeatureRecord[];
    passportVersion: string;
    createdAt: string;
    policyVersion: string;
    featureSchemaVersion: string;
    anchorPolicy: AnchorPolicy;
    scaleFloors?: IdentityFeatureScaleFloors;
}

/** Fits a passport document directly from a night list, with no bootstrap/core-selection step. */
export function fitPassportFromNights(params: FitPassportParams): PhysiologicalIdentityPassport {
    const floors = params.scaleFloors ?? DEFAULT_IDENTITY_FEATURE_SCALE_FLOORS;
    const grouped = groupBySharedAndAnchor(params.nights);

    const sourceProfiles: Record<string, SourceProfile> = {};
    const crossSourceProfiles: Record<string, CrossSourceProfile> = {};
    for (const [key, groupNights] of grouped) {
        const sharedProvider = groupNights[0].sharedProvider;
        sourceProfiles[sharedProvider] = fitSourceProfile(groupNights, floors);
        crossSourceProfiles[key] = fitCrossSourceProfile(groupNights, floors);
    }

    return {
        schemaVersion: 1,
        passportVersion: params.passportVersion,
        createdAt: params.createdAt,
        policyVersion: params.policyVersion,
        featureSchemaVersion: params.featureSchemaVersion,
        anchorPolicy: params.anchorPolicy,
        sourceProfiles,
        crossSourceProfiles,
        calibration: emptyCalibrationSummary(),
    };
}

export interface PassportBootstrapResult {
    passport: PhysiologicalIdentityPassport;
    usableNightCount: number;
    excludedByLineageOrAnchorCount: number;
    coreNightCount: number;
    /** Descriptive re-scoring of every *usable* night (core + excluded) -- diagnostics, not labels. */
    nightConcordance: readonly NightConcordanceEvaluation[];
}

/**
 * Implements the plan's 7-step historical bootstrap:
 *   1. usable independent-lineage, anchor-eligible, validly-paired nights only;
 *   2. preliminary robust center/scale over all usable nights;
 *   3. conservative central core via multi-feature concordance;
 *   4. excluded nights are never labelled NOT_USER;
 *   5. fit passport v0 from the central core;
 *   6. `nightConcordance` re-scores every usable night for descriptive analysis;
 *   7. the result persists uncertainty (concordance diagnostics), not guessed identity labels.
 *
 * A full-sample bootstrap like this may be used as the production/shadow model after selection,
 * but `nightConcordance` here is in-sample and must not be reported as unbiased acceptance/
 * coverage evidence -- use `leaveOneNightOutReplay`/`chronologicalExpandingWindowReplay` for that.
 */
export function bootstrapPassportFromHistory(params: {
    nights: readonly PairedNightFeatureRecord[];
    passportVersion: string;
    createdAt: string;
    policyVersion: string;
    featureSchemaVersion: string;
    anchorPolicy: AnchorPolicy;
    config?: PassportBootstrapConfig;
}): PassportBootstrapResult {
    const config = params.config ?? DEFAULT_PASSPORT_BOOTSTRAP_CONFIG;

    // Step 1.
    const usable = params.nights.filter(
        (n) => n.lineageIndependent && n.anchorEligible && n.overlap !== null,
    );

    // Step 2.
    const preliminary = fitPreliminaryRelationEstimates(usable, config.scaleFloors);

    // Step 3.
    const nightConcordance = usable.map((n) => evaluateNightConcordance(n, preliminary, config));

    // Step 4 (nothing labelled NOT_USER -- `nightConcordance` carries only descriptive reasons).
    const coreKeys = new Set(
        nightConcordance.filter((c) => c.includedInCore).map((c) => c.sourceNightKey),
    );
    const coreNights = usable.filter((n) => coreKeys.has(n.sourceNightKey));

    // Step 5.
    const passport = fitPassportFromNights({
        nights: coreNights,
        passportVersion: params.passportVersion,
        createdAt: params.createdAt,
        policyVersion: params.policyVersion,
        featureSchemaVersion: params.featureSchemaVersion,
        anchorPolicy: params.anchorPolicy,
        scaleFloors: config.scaleFloors,
    });

    // Steps 6-7: nightConcordance (already computed over all usable nights) is the descriptive
    // re-score; no identity labels are produced anywhere in this result.
    return {
        passport,
        usableNightCount: usable.length,
        excludedByLineageOrAnchorCount: params.nights.length - usable.length,
        coreNightCount: coreNights.length,
        nightConcordance,
    };
}

// --- Out-of-sample evaluation (ADR-0028 P-PI-16) ------------------------------------------------

export interface OutOfSampleReplayResult {
    sourceNightKey: string;
    /** `null` when there were not enough training nights to fit a passport for this night. */
    passport: PhysiologicalIdentityPassport | null;
    trainingNightCount: number;
}

type BootstrapFitParams = Omit<Parameters<typeof bootstrapPassportFromHistory>[0], 'nights'>;

/**
 * Leave-one-night-out replay: each night is scored only against a passport fitted from every
 * *other* night. Suited to the small historical paired set. Never lets a night contribute to the
 * passport that evaluates it (P-PI-16).
 */
export function leaveOneNightOutReplay(
    nights: readonly PairedNightFeatureRecord[],
    fitParams: BootstrapFitParams,
): readonly OutOfSampleReplayResult[] {
    return nights.map((night) => {
        const trainingNights = nights.filter((other) => other.sourceNightKey !== night.sourceNightKey);
        if (trainingNights.length === 0) {
            return { sourceNightKey: night.sourceNightKey, passport: null, trainingNightCount: 0 };
        }
        const { passport } = bootstrapPassportFromHistory({ ...fitParams, nights: trainingNights });
        return { sourceNightKey: night.sourceNightKey, passport, trainingNightCount: trainingNights.length };
    });
}

/**
 * Chronological expanding-window replay: a night is scored only against a passport fitted from
 * strictly earlier nights (`nightsSortedChronologically` must already be in ascending order).
 * Nights before `minTrainingNights` of history exists get `passport: null` rather than a
 * degenerate near-empty fit.
 */
export function chronologicalExpandingWindowReplay(
    nightsSortedChronologically: readonly PairedNightFeatureRecord[],
    fitParams: BootstrapFitParams,
    minTrainingNights = 5,
): readonly OutOfSampleReplayResult[] {
    const results: OutOfSampleReplayResult[] = [];
    for (let i = 0; i < nightsSortedChronologically.length; i++) {
        const night = nightsSortedChronologically[i];
        const trainingNights = nightsSortedChronologically.slice(0, i);
        if (trainingNights.length < minTrainingNights) {
            results.push({ sourceNightKey: night.sourceNightKey, passport: null, trainingNightCount: trainingNights.length });
            continue;
        }
        const { passport } = bootstrapPassportFromHistory({ ...fitParams, nights: trainingNights });
        results.push({ sourceNightKey: night.sourceNightKey, passport, trainingNightCount: trainingNights.length });
    }
    return results;
}

// --- Passport eras (versioning) -----------------------------------------------------------------

export type PassportEraChangeReason =
    | 'GARMIN_DEVICE_OR_ALGORITHM_CHANGE'
    | 'EIGHT_SLEEP_ALGORITHM_OR_API_CHANGE'
    | 'GOOGLE_HEALTH_MAPPING_CHANGE'
    | 'MEASUREMENT_SYSTEM_SHIFT_CONFIRMED_BY_REPLAY'
    | 'INITIAL_BOOTSTRAP'
    | 'OTHER';

/**
 * Deterministically derives the next `passportVersion` string ("YYYY-MM-DD.N") for a given local
 * creation date, given the versions that already exist for that date. Pure/testable: callers
 * supply `createdAtDate` explicitly rather than this function reading the clock, so passport
 * version generation is itself replayable.
 */
export function nextPassportVersion(
    createdAtDate: string,
    existingVersionsForDate: readonly string[],
): string {
    const prefix = `${createdAtDate}.`;
    const suffixes = existingVersionsForDate
        .filter((v) => v.startsWith(prefix))
        .map((v) => Number.parseInt(v.slice(prefix.length), 10))
        .filter((n) => Number.isFinite(n));
    const next = suffixes.length > 0 ? Math.max(...suffixes) + 1 : 1;
    return `${prefix}${next}`;
}
