import { describe, expect, it } from 'vitest';
import { validateExternalTrainingPlanV2, isV2Plan, isV2Session, EXTERNAL_PLAN_SCHEMA_V2 } from './externalPlanV2';
import { EXTERNAL_PLAN_SCHEMA } from '../engine/models';
import { computeContentHash } from '../engine/externalPlanHash';
import type { SessionDefinition } from './models';

import fixture01 from './fixtures/01-full-body-maintenance.json';
import fixture02 from './fixtures/02-lower-olympic-variants.json';
import fixture03 from './fixtures/03-upper-body-absorption-and-spin.json';
import fixture04 from './fixtures/04-friday-field-drills.json';
import fixture05 from './fixtures/05-timed-trunk-and-tissue.json';
import fixture06 from './fixtures/06-protocol-locked-sprint-jump-test.json';
import fixture08 from './fixtures/08-recovery-spin-companion.json';

const M0_2_FIXTURES = [fixture01, fixture02, fixture03, fixture04, fixture05, fixture06, fixture08];

function planV2(definition: unknown, overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V2,
        planId: 'v2-import-1',
        revision: 1,
        title: 'Imported v2 plan',
        startDate: '2026-08-17', // a Monday
        weekCount: 1,
        sessions: [
            {
                id: 'w1-session', title: 'Full Body Maintenance', priority: 'key',
                placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
                gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
                definition,
            },
        ],
        ...overrides,
    };
}

describe('external-plan@2 (M3.6)', () => {
    it('validates a v2 plan whose session definition is the M0.2 fixture vocabulary', () => {
        const result = validateExternalTrainingPlanV2(planV2(fixture01));
        expect(result.isValid).toBe(true);
    });

    it.each(M0_2_FIXTURES)('validates M0.2 fixture $id embedded as a v2 session definition', fixture => {
        const result = validateExternalTrainingPlanV2(planV2(fixture));
        expect(result.isValid).toBe(true);
    });

    it('rejects the wrong schema literal', () => {
        const result = validateExternalTrainingPlanV2(planV2(fixture01, { schema: EXTERNAL_PLAN_SCHEMA }));
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ field: 'schema' }));
    });

    it('rejects an unrecognized top-level plan field', () => {
        const result = validateExternalTrainingPlanV2(planV2(fixture01, { calibratedTaper: 0.7 }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('calibratedTaper'))).toBe(true);
    });

    it('rejects a session carrying v1\'s prescription field alongside definition', () => {
        const plan = planV2(fixture01);
        (plan.sessions[0] as unknown as Record<string, unknown>).prescription = { summary: 'leftover v1 field' };
        const result = validateExternalTrainingPlanV2(plan);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('prescription'))).toBe(true);
    });

    it('rejects a session missing definition entirely', () => {
        const plan = planV2(fixture01);
        delete (plan.sessions[0] as { definition?: unknown }).definition;
        const result = validateExternalTrainingPlanV2(plan);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.endsWith('.definition'))).toBe(true);
    });

    it('rejects an author-supplied systemicCost on the definition (D-EXTTIER)', () => {
        const definition: SessionDefinition & { systemicCost?: number } = {
            ...(fixture01 as unknown as SessionDefinition),
            systemicCost: 0.8,
        };
        const result = validateExternalTrainingPlanV2(planV2(definition));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('systemicCost'))).toBe(true);
    });

    it('rejects an author-supplied unknown field on the definition (e.g. a hallucinated stimulusProfile)', () => {
        const definition = { ...(fixture01 as unknown as SessionDefinition), stimulusProfile: { load: 0.6 } };
        const result = validateExternalTrainingPlanV2(planV2(definition));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('stimulusProfile'))).toBe(true);
    });

    it('still enforces the shared envelope rules (e.g. a fixed session needs a preferredDay)', () => {
        const plan = planV2(fixture01);
        plan.sessions[0].placement = { week: 1, flexibility: 'fixed', ifMissed: 'drop' } as never;
        const result = validateExternalTrainingPlanV2(plan);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('preferredDay'))).toBe(true);
    });

    describe('dose.sets integer validation', () => {
        it.each([
            ['repetition', { kind: 'repetition', sets: 2.5, reps: 10 }],
            ['repetition zero', { kind: 'repetition', sets: 0, reps: 10 }],
            ['repetition negative', { kind: 'repetition', sets: -3, reps: 10 }],
            ['duration fractional', { kind: 'duration', sets: 1.5, seconds: 30 }],
            ['duration zero', { kind: 'duration', sets: 0, seconds: 30 }],
            ['duration negative', { kind: 'duration', sets: -2, seconds: 30 }],
            ['distance fractional', { kind: 'distance', sets: 2.2, meters: 400 }],
            ['distance zero', { kind: 'distance', sets: 0, meters: 400 }],
            ['distance negative', { kind: 'distance', sets: -1, meters: 400 }],
        ])('rejects %s with invalid sets', (_label, dose) => {
            const def = structuredClone(fixture01) as unknown as SessionDefinition;
            def.blocks[0].steps[0].dose = dose as never;
            const result = validateExternalTrainingPlanV2(planV2(def));
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field.includes('dose.sets'))).toBe(true);
        });
    });

    describe('type guards', () => {
        it('isV2Plan narrows on the schema literal', () => {
            expect(isV2Plan({ schema: EXTERNAL_PLAN_SCHEMA_V2 })).toBe(true);
            expect(isV2Plan({ schema: EXTERNAL_PLAN_SCHEMA })).toBe(false);
        });

        it('isV2Session narrows on definition vs. prescription', () => {
            expect(isV2Session({ definition: {} })).toBe(true);
            expect(isV2Session({ prescription: {} })).toBe(false);
        });
    });

    describe('hash round trip (Done when: ranges, sides, option sets and companions survive hash and reload)', () => {
        // fixture02: {min,max} dose ranges and optionSets. fixture03: laterality
        // (per_side/alternating) and a companionSessions reference to fixture08.
        it.each([
            ['02-lower-olympic-variants (ranges + optionSets)', fixture02],
            ['03-upper-body-absorption-and-spin (laterality + companions)', fixture03],
        ])('hashes stably across a serialize -> parse -> re-hash round trip: %s', async (_label, fixture) => {
            const plan = planV2(fixture);
            const originalHash = await computeContentHash(plan);

            // Simulates a Firestore read: the exact bytes, but a fresh object graph with no
            // guaranteed key-insertion-order relationship to the original.
            const reloaded = JSON.parse(JSON.stringify(plan));
            const reloadedHash = await computeContentHash(reloaded);

            expect(reloadedHash).toBe(originalHash);
        });
    });
});
