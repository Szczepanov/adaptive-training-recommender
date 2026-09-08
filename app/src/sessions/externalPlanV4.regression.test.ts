import { describe, expect, it } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA_V4, validateExternalTrainingPlanV4 } from './externalPlanV4';
import fixture01 from './fixtures/01-full-body-maintenance.json';

function session(id: string, week: number, intraday: Record<string, unknown>, preferredDay = 'monday') {
    return {
        id,
        title: id,
        priority: 'key',
        placement: { week, preferredDay, flexibility: 'preferred', ifMissed: 'drop' },
        gating: {
            modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55,
            environment: 'either', equipment: [],
        },
        definition: fixture01,
        intraday,
    };
}

function plan(sessions: unknown[]) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V4,
        planId: 'v4-regression',
        revision: 1,
        title: 'V4 regression fixture',
        startDate: '2026-08-17',
        weekCount: 2,
        sessions,
        restDays: [],
    };
}

describe('external-plan@4 cross-session validation regressions', () => {
    it('returns INVALID instead of throwing when an intraday window is missing', () => {
        const raw = plan([session('am', 1, { bundleId: 'double', order: 0 })]);

        expect(() => validateExternalTrainingPlanV4(raw)).not.toThrow();
        const result = validateExternalTrainingPlanV4(raw);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(expect.objectContaining({ field: 'sessions[0].intraday.window' }));
    });

    it('returns INVALID instead of throwing for malformed window/order/bundle fields', () => {
        const raw = plan([
            session('am', 1, { window: null, bundleId: 42, order: 'first' }),
            session('pm', 1, { window: [], bundleId: 42, order: 'second' }),
        ]);

        expect(() => validateExternalTrainingPlanV4(raw)).not.toThrow();
        const result = validateExternalTrainingPlanV4(raw);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(6);
    });

    it('allows the same descriptive bundleId to be reused in another plan week', () => {
        const raw = plan([
            session('w1-am', 1, {
                window: { startLocal: '07:00', endLocal: '08:00' },
                bundleId: 'monday-double', order: 0,
            }),
            session('w2-am', 2, {
                window: { startLocal: '07:00', endLocal: '08:00' },
                bundleId: 'monday-double', order: 0,
            }),
        ]);

        expect(validateExternalTrainingPlanV4(raw).isValid).toBe(true);
    });

    it('rejects overlapping requested windows on the same authored date even across different bundleIds', () => {
        const raw = plan([
            session('first', 1, {
                window: { startLocal: '07:00', endLocal: '09:00' },
                bundleId: 'strength', order: 0,
            }),
            session('second', 1, {
                window: { startLocal: '08:30', endLocal: '10:00' },
                bundleId: 'bike', order: 0,
            }),
        ]);

        const result = validateExternalTrainingPlanV4(raw);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.message.includes('Overlapping requested windows'))).toBe(true);
    });

    it('does not treat equal clock windows on different authored dates as overlapping', () => {
        const raw = plan([
            session('monday', 1, {
                window: { startLocal: '07:00', endLocal: '08:00' },
                bundleId: 'morning', order: 0,
            }, 'monday'),
            session('tuesday', 1, {
                window: { startLocal: '07:00', endLocal: '08:00' },
                bundleId: 'morning-2', order: 0,
            }, 'tuesday'),
        ]);

        expect(validateExternalTrainingPlanV4(raw).isValid).toBe(true);
    });
});
