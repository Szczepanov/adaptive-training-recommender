/**
 * Historical out-of-sample shadow replay (PI8, ADR-0028).
 *
 * Runs PI2's pairing/lineage/feature extraction, PI3's out-of-sample passport fitting
 * (leave-one-night-out or chronological expanding window), and PI4's ternary evaluator over a
 * historical run of paired shared-source/anchor nights, producing the evidence fields the plan
 * requires before PI9 activation: coverage, reason-code distribution, lineage/anchor-quality
 * abstention counts, single-vs-multi-feature disagreement, a before/after identity-gating
 * comparison of the full-window robust shared-source baseline, and a coverage-only threshold
 * sensitivity sweep.
 *
 * Two invariants this module exists to protect:
 *   - P-PI-16: a night never contributes to the passport that evaluates it. Every automatic
 *     status here comes from `leaveOneNightOutReplay`/`chronologicalExpandingWindowReplay`
 *     (PI3), never from a full-sample in-sample fit.
 *   - P-PI-8: no historical night is ever labelled `NOT_USER` here. `evaluateIdentityEvidence`
 *     structurally cannot emit it in v1, and this module reports only `USER`/`UNCERTAIN` counts.
 *
 * This module also never fabricates a false-acceptance/precision claim: without real negative
 * labels the threshold sweep can only report coverage, and every report explicitly says so.
 */

import type {
    IdentityConfidenceTier,
    IdentityReasonCode,
    ObservationBundleRef,
} from '../observations/identityModels';
import {
    evaluateAnchorEligibility,
    computePhysiologicalRelationFeatures,
    selectBestSessionPairing,
    type AnchorEligibilityResult,
    type IntervalOverlapMetrics,
    type PhysiologicalRelationFeatures,
    type SessionInterval,
} from './identityFeatures';
import { evaluateAnchorLineageIndependence, type AnchorLineageEvaluation } from './identityLineage';
import {
    DEFAULT_IDENTITY_ATTRIBUTION_POLICY,
    evaluateIdentityEvidence,
    type IdentityAttributionInput,
    type IdentityAttributionPolicy,
} from './identityAttribution';
import {
    DEFAULT_PASSPORT_BOOTSTRAP_CONFIG,
    chronologicalExpandingWindowReplay,
    leaveOneNightOutReplay,
    type AnchorPolicy,
    type OutOfSampleReplayResult,
    type PairedNightFeatureRecord,
    type PassportBootstrapConfig,
} from './identityPassport';
import { calculateMad, calculateMedian } from './multisourceBaselines';

const HARD_ABSTENTION_REASON_CODES: readonly IdentityReasonCode[] = [
    'ANCHOR_MISSING',
    'ANCHOR_QUALITY_INSUFFICIENT',
    'EVIDENCE_LINEAGE_DEPENDENT',
];

const DEFAULT_CANDIDATE_MIN_USER_SCORES: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9];

export interface IdentityReplayNightInput {
    sourceNightKey: string;
    sharedBundleRef: ObservationBundleRef;
    /** Every candidate anchor ref for this night; lineage evaluation runs over all of them. */
    anchorBundleRefs: readonly ObservationBundleRef[];
    anchorPresent: boolean;
    anchorTechnicallyEligible: boolean;
    garminSessions: readonly SessionInterval[];
    eightSleepSessions: readonly SessionInterval[];
    sharedRestingHeartRate: number | null;
    garminRestingHeartRate: number | null;
    sharedRespirationRate: number | null;
    garminRespirationRate: number | null;
    sharedHrv: number | null;
    garminHrv: number | null;
    sharedSleepStartMinutesLocal: number | null;
    sharedSleepDurationMinutes: number | null;
}

/** Exported alongside `deriveNightFeatures`/`toPairedNightFeatureRecord` for direct unit testing. */
export interface IdentityReplayNightFeatures {
    input: IdentityReplayNightInput;
    anchorEligibility: AnchorEligibilityResult;
    lineageEvaluation: AnchorLineageEvaluation;
    pairingReasonCodes: readonly IdentityReasonCode[];
    overlap: IntervalOverlapMetrics | null;
    relation: PhysiologicalRelationFeatures;
}

