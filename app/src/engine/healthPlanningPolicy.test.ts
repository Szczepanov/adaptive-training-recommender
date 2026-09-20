import { describe, expect, it } from 'vitest';
import {
    isQualifyingHealthQualityEnduranceEvidence,
    resolveHealthPlanningPolicy,
} from './healthPlanningPolicy';

describe('health planning policy', () => {
    it('prefers low-impact aerobic work and limits unnecessary moderate intensity without running support', () => {
        expect(resolveHealthPlanningPolicy(
            ['health'],
            { preferredModalities: ['Strength', 'Walking', 'Cycling'], deprioritizedModalities: [], avoidedModalities: [] },
            false,
        )).toEqual({
            enabled: true,
            preferLowImpactAerobic: true,
            withholdQualityEndurance: false,
            withholdHardEndurance: true,
            qualityEnduranceSessionLimit: 1,
        });
    });

    it('withholds moderate work after adverse recovery but re-enables it for a fresh check', () => {
        const preferences = { preferredModalities: ['Strength', 'Walking'], deprioritizedModalities: [], avoidedModalities: [] };
        expect(resolveHealthPlanningPolicy(['health'], preferences, true)?.withholdQualityEndurance).toBe(true);
        expect(resolveHealthPlanningPolicy(['health'], preferences, false)?.withholdQualityEndurance).toBe(false);
    });

    it('does not let the health hard-endurance ceiling override explicit performance intent or running support', () => {
        expect(resolveHealthPlanningPolicy(['endurance'], { preferredModalities: ['Running'], deprioritizedModalities: [], avoidedModalities: [] }, false)).toBeNull();
        for (const performancePriority of ['endurance', 'speed_power', 'sport_readiness'] as const) {
            expect(resolveHealthPlanningPolicy(
                ['health', performancePriority],
                { preferredModalities: ['Strength', 'Cycling'], deprioritizedModalities: [], avoidedModalities: [] },
                false,
            )).toMatchObject({
                withholdHardEndurance: false,
            });
        }
        expect(resolveHealthPlanningPolicy(['health'], { preferredModalities: ['Running'], deprioritizedModalities: [], avoidedModalities: [] }, false)).toMatchObject({
            preferLowImpactAerobic: false,
            withholdHardEndurance: false,
            qualityEnduranceSessionLimit: null,
        });
    });

    it('only counts typed, meaningful quality history toward the cap', () => {
        expect(isQualifyingHealthQualityEnduranceEvidence({ category: 'Moderate Endurance' })).toBe(true);
        expect(isQualifyingHealthQualityEnduranceEvidence({ type: 'Tempo Run', duration_min: 60 })).toBe(false);
        expect(isQualifyingHealthQualityEnduranceEvidence({ type: 'Tempo Run', intensity_tag: 'easy', duration_min: 60 })).toBe(false);
        expect(isQualifyingHealthQualityEnduranceEvidence({ type: 'Tempo Run', intensity_tag: 'moderate', duration_min: 19 })).toBe(false);
        expect(isQualifyingHealthQualityEnduranceEvidence({ type: 'Tempo Run', intensity_tag: 'moderate', duration_min: 20 })).toBe(true);
    });
});
