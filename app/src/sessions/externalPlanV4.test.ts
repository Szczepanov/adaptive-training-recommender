import { describe, expect, it } from 'vitest';
import { validateExternalTrainingPlanV4, isV4Plan, EXTERNAL_PLAN_SCHEMA_V4 } from './externalPlanV4';
import { validateExternalTrainingPlanV3, EXTERNAL_PLAN_SCHEMA_V3 } from './externalPlanV3';
import { validateExternalTrainingPlanV2, EXTERNAL_PLAN_SCHEMA_V2 } from './externalPlanV2';
import { EXTERNAL_PLAN_SCHEMA } from '../engine/models';
import { validateExternalTrainingPlan } from '../engine/validation';

import fixture01 from './fixtures/01-full-body-maintenance.json';

function session(overrides: Record<string, unknown> = {}) {
    return {
        id: 'w1-am', title: 'AM Session', priority: 'key',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
        gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
        definition: fixture01,
        ...overrides,
    };
}

function planV4(sessions: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V4,
        planId: 'v4-import-1',
        revision: 1,
        title: 'Imported v4 plan',
        startDate: '2026-08-17', // a Monday
        weekCount: 2,
        sessions,
        restDays: [],
        ...overrides,
    };
}

describe('external-plan@4 (ADR-0036 D-SCHEMA)', () => {
    it('validates a well-formed v4 plan with no intraday sessions (v4 without intraday behaves like v3)', () => {
        const result = validateExternalTrainingPlanV4(planV4([session()]));
        expect(result.isValid).toBe(true);
    });

    it('isV4Plan narrows on the schema literal', () => {
        expect(isV4Plan({ schema: EXTERNAL_PLAN_SCHEMA_V4 })).toBe(true);
        expect(isV4Plan({ schema: EXTERNAL_PLAN_SCHEMA_V3 })).toBe(false);
    });

    it('rejects the wrong schema literal', () => {
        const result = validateExternalTrainingPlanV4(planV4([session()], { schema: EXTERNAL_PLAN_SCHEMA_V3 }));
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ field: 'schema' }));
    });

    it('v1/v2/v3 validators are unchanged by v4 existing', () => {
        expect(validateExternalTrainingPlan({ schema: EXTERNAL_PLAN_SCHEMA }).isValid).toBe(false); // still incomplete, but doesn't throw
        expect(() => validateExternalTrainingPlanV2({ schema: EXTERNAL_PLAN_SCHEMA_V2 })).not.toThrow();
        expect(() => validateExternalTrainingPlanV3({ schema: EXTERNAL_PLAN_SCHEMA_V3 })).not.toThrow();
    });

    it('accepts a valid two-member intraday bundle with a required-completed predecessor', () => {
        const am = session({
            id: 'am', priority: 'key',
            intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'monday-double', order: 0 },
        });
        const pm = session({
            id: 'pm', priority: 'supporting',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'monday-double', order: 1, afterSessionId: 'am', minimumSeparationMinutes: 360 },
        });
        const result = validateExternalTrainingPlanV4(planV4([am, pm]));
        expect(result.isValid).toBe(true);
    });

    it('rejects an intraday window with startLocal >= endLocal (zero-length or cross-midnight)', () => {
        const bad = session({ intraday: { window: { startLocal: '20:00', endLocal: '06:00' }, bundleId: 'b', order: 0 } });
        const result = validateExternalTrainingPlanV4(planV4([bad]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.endsWith('.window'))).toBe(true);
    });

    it('rejects a malformed HH:mm window value', () => {
        const bad = session({ intraday: { window: { startLocal: '7am', endLocal: '08:00' }, bundleId: 'b', order: 0 } });
        const result = validateExternalTrainingPlanV4(planV4([bad]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.endsWith('.window.startLocal'))).toBe(true);
    });

    it('rejects minimumSeparationMinutes without afterSessionId', () => {
        const bad = session({ intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0, minimumSeparationMinutes: 60 } });
        const result = validateExternalTrainingPlanV4(planV4([bad]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.endsWith('.minimumSeparationMinutes'))).toBe(true);
    });

    it('rejects duplicate order values within one bundle', () => {
        const am = session({ id: 'am', intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0 } });
        const pm = session({ id: 'pm', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'b', order: 0 } });
        const result = validateExternalTrainingPlanV4(planV4([am, pm]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('unique order'))).toBe(true);
    });

    it('rejects overlapping requested windows within one bundle', () => {
        const am = session({ id: 'am', intraday: { window: { startLocal: '07:00', endLocal: '09:00' }, bundleId: 'b', order: 0 } });
        const pm = session({ id: 'pm', intraday: { window: { startLocal: '08:00', endLocal: '10:00' }, bundleId: 'b', order: 1 } });
        const result = validateExternalTrainingPlanV4(planV4([am, pm]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('Overlapping'))).toBe(true);
    });

    it('rejects a dangling afterSessionId reference', () => {
        const am = session({ id: 'am', intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0, afterSessionId: 'does-not-exist' } });
        const result = validateExternalTrainingPlanV4(planV4([am]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.endsWith('.afterSessionId'))).toBe(true);
    });

    it('rejects a forward/self afterSessionId reference (order must strictly precede)', () => {
        const am = session({ id: 'am', intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0, afterSessionId: 'pm' } });
        const pm = session({ id: 'pm', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'b', order: 1 } });
        const result = validateExternalTrainingPlanV4(planV4([am, pm]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('earlier order'))).toBe(true);
    });

    it('rejects a required session depending on an optional predecessor', () => {
        const am = session({ id: 'am', priority: 'optional', intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0 } });
        const pm = session({ id: 'pm', priority: 'key', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'b', order: 1, afterSessionId: 'am' } });
        const result = validateExternalTrainingPlanV4(planV4([am, pm]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('optional predecessor'))).toBe(true);
    });

    it('rejects bundle members that disagree on week/preferredDay/flexibility', () => {
        const am = session({ id: 'am', intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0 } });
        const pm = session({
            id: 'pm',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
            intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'b', order: 1 },
        });
        const result = validateExternalTrainingPlanV4(planV4([am, pm]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('must agree on'))).toBe(true);
    });

    it('rejects an intraday bundle member without a preferredDay', () => {
        const am = session({
            placement: { week: 1, flexibility: 'preferred', ifMissed: 'drop' },
            intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0 },
        });
        const result = validateExternalTrainingPlanV4(planV4([am]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('preferredDay'))).toBe(true);
    });

    it('rejects an intraday session whose date conflicts with an authored rest directive', () => {
        const am = session({ intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0 } });
        const result = validateExternalTrainingPlanV4(planV4([am], { restDays: [{ id: 'r1', week: 1, day: 'monday' }] }));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('rest directive'))).toBe(true);
    });

    it('rejects an unrecognized intraday field', () => {
        const am = session({ intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b', order: 0, extra: true } });
        const result = validateExternalTrainingPlanV4(planV4([am]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('Unrecognized intraday field'))).toBe(true);
    });

    it('rejects a bundleId longer than the bound', () => {
        const am = session({ intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b'.repeat(65), order: 0 } });
        const result = validateExternalTrainingPlanV4(planV4([am]));
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.endsWith('.bundleId'))).toBe(true);
    });
});