/** Derives PI2 anchor, lineage, pairing, overlap, and physiological-relation features for one night. */
export function deriveNightFeatures(input: IdentityReplayNightInput): IdentityReplayNightFeatures {
    const anchorEligibility = evaluateAnchorEligibility({
        present: input.anchorPresent,
        technicallyEligible: input.anchorTechnicallyEligible,
    });
    const lineageEvaluation = evaluateAnchorLineageIndependence(input.anchorBundleRefs, input.sharedBundleRef);
    const pairing = selectBestSessionPairing(input.garminSessions, input.eightSleepSessions);
    const relation = computePhysiologicalRelationFeatures({
        eightSleepRhr: input.sharedRestingHeartRate,
        garminRhr: input.garminRestingHeartRate,
        eightSleepResp: input.sharedRespirationRate,
        garminResp: input.garminRespirationRate,
        eightSleepHrv: input.sharedHrv,
        garminHrv: input.garminHrv,
    });
    return {
        input,
        anchorEligibility,
        lineageEvaluation,
        pairingReasonCodes: pairing.reasonCodes,
        overlap: pairing.selected?.validation.metrics ?? null,
        relation,
    };
}

/** Exported for direct unit testing of the anchor-policy-match guard described above. */
export function toPairedNightFeatureRecord(
    features: IdentityReplayNightFeatures,
    anchorPolicy: AnchorPolicy,
): PairedNightFeatureRecord {
    const { input } = features;
    // A night is only lineage-independent *for this configured anchor policy* when one of its
    // independent refs actually matches anchorPolicy's provider/transport -- mirroring
    // identityAttribution.ts's hasConfiguredIndependentAnchor guard. Checking only "any
    // independent ref exists" would let a night whose sole independent anchor is a *different*
    // provider/transport contaminate this policy's fitted crossSourceProfile (PI9 review finding).
    const hasConfiguredIndependentAnchor = features.lineageEvaluation.independentAnchorRefs.some(
        (ref) => ref.provider === anchorPolicy.primaryProvider && ref.transport === anchorPolicy.primaryTransport,
    );
    return {
        sourceNightKey: input.sourceNightKey,
        sharedProvider: input.sharedBundleRef.provider,
        anchorProvider: anchorPolicy.primaryProvider,
        anchorTransport: anchorPolicy.primaryTransport,
        lineageIndependent: hasConfiguredIndependentAnchor,
        anchorEligible: features.anchorEligibility.eligible,
        sharedRestingHeartRate: input.sharedRestingHeartRate,
        sharedRespirationRate: input.sharedRespirationRate,
        sharedHrv: input.sharedHrv,
        sharedSleepStartMinutesLocal: input.sharedSleepStartMinutesLocal,
        sharedSleepDurationMinutes: input.sharedSleepDurationMinutes,
        relation: features.relation,
        overlap: features.overlap,
    };
}

export type IdentityReplayMethod = 'leaveOneOut' | 'chronologicalExpandingWindow';

export interface IdentityReplayConfig {
    method: IdentityReplayMethod;
    policyVersion: string;
    featureSchemaVersion: string;
    anchorPolicy: AnchorPolicy;
    /** Only used when `method: 'chronologicalExpandingWindow'`. Defaults to 5 (PI3 default). */
    minTrainingNights?: number;
    bootstrapConfig?: PassportBootstrapConfig;
    attributionPolicy?: IdentityAttributionPolicy;
    /** Candidate `minUserScore` values to sweep for the coverage-only sensitivity table. */
    candidateMinUserScores?: readonly number[];
}

