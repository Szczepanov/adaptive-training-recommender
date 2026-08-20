import { describe, expect, it } from 'vitest';
import type { SessionDefinition } from '../sessions/models';
import { ineligibleAlternativeOptionIds } from './sessionChoiceEligibility';

function definitionWithAlternative(alternativeExerciseId: string | null): SessionDefinition {
    return {
        schemaVersion: 1,
        id: 'def-1',
        revision: 1,
        title: 'Test session',
        intent: 'training',
        blocks: [
            {
                id: 'block-1',
                role: 'main',
                executionMode: 'sequential',
                optionSets: [
                    {
                        id: 'choice-1',
                        appliesAtStepId: 'step-1',
                        trigger: { kind: 'athlete_observed', description: 'How does it feel?' },
                        options: [
                            { id: 'opt-continue', label: 'Continue', actions: [] },
                            {
                                id: 'opt-alternative',
                                label: 'Switch',
                                actions: [{ kind: 'select_alternative', targetStepId: 'step-1', alternativeId: 'alt-1' }],
                            },
                        ],
                    },
                ],
                steps: [
                    {
                        id: 'step-1',
                        kind: 'exercise',
                        exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                        alternatives: alternativeExerciseId === null ? [] : [
                            {
                                id: 'alt-1',
                                title: 'Alternative',
                                exerciseRef: alternativeExerciseId === 'unresolved'
                                    ? { kind: 'unresolved_free_text', name: 'Made-up movement' }
                                    : { kind: 'catalog', exerciseId: alternativeExerciseId },
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

describe('ineligibleAlternativeOptionIds', () => {
    it('returns an empty set when no modality is restricted', () => {
        const definition = definitionWithAlternative('goblet_squat');
        expect(ineligibleAlternativeOptionIds(definition, []).size).toBe(0);
    });

    it('flags an option whose alternative resolves to a restricted modality', () => {
        const definition = definitionWithAlternative('goblet_squat'); // strength modality
        const ineligible = ineligibleAlternativeOptionIds(definition, ['Strength']);
        expect(ineligible.has('opt-alternative')).toBe(true);
        expect(ineligible.has('opt-continue')).toBe(false);
    });

    it('does not flag an option when the alternative resolves to a different, non-restricted modality', () => {
        const definition = definitionWithAlternative('goblet_squat');
        const ineligible = ineligibleAlternativeOptionIds(definition, ['Cycling']);
        expect(ineligible.size).toBe(0);
    });

    it('never flags an unresolved free-text alternative -- it stays a legitimate low-confidence option, not a restriction', () => {
        const definition = definitionWithAlternative('unresolved');
        const ineligible = ineligibleAlternativeOptionIds(definition, ['Strength']);
        expect(ineligible.size).toBe(0);
    });

    it('never flags an option with no select_alternative action', () => {
        const definition = definitionWithAlternative('goblet_squat');
        const ineligible = ineligibleAlternativeOptionIds(definition, ['Strength']);
        expect(ineligible.has('opt-continue')).toBe(false);
    });

    it('does not flag an alternative id that is not found in the catalog', () => {
        const definition = definitionWithAlternative('not_a_real_exercise_id');
        const ineligible = ineligibleAlternativeOptionIds(definition, ['Strength']);
        expect(ineligible.size).toBe(0);
    });
});
