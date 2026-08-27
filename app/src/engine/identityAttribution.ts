/**
 * Ternary physiological-identity evaluator with abstention (PI4, ADR-0028).
 *
 * This is a SHADOW-ONLY selective classifier. It composes PI2's technically valid,
 * provenance-independent paired features against PI3's versioned passport. V1 can automatically
 * accept a night as USER, but it deliberately cannot emit automatic NOT_USER. Conflicting or
 * incomplete evidence abstains to UNCERTAIN and remains outside baseline/fusion until PI5 wires
 * the effective-eligibility boundary.
 *
 * `identityScore` is a bounded evidence-ranking score, not a probability. The default numerical
 * policy is an explicit replay candidate for PI8; activation thresholds remain an evidence
 * decision rather than a claim that these defaults are calibrated.
 */

import {
    IDENTITY_REASON_CODES,
    freezeAutomaticIdentityAssessment,
    type AutomaticIdentityAssessment,
    type IdentityConfidenceTier,
    type IdentityReasonCode,
    type ObservationBundleRef,
} from '../observations/identityModels';
import type {
    AnchorEligibilityResult,
    IntervalOverlapMetrics,
    PhysiologicalRelationFeatures,
} from './identityFeatures';
import type { AnchorLineageEvaluation } from './identityLineage';
import {
    crossSourceProfileKey,
    type PhysiologicalIdentityPassport,
    type RobustLocationEstimate,
    type RobustRatioEstimate,
    type RobustScalarEstimate,
} from './identityPassport';

export const IDENTITY_POLICY_VERSION = 'identity-v1-shadow';

export interface IdentityAttributionPolicy {
    policyVersion: string;
    /** Passport-level maturity. This is a conservative shadow default, not an activation claim. */
    minTrustedNightCount: number;
    /** Per-feature history required before that feature can contribute evidence. */
    minFeatureNightCount: number;
    /** A feature is concordant at or below this absolute robust deviation. */
    concordanceZThreshold: number;
    /** Caps each feature's influence in the bounded evidence score. */
    scoreZCap: number;
    /** Minimum score for automatic USER, in addition to all multi-feature guards. */
    minUserScore: number;
    /** At least this many relation/timing groups must independently agree. */
    minConcordantEvidenceGroups: number;
    /** Prevents timing alone from asserting identity. */
    minConcordantPhysiologyFeatures: number;
    /** Robust scale floor for the bounded Jaccard feature, whose passport stores IQR. */
    sessionJaccardScaleFloor: number;
    /** Containment/partial-occupancy guard; only used with discordant session geometry. */
    mixedOccupancyOverlapFraction: number;
}

export const DEFAULT_IDENTITY_ATTRIBUTION_POLICY: IdentityAttributionPolicy = Object.freeze({
    policyVersion: IDENTITY_POLICY_VERSION,
    minTrustedNightCount: 14,
    minFeatureNightCount: 7,
    concordanceZThreshold: 3,
    scoreZCap: 6,
    minUserScore: 0.6,
    minConcordantEvidenceGroups: 3,
    minConcordantPhysiologyFeatures: 2,
    sessionJaccardScaleFloor: 0.05,
    mixedOccupancyOverlapFraction: 0.8,
});

export type IdentityEvidenceFeature =
    | 'SESSION_START_DELTA'
    | 'SESSION_END_DELTA'
    | 'SESSION_DURATION_DELTA'
    | 'SESSION_JACCARD'
    | 'RHR_RELATION'
    | 'RESPIRATION_RELATION'
    | 'HRV_RELATION';

export type IdentityEvidenceGroup = 'SESSION_TIMING' | 'RHR' | 'RESPIRATION' | 'HRV';

export interface IdentityFeatureEvidence {
    feature: IdentityEvidenceFeature;
    group: IdentityEvidenceGroup;
    robustDeviation: number;
    concordant: boolean;
}

export interface IdentityEvidenceEvaluation {
    identityScore: number | null;
    confidenceTier: IdentityConfidenceTier;
    reasonCodes: readonly IdentityReasonCode[];
    featureEvidence: readonly IdentityFeatureEvidence[];
    evaluatedEvidenceGroupCount: number;
    concordantEvidenceGroupCount: number;
    evaluatedPhysiologyFeatureCount: number;
    concordantPhysiologyFeatureCount: number;
    automaticStatus: 'USER' | 'UNCERTAIN';
}

export interface IdentityAttributionInput {
    assessmentId: string;
    sourceNightKey: string;
    assessedAt: string;
    featureSchemaVersion: string;
    sharedBundleRef: ObservationBundleRef;
    /** Every candidate anchor ref is retained for replay, including ignored dependent copies. */
    anchorBundleRefs: readonly ObservationBundleRef[];
    anchorEligibility: AnchorEligibilityResult;
    lineageEvaluation: AnchorLineageEvaluation;
    pairingReasonCodes: readonly IdentityReasonCode[];
    overlap: IntervalOverlapMetrics | null;
    relation: PhysiologicalRelationFeatures;
    passport: PhysiologicalIdentityPassport | null;
}

