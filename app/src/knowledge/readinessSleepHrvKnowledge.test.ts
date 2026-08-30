import { describe, expect, it } from 'vitest';
import {
    getActiveKnowledgeClaim,
    getKnowledgeSource,
    KNOWLEDGE_CLAIM_IDS,
    validateSportsKnowledgeRegistry,
} from './sportsKnowledge';

describe('readiness, sleep and HRV knowledge pack', () => {
    it('keeps the complete registry structurally valid', () => {
        expect(validateSportsKnowledgeRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('treats HRV as contextual longitudinal evidence rather than standalone readiness truth', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.hrvContextualMonitoring);
        expect(claim).toMatchObject({ maturity: 'supported', evidenceCertainty: 'moderate', recommendationStrength: 'conditional' });
        expect(claim.statement).toContain('cannot by itself determine readiness');
        expect(claim.limitations.join(' ')).toContain('universal millisecond cutoff');
        claim.evidence.forEach(link => expect(getKnowledgeSource(link.sourceId).sourceType).not.toBe('product_policy'));
    });

    it('keeps HRV-guided training authority conditional because performance superiority is inconsistent', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.hrvGuidedTrainingConditional);
        expect(claim).toMatchObject({ evidenceCertainty: 'low', recommendationStrength: 'conditional' });
        expect(claim.statement).toContain('small and inconsistent');
        expect(claim.limitations.join(' ')).toContain('HRV-only hard stop');
    });

    it('separates the established importance of sleep from wearable sleep-score authority', () => {
        const sleep = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.sleepPerformanceImportance);
        const wearable = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.wearableSleepMeasurementLimits);
        expect(sleep).toMatchObject({ evidenceCertainty: 'moderate', recommendationStrength: 'conditional' });
        expect(wearable).toMatchObject({ evidenceCertainty: 'moderate', recommendationStrength: 'informational' });
        expect(wearable.statement).toContain('should not be treated as validated physiological readiness thresholds');
        expect(wearable.limitations.join(' ')).toContain('Body Battery');
    });

    it('records exact readiness cut-points as product heuristics rather than scientific claims', () => {
        const heuristicIds = [
            KNOWLEDGE_CLAIM_IDS.readinessPhysiologicalStrainModel,
            KNOWLEDGE_CLAIM_IDS.readinessAbsoluteDeviceFloors,
            KNOWLEDGE_CLAIM_IDS.readinessAcuteBiometricFloors,
            KNOWLEDGE_CLAIM_IDS.readinessModeThresholds,
            KNOWLEDGE_CLAIM_IDS.internalResponseStrainModel,
        ];
        for (const id of heuristicIds) {
            const claim = getActiveKnowledgeClaim(id);
            expect(claim).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable' });
            expect(claim.evidence.some(link => getKnowledgeSource(link.sourceId).sourceType === 'product_policy')).toBe(true);
        }
        expect(getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.readinessAcuteBiometricFloors).statement).toContain('15 ms');
        expect(getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.readinessModeThresholds).statement).toContain('2.2');
        expect(getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.readinessAbsoluteDeviceFloors).statement).toContain('Body Battery 20');
    });
});
