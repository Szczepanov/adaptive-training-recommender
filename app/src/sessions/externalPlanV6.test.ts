import { describe, expect, it } from 'vitest';
import fixture from './fixtures/01-full-body-maintenance.json';
import { EXTERNAL_PLAN_SCHEMA_V6, validateExternalTrainingPlanV6 } from './externalPlanV6';
import { validateAnyExternalTrainingPlan } from './externalPlanValidation';

function plan(scaling?: Record<string, unknown>) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V6,
        planId: 'v6-block', revision: 1, title: 'V6 block', startDate: '2026-08-17', weekCount: 1,
        sessions: [{
            id: 'session-1', title: 'Strength', priority: 'key',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 60, environment: 'either', equipment: [] },
            definition: fixture,
            ...(scaling ? { scaling } : {}),
        }],
        restDays: [],
    };
}

describe('external-plan@6 reduced definitions', () => {
    it('accepts a reduced executable definition alongside inherited v5 fields', () => {
        const reducedDefinition = structuredClone(fixture);
        reducedDefinition.blocks[0].steps = reducedDefinition.blocks[0].steps.slice(0, 1);
        const result = validateExternalTrainingPlanV6(plan({ reducible: true, reducedDefinition }));
        expect(result.isValid).toBe(true);
        expect(result.data?.sessions[0].scaling?.reducedDefinition?.blocks[0].steps).toHaveLength(1);
    });

    it('requires a reducible authored session and preserves definition identity and intent', () => {
        const reducedDefinition = structuredClone(fixture);
        reducedDefinition.intent = 'recovery';
        const result = validateExternalTrainingPlanV6(plan({ reducible: false, reducedDefinition }));
        expect(result.isValid).toBe(false);
        expect(result.errors.map(error => error.field)).toContain('sessions[0].scaling.reducedDefinition');
        expect(result.errors.map(error => error.field)).toContain('sessions[0].scaling.reducedDefinition.intent');
    });

    it('reports malformed nested reduced definitions using the exact input path', () => {
        const result = validateExternalTrainingPlanV6(plan({ reducible: true, reducedDefinition: { schemaVersion: 1 } }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.field === 'sessions[0].scaling.reducedDefinition.id')).toBe(true);
    });
});

describe('external-plan@6 contract paths through the schema dispatcher', () => {
    type V6Plan = ReturnType<typeof plan>;
    it.each<[string, (draft: V6Plan) => void]>([
        ['startDate', draft => { draft.startDate = '2026-02-30'; }],
        ['sessions[0].gating.intensity', draft => { draft.sessions[0].gating.intensity = 'invented'; }],
        ['sessions[0].definition.intent', draft => { draft.sessions[0].definition.intent = 'invented'; }],
        ['sessions[0].scaling.reducedDefinition.intent', draft => {
            draft.sessions[0] = {
                ...draft.sessions[0],
                scaling: { reducible: true, reducedDefinition: { ...draft.sessions[0].definition, intent: 'recovery' } },
            };
        }],
    ])('rejects an invalid %s at its exact contract path', (field, mutate) => {
        const invalid = structuredClone(plan());
        mutate(invalid);
        const result = validateAnyExternalTrainingPlan(invalid);
        expect(result.isValid).toBe(false);
        expect(result.errors.map(error => error.field)).toContain(field);
    });
});
