import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressionReviewPanel } from './ProgressionReviewPanel';
import { claimBelongsToReviewedRevision, deriveProposalId } from './progressionReviewPanelLogic';
import type { ProposedProgressionChange } from '../engine/progressionReview';
import type { ProgressionExperimentClaim } from '../services/progressionClaimService';

function change(overrides: Partial<ProposedProgressionChange> = {}): ProposedProgressionChange {
    return {
        targetBinding: { objectiveId: 'obj_1' },
        variable: 'duration_min',
        unit: 'minutes',
        previousValue: 90,
        proposedValue: 100,
        derivedDoseEffects: { delta: 10 },
        ...overrides,
    };
}

function heldClaim(overrides: Partial<ProgressionExperimentClaim> = {}): ProgressionExperimentClaim {
    return {
        userId: 'u1',
        state: 'held',
        experimentId: 'experiment-1',
        blockId: 'block-1',
        proposalId: 'proposal-1',
        sourcePlanRevision: 1,
        activationKey: 'a'.repeat(64),
        activationRevisionId: '2',
        acquiredAt: '2026-09-01T00:00:00.000Z',
        revision: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('ProgressionReviewPanel', () => {
    it('renders without throwing before any block has loaded', () => {
        const html = renderToStaticMarkup(<ProgressionReviewPanel userId="u1" />);
        expect(html).toContain('Progression Review');
    });
});

describe('deriveProposalId', () => {
    it('matches the canonical SHA-256 identity for the default proposal payload', () => {
        expect(deriveProposalId(1, '2026-09-15', change())).toBe(
            'dbbf02131a31b42f0d114e561c2c8d1e1b9222e02894db241956ad7e449a1bc3',
        );
    });

    it('is stable for the same source revision, review date and proposal semantics', () => {
        const a = deriveProposalId(1, '2026-09-15', change());
        const b = deriveProposalId(1, '2026-09-15', change());
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('differs when the source revision moved', () => {
        expect(deriveProposalId(1, '2026-09-15', change())).not.toBe(deriveProposalId(2, '2026-09-15', change()));
    });

    it('differs when the proposed value differs', () => {
        expect(deriveProposalId(1, '2026-09-15', change({ proposedValue: 100 })))
            .not.toBe(deriveProposalId(1, '2026-09-15', change({ proposedValue: 110 })));
    });

    it('differs when the review date differs', () => {
        expect(deriveProposalId(1, '2026-09-15', change())).not.toBe(deriveProposalId(1, '2026-09-29', change()));
    });

    it('differs when the target binding differs even if the before/after dose is identical', () => {
        expect(deriveProposalId(1, '2026-09-15', change({ targetBinding: { objectiveId: 'obj_1' } })))
            .not.toBe(deriveProposalId(1, '2026-09-15', change({ targetBinding: { objectiveId: 'obj_2' } })));
    });
});

describe('claimBelongsToReviewedRevision', () => {
    it('allows completion only for the exact held block/revision under review', () => {
        expect(claimBelongsToReviewedRevision(heldClaim(), 'block-1', 2)).toBe(true);
    });

    it('rejects a stale review revision', () => {
        expect(claimBelongsToReviewedRevision(heldClaim(), 'block-1', 1)).toBe(false);
    });

    it('rejects a different block or released claim', () => {
        expect(claimBelongsToReviewedRevision(heldClaim(), 'block-2', 2)).toBe(false);
        expect(claimBelongsToReviewedRevision(heldClaim({ state: 'released' }), 'block-1', 2)).toBe(false);
    });
});
