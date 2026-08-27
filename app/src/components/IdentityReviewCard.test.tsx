import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AutomaticIdentityAssessment } from '../observations/identityModels';
import { IdentityReviewForm } from './IdentityReviewCard';

function assessment(overrides: Partial<AutomaticIdentityAssessment> = {}): AutomaticIdentityAssessment {
    return {
        id: 'assessment-1',
        sourceNightKey: '2026-08-20',
        sharedSource: { provider: 'eight_sleep', transport: 'google_health' },
        automaticStatus: 'UNCERTAIN',
        identityScore: 0.4,
        confidenceTier: 'LOW',
        reasonCodes: ['SESSION_TIMING_DISCORDANT', 'RHR_RELATION_DISCORDANT'],
        passportVersion: '2026-08-20.1',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        assessedAt: '2026-08-20T06:00:00Z',
        sharedBundleRef: {
            id: '2026-08-20_eight_sleep_google_health',
            provider: 'eight_sleep',
            transport: 'google_health',
            revision: 1,
            sourcePayloadHash: 'sha256:x',
            lineageKey: 'eight_sleep:pod-side:a',
        },
        anchorBundleRefs: [],
        ...overrides,
    };
}

describe('IdentityReviewForm', () => {
    it('renders the default discordant-evidence copy and all four review buttons', () => {
        const html = renderToStaticMarkup(
            <IdentityReviewForm assessment={assessment()} existingReviewLabel={null} onSubmit={vi.fn()} />,
        );
        expect(html).toContain('Eight Sleep data not verified');
        expect(html).toContain('did not agree strongly enough');
        expect(html).toContain('Only me');
        expect(html).toContain('Shared / mixed');
        expect(html).toContain('Not me');
        expect(html).toContain('Unsure');
        expect(html).not.toContain('imposter');
        expect(html).not.toContain('sensor bad');
    });

    it('uses ANCHOR_MISSING copy when that is the leading reason code', () => {
        const html = renderToStaticMarkup(
            <IdentityReviewForm
                assessment={assessment({ reasonCodes: ['ANCHOR_MISSING'] })}
                existingReviewLabel={null}
                onSubmit={vi.fn()}
            />,
        );
        expect(html).toContain('find a Garmin record');
    });

    it('uses ANCHOR_QUALITY_INSUFFICIENT copy when that is the leading reason code', () => {
        const html = renderToStaticMarkup(
            <IdentityReviewForm
                assessment={assessment({ reasonCodes: ['ANCHOR_QUALITY_INSUFFICIENT'] })}
                existingReviewLabel={null}
                onSubmit={vi.fn()}
            />,
        );
        expect(html).toContain('complete enough to confirm');
    });

    it('surfaces reason codes in user language behind progressive disclosure', () => {
        const html = renderToStaticMarkup(
            <IdentityReviewForm assessment={assessment()} existingReviewLabel={null} onSubmit={vi.fn()} />,
        );
        expect(html).toContain('Why?');
        expect(html).toContain('sleep interval differed from Garmin');
        expect(html).toContain('resting-heart-rate relationship differed from your usual paired pattern');
    });

    it('shows the prior answer without naming a household member', () => {
        const html = renderToStaticMarkup(
            <IdentityReviewForm assessment={assessment()} existingReviewLabel="NOT_USER" onSubmit={vi.fn()} />,
        );
        expect(html).toContain('You previously told us: Not me');
        expect(html).not.toMatch(/spouse|child|guest|partner/i);
    });
});