export interface IdentityReplayNightResult {
    sourceNightKey: string;
    trainingNightCount: number;
    passportVersion: string | null;
    automaticStatus: 'USER' | 'UNCERTAIN';
    identityScore: number | null;
    confidenceTier: IdentityConfidenceTier;
    reasonCodes: readonly IdentityReasonCode[];
    evaluatedPhysiologyFeatureCount: number;
    concordantPhysiologyFeatureCount: number;
    discordantFeatureCount: number;
}

export type IdentityReplayBaselineMetric = 'restingHeartRate' | 'respirationRate' | 'hrv';

export interface IdentityReplayBaselineEstimate {
    n: number;
    median: number | null;
    mad: number | null;
}

export interface IdentityReplayBaselineComparison {
    metric: IdentityReplayBaselineMetric;
    /** Every technically valid night with a value, regardless of identity (pre-PI5 behaviour). */
    beforeGating: IdentityReplayBaselineEstimate;
    /** Only nights the out-of-sample evaluator accepted as automatic `USER`. */
    afterGating: IdentityReplayBaselineEstimate;
    nightsExcludedByGating: number;
}

export interface IdentityReplayThresholdSensitivity {
    minUserScore: number;
    coverageCount: number;
    coverageFraction: number;
}

export interface IdentityReplayReport {
    generatedFrom: 'historical-out-of-sample-replay';
    method: IdentityReplayMethod;
    policyVersion: string;
    featureSchemaVersion: string;
    pairedNightCount: number;
    automaticUserCount: number;
    automaticUserCoverage: number;
    uncertainCount: number;
    reasonCodeDistribution: Readonly<Record<string, number>>;
    lineageOrAnchorQualityAbstentionCount: number;
    singleFeatureDisagreementCount: number;
    multiFeatureDisagreementCount: number;
    baselineComparisons: readonly IdentityReplayBaselineComparison[];
    thresholdSensitivity: readonly IdentityReplayThresholdSensitivity[];
    limitations: readonly string[];
    nights: readonly IdentityReplayNightResult[];
}

const REPORT_LIMITATIONS: readonly string[] = [
    'Every automatic status is out-of-sample (P-PI-16): a night is scored only against a passport fitted without that night.',
    'No historical night is ever labelled NOT_USER here; automatic NOT_USER is structurally absent from the v1 evaluator (P-PI-8).',
    'Baseline before/after figures are a single full-replay-window robust estimate, not a literal day-by-day rolling 7d/28d baseline.',
    'Threshold sensitivity reports acceptance coverage only -- without real negative labels, false-acceptance/precision cannot be measured yet (see PI8 prospective evidence).',
];

/**
 * Validates invariants that TypeScript cannot enforce once the evidence CLI loads JSON. In
 * particular, `sourceNightKey` must be unique because both PI3 replay primitives and the result
 * maps use it as the night identity. Allowing duplicate rows would make a chronological replay
 * train a later duplicate on the same logical night and would collapse result/passport lookups,
 * violating P-PI-16.
 */
function assertReplayInputContract(
    nights: readonly IdentityReplayNightInput[],
    config: IdentityReplayConfig,
): void {
    const seenNightKeys = new Set<string>();
    for (const night of nights) {
        if (!night.sourceNightKey.trim()) {
            throw new Error('runIdentityReplay: every replay row requires a non-empty sourceNightKey.');
        }
        if (seenNightKeys.has(night.sourceNightKey)) {
            throw new Error(
                `runIdentityReplay: duplicate sourceNightKey ${night.sourceNightKey}; ` +
                    'export exactly one canonical shared-source row per logical night.',
            );
        }
        seenNightKeys.add(night.sourceNightKey);
    }

    if (config.method !== 'leaveOneOut' && config.method !== 'chronologicalExpandingWindow') {
        throw new Error(`runIdentityReplay: unsupported replay method ${String(config.method)}.`);
    }
    if (
        config.minTrainingNights !== undefined &&
        (!Number.isInteger(config.minTrainingNights) || config.minTrainingNights < 1)
    ) {
        throw new Error('runIdentityReplay: minTrainingNights must be a positive integer when provided.');
    }
    for (const minUserScore of config.candidateMinUserScores ?? []) {
        if (!Number.isFinite(minUserScore) || minUserScore < 0 || minUserScore > 1) {
            throw new Error('runIdentityReplay: candidateMinUserScores values must be finite numbers in [0, 1].');
        }
    }
}

