import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdherencePrompt } from './AdherencePrompt';
import type { DailyRecommendation } from '../engine/models';

const recommendation = {
    userId: 'u1',
    date: '2026-11-12',
    templateId: 'easy_ride',
    templateTitle: 'Easy Ride',
    category: 'Easy',
    modality: 'Cycling',
    mode: 'train',
    rationale: 'Keep it easy.',
    schemaVersion: 3,
    createdAt: '2026-11-12T06:00:00Z',
    updatedAt: '2026-11-12T06:00:00Z',
    adherence: {
        respondedAt: null,
        followed: null,
        actualModality: null,
        actualDurationMin: null,
        skipped: false,
        notes: null,
    },
} as unknown as DailyRecommendation;

describe('AdherencePrompt (#1167 P2-5)', () => {
    it('renders nothing in ledger mode', () => {
        const html = renderToStaticMarkup(
            <AdherencePrompt
                userId="u1"
                date="2026-11-12"
                recommendation={recommendation}
                onResolved={vi.fn()}
                planningAuthorityMode="ledger"
            />,
        );
        expect(html).toBe('');
    });

    it('renders the adherence prompt in engine mode', () => {
        const html = renderToStaticMarkup(
            <AdherencePrompt
                userId="u1"
                date="2026-11-12"
                recommendation={recommendation}
                onResolved={vi.fn()}
                planningAuthorityMode="engine"
            />,
        );
        expect(html).toContain('Did you complete yesterday');
        expect(html).toContain('Easy Ride');
    });
});
