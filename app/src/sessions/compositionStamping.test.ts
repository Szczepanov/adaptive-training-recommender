import { describe, expect, it } from 'vitest';
import {
    authoredComposition, componentPatternsForStep, entryCompositionStamp, relaxUnevidencedRequirements,
    stampImportedSessionComposition, swappedStepComposition,
} from './compositionStamping';
import { deliveredPatternWork } from './deliveredComposition';
import type { SessionDefinition, SessionEntry, SessionStep } from './models';
import { validateSessionDefinition } from './validation';
import { EXERCISES_BY_ID } from '../workouts/exercises';

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

describe('authoredComposition (#813 manual/draft authoring)', () => {
    it('copies the catalog exercise tags onto a manually chosen movement', () => {
        expect(authoredComposition({ kind: 'catalog', exerciseId: 'split_squat' }))
            .toEqual({ compositionPatterns: ['unilateral_lower_body'], degradedComposition: undefined });
    });

    it('copies the tags rather than aliasing the catalog array', () => {
        const { compositionPatterns } = authoredComposition({ kind: 'catalog', exerciseId: 'split_squat' });
        expect(compositionPatterns).not.toBe(EXERCISES_BY_ID.get('split_squat')?.compositionPatterns);
    });

    it('keeps a free-text movement unknown, even when its name matches a catalog exercise', () => {
        expect(authoredComposition({ kind: 'unresolved_free_text', name: 'Split Squat' }))
            .toEqual({ compositionPatterns: undefined, degradedComposition: undefined });
        expect(authoredComposition(undefined)).toEqual({ compositionPatterns: undefined, degradedComposition: undefined });
    });

    it('carries no tags for an unknown catalog id', () => {
        expect(authoredComposition({ kind: 'catalog', exerciseId: 'not_a_real_exercise' }).compositionPatterns).toBeUndefined();
    });

    it('clears a stale stamp and degradation when the movement changes', () => {
        const degraded: SessionStep = { ...splitSquat, degradedComposition: { pattern: 'unilateral_lower_body', reason: 'swap' } };
        const toFreeText = { ...degraded, ...authoredComposition({ kind: 'unresolved_free_text', name: 'Hotel lunges' }) };
        expect(entryCompositionStamp(toFreeText)).toEqual({});
    });

    it('lets a set logged on a manually authored catalog step reach the ledger, and passes validation', () => {
        const manualStep: SessionStep = {
            id: 'manual-step', kind: 'exercise', title: 'Reverse Lunge',
            exerciseRef: { kind: 'catalog', exerciseId: 'reverse_lunge' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
            ...authoredComposition({ kind: 'catalog', exerciseId: 'reverse_lunge' }),
        };
        expect(deliveredPatternWork([loggedOn(manualStep)], 'unilateral_lower_body')).toEqual({ workingSets: 1, stepIds: ['manual-step'] });
        const definition = {
            schemaVersion: 1, id: 'manual-def', revision: 1, title: 'Manual', intent: 'training', dominantModality: 'strength', duration: { min: 30, max: 30 },
            blocks: [{ id: 'b1', title: 'Main', role: 'main', executionMode: 'sequential', steps: [manualStep] }],
        } as unknown as SessionDefinition;
        const result = validateSessionDefinition(definition);
        expect(result.ok ? [] : result.issues).toEqual([]);
    });
});

describe('authored alternatives against the components of the parent step (#813)', () => {
    it('declares a degradation when a catalog alternative does not preserve a component', () => {
        expect(authoredComposition({ kind: 'catalog', exerciseId: 'goblet_squat' }, ['unilateral_lower_body'])).toEqual({
            compositionPatterns: ['knee_dominant_bilateral'],
            degradedComposition: { pattern: 'unilateral_lower_body', reason: 'Authored catalog alternative does not preserve this movement component.' },
        });
    });

    it('declares a degradation for a free-text alternative, which has no structured evidence', () => {
        expect(authoredComposition({ kind: 'unresolved_free_text', name: 'Hotel lunges' }, ['unilateral_lower_body']).degradedComposition)
            .toEqual({ pattern: 'unilateral_lower_body', reason: 'Authored custom alternative has no structured evidence for this movement component.' });
    });

    it('declares nothing when the alternative preserves every component', () => {
        expect(authoredComposition({ kind: 'catalog', exerciseId: 'reverse_lunge' }, ['unilateral_lower_body']).degradedComposition).toBeUndefined();
    });

    it('lists every component naming the step, relaxed or not, once each', () => {
        const composition = [
            { id: 'a', pattern: 'unilateral_lower_body', status: 'required', stepIds: ['s1', 's2'] },
            { id: 'b', pattern: 'unilateral_lower_body', status: 'relaxed', reason: 'r', stepIds: ['s1'] },
            { id: 'c', pattern: 'knee_dominant_bilateral', status: 'relaxed', reason: 'r', stepIds: ['s1'] },
        ] as SessionDefinition['movementComposition'];
        expect(componentPatternsForStep(composition, 's1')).toEqual(['unilateral_lower_body', 'knee_dominant_bilateral']);
        expect(componentPatternsForStep(composition, 's3')).toEqual([]);
        expect(componentPatternsForStep(undefined, 's1')).toEqual([]);
    });
});

describe('relaxUnevidencedRequirements (#813 template edits)', () => {
    const block = (steps: SessionStep[]) => [{ id: 'b1', title: 'Main', role: 'main', executionMode: 'sequential', steps }] as SessionDefinition['blocks'];

    it('keeps a requirement whose step still evidences the pattern', () => {
        expect(relaxUnevidencedRequirements(requiredUnilateral!, block([splitSquat]))).toEqual(requiredUnilateral);
    });

    it('relaxes a requirement when the movement of its step loses the pattern, or the step is gone', () => {
        const changed = { ...splitSquat, exerciseRef: { kind: 'catalog', exerciseId: 'goblet_squat' }, compositionPatterns: ['knee_dominant_bilateral'] } as SessionStep;
        for (const blocks of [block([changed]), block([])]) {
            expect(relaxUnevidencedRequirements(requiredUnilateral!, blocks)).toEqual([{
                ...requiredUnilateral![0], status: 'relaxed', reason: 'Saved template no longer has structured evidence for this movement component.',
            }]);
        }
    });
});

describe('stampImportedSessionComposition (#813 JSON session import)', () => {
    const makeImportedSession = (steps: SessionStep[], movementComposition?: SessionDefinition['movementComposition']): SessionDefinition => ({
        schemaVersion: 1,
        id: 'imported_workout',
        revision: 1,
        title: 'Imported Workout',
        intent: 'training',
        dominantModality: 'strength',
        duration: { min: 30, max: 45 },
        blocks: [{
            id: 'b1',
            title: 'Main',
            role: 'main',
            executionMode: 'sequential',
            steps,
        }],
        ...(movementComposition ? { movementComposition } : {}),
    });

    it('stamps catalog exercise composition patterns onto untagged steps', () => {
        const untaggedStep: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Split Squat',
            exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
        };
        const stamped = stampImportedSessionComposition(makeImportedSession([untaggedStep]));
        const step = stamped.blocks[0].steps[0];
        expect(step.compositionPatterns).toEqual(['unilateral_lower_body']);

        // Logged set on the imported step confirms unilateral lower body work in the ledger (#803/#813)
        const entry = loggedOn(step);
        expect(entry.compositionPatterns).toEqual(['unilateral_lower_body']);
        expect(deliveredPatternWork([entry], 'unilateral_lower_body')).toEqual({ workingSets: 1, stepIds: ['s1'] });

        expect(validateSessionDefinition(stamped).ok).toBe(true);
    });

    it('keeps tags that the JSON carries itself', () => {
        const taggedStep: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Custom Tagged Split Squat',
            exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
            compositionPatterns: ['unilateral_lower_body', 'knee_dominant_bilateral'],
        };
        const stamped = stampImportedSessionComposition(makeImportedSession([taggedStep]));
        expect(stamped.blocks[0].steps[0].compositionPatterns).toEqual(['unilateral_lower_body', 'knee_dominant_bilateral']);
    });

    it('leaves free-text movements untagged, even when title matches a catalog exercise', () => {
        const freeTextStep: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Split Squat',
            exerciseRef: { kind: 'unresolved_free_text', name: 'Split Squat' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
        };
        const stamped = stampImportedSessionComposition(makeImportedSession([freeTextStep]));
        expect(stamped.blocks[0].steps[0].compositionPatterns).toBeUndefined();
    });

    it('leaves unknown catalog exercise ids untagged', () => {
        const unknownCatalogStep: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Unknown',
            exerciseRef: { kind: 'catalog', exerciseId: 'non_existent_exercise' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
        };
        const stamped = stampImportedSessionComposition(makeImportedSession([unknownCatalogStep]));
        expect(stamped.blocks[0].steps[0].compositionPatterns).toBeUndefined();
    });

    it('stamps catalog tags onto alternatives and declares degradedComposition when parent step component is not preserved', () => {
        const stepWithAlt: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Split Squat',
            exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
            alternatives: [{
                id: 'alt1',
                title: 'Goblet Squat',
                exerciseRef: { kind: 'catalog', exerciseId: 'goblet_squat' },
            }],
        };
        const req: SessionDefinition['movementComposition'] = [
            { id: 'req1', pattern: 'unilateral_lower_body', status: 'required', stepIds: ['s1'] },
        ];
        const stamped = stampImportedSessionComposition(makeImportedSession([stepWithAlt], req));
        const alt = stamped.blocks[0].steps[0].alternatives![0];
        expect(alt.compositionPatterns).toEqual(['knee_dominant_bilateral']);
        expect(alt.degradedComposition).toEqual({
            pattern: 'unilateral_lower_body',
            reason: 'Authored catalog alternative does not preserve this movement component.',
        });
        expect(validateSessionDefinition(stamped).ok).toBe(true);
    });

    it('stamps catalog tags onto alternatives without degradation when parent step component is preserved', () => {
        const stepWithAlt: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Split Squat',
            exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
            alternatives: [{
                id: 'alt1',
                title: 'Reverse Lunge',
                exerciseRef: { kind: 'catalog', exerciseId: 'reverse_lunge' },
            }],
        };
        const req: SessionDefinition['movementComposition'] = [
            { id: 'req1', pattern: 'unilateral_lower_body', status: 'required', stepIds: ['s1'] },
        ];
        const stamped = stampImportedSessionComposition(makeImportedSession([stepWithAlt], req));
        const alt = stamped.blocks[0].steps[0].alternatives![0];
        expect(alt.compositionPatterns).toEqual(['unilateral_lower_body']);
        expect(alt.degradedComposition).toBeUndefined();
        expect(validateSessionDefinition(stamped).ok).toBe(true);
    });

    it('leaves free-text alternatives untagged and declares degradedComposition when parent step component is not preserved', () => {
        const stepWithAlt: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Split Squat',
            exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
            alternatives: [{
                id: 'alt1',
                title: 'Hotel Lunges',
                exerciseRef: { kind: 'unresolved_free_text', name: 'Hotel Lunges' },
            }],
        };
        const req: SessionDefinition['movementComposition'] = [
            { id: 'req1', pattern: 'unilateral_lower_body', status: 'required', stepIds: ['s1'] },
        ];
        const stamped = stampImportedSessionComposition(makeImportedSession([stepWithAlt], req));
        const alt = stamped.blocks[0].steps[0].alternatives![0];
        expect(alt.compositionPatterns).toBeUndefined();
        expect(alt.degradedComposition).toEqual({
            pattern: 'unilateral_lower_body',
            reason: 'Authored custom alternative has no structured evidence for this movement component.',
        });
        expect(validateSessionDefinition(stamped).ok).toBe(true);
    });

    it('keeps existing alternative tags and attaches degradedComposition if not preserved', () => {
        const stepWithAlt: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Split Squat',
            exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
            alternatives: [{
                id: 'alt1',
                title: 'Front Squat',
                exerciseRef: { kind: 'catalog', exerciseId: 'front_squat' },
                compositionPatterns: ['knee_dominant_bilateral'],
            }],
        };
        const req: SessionDefinition['movementComposition'] = [
            { id: 'req1', pattern: 'unilateral_lower_body', status: 'required', stepIds: ['s1'] },
        ];
        const stamped = stampImportedSessionComposition(makeImportedSession([stepWithAlt], req));
        const alt = stamped.blocks[0].steps[0].alternatives![0];
        expect(alt.compositionPatterns).toEqual(['knee_dominant_bilateral']);
        expect(alt.degradedComposition).toEqual({
            pattern: 'unilateral_lower_body',
            reason: 'Authored catalog alternative does not preserve this movement component.',
        });
        expect(validateSessionDefinition(stamped).ok).toBe(true);
    });

    it('relaxes unevidenced required components via relaxUnevidencedRequirements', () => {
        const step: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Bench Press',
            exerciseRef: { kind: 'catalog', exerciseId: 'bench_press' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
        };
        // Requirement for unilateral_lower_body, but the session has no unilateral exercise
        const req: SessionDefinition['movementComposition'] = [
            { id: 'req1', pattern: 'unilateral_lower_body', status: 'required', stepIds: ['s1'] },
        ];
        const stamped = stampImportedSessionComposition(makeImportedSession([step], req));
        expect(stamped.movementComposition![0].status).toBe('relaxed');
        expect(stamped.movementComposition![0].reason).toBe('Imported session has no structured evidence for this movement component.');
        expect(validateSessionDefinition(stamped).ok).toBe(true);
    });

    it('safely handles malformed non-object inputs or missing blocks without throwing', () => {
        expect(stampImportedSessionComposition(null as unknown as SessionDefinition)).toBeNull();
        expect(stampImportedSessionComposition({} as SessionDefinition)).toEqual({});
        expect(stampImportedSessionComposition({ blocks: 'not-array' } as unknown as SessionDefinition)).toEqual({ blocks: 'not-array' });
    });

    it('returns malformed composition unchanged so validation reports the issue instead of a TypeError', () => {
        const step: SessionStep = {
            id: 's1',
            kind: 'exercise',
            title: 'Split Squat',
            exerciseRef: { kind: 'catalog', exerciseId: 'split_squat' },
            dose: { kind: 'repetition', sets: 3, reps: 8 },
        };
        const malformed = makeImportedSession([step], [null] as unknown as SessionDefinition['movementComposition']);
        expect(stampImportedSessionComposition(malformed)).toBe(malformed);
        expect(validateSessionDefinition(malformed).ok).toBe(false);
    });
});
