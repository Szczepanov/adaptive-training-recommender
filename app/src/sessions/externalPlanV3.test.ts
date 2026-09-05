import { describe, expect, it } from 'vitest';
import { validateExternalTrainingPlanV3, isV3Plan, EXTERNAL_PLAN_SCHEMA_V3 } from './externalPlanV3';
import { validateExternalTrainingPlanV2, EXTERNAL_PLAN_SCHEMA_V2 } from './externalPlanV2';
import { EXTERNAL_PLAN_SCHEMA } from '../engine/models';

import fixture01 from './fixtures/01-full-body-maintenance.json';

function planV3(overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V3,
        planId: 'v3-import-1',
        revision: 1,
        title: 'Imported v3 plan',
        startDate: '2026-08-17', // a Monday
        weekCount: 2,
        sessions: [
            {
                id: 'w1-session', title: 'Full Body Maintenance', priority: 'key',
                placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
                gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
                definition: fixture01,
            },
        ],
        restDays: [{ id: 'w1-friday-rest', week: 1, day: 'friday' }],
        ...overrides,
    };
}

describe('external-plan@3 (ADR-0035)', () => {
    it('validates a well-formed v3 plan with one rest directive', () => {
        const result = validateExternalTrainingPlanV3(planV3());
        expect(result.isValid).toBe(true);
        expect(result.data?.restDays).toEqual([{ id: 'w1-friday-rest', week: 1, day: 'friday' }]);
    });

    it('accepts an empty restDays list -- the field is required but may be empty', () => {
        const result = validateExternalTrainingPlanV3(planV3({ restDays: [] }));
        expect(result.isValid).toBe(true);
    });

    it('rejects a missing restDays field entirely', () => {
        const plan = planV3() as Record<string, unknown>;
        delete plan.restDays;
        const result = validateExternalTrainingPlanV3(plan);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'restDays')).toBe(true);
    });

    it('rejects malformed rest directives without throwing', () => {
        for (const malformed of [null, 42, 'rest', []]) {
            expect(() => validateExternalTrainingPlanV3(planV3({ restDays: [malformed] }))).not.toThrow();
            const result = validateExternalTrainingPlanV3(planV3({ restDays: [malformed] }));
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === 'restDays[0]' && e.message.includes('object'))).toBe(true);
        }
    });

    it('isV3Plan narrows on the schema literal', () => {
        expect(isV3Plan({ schema: EXTERNAL_PLAN_SCHEMA_V3 })).toBe(true);
        expect(isV3Plan({ schema: EXTERNAL_PLAN_SCHEMA_V2 })).toBe(false);
    });

    it('rejects the wrong schema literal', () => {
        const result = validateExternalTrainingPlanV3(planV3({ schema: EXTERNAL_PLAN_SCHEMA_V2 }));
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ field: 'schema' }));
    });

    it('rejects a rest directive with a duplicate id', () => {
        const result = validateExternalTrainingPlanV3(planV3({
            restDays: [
                { id: 'dup', week: 1, day: 'friday' },
                { id: 'dup', week: 1, day: 'saturday' },
            ],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('unique'))).toBe(true);
    });

    it('rejects two rest directives claiming the same (week, day)', () => {
        const result = validateExternalTrainingPlanV3(planV3({
            restDays: [
                { id: 'a', week: 1, day: 'friday' },
                { id: 'b', week: 1, day: 'friday' },
            ],
        }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('same (week, day)'))).toBe(true);
    });

    it('rejects a rest directive whose week is out of range', () => {
        const result = validateExternalTrainingPlanV3(planV3({ restDays: [{ id: 'a', week: 5, day: 'friday' }] }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'restDays[0].week')).toBe(true);
    });

    it('rejects a rest directive with an unsupported weekday', () => {
        const result = validateExternalTrainingPlanV3(planV3({ restDays: [{ id: 'a', week: 1, day: 'holiday' }] }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'restDays[0].day')).toBe(true);
    });

    it('rejects an unrecognized field on a rest directive', () => {
        const result = validateExternalTrainingPlanV3(planV3({ restDays: [{ id: 'a', week: 1, day: 'friday', reason: 'taper' }] }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('reason'))).toBe(true);
    });

    it('rejects a rest directive conflicting with a fixed session on the same date', () => {
        const plan = planV3({
            sessions: [
                {
                    id: 'w1-fixed', title: 'Fixed Threshold', priority: 'key',
                    placement: { week: 1, preferredDay: 'friday', flexibility: 'fixed', ifMissed: 'drop' },
                    gating: { modality: 'cycling', intensity: 'hard', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
                    definition: fixture01,
                },
            ],
            restDays: [{ id: 'w1-friday-rest', week: 1, day: 'friday' }],
        });
        const result = validateExternalTrainingPlanV3(plan);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'restDays' && e.message.includes('same date'))).toBe(true);
    });

    it('does not conflict with a non-fixed (preferred/any_day) session on the same date', () => {
        // A preferred session is movable, so it does not own its date the way a fixed one
        // does -- resolvePlacement's occupancy blocking (externalPlacement.ts) is what
        // actually keeps it off a rest date at placement time, not import-time validation.
        const result = validateExternalTrainingPlanV3(planV3());
        expect(result.isValid).toBe(true);
    });

    it('rejects more than EXTERNAL_PLAN_MAX_WEEKS rest directives', () => {
        const restDays = Array.from({ length: 27 }, (_, i) => ({ id: `r${i}`, week: 1, day: 'friday' as const }));
        const result = validateExternalTrainingPlanV3(planV3({ weekCount: 1, restDays }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'restDays')).toBe(true);
    });

    it('v1/v2 continue to reject a restDays field -- it is v3-only', () => {
        const v2WithRest = {
            schema: EXTERNAL_PLAN_SCHEMA_V2,
            planId: 'v2-with-rest', revision: 1, title: 'v2 plan', startDate: '2026-08-17', weekCount: 1,
            sessions: [{
                id: 's1', title: 'Session', priority: 'key',
                placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
                gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
                definition: fixture01,
            }],
            restDays: [{ id: 'a', week: 1, day: 'friday' }],
        };
        const result = validateExternalTrainingPlanV2(v2WithRest);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('restDays'))).toBe(true);
    });

    it('rejects an unrecognized top-level plan field', () => {
        const result = validateExternalTrainingPlanV3(planV3({ calibratedTaper: 0.7 }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('calibratedTaper'))).toBe(true);
    });

    it('inherits v2 session validation unchanged -- a v1 prescription field is still rejected', () => {
        const plan = planV3();
        (plan.sessions[0] as unknown as Record<string, unknown>).prescription = { summary: 'leftover v1 field' };
        const result = validateExternalTrainingPlanV3(plan);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('prescription'))).toBe(true);
    });

    it('rejects wrong schema on a v1 document even if it happens to carry restDays', () => {
        const result = validateExternalTrainingPlanV3(planV3({ schema: EXTERNAL_PLAN_SCHEMA }));
        expect(result.isValid).toBe(false);
    });
});
