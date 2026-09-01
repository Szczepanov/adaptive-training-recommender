import { describe, expect, it } from 'vitest';
import { resolveInjuryRestrictions } from '../engine/injuryPolicy';
import { INJURY_PAIN_POLICY_DESCRIPTOR } from './injuryPainKnowledge';

const TODAY = '2026-09-01';

type RegionMappingFamilyKey = keyof typeof INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings;

const REGION_ALIGNMENT_CASES = (
    Object.entries(INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings) as [
        RegionMappingFamilyKey,
        (typeof INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings)[RegionMappingFamilyKey],
    ][]
).flatMap(([family, descriptor]) =>
    descriptor.regions.map((region) => [family, region] as const),
);

describe('injury and clinical-symptom policy alignment', () => {
    it.each(REGION_ALIGNMENT_CASES)('pins %s (%s) restrictions for limit and exclude', (family, region) => {
        const descriptor = INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings[family];
        const limit = resolveInjuryRestrictions([{ region, severity: 'limit' }], TODAY);
        const exclude = resolveInjuryRestrictions([{ region, severity: 'exclude' }], TODAY);

        expect(limit).toEqual(descriptor.limit);
        expect(exclude).toEqual(descriptor.exclude);
    });

    it('pins monitor as explicit-modality pass-through without a region-derived mapping', () => {
        expect(resolveInjuryRestrictions([{ region: 'knee', severity: 'monitor', restrictedModalities: ['Cycling'] }], TODAY)).toEqual({
            restrictedModalities: ['Cycling'], impliedGuardrails: [], restrictedCategories: [],
        });
    });

    it("pins expiry and today's scope as separate from region policy", () => {
        expect(resolveInjuryRestrictions([{ region: 'knee', severity: 'exclude', reviewBy: '2026-08-31' }], TODAY)).toEqual({
            restrictedModalities: [], impliedGuardrails: [], restrictedCategories: [],
        });
    });
});