/** Builds the exact PI4 evaluator input for one replay night and its out-of-sample passport. */
function buildAttributionInput(
    features: IdentityReplayNightFeatures,
    passport: OutOfSampleReplayResult['passport'],
    config: IdentityReplayConfig,
): IdentityAttributionInput {
    return {
        assessmentId: `replay:${features.input.sourceNightKey}`,
        sourceNightKey: features.input.sourceNightKey,
        assessedAt: features.input.sourceNightKey,
        featureSchemaVersion: config.featureSchemaVersion,
        sharedBundleRef: features.input.sharedBundleRef,
        anchorBundleRefs: features.input.anchorBundleRefs,
        anchorEligibility: features.anchorEligibility,
        lineageEvaluation: features.lineageEvaluation,
        pairingReasonCodes: features.pairingReasonCodes,
        overlap: features.overlap,
        relation: features.relation,
        passport,
    };
}

/** Counts automatic USER acceptances when only the policy's `minUserScore` threshold is changed. */
function evaluateAtThreshold(
    inputs: readonly IdentityAttributionInput[],
    policy: IdentityAttributionPolicy,
    minUserScore: number,
): number {
    const thresholdPolicy: IdentityAttributionPolicy = { ...policy, minUserScore };
    return inputs.filter((input) => evaluateIdentityEvidence(input, thresholdPolicy).automaticStatus === 'USER')
        .length;
}

/** Selects the raw shared-source value used by the before/after baseline comparison. */
function rawMetricValue(input: IdentityReplayNightInput, metric: IdentityReplayBaselineMetric): number | null {
    if (metric === 'restingHeartRate') return input.sharedRestingHeartRate;
    if (metric === 'respirationRate') return input.sharedRespirationRate;
    return input.sharedHrv;
}

/** Computes the report's robust baseline summary for one finite-value vector. */
function estimateFor(values: readonly number[]): IdentityReplayBaselineEstimate {
    const median = calculateMedian(values);
    return { n: values.length, median, mad: calculateMad(values, median) };
}

/** Compares a full-window shared-source baseline before identity gating and after USER-only gating. */
function computeBaselineComparison(
    nightInputs: readonly IdentityReplayNightInput[],
    userNightKeys: ReadonlySet<string>,
    metric: IdentityReplayBaselineMetric,
): IdentityReplayBaselineComparison {
    const before: number[] = [];
    const after: number[] = [];
    for (const input of nightInputs) {
        const value = rawMetricValue(input, metric);
        if (value === null || !Number.isFinite(value)) continue;
        before.push(value);
        if (userNightKeys.has(input.sourceNightKey)) after.push(value);
    }
    const beforeGating = estimateFor(before);
    const afterGating = estimateFor(after);
    return {
        metric,
        beforeGating,
        afterGating,
        nightsExcludedByGating: beforeGating.n - afterGating.n,
    };
}

/**
 * Runs the full PI8 out-of-sample historical replay. `nights` need not be pre-sorted; this
 * function sorts by `sourceNightKey` before fitting so a `chronologicalExpandingWindow` replay
 * trains each night only on strictly earlier nights. The input contract requires exactly one
 * canonical row per `sourceNightKey`; duplicate logical nights fail closed before any fitting.
 */
