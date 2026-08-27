import { describe, expect, it } from 'vitest';
import type { ObservationBundleRef } from '../observations/identityModels';
import {
    DEFAULT_IDENTITY_ATTRIBUTION_POLICY,
    IDENTITY_POLICY_VERSION,
    assessPhysiologicalIdentity,
    evaluateIdentityEvidence,
    type IdentityAttributionInput,
} from './identityAttribution';
import type { IntervalOverlapMetrics, PhysiologicalRelationFeatures } from './identityFeatures';
import type { AnchorLineageEvaluation } from './identityLineage';
import type {
    PhysiologicalIdentityPassport,
    RobustLocationEstimate,
    RobustRatioEstimate,
    RobustScalarEstimate,
} from './identityPassport';

const FEATURE_SCHEMA_VERSION = 'identity-features-v1';

function ref(overrides: Partial<ObservationBundleRef> = {}): ObservationBundleRef {
    return {
        id: 'bundle',
        provider: 'garmin',
        transport: 'garmin_direct',
        revision: 1,
        sourcePayloadHash: 'sha256:bundle',
        lineageKey: 'garmin:device:athlete',
        ...overrides,
    };
}

const SHARED_REF = ref({
    id: 'shared-night',
    provider: 'shared_bed',
    transport: 'health_aggregator',
    sourcePayloadHash: 'sha256:shared',
    lineageKey: 'shared-bed:side:a',
});
const ANCHOR_REF = ref({ id: 'anchor-night' });

function scalar(median: number, mad: number, n = 20): RobustScalarEstimate {
    return { median, mad, iqr: mad * 1.349, n };
}

function location(median: number, mad: number, n = 20): RobustLocationEstimate {
    return { median, mad, n };
}

function ratio(median: number, iqr: number, n = 20): RobustRatioEstimate {
    return { median, iqr, n };
}

function passport(overrides: Partial<PhysiologicalIdentityPassport> = {}): PhysiologicalIdentityPassport {
    return {
        schemaVersion: 1,
        passportVersion: '2026-08-27.1',
        createdAt: '2026-08-27T06:00:00Z',
        policyVersion: IDENTITY_POLICY_VERSION,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        anchorPolicy: {
            primaryProvider: 'garmin',
            primaryTransport: 'garmin_direct',
            role: 'PERSONAL_DEVICE_ANCHOR',
            requireIndependentLineage: true,
        },
        sourceProfiles: {
            shared_bed: {
                trustedNightCount: 20,
                restingHeartRate: scalar(55, 2),
                respirationRate: scalar(14, 0.5),
                logHrv: scalar(Math.log(60), 0.05),
                sleepStartMinutesLocal: location(1_380, 10),
                sleepDurationMinutes: location(450, 15),
            },
        },
        crossSourceProfiles: {
            shared_bed__garmin_garmin_direct: {
                rhrResidual: scalar(2, 1),
                respirationResidual: scalar(0.2, 0.5),
                hrvLogResidual: scalar(0.1, 0.05),
                startDeltaMinutes: location(5, 10),
                endDeltaMinutes: location(10, 10),
                durationDeltaMinutes: location(5, 15),
                sessionJaccard: ratio(0.95, 0.06),
            },
        },
        calibration: {
            manualUserCount: 0,
            manualNotUserCount: 0,
            mixedOccupancyCount: 0,
            uncertainCount: 0,
            shadowWindowStart: null,
            shadowWindowEnd: null,
        },
        ...overrides,
    };
}

function overlap(overrides: Partial<IntervalOverlapMetrics> = {}): IntervalOverlapMetrics {
    return {
        intersectionMinutes: 440,
        unionMinutes: 465,
        jaccard: 0.95,
        eightOverlapFraction: 0.98,
        garminOverlapFraction: 0.98,
        startDeltaMinutes: 5,
        endDeltaMinutes: 10,
        durationDeltaMinutes: 5,
        ...overrides,
    };
}

function relation(overrides: Partial<PhysiologicalRelationFeatures> = {}): PhysiologicalRelationFeatures {
    return {
        rhrResidual: 2,
        respResidual: 0.2,
        hrvLogResidual: 0.1,
        ...overrides,
    };
}

function independentLineage(): AnchorLineageEvaluation {
    return {
        independentAnchorRefs: [ANCHOR_REF],
        dependentAnchorRefs: [],
        reasonCodes: [],
    };
}

function input(overrides: Partial<IdentityAttributionInput> = {}): IdentityAttributionInput {
    return {
        assessmentId: 'identity-assessment-2026-08-27',
        sourceNightKey: '2026-08-27',
        assessedAt: '2026-08-27T06:30:00Z',
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        sharedBundleRef: SHARED_REF,
        anchorBundleRefs: [ANCHOR_REF],
        anchorEligibility: { eligible: true, reasonCode: null },
        lineageEvaluation: independentLineage(),
        pairingReasonCodes: [],
        overlap: overlap(),
        relation: relation(),
        passport: passport(),
        ...overrides,
    };
}