interface EstimateWithScale {
    median: number | null;
    scale: number | null;
    n: number;
}

function scalarEstimate(estimate: RobustScalarEstimate): EstimateWithScale {
    return { median: estimate.median, scale: estimate.mad, n: estimate.n };
}

function locationEstimate(estimate: RobustLocationEstimate): EstimateWithScale {
    return { median: estimate.median, scale: estimate.mad, n: estimate.n };
}

function ratioEstimate(
    estimate: RobustRatioEstimate,
    scaleFloor: number,
): EstimateWithScale {
    // IQR / 1.349 is the normal-consistent scale counterpart to scaled MAD. The explicit floor
    // protects early/near-constant passport histories from unstable divisions.
    const scale = estimate.iqr === null ? null : Math.max(estimate.iqr / 1.349, scaleFloor);
    return { median: estimate.median, scale, n: estimate.n };
}

function scoreFeature(
    feature: IdentityEvidenceFeature,
    group: IdentityEvidenceGroup,
    value: number | null,
    estimate: EstimateWithScale,
    policy: IdentityAttributionPolicy,
): IdentityFeatureEvidence | null {
    if (
        value === null ||
        !Number.isFinite(value) ||
        estimate.n < policy.minFeatureNightCount ||
        estimate.median === null ||
        estimate.scale === null ||
        !Number.isFinite(estimate.median) ||
        !Number.isFinite(estimate.scale) ||
        estimate.scale <= 0
    ) {
        return null;
    }

    const robustDeviation = Math.abs(value - estimate.median) / estimate.scale;
    return {
        feature,
        group,
        robustDeviation,
        concordant: robustDeviation <= policy.concordanceZThreshold,
    };
}

function appendFeature(
    evidence: IdentityFeatureEvidence[],
    candidate: IdentityFeatureEvidence | null,
): void {
    if (candidate) {
        evidence.push(candidate);
    }
}

function uniqueReasons(codes: readonly IdentityReasonCode[]): readonly IdentityReasonCode[] {
    const included = new Set(codes);
    return IDENTITY_REASON_CODES.filter((code) => included.has(code));
}

function hasHardPreconditionFailure(codes: readonly IdentityReasonCode[]): boolean {
    return codes.some((code) =>
        [
            'ANCHOR_MISSING',
            'ANCHOR_QUALITY_INSUFFICIENT',
            'EVIDENCE_LINEAGE_DEPENDENT',
            'INSUFFICIENT_PASSPORT_HISTORY',
            'MULTIPLE_PAIRING_CANDIDATES',
            'SESSION_INTERVAL_INVALID',
            'MIXED_OCCUPANCY_SUSPECTED',
        ].includes(code),
    );
}

function confidenceForUncertain(
    identityScore: number | null,
    hasHardFailure: boolean,
    hasDiscordance: boolean,
): IdentityConfidenceTier {
    if (identityScore === null) {
        return 'NONE';
    }
    if (hasHardFailure || hasDiscordance) {
        return 'LOW';
    }
    return 'MODERATE';
}

/**
 * Evaluates identity evidence without constructing/persisting the assessment wrapper. Exported so
 * PI8 can compare risk/coverage across policies while keeping the production-shaped assessment
 * contract stable.
 */
