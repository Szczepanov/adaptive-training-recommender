import { describe, expect, it } from 'vitest';
import type { ReliabilityEstimate } from './models';
import { assertValidReliabilityEstimate, reliabilityEvidenceLabel } from './reliability';

describe('OV1 reliability provenance', () => {
    it('keeps literature, personal repeatability and manual evidence visibly distinct', () => {
        const literature: ReliabilityEstimate = {
            source: 'literature_reference',
            statistic: 'cv_pct',
            value: 2.1,
            reference: 'Reviewed protocol-specific source',
        };
        const personal: ReliabilityEstimate = {
            source: 'personal_repeatability',
            statistic: 'typical_error_abs',
            value: 6,
            contextNote: 'Close-spaced comparable repeat trials',
        };
        const manual: ReliabilityEstimate = {
            source: 'manual',
            statistic: 'sem_abs',
            value: 5,
        };

        expect(reliabilityEvidenceLabel(literature)).toBe('reference_level');
        expect(reliabilityEvidenceLabel(personal)).toBe('personal');
        expect(reliabilityEvidenceLabel(manual)).toBe('manual');
    });

    it('rejects negative, non-finite and empty-provenance values', () => {
        expect(() => assertValidReliabilityEstimate({
            source: 'manual', statistic: 'typical_error_abs', value: -1,
        })).toThrow(/finite non-negative/);
        expect(() => assertValidReliabilityEstimate({
            source: 'manual', statistic: 'typical_error_abs', value: Number.NaN,
        })).toThrow(/finite non-negative/);
        expect(() => assertValidReliabilityEstimate({
            source: 'literature_reference', statistic: 'cv_pct', value: 2, reference: '   ',
        })).toThrow(/reference must be non-empty/);
    });
});
