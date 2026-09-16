import { describe, expect, it } from 'vitest';
import { stepName } from './stepDisplay';
import type { SessionStep } from './models';

describe('stepDisplay stepName resolution', () => {
    it('returns authored step title if present', () => {
        const step: SessionStep = {
            id: 'step_1',
            kind: 'exercise',
            title: 'Authored Exercise Title',
        };
        expect(stepName(step)).toBe('Authored Exercise Title');
    });

    it('resolves catalog exercise name from catalog when available', () => {
        const step: SessionStep = {
            id: 'step_2',
            kind: 'exercise',
            exerciseRef: {
                kind: 'catalog',
                exerciseId: 'bench_press',
            },
        };
        expect(stepName(step)).toBe('Bench Press');
    });

    it('falls back to formatted slug in Title Case when catalog id is unmapped', () => {
        const step: SessionStep = {
            id: 'step_3',
            kind: 'exercise',
            exerciseRef: {
                kind: 'catalog',
                exerciseId: 'unmapped_complex_movement_variant',
            },
        };
        expect(stepName(step)).toBe('Unmapped Complex Movement Variant');
    });

    it('resolves unresolved_free_text exercise name directly', () => {
        const step: SessionStep = {
            id: 'step_4',
            kind: 'exercise',
            exerciseRef: {
                kind: 'unresolved_free_text',
                name: 'Outdoor Hill Sprint',
            },
        };
        expect(stepName(step)).toBe('Outdoor Hill Sprint');
    });

    it('falls back to formatted step id when exerciseRef is absent and no title', () => {
        const step: SessionStep = {
            id: 'custom_jump_squat_combo',
            kind: 'exercise',
        };
        expect(stepName(step)).toBe('Custom Jump Squat Combo');
    });
});