export function evaluateIdentityEvidence(
    input: IdentityAttributionInput,
    policy: IdentityAttributionPolicy = DEFAULT_IDENTITY_ATTRIBUTION_POLICY,
): IdentityEvidenceEvaluation {
    const reasons: IdentityReasonCode[] = [...input.pairingReasonCodes];

    if (!input.anchorEligibility.eligible && input.anchorEligibility.reasonCode) {
        reasons.push(input.anchorEligibility.reasonCode);
    }

    const hasAnyIndependentAnchor = input.lineageEvaluation.independentAnchorRefs.length > 0;
    if (!hasAnyIndependentAnchor && input.anchorBundleRefs.length > 0) {
        reasons.push('EVIDENCE_LINEAGE_DEPENDENT');
    }

    if (input.overlap === null && !reasons.includes('SESSION_INTERVAL_INVALID')) {
        reasons.push('SESSION_TIMING_DISCORDANT');
    }

    const passport = input.passport;
    const profileKey = passport
        ? crossSourceProfileKey(
              input.sharedBundleRef.provider,
              passport.anchorPolicy.primaryProvider,
              passport.anchorPolicy.primaryTransport,
          )
        : null;
    const profile = passport && profileKey ? passport.crossSourceProfiles[profileKey] : undefined;
    const sourceProfile = passport?.sourceProfiles[input.sharedBundleRef.provider];
    const hasConfiguredIndependentAnchor =
        passport !== null &&
        input.lineageEvaluation.independentAnchorRefs.some(
            (ref) =>
                ref.provider === passport.anchorPolicy.primaryProvider &&
                ref.transport === passport.anchorPolicy.primaryTransport,
        );
    if (passport && input.anchorEligibility.eligible && !hasConfiguredIndependentAnchor) {
        // An unrelated personal device cannot be substituted for the configured anchor whose
        // paired relationship the selected passport profile represents.
        reasons.push('ANCHOR_QUALITY_INSUFFICIENT');
    }
    const passportMature =
        passport !== null &&
        passport.featureSchemaVersion === input.featureSchemaVersion &&
        profile !== undefined &&
        sourceProfile !== undefined &&
        sourceProfile.trustedNightCount >= policy.minTrustedNightCount;

    if (!passportMature) {
        reasons.push('INSUFFICIENT_PASSPORT_HISTORY');
    }

    // Do not calculate an apparently reassuring score from unusable/non-independent evidence.
    const canScore =
        input.anchorEligibility.eligible &&
        hasConfiguredIndependentAnchor &&
        input.overlap !== null &&
        passportMature &&
        profile !== undefined;
    if (!canScore || !profile || !input.overlap) {
        const reasonCodes = uniqueReasons(reasons);
        return {
            identityScore: null,
            confidenceTier: 'NONE',
            reasonCodes,
            featureEvidence: [],
            evaluatedEvidenceGroupCount: 0,
            concordantEvidenceGroupCount: 0,
            evaluatedPhysiologyFeatureCount: 0,
            concordantPhysiologyFeatureCount: 0,
            automaticStatus: 'UNCERTAIN',
        };
    }

    const evidence: IdentityFeatureEvidence[] = [];
    appendFeature(
        evidence,
        scoreFeature(
            'SESSION_START_DELTA',
            'SESSION_TIMING',
            input.overlap.startDeltaMinutes,
            locationEstimate(profile.startDeltaMinutes),
            policy,
        ),
    );
    appendFeature(
        evidence,
        scoreFeature(
            'SESSION_END_DELTA',
            'SESSION_TIMING',
            input.overlap.endDeltaMinutes,
            locationEstimate(profile.endDeltaMinutes),
            policy,
        ),
    );
    appendFeature(
        evidence,
        scoreFeature(
            'SESSION_DURATION_DELTA',
            'SESSION_TIMING',
            input.overlap.durationDeltaMinutes,
            locationEstimate(profile.durationDeltaMinutes),
            policy,
        ),
    );
    appendFeature(
        evidence,
        scoreFeature(
            'SESSION_JACCARD',
            'SESSION_TIMING',
            input.overlap.jaccard,
            ratioEstimate(profile.sessionJaccard, policy.sessionJaccardScaleFloor),
            policy,
        ),
    );
    appendFeature(
        evidence,
        scoreFeature(
            'RHR_RELATION',
            'RHR',
            input.relation.rhrResidual,
            scalarEstimate(profile.rhrResidual),
            policy,
        ),
    );
    appendFeature(
        evidence,
        scoreFeature(
            'RESPIRATION_RELATION',
            'RESPIRATION',
            input.relation.respResidual,
            scalarEstimate(profile.respirationResidual),
            policy,
        ),
    );
    appendFeature(
        evidence,
        scoreFeature(
            'HRV_RELATION',
            'HRV',
            input.relation.hrvLogResidual,
            scalarEstimate(profile.hrvLogResidual),
            policy,
        ),
    );

    const timingEvidenceCount = evidence.filter((item) => item.group === 'SESSION_TIMING').length;
    const physiologyEvidenceCount = evidence.filter((item) => item.group !== 'SESSION_TIMING').length;
    const availablePhysiologyInputCount = [
        input.relation.rhrResidual,
        input.relation.respResidual,
        input.relation.hrvLogResidual,
    ].filter((value) => value !== null && Number.isFinite(value)).length;
    if (
        timingEvidenceCount === 0 ||
        (availablePhysiologyInputCount >= policy.minConcordantPhysiologyFeatures &&
            physiologyEvidenceCount < policy.minConcordantPhysiologyFeatures)
    ) {
        // The current night supplied enough raw candidate features, but the passport did not
        // contain enough per-feature history to evaluate the required evidence groups.
        reasons.push('INSUFFICIENT_PASSPORT_HISTORY');
    }

    const groupEvidence = new Map<IdentityEvidenceGroup, IdentityFeatureEvidence[]>();
    for (const item of evidence) {
        const current = groupEvidence.get(item.group);
        if (current) {
            current.push(item);
        } else {
            groupEvidence.set(item.group, [item]);
        }
    }

    const timing = groupEvidence.get('SESSION_TIMING') ?? [];
    if (timing.length > 0) {
        reasons.push(
            timing.every((item) => item.concordant)
                ? 'SESSION_TIMING_CONCORDANT'
                : 'SESSION_TIMING_DISCORDANT',
        );
    }

    const relationReasonPairs: readonly [
        IdentityEvidenceGroup,
        IdentityReasonCode,
        IdentityReasonCode,
    ][] = [
        ['RHR', 'RHR_RELATION_CONCORDANT', 'RHR_RELATION_DISCORDANT'],
        ['RESPIRATION', 'RESPIRATION_RELATION_CONCORDANT', 'RESPIRATION_RELATION_DISCORDANT'],
        ['HRV', 'HRV_RELATION_CONCORDANT', 'HRV_RELATION_DISCORDANT'],
    ];
    for (const [group, concordantReason, discordantReason] of relationReasonPairs) {
        const groupItems = groupEvidence.get(group) ?? [];
        if (groupItems.length > 0) {
            reasons.push(groupItems.every((item) => item.concordant) ? concordantReason : discordantReason);
        }
    }

    const mixedOccupancySuspected =
        timing.some((item) => !item.concordant) &&
        (input.overlap.eightOverlapFraction < policy.mixedOccupancyOverlapFraction ||
            input.overlap.garminOverlapFraction < policy.mixedOccupancyOverlapFraction);
    if (mixedOccupancySuspected) {
        reasons.push('MIXED_OCCUPANCY_SUSPECTED');
    }

    // Correlated timing dimensions count as one group, preventing four timing measurements from
    // overwhelming one or two genuinely independent physiological relations.
    const groupScores = [...groupEvidence.values()].map((items) => {
        const meanDeviation =
            items.reduce((total, item) => total + Math.min(item.robustDeviation, policy.scoreZCap), 0) /
            items.length;
        return 1 - meanDeviation / policy.scoreZCap;
    });
    const identityScore =
        groupScores.length === 0
            ? null
            : groupScores.reduce((total, score) => total + score, 0) / groupScores.length;

    const groups = [...groupEvidence.entries()];
    const concordantEvidenceGroupCount = groups.filter(([, items]) =>
        items.every((item) => item.concordant),
    ).length;
    const physiology = evidence.filter((item) => item.group !== 'SESSION_TIMING');
    const concordantPhysiologyFeatureCount = physiology.filter((item) => item.concordant).length;
    const hasDiscordance = evidence.some((item) => !item.concordant);
    const reasonCodes = uniqueReasons(reasons);
    const hardFailure = hasHardPreconditionFailure(reasonCodes);
    const automaticUser =
        !hardFailure &&
        !hasDiscordance &&
        identityScore !== null &&
        identityScore >= policy.minUserScore &&
        groupEvidence.has('SESSION_TIMING') &&
        concordantEvidenceGroupCount >= policy.minConcordantEvidenceGroups &&
        concordantPhysiologyFeatureCount >= policy.minConcordantPhysiologyFeatures;

    return {
        identityScore,
        confidenceTier: automaticUser
            ? 'HIGH'
            : confidenceForUncertain(identityScore, hardFailure, hasDiscordance),
        reasonCodes,
        featureEvidence: evidence,
        evaluatedEvidenceGroupCount: groupEvidence.size,
        concordantEvidenceGroupCount,
        evaluatedPhysiologyFeatureCount: physiology.length,
        concordantPhysiologyFeatureCount,
        // Automatic NOT_USER is structurally absent from this return type in v1 (P-PI-8).
        automaticStatus: automaticUser ? 'USER' : 'UNCERTAIN',
    };
}

/** Builds and deep-freezes PI1's canonical immutable automatic-assessment contract. */
export function assessPhysiologicalIdentity(
    input: IdentityAttributionInput,
    policy: IdentityAttributionPolicy = DEFAULT_IDENTITY_ATTRIBUTION_POLICY,
): Readonly<AutomaticIdentityAssessment> {
    const evidence = evaluateIdentityEvidence(input, policy);
    return freezeAutomaticIdentityAssessment({
        id: input.assessmentId,
        sourceNightKey: input.sourceNightKey,
        sharedSource: {
            provider: input.sharedBundleRef.provider,
            transport: input.sharedBundleRef.transport,
        },
        automaticStatus: evidence.automaticStatus,
        identityScore: evidence.identityScore,
        confidenceTier: evidence.confidenceTier,
        reasonCodes: [...evidence.reasonCodes],
        passportVersion: input.passport?.passportVersion ?? null,
        policyVersion: policy.policyVersion,
        featureSchemaVersion: input.featureSchemaVersion,
        assessedAt: input.assessedAt,
        sharedBundleRef: { ...input.sharedBundleRef },
        anchorBundleRefs: input.anchorBundleRefs.map((ref) => ({ ...ref })),
    });
}
