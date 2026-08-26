import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataConfidenceIndicator } from './DataConfidenceIndicator';
import type { DataConfidenceScore } from '../engine/dataConfidence';

describe('DataConfidenceIndicator', () => {
    const mockHighConfidence: DataConfidenceScore = {
        rating: 'HIGH',
        score: 92,
        sensorTier: 'FULL_WEARABLE',
        breakdown: {
            completenessScore: 100,
            freshnessScore: 90,
            baselineMaturityScore: 100,
            plausibilityScore: 100,
        },
        signals: {
            hrv: { signal: 'hrv', displayName: 'Overnight HRV', status: 'PRESENT', value: 65, isPlausible: true },
            rhr: { signal: 'rhr', displayName: 'Resting Heart Rate', status: 'PRESENT', value: 48, isPlausible: true },
        },
        activeSafeguards: [],
        summaryMessage: 'Complete, current, plausible core signals with mature wearable baselines.',
    };

    it('renders null when confidence is undefined or null', () => {
        const html = renderToStaticMarkup(<DataConfidenceIndicator confidence={null} />);
        expect(html).toBe('');
    });

    it('renders the high confidence badge correctly with class and text', () => {
        const html = renderToStaticMarkup(<DataConfidenceIndicator confidence={mockHighConfidence} />);
        expect(html).toContain('confidence-high');
        expect(html).toContain('Confidence:');
        expect(html).toContain('HIGH (92%)');
    });

    it('renders low confidence with appropriate styling', () => {
        const lowConfidence: DataConfidenceScore = {
            ...mockHighConfidence,
            rating: 'LOW',
            score: 45,
            sensorTier: 'SUBJECTIVE_ONLY',
            activeSafeguards: ['Subjective-only coverage: wearable telemetry is absent or unusable.'],
        };

        const html = renderToStaticMarkup(<DataConfidenceIndicator confidence={lowConfidence} />);
        expect(html).toContain('confidence-low');
        expect(html).toContain('LOW (45%)');
    });
});
