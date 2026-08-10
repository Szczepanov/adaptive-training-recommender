import { describe, expect, it } from 'vitest';
import type { CompletedExposure } from './trainingHistory';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from './evergreenStrategy';

const exposure = (duration: number): CompletedExposure => ({
    date: '2026-08-01', trainingRecordLike: { type: 'Cycling endurance', duration_min: duration, training_effect: 0, intensity_tag: '' },
    costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
});

describe('evergreen evidence-backed strategy', () => {
    it('keeps sparse history unknown and withholds conditional intensity', () => {
        const state = inferAthleteTrainingState([], 7);
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, state);
        expect(state.trainingAgeProxy).toBe('unknown');
        expect(state.inference).toMatchObject({ dataQuality: 'insufficient', diagnostics: [{ code: 'insufficient_history' }] });
        expect(strategy.requirements.map(requirement => requirement.adaptation)).not.toContain('high_intensity');
        expect(strategy.warnings).toEqual([{ code: 'conditional_prior_withheld', message: expect.any(String) }]);
    });

    it('carries complete provenance on every resolved requirement', () => {
        const state = inferAthleteTrainingState(Array.from({ length: 12 }, () => exposure(60)), 28);
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['health', 'endurance'] }, state);
        expect(state.trainingAgeProxy).toBe('established');
        expect(strategy.requirements).toHaveLength(3);
        strategy.requirements.forEach(requirement => {
            expect(requirement.evidence).toMatchObject({ sourceId: expect.any(String), population: expect.any(String), outcome: expect.any(String), policyVersion: expect.any(String), reviewedOn: expect.any(String) });
        });
    });

    it('does not manufacture strength development for an endurance-only priority', () => {
        const strategy = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, inferAthleteTrainingState([], 7));
        expect(strategy.requirements.map(requirement => requirement.adaptation)).not.toContain('strength');
    });
});
