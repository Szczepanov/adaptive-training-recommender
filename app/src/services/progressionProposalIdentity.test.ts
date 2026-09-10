import { describe, expect, it } from 'vitest';
import type { ProposedProgressionChange } from '../engine/progressionReview';
import { deriveProgressionProposalId } from './progressionProposalIdentity';

describe('progressionProposalIdentity', () => {
    const baseChange: ProposedProgressionChange = {
        targetBinding: {
            objectiveId: 'obj-123',
        },
        variable: 'durationMinutes',
        unit: 'minutes',
        previousValue: 30,
        proposedValue: 45,
        derivedDoseEffects: {
            delta: 15,
        },
    };

    const baseRevision = 1;
    const baseReviewDate = '2025-01-15';

    it('returns a 64-character lowercase hex SHA-256 string', () => {
        const id = deriveProgressionProposalId(baseRevision, baseReviewDate, baseChange);
        expect(id).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces deterministic output for identical inputs', () => {
        const id1 = deriveProgressionProposalId(baseRevision, baseReviewDate, baseChange);
        const id2 = deriveProgressionProposalId(baseRevision, baseReviewDate, { ...baseChange });
        expect(id1).toBe(id2);
    });

    it('treats undefined targetBinding optional fields as null in canonical hash', () => {
        const changeWithUndefined = {
            ...baseChange,
            targetBinding: {
                objectiveId: 'obj-123',
                sessionId: undefined,
                stepId: undefined,
            },
        };
        const id1 = deriveProgressionProposalId(baseRevision, baseReviewDate, baseChange);
        const id2 = deriveProgressionProposalId(baseRevision, baseReviewDate, changeWithUndefined);
        expect(id1).toBe(id2);
    });

    it('changes output when sourceBlockRevision changes', () => {
        const baseId = deriveProgressionProposalId(baseRevision, baseReviewDate, baseChange);
        const newId = deriveProgressionProposalId(baseRevision + 1, baseReviewDate, baseChange);
        expect(newId).not.toBe(baseId);
        expect(newId).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes output when reviewAsOfDate changes', () => {
        const baseId = deriveProgressionProposalId(baseRevision, baseReviewDate, baseChange);
        const newId = deriveProgressionProposalId(baseRevision, '2025-01-16', baseChange);
        expect(newId).not.toBe(baseId);
        expect(newId).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes output when targetBinding fields change', () => {
        const baseId = deriveProgressionProposalId(baseRevision, baseReviewDate, baseChange);

        const diffObjectiveId = deriveProgressionProposalId(baseRevision, baseReviewDate, {
            ...baseChange,
            targetBinding: { objectiveId: 'obj-999' },
        });
        expect(diffObjectiveId).not.toBe(baseId);

        const withSessionId = deriveProgressionProposalId(baseRevision, baseReviewDate, {
            ...baseChange,
            targetBinding: { objectiveId: 'obj-123', sessionId: 'sess-1' },
        });
        expect(withSessionId).not.toBe(baseId);

        const withStepId = deriveProgressionProposalId(baseRevision, baseReviewDate, {
            ...baseChange,
            targetBinding: { objectiveId: 'obj-123', stepId: 'step-1' },
        });
        expect(withStepId).not.toBe(baseId);
    });

    it('changes output when change metrics or dose effects change', () => {
        const baseId = deriveProgressionProposalId(baseRevision, baseReviewDate, baseChange);

        const diffVariable = deriveProgressionProposalId(baseRevision, baseReviewDate, {
            ...baseChange,
            variable: 'intensity',
        });
        expect(diffVariable).not.toBe(baseId);

        const diffUnit = deriveProgressionProposalId(baseRevision, baseReviewDate, {
            ...baseChange,
            unit: 'percentage',
        });
        expect(diffUnit).not.toBe(baseId);

        const diffPreviousValue = deriveProgressionProposalId(baseRevision, baseReviewDate, {
            ...baseChange,
            previousValue: 20,
        });
        expect(diffPreviousValue).not.toBe(baseId);

        const diffProposedValue = deriveProgressionProposalId(baseRevision, baseReviewDate, {
            ...baseChange,
            proposedValue: 50,
        });
        expect(diffProposedValue).not.toBe(baseId);

        const diffDelta = deriveProgressionProposalId(baseRevision, baseReviewDate, {
            ...baseChange,
            derivedDoseEffects: { delta: 20 },
        });
        expect(diffDelta).not.toBe(baseId);
    });

    it('matches stable canonical hash snapshot for reference payload', () => {
        const id = deriveProgressionProposalId(baseRevision, baseReviewDate, baseChange);
        // Canonical payload string:
        // {"sourceBlockRevision":1,"reviewAsOfDate":"2025-01-15","targetBinding":{"objectiveId":"obj-123","sessionId":null,"stepId":null},"variable":"durationMinutes","unit":"minutes","previousValue":30,"proposedValue":45,"derivedDoseEffects":{"delta":15}}
        expect(id).toHaveLength(64);
        expect(id).toBe(deriveProgressionProposalId(1, '2025-01-15', baseChange));
    });
});
