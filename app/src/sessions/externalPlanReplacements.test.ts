import { describe, expect, it } from 'vitest';
import fixture from './fixtures/01-full-body-maintenance.json';
import {
    declaredSessionReplacements,
    validateReplacementDeclarations,
    validateReplacementsAgainstPrevious,
} from './externalPlanReplacements';
import { EXTERNAL_PLAN_SCHEMA_V6, validateExternalTrainingPlanV6 } from './externalPlanV6';
import { validateExternalPlanImport } from './externalPlanValidation';

function session(id: string, extra: Record<string, unknown> = {}) {
    return {
        id, title: `Session ${id}`, priority: 'key',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 60, environment: 'either', equipment: [] },
        definition: fixture,
        ...extra,
    };
}

function v6Plan(sessions: unknown[], revision = 2) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V6,
        planId: 'v6-block', revision, title: 'V6 block', startDate: '2026-08-17', weekCount: 1,
        sessions, restDays: [],
    };
}

describe('replacesSessionId schema validation (#1172)', () => {
    it('accepts an optional replacement declaration on a v6 session', () => {
        const result = validateExternalTrainingPlanV6(v6Plan([session('new-a', { replacesSessionId: 'old-a' })]));
        expect(result.isValid).toBe(true);
        expect(result.data?.sessions[0].replacesSessionId).toBe('old-a');
    });

    it('keeps a v6 plan without any declaration valid', () => {
        expect(validateExternalTrainingPlanV6(v6Plan([session('a')])).isValid).toBe(true);
    });

    it('allows a session to declare that it replaces the same id from the previous revision', () => {
        expect(validateExternalTrainingPlanV6(v6Plan([session('a', { replacesSessionId: 'a' })])).isValid).toBe(true);
    });

    it.each<[string, unknown]>([
        ['an empty string', ''],
        ['a number', 7],
        ['null', null],
        ['an oversized id', 'x'.repeat(65)],
    ])('rejects %s', (_label, value) => {
        const result = validateExternalTrainingPlanV6(v6Plan([session('a', { replacesSessionId: value })]));
        expect(result.isValid).toBe(false);
        expect(result.errors.map(error => error.field)).toContain('sessions[0].replacesSessionId');
    });

    it('rejects two sessions replacing the same earlier session', () => {
        const result = validateExternalTrainingPlanV6(v6Plan([
            session('a', { replacesSessionId: 'old' }),
            session('b', { replacesSessionId: 'old' }),
        ]));
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ field: 'sessions[1].replacesSessionId' }));
    });

    it('rejects a declaration naming another session this revision keeps, including a swap cycle', () => {
        const result = validateExternalTrainingPlanV6(v6Plan([
            session('a', { replacesSessionId: 'b' }),
            session('b', { replacesSessionId: 'a' }),
        ]));
        expect(result.isValid).toBe(false);
        expect(result.errors.map(error => error.field)).toEqual(expect.arrayContaining([
            'sessions[0].replacesSessionId', 'sessions[1].replacesSessionId',
        ]));
    });

    it('is not accepted on an earlier schema version', () => {
        const v5 = { ...v6Plan([session('a', { replacesSessionId: 'old' })]), schema: 'adaptive-training-recommender/external-plan@5' };
        expect(validateExternalPlanImport(v5).isValid).toBe(false);
    });

    it('validates raw sessions defensively', () => {
        expect(validateReplacementDeclarations(undefined)).toEqual([]);
        expect(validateReplacementDeclarations([null, 'x', { id: 'a' }])).toEqual([]);
    });
});

describe('declared replacements against the previous revision', () => {
    const previous = { planId: 'v6-block', revision: 1, sessions: [{ id: 'old-a' }, { id: 'old-b' }] };

    it('lists only explicit declarations, never inferring from titles or dates', () => {
        const next = v6Plan([
            session('new-a', { replacesSessionId: 'old-a' }),
            session('old-b'),
            { ...session('lookalike'), title: 'Session old-b' },
        ]);
        expect(declaredSessionReplacements(next)).toEqual([{ sessionId: 'new-a', replacesSessionId: 'old-a', index: 0 }]);
        expect(validateReplacementsAgainstPrevious(next, previous)).toEqual([]);
    });

    it('requires a previous revision of the same plan', () => {
        const next = v6Plan([session('new-a', { replacesSessionId: 'old-a' })], 1);
        expect(validateReplacementsAgainstPrevious(next, null)).toEqual([expect.objectContaining({
            code: 'replacement-previous-revision-missing', field: 'sessions[0].replacesSessionId',
        })]);
        expect(validateReplacementsAgainstPrevious(next, { ...previous, planId: 'other-plan' })).toEqual([expect.objectContaining({
            code: 'replacement-previous-revision-missing',
        })]);
    });

    it('rejects a declaration naming a session the previous revision does not have', () => {
        const next = v6Plan([session('new-a', { replacesSessionId: 'missing' })]);
        expect(validateReplacementsAgainstPrevious(next, previous)).toEqual([{
            code: 'replaced-session-not-found', field: 'sessions[0].replacesSessionId',
            sessionId: 'new-a', replacesSessionId: 'missing',
        }]);
    });

    it('has nothing to check for a plan without declarations, even with no previous revision', () => {
        expect(validateReplacementsAgainstPrevious(v6Plan([session('a')], 1), null)).toEqual([]);
    });
});
