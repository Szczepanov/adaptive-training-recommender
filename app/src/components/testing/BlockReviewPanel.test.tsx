import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BlockReviewPanel } from './BlockReviewPanel';

vi.mock('../../services/blockReviewService', () => ({
    blockReviewService: { listReviews: vi.fn(), loadReview: vi.fn() },
}));

describe('BlockReviewPanel', () => {
    it('offers an explicit review action before loading evidence or enabling exports', () => {
        const html = renderToStaticMarkup(<BlockReviewPanel userId="synthetic-athlete" />);
        expect(html).toContain('Review block evidence');
        expect(html).toContain('No training changes');
        expect(html).not.toContain('Export block report');
        expect(html).toContain('aria-labelledby="block-review-title"');
    });
});