export function runIdentityReplay(
    nights: readonly IdentityReplayNightInput[],
    config: IdentityReplayConfig,
): IdentityReplayReport {
    assertReplayInputContract(nights, config);
    const sortedInputs = [...nights].sort((a, b) => a.sourceNightKey.localeCompare(b.sourceNightKey));
    const featuresByNight = sortedInputs.map(deriveNightFeatures);
    const pairedRecords = featuresByNight.map((f) => toPairedNightFeatureRecord(f, config.anchorPolicy));

    const bootstrapFitParams = {
        passportVersion: 'replay',
        createdAt: 'replay',
        policyVersion: config.policyVersion,
        featureSchemaVersion: config.featureSchemaVersion,
        anchorPolicy: config.anchorPolicy,
        config: config.bootstrapConfig ?? DEFAULT_PASSPORT_BOOTSTRAP_CONFIG,
    };

    const outOfSample: readonly OutOfSampleReplayResult[] =
        config.method === 'leaveOneOut'
            ? leaveOneNightOutReplay(pairedRecords, bootstrapFitParams)
            : chronologicalExpandingWindowReplay(pairedRecords, bootstrapFitParams, config.minTrainingNights ?? 5);
    const passportByNight = new Map(outOfSample.map((r) => [r.sourceNightKey, r]));

    const attributionPolicy = config.attributionPolicy ?? DEFAULT_IDENTITY_ATTRIBUTION_POLICY;
    const attributionInputs = featuresByNight.map((features) => {
        const oos = passportByNight.get(features.input.sourceNightKey);
        return buildAttributionInput(features, oos?.passport ?? null, config);
    });

    const nightResults: IdentityReplayNightResult[] = featuresByNight.map((features, index) => {
        const oos = passportByNight.get(features.input.sourceNightKey);
        const evidence = evaluateIdentityEvidence(attributionInputs[index], attributionPolicy);
        return {
            sourceNightKey: features.input.sourceNightKey,
            trainingNightCount: oos?.trainingNightCount ?? 0,
            passportVersion: oos?.passport?.passportVersion ?? null,
            automaticStatus: evidence.automaticStatus,
            identityScore: evidence.identityScore,
            confidenceTier: evidence.confidenceTier,
            reasonCodes: evidence.reasonCodes,
            evaluatedPhysiologyFeatureCount: evidence.evaluatedPhysiologyFeatureCount,
            concordantPhysiologyFeatureCount: evidence.concordantPhysiologyFeatureCount,
            discordantFeatureCount: evidence.featureEvidence.filter((f) => !f.concordant).length,
        };
    });

    const reasonCodeDistribution: Record<string, number> = {};
    let lineageOrAnchorQualityAbstentionCount = 0;
    let singleFeatureDisagreementCount = 0;
    let multiFeatureDisagreementCount = 0;
    let automaticUserCount = 0;
    for (const result of nightResults) {
        if (result.automaticStatus === 'USER') automaticUserCount += 1;
        for (const code of result.reasonCodes) {
            reasonCodeDistribution[code] = (reasonCodeDistribution[code] ?? 0) + 1;
        }
        if (result.reasonCodes.some((code) => HARD_ABSTENTION_REASON_CODES.includes(code))) {
            lineageOrAnchorQualityAbstentionCount += 1;
        }
        if (result.discordantFeatureCount === 1) singleFeatureDisagreementCount += 1;
        if (result.discordantFeatureCount >= 2) multiFeatureDisagreementCount += 1;
    }

    const userNightKeys = new Set(
        nightResults.filter((r) => r.automaticStatus === 'USER').map((r) => r.sourceNightKey),
    );
    const baselineComparisons: IdentityReplayBaselineComparison[] = (
        ['restingHeartRate', 'respirationRate', 'hrv'] as const
    ).map((metric) => computeBaselineComparison(sortedInputs, userNightKeys, metric));

    const candidateMinUserScores = config.candidateMinUserScores ?? DEFAULT_CANDIDATE_MIN_USER_SCORES;
    const thresholdSensitivity: IdentityReplayThresholdSensitivity[] = candidateMinUserScores.map(
        (minUserScore) => {
            const coverageCount = evaluateAtThreshold(attributionInputs, attributionPolicy, minUserScore);
            return {
                minUserScore,
                coverageCount,
                coverageFraction: attributionInputs.length > 0 ? coverageCount / attributionInputs.length : 0,
            };
        },
    );

    return {
        generatedFrom: 'historical-out-of-sample-replay',
        method: config.method,
        policyVersion: config.policyVersion,
        featureSchemaVersion: config.featureSchemaVersion,
        pairedNightCount: nightResults.length,
        automaticUserCount,
        automaticUserCoverage: nightResults.length > 0 ? automaticUserCount / nightResults.length : 0,
        uncertainCount: nightResults.length - automaticUserCount,
        reasonCodeDistribution,
        lineageOrAnchorQualityAbstentionCount,
        singleFeatureDisagreementCount,
        multiFeatureDisagreementCount,
        baselineComparisons,
        thresholdSensitivity,
        limitations: REPORT_LIMITATIONS,
        nights: nightResults,
    };
}