describe('identityAttribution (PI4, ADR-0028)', () => {
    it('A. accepts ordinary independent multi-feature agreement as high-confidence USER', () => {
        const result = evaluateIdentityEvidence(input());

        expect(result.automaticStatus).toBe('USER');
        expect(result.confidenceTier).toBe('HIGH');
        expect(result.identityScore).toBeCloseTo(1, 10);
        expect(result.reasonCodes).toEqual([
            'SESSION_TIMING_CONCORDANT',
            'RHR_RELATION_CONCORDANT',
            'RESPIRATION_RELATION_CONCORDANT',
            'HRV_RELATION_CONCORDANT',
        ]);
        expect(result.concordantEvidenceGroupCount).toBe(4);
        expect(result.concordantPhysiologyFeatureCount).toBe(3);
    });

    it('B. unusual absolute physiology remains USER when paired relations stay concordant', () => {
        // The evaluator intentionally sees paired relations, not population or absolute-normality
        // thresholds. Both devices may move sharply on an illness night while their relationship
        // remains personally concordant; downstream anomaly logic must still see that physiology.
        const result = evaluateIdentityEvidence(input({ relation: relation() }));

        expect(result.automaticStatus).toBe('USER');
        expect(result.reasonCodes).not.toContain('RHR_RELATION_DISCORDANT');
    });

    it('F. missing anchor abstains with no reassuring physiology-only score', () => {
        const result = evaluateIdentityEvidence(
            input({
                anchorBundleRefs: [],
                anchorEligibility: { eligible: false, reasonCode: 'ANCHOR_MISSING' },
                lineageEvaluation: {
                    independentAnchorRefs: [],
                    dependentAnchorRefs: [],
                    reasonCodes: [],
                },
            }),
        );

        expect(result.automaticStatus).toBe('UNCERTAIN');
        expect(result.identityScore).toBeNull();
        expect(result.confidenceTier).toBe('NONE');
        expect(result.reasonCodes).toContain('ANCHOR_MISSING');
    });

    it('G. technically ineligible anchor is distinct from a missing anchor and abstains', () => {
        const result = evaluateIdentityEvidence(
            input({
                anchorEligibility: {
                    eligible: false,
                    reasonCode: 'ANCHOR_QUALITY_INSUFFICIENT',
                },
            }),
        );

        expect(result.automaticStatus).toBe('UNCERTAIN');
        expect(result.reasonCodes).toContain('ANCHOR_QUALITY_INSUFFICIENT');
        expect(result.reasonCodes).not.toContain('ANCHOR_MISSING');
    });

    it('K. mirrored/dependent evidence cannot assert USER or contribute a score', () => {
        const dependentAnchor = ref({
            id: 'mirrored-anchor',
            lineageKey: SHARED_REF.lineageKey,
            transport: 'other_transport',
        });
        const result = evaluateIdentityEvidence(
            input({
                anchorBundleRefs: [dependentAnchor],
                lineageEvaluation: {
                    independentAnchorRefs: [],
                    dependentAnchorRefs: [dependentAnchor],
                    reasonCodes: ['EVIDENCE_LINEAGE_DEPENDENT'],
                },
            }),
        );

        expect(result.automaticStatus).toBe('UNCERTAIN');
        expect(result.identityScore).toBeNull();
        expect(result.reasonCodes).toContain('EVIDENCE_LINEAGE_DEPENDENT');
    });

    it('does not substitute an unrelated independent device for the passport-configured anchor', () => {
        const unrelated = ref({
            id: 'unrelated-anchor',
            provider: 'other_watch',
            transport: 'other_direct',
            lineageKey: 'other-watch:device:athlete',
        });
        const result = evaluateIdentityEvidence(
            input({
                anchorBundleRefs: [unrelated],
                lineageEvaluation: {
                    independentAnchorRefs: [unrelated],
                    dependentAnchorRefs: [],
                    reasonCodes: [],
                },
            }),
        );

        expect(result.automaticStatus).toBe('UNCERTAIN');
        expect(result.identityScore).toBeNull();
        expect(result.reasonCodes).toContain('ANCHOR_QUALITY_INSUFFICIENT');
    });

    it('abstains when passport history is immature or feature-schema incompatible', () => {
        const immature = passport({
            sourceProfiles: {
                shared_bed: {
                    ...passport().sourceProfiles.shared_bed,
                    trustedNightCount: DEFAULT_IDENTITY_ATTRIBUTION_POLICY.minTrustedNightCount - 1,
                },
            },
        });
        const immatureResult = evaluateIdentityEvidence(input({ passport: immature }));
        const incompatibleResult = evaluateIdentityEvidence(
            input({ featureSchemaVersion: 'identity-features-v2' }),
        );

        expect(immatureResult.automaticStatus).toBe('UNCERTAIN');
        expect(immatureResult.reasonCodes).toContain('INSUFFICIENT_PASSPORT_HISTORY');
        expect(incompatibleResult.automaticStatus).toBe('UNCERTAIN');
        expect(incompatibleResult.identityScore).toBeNull();
    });

    it('treats an otherwise mature passport with insufficient required feature history as immature', () => {
        const base = passport();
        const thinFeatureHistory = passport({
            crossSourceProfiles: {
                shared_bed__garmin_garmin_direct: {
                    ...base.crossSourceProfiles.shared_bed__garmin_garmin_direct,
                    startDeltaMinutes: location(5, 10, 2),
                    endDeltaMinutes: location(10, 10, 2),
                    durationDeltaMinutes: location(5, 15, 2),
                    sessionJaccard: ratio(0.95, 0.06, 2),
                },
            },
        });
        const result = evaluateIdentityEvidence(input({ passport: thinFeatureHistory }));

        expect(result.automaticStatus).toBe('UNCERTAIN');
        expect(result.reasonCodes).toContain('INSUFFICIENT_PASSPORT_HISTORY');
    });

    it('requires timing plus at least two physiological relations for multi-feature USER', () => {
        const twoPhysiology = evaluateIdentityEvidence(
            input({ relation: relation({ hrvLogResidual: null }) }),
        );
        const onePhysiology = evaluateIdentityEvidence(
            input({ relation: relation({ respResidual: null, hrvLogResidual: null }) }),
        );

        expect(twoPhysiology.automaticStatus).toBe('USER');
        expect(twoPhysiology.evaluatedPhysiologyFeatureCount).toBe(2);
        expect(onePhysiology.automaticStatus).toBe('UNCERTAIN');
        expect(onePhysiology.confidenceTier).toBe('MODERATE');
    });

    it('one discrepant physiological feature forces abstention but never automatic NOT_USER', () => {
        const result = evaluateIdentityEvidence(
            input({ relation: relation({ rhrResidual: 22 }) }),
        );

        expect(result.automaticStatus).toBe('UNCERTAIN');
        expect(result.confidenceTier).toBe('LOW');
        expect(result.reasonCodes).toContain('RHR_RELATION_DISCORDANT');
        expect(result.reasonCodes).toContain('RESPIRATION_RELATION_CONCORDANT');
        expect(result.identityScore).not.toBeNull();
    });

    it('I. discordant partial session geometry suspects mixed occupancy and quarantines automatically', () => {
        const result = evaluateIdentityEvidence(
            input({
                overlap: overlap({
                    startDeltaMinutes: -180,
                    durationDeltaMinutes: 180,
                    jaccard: 0.7,
                    eightOverlapFraction: 0.7,
                }),
            }),
        );

        expect(result.automaticStatus).toBe('UNCERTAIN');
        expect(result.reasonCodes).toContain('SESSION_TIMING_DISCORDANT');
        expect(result.reasonCodes).toContain('MIXED_OCCUPANCY_SUSPECTED');
    });

    it('ambiguous pairing abstains even when the selected candidate otherwise agrees', () => {
        const result = evaluateIdentityEvidence(
            input({ pairingReasonCodes: ['MULTIPLE_PAIRING_CANDIDATES'] }),
        );

        expect(result.automaticStatus).toBe('UNCERTAIN');
        expect(result.reasonCodes).toContain('MULTIPLE_PAIRING_CANDIDATES');
        expect(result.identityScore).toBeCloseTo(1, 10);
    });

    it('constructs the canonical immutable assessment with complete replay refs', () => {
        const dependentCopy = ref({
            id: 'dependent-copy',
            transport: 'aggregator',
            lineageKey: ANCHOR_REF.lineageKey,
        });
        const assessment = assessPhysiologicalIdentity(
            input({ anchorBundleRefs: [ANCHOR_REF, dependentCopy] }),
        );

        expect(assessment.automaticStatus).toBe('USER');
        expect(assessment.policyVersion).toBe(IDENTITY_POLICY_VERSION);
        expect(assessment.passportVersion).toBe('2026-08-27.1');
        expect(assessment.anchorBundleRefs).toEqual([ANCHOR_REF, dependentCopy]);
        expect(Object.isFrozen(assessment)).toBe(true);
        expect(Object.isFrozen(assessment.sharedSource)).toBe(true);
        expect(Object.isFrozen(assessment.anchorBundleRefs[0])).toBe(true);
    });

    it('automatic NOT_USER is disabled for every scored discrepancy in v1', () => {
        const residuals = [-100, -20, -1, 2, 5, 20, 100];
        for (const rhrResidual of residuals) {
            for (const respResidual of residuals) {
                const result = evaluateIdentityEvidence(
                    input({ relation: relation({ rhrResidual, respResidual }) }),
                );
                expect(result.automaticStatus).not.toBe('NOT_USER');
            }
        }
    });

    it('exposes a versioned, bounded evidence score rather than probability semantics', () => {
        const result = evaluateIdentityEvidence(
            input({ relation: relation({ rhrResidual: 3, respResidual: 0.7 }) }),
        );

        expect(DEFAULT_IDENTITY_ATTRIBUTION_POLICY.policyVersion).toBe('identity-v1-shadow');
        expect(result.identityScore).toBeGreaterThanOrEqual(0);
        expect(result.identityScore).toBeLessThanOrEqual(1);
        expect(result).not.toHaveProperty('probability');
    });
});
