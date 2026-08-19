import { describe, expect, it } from 'vitest';
import { relevantFollowupRegions } from './followupSchedule';

describe('relevantFollowupRegions', () => {
    it('maps back_squat-style tissueDemand/safetyTags to knee', () => {
        const regions = relevantFollowupRegions([{ tissueDemand: ['knee_extensor', 'hip_extensor'], safetyTags: ['knee_swelling'] }]);
        expect(regions).toContain('knee');
        expect(regions).toContain('hip');
    });

    it('maps a field sprint drill to hamstring/calf-relevant regions', () => {
        const regions = relevantFollowupRegions([{ tissueDemand: ['posterior_chain', 'calf'], safetyTags: ['acute_hamstring_pain', 'worsening_achilles_pain'] }]);
        expect(regions).toEqual(expect.arrayContaining(['calf', 'hamstring', 'achilles']));
    });

    it('returns empty for an exercise with no tissue/safety tags', () => {
        expect(relevantFollowupRegions([{}])).toEqual([]);
    });

    it('returns empty for no exercises at all (e.g. an easy aerobic session)', () => {
        expect(relevantFollowupRegions([])).toEqual([]);
    });

    it('does not guess a region for an unrecognized tag', () => {
        expect(relevantFollowupRegions([{ tissueDemand: ['some_future_tag_nobody_mapped_yet'] }])).toEqual([]);
    });

    it('deduplicates and sorts regions across multiple exercises', () => {
        const regions = relevantFollowupRegions([
            { tissueDemand: ['knee_extensor'] },
            { tissueDemand: ['knee_extensor'] },
            { safetyTags: ['acute_hamstring_pain'] },
        ]);
        expect(regions).toEqual(['hamstring', 'knee']);
    });

    it('is case-insensitive', () => {
        expect(relevantFollowupRegions([{ tissueDemand: ['KNEE_EXTENSOR'] }])).toEqual(['knee']);
    });
});