/** Formats a baseline estimate compactly for the Markdown evidence table. */
function formatEstimate(estimate: IdentityReplayBaselineEstimate): string {
    if (estimate.median === null) return `N=${estimate.n}, median=N/A`;
    return `N=${estimate.n}, median=${estimate.median.toFixed(2)}, MAD=${estimate.mad?.toFixed(2) ?? 'N/A'}`;
}

/** Renders the structured PI8 replay report as a reviewable Markdown evidence artifact. */
export function renderIdentityReplayMarkdown(report: IdentityReplayReport): string {
    const lines = [
        '# Physiological identity passport -- historical out-of-sample replay',
        '',
        `- Method: ${report.method}`,
        `- Policy version: ${report.policyVersion}`,
        `- Feature schema version: ${report.featureSchemaVersion}`,
        `- Paired nights: ${report.pairedNightCount}`,
        `- Automatic USER: ${report.automaticUserCount} (${(report.automaticUserCoverage * 100).toFixed(1)}% coverage)`,
        `- UNCERTAIN: ${report.uncertainCount}`,
        `- Lineage/anchor-quality abstentions: ${report.lineageOrAnchorQualityAbstentionCount}`,
        `- Single-feature disagreement nights: ${report.singleFeatureDisagreementCount}`,
        `- Multi-feature disagreement nights: ${report.multiFeatureDisagreementCount}`,
        '',
        '## Limitations',
        '',
        ...report.limitations.map((item) => `- ${item}`),
        '',
        '## Reason-code distribution',
        '',
        '| Reason code | Nights |',
        '| --- | ---: |',
        ...Object.entries(report.reasonCodeDistribution)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => `| ${code} | ${count} |`),
        '',
        '## Baseline before/after identity gating',
        '',
        '| Metric | Before gating | After gating | Nights excluded |',
        '| --- | --- | --- | ---: |',
        ...report.baselineComparisons.map(
            (row) =>
                `| ${row.metric} | ${formatEstimate(row.beforeGating)} | ${formatEstimate(row.afterGating)} | ${row.nightsExcludedByGating} |`,
        ),
        '',
        '## Threshold sensitivity (coverage only -- no false-acceptance evidence yet)',
        '',
        '| minUserScore | Automatic USER coverage |',
        '| ---: | --- |',
        ...report.thresholdSensitivity.map(
            (row) => `| ${row.minUserScore} | ${row.coverageCount}/${report.pairedNightCount} (${(row.coverageFraction * 100).toFixed(1)}%) |`,
        ),
        '',
        '## Nights',
        '',
        '| Date | Status | Score | Confidence | Reason codes |',
        '| --- | --- | --- | --- | --- |',
        ...report.nights.map(
            (row) =>
                `| ${row.sourceNightKey} | ${row.automaticStatus} | ${row.identityScore === null ? 'N/A' : row.identityScore.toFixed(3)} | ${row.confidenceTier} | ${row.reasonCodes.join(', ') || 'none'} |`,
        ),
        '',
    ];
    return lines.join('\n');
}
