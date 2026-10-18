import { describe, expect, it } from 'vitest';
import { entryCompositionStamp, swappedStepComposition } from './compositionStamping';
import { deliveredPatternWork } from './deliveredComposition';
import type { SessionDefinition, SessionEntry, SessionStep } from './models';

const splitSquat: SessionStep = {
    id: 'reentry_split_squat',
    kind: 'exercise',
    exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' },
    compositionPatterns: ['unilateral_lower_body'],
};

const requiredUnilateral: SessionDefinition['movementComposition'] = [
    { id: 'req-uni', pattern: 'unilateral_lower_body', status: 'required', stepIds: ['reentry_split_squat'] },
] as SessionDefinition['movementComposition'];

function loggedOn(step: SessionStep): SessionEntry {
    return {
        id: 'e1', executionId: 'exec-1', stepId: step.id, exerciseRef: step.exerciseRef,
        ...entryCompositionStamp(step),
        completedAt: '2026-10-18T08:00:00.000Z', createdAt: '2026-10-18T08:00:00.000Z', updatedAt: '2026-10-18T08:00:00.000Z',
        payload: { kind: 'repetition', setIndex: 1, reps: 6, weightKg: 12 },
    };
}

describe('entryCompositionStamp (#803 runner stamp)', () => {
    it('stamps a set logged on a tagged step, so the ledger can count it', () => {
        const entry = loggedOn(splitSquat);
        expect(entry.compositionPatterns).toEqual(['unilateral_lower_body']);
        expect(deliveredPatternWork([entry], 'unilateral_lower_body')).toEqual({ workingSets: 1, stepIds: ['reentry_split_squat'] });
    });

    it('stamps nothing on an untagged step, including a choice alternative without patterns', () => {
        const alternativeWithoutPatterns: SessionStep = { ...splitSquat, compositionPatterns: undefined };
        expect(entryCompositionStamp(alternativeWithoutPatterns)).toEqual({});
        expect(deliveredPatternWork([loggedOn(alternativeWithoutPatterns)], 'unilateral_lower_body')).toBeNull();
    });

    it('carries an explicit degradation forward', () => {
        const degraded: SessionStep = { ...splitSquat, compositionPatterns: undefined, degradedComposition: { pattern: 'unilateral_lower_body', reason: 'swap' } };
        expect(entryCompositionStamp(degraded)).toEqual({ degradedComposition: { pattern: 'unilateral_lower_body', reason: 'swap' } });
    });
});

describe('swappedStepComposition (#803 swap path)', () => {
    it('keeps the pattern when swapping to a tagged catalog exercise', () => {
        expect(swappedStepComposition(splitSquat, { kind: 'catalog', exerciseId: 'step_up' }, requiredUnilateral))
            .toEqual({ compositionPatterns: ['unilateral_lower_body'] });
    });

    it('drops the pattern and records a degradation when a catalog swap loses a required family', () => {
        // The goblet squat brings its own family, never the lost unilateral one.
        expect(swappedStepComposition(splitSquat, { kind: 'catalog', exerciseId: 'goblet_squat' }, requiredUnilateral)).toEqual({
            compositionPatterns: ['knee_dominant_bilateral'],
            degradedComposition: { pattern: 'unilateral_lower_body', reason: 'Athlete selected a catalog exercise that does not preserve this movement component.' },
        });
    });

    it('drops the pattern without a degradation for a free-text swap', () => {
        expect(swappedStepComposition(splitSquat, { kind: 'unresolved_free_text', name: 'Hotel lunges' }, requiredUnilateral)).toEqual({});
    });

    it('falls back to the step\'s own patterns as the required set when no requirement is authored', () => {
        expect(swappedStepComposition(splitSquat, { kind: 'catalog', exerciseId: 'goblet_squat' }, undefined))
            .toMatchObject({ degradedComposition: { pattern: 'unilateral_lower_body' } });
    });

    it('stamps the newly tagged catalog exercises (#803 tagging)', () => {
        for (const exerciseId of ['split_squat', 'reverse_lunge', 'lateral_lunge', 'step_down', 'single_leg_hip_thrust']) {
            expect(swappedStepComposition(splitSquat, { kind: 'catalog', exerciseId }, requiredUnilateral))
                .toEqual({ compositionPatterns: ['unilateral_lower_body'] });
        }
    });
});
