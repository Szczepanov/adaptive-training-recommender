import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressionReviewPanel } from './ProgressionReviewPanel';
import { deriveProposalId } from './progressionReviewPanelLogic';
import type { ProposedProgressionChange } from '../engine/progressionReview';

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

describe('ProgressionReviewPanel', () => {
    it('renders without throwing before any block has loaded', () => {
        const html = renderToStaticMarkup(<ProgressionReviewPanel userId="u1" />);
        expect(html).toContain('Progression Review');
    });
});

describe('deriveProposalId', () => {
    it('is stable for the same source revision, review date and proposed value', () => {
        const a = deriveProposalId(1, '2026-09-15', change());
        const b = deriveProposalId(1, '2026-09-15', change());
        expect(a).toBe(b);
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
});
