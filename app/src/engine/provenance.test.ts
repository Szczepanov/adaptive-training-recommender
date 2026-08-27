import { describe, expect, it } from 'vitest';
import type { Recommendation } from './models';
import type { IdentityDecisionProvenance } from '../observations/identityModels';
import { TEMPLATES } from './templates';
import { POLICY_VERSION } from './policy';
import { buildRecommendationAudit } from './provenance';
import { buildTrainingHistorySnapshot } from './trainingHistorySnapshot';

describe('recommendation provenance', () => {
    it('stores compact decision facts without raw health fields or athlete notes', () => {
        const template = TEMPLATES.find(item => item.category === 'Easy Endurance');
        if (!template) throw new Error('Test fixture requires an easy template');
        const recommendation: Recommendation = {
            template,
            mode: 'train',
            rationale: 'This should never be copied into the audit.',
            plannedDose: { volume: 0.6, intensity: 1 },
            executionDose: { volume: 0.5, intensity: 1 },
            envelopes: {
                safety: { clinicalFlagActive: false, restrictedModalities: [] },
                plan: { maxAllowableTier: 'Easy', taperActive: false },
            },
            decisionTrace: {
                policyVersion: POLICY_VERSION,
                candidateScores: [{ templateId: template.id, utilityScore: 1.25, excludedReasons: [] }],
                droppedContributorObjectives: [],
            },
        };
        const snapshot = buildTrainingHistorySnapshot(
            '2026-08-07', 7,
            { status: 'AVAILABLE', revision: 'activities-r1', data: [] },
            { status: 'AVAILABLE', revision: 'recommendations-r1', data: [] },
            '2026-08-07T08:00:00Z',
        );

        const audit = buildRecommendationAudit(recommendation, snapshot, '2026-08-07T09:00:00Z');
        expect(audit).toEqual({
            policyVersion: POLICY_VERSION,
            evaluatedAt: '2026-08-07T09:00:00Z',
            decisionContextRevision: snapshot.revision,
            safetyStatus: 'complete',
            history: {
                completedEventCount: 0,
                unmatchedEventCount: 0,
                sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' },
            },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Easy' },
            plannedDose: { volume: 0.6, intensity: 1 },
            executionDose: { volume: 0.5, intensity: 1 },
            candidateScores: [{ templateId: template.id, utilityScore: 1.25, excludedReasons: [] }],
            droppedContributorObjectives: [],
        });
        expect(JSON.stringify(audit)).not.toContain('This should never');
    });

    it('carries external plan provenance verbatim, and omits the field entirely otherwise', () => {
        const template = TEMPLATES.find(item => item.category === 'Rest');
        if (!template) throw new Error('Test fixture requires a rest template');
        const base: Recommendation = {
            template,
            mode: 'recover',
            rationale: 'Adjudicated from an imported plan.',
            envelopes: {
                safety: { clinicalFlagActive: false, restrictedModalities: [] },
                plan: { maxAllowableTier: 'Rest', taperActive: false },
            },
            decisionTrace: { policyVersion: POLICY_VERSION, candidateScores: [], droppedContributorObjectives: [] },
        };
        const snapshot = buildTrainingHistorySnapshot(
            '2026-08-07', 7,
            { status: 'AVAILABLE', revision: 'activities-r1', data: [] },
            { status: 'AVAILABLE', revision: 'recommendations-r1', data: [] },
            '2026-08-07T08:00:00Z',
        );
        const provenance = { planId: 'autumn-block', revision: 2, sessionId: 'w1-threshold', contentHash: 'abc123' };

        const external = buildRecommendationAudit(
            { ...base, decisionTrace: { ...base.decisionTrace!, externalPlan: provenance } },
            snapshot, '2026-08-07T09:00:00Z',
        );
        expect(external!.externalPlan).toEqual(provenance);

        // Absent rather than undefined: Firestore rejects an explicit undefined value, and
        // an always-present key would make "was this external?" ambiguous on read.
        const catalog = buildRecommendationAudit(base, snapshot, '2026-08-07T09:00:00Z');
        expect(Object.keys(catalog!)).not.toContain('externalPlan');
    });

    it('produces non-zero safetyRestrictedModalityCount in audit when an injury is active', () => {
        const template = TEMPLATES.find(item => item.category === 'Easy Endurance');
        if (!template) throw new Error('Test fixture requires an easy template');
        const recommendation: Recommendation = {
            template,
            mode: 'train',
            rationale: 'Injury active test',
            envelopes: {
                safety: { clinicalFlagActive: true, restrictedModalities: ['Running'] },
                plan: { maxAllowableTier: 'Easy', taperActive: false },
            },
            decisionTrace: {
                policyVersion: POLICY_VERSION,
                candidateScores: [{ templateId: template.id, utilityScore: 1.25, excludedReasons: [] }],
                droppedContributorObjectives: [],
            },
        };
        const snapshot = buildTrainingHistorySnapshot(
            '2026-08-07', 7,
            { status: 'AVAILABLE', revision: 'activities-r1', data: [] },
            { status: 'AVAILABLE', revision: 'recommendations-r1', data: [] },
            '2026-08-07T08:00:00Z',
        );

        const audit = buildRecommendationAudit(recommendation, snapshot, '2026-08-07T09:00:00Z');
        expect(audit?.envelope.safetyRestrictedModalityCount).toBe(1);
    });

    it('carries compact identity evidence into the recommendation audit verbatim', () => {
        const template = TEMPLATES.find(item => item.category === 'Rest');
        if (!template) throw new Error('Test fixture requires a rest template');
        const recommendation: Recommendation = {
            template,
            mode: 'recover',
            rationale: 'Identity fallback.',
            envelopes: {
                safety: { clinicalFlagActive: false, restrictedModalities: [] },
                plan: { maxAllowableTier: 'Rest', taperActive: false },
            },
            decisionTrace: { policyVersion: POLICY_VERSION, candidateScores: [], droppedContributorObjectives: [] },
        };
        const snapshot = buildTrainingHistorySnapshot(
            '2026-08-07', 7,
            { status: 'AVAILABLE', revision: 'activities-r1', data: [] },
            { status: 'AVAILABLE', revision: 'recommendations-r1', data: [] },
            '2026-08-07T08:00:00Z',
        );
        const identity: IdentityDecisionProvenance = {
            identityAssessmentId: 'assessment-1',
            automaticStatus: 'UNCERTAIN', effectiveStatus: 'UNCERTAIN', reviewEventId: null,
            identityPolicyVersion: 'identity-v1-shadow', featureSchemaVersion: 'identity-features-v1',
            passportVersion: '2026-08-07.1',
            sharedBundleRef: {
                id: 'shared', provider: 'shared_bed', transport: 'health_aggregator', revision: 2,
                sourcePayloadHash: 'sha256:shared', lineageKey: 'shared-bed:side:a',
            },
            anchorBundleRefs: [],
            selectedEffectiveSource: { provider: 'garmin', transport: 'garmin_direct' },
            fallbackReason: 'ANCHOR_MISSING',
        };

        const audit = buildRecommendationAudit(
            recommendation, snapshot, '2026-08-07T09:00:00Z', null, identity,
        );
        expect(audit?.identityDecision).toEqual(identity);
    });
});
