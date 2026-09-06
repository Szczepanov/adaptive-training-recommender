import { describe, expect, it } from 'vitest';
import { resolvePlacement } from '../engine/externalPlacement';
import { computeDailyLedger } from '../engine/dailyLedger';
import type { ScheduleWindow, ExternalPlanHeader } from '../engine/models';
import { EXTERNAL_PLAN_SCHEMA_V4 } from '../sessions/externalPlanV4';
import fixture01 from '../sessions/fixtures/01-full-body-maintenance.json';
import {
    externalPlanContextForDate,
    placedSessionForDate,
    resolveIntradayBundlePlacement,
    type ActiveExternalPlan,
    type IntradayBundlePlacementContext,
} from './activeExternalPlanService';

const DATE = '2026-08-17'; // the plan's Monday startDate

function intradaySession(overrides: Record<string, unknown> = {}) {
    return {
        id: 's-am', title: 'AM', priority: 'key',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
        definition: fixture01,
        intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 },
        ...overrides,
    };
}

function planV4(sessions: Record<string, unknown>[]) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V4,
        planId: 'v4-bundle-1', revision: 1, title: 'Bundle plan',
        startDate: DATE, weekCount: 1,
        sessions, restDays: [],
    } as const;
}

function header(): ExternalPlanHeader {
    return {
        userId: 'u1', planId: 'v4-bundle-1', revision: 1, title: 'Bundle plan',
        startDate: DATE, weekCount: 1, contentHash: 'hash-1',
        importedAt: '2026-08-16T10:00:00Z', supersededFrom: null, updatedAt: '2026-08-16T10:00:00Z',
    };
}

function activePlan(sessions: Record<string, unknown>[]): ActiveExternalPlan {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture, matches the untyped JSON import shape validateExternalTrainingPlanV4 already accepts
    const plan = planV4(sessions) as any;
    return { header: header(), plan, placement: null, placed: resolvePlacement(plan, null, {}) };
}

function scheduleWindow(overrides: Partial<ScheduleWindow> = {}): ScheduleWindow {
    return {
        id: 'w', userId: 'u1', date: DATE, startLocal: '06:00', endLocal: '07:00',
        revision: 1, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        ...overrides,
    };
}

function bundleContext(overrides: Partial<IntradayBundlePlacementContext> = {}): IntradayBundlePlacementContext {
    return {
        scheduleWindows: [],
        fixedActivities: [],
        ledger: computeDailyLedger({ dailyMinuteCeiling: 200, dailySystemicCostCeiling: 1 }, []),
        ...overrides,
    };
}

describe('resolveIntradayBundlePlacement', () => {
    it('returns null when no placed session for the date carries intraday', () => {
        const active = activePlan([{
            id: 'plain', title: 'Plain', priority: 'key',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [] },
            definition: fixture01,
        }]);
        expect(resolveIntradayBundlePlacement(active, DATE, bundleContext())).toBeNull();
    });

    it('resolves a feasible two-member bundle against real schedule windows', () => {
        const active = activePlan([
            intradaySession({ id: 's-am', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 } }),
            intradaySession({ id: 's-pm', title: 'PM', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        const result = resolveIntradayBundlePlacement(active, DATE, bundleContext({
            scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' }), scheduleWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
        }));
        expect(result?.outcome).toBe('placed');
        expect(result?.bindings?.map(b => b.sessionId)).toEqual(['s-am', 's-pm']);
    });

    it('reports infeasible when the date is authored rest', () => {
        // D-SCHEMA import validation would reject an intraday session sharing a date with
        // an authored rest directive, but resolveIntradayBundlePlacement itself must still
        // fail closed if it ever sees that combination (e.g. an older revision's overlay),
        // so this constructs that state directly rather than through resolvePlacement.
        const plan = { ...planV4([intradaySession()]), restDays: [{ id: 'r1', week: 1, day: 'monday' }] };
        const active: ActiveExternalPlan = {
            header: header(),
            plan: plan as unknown as ActiveExternalPlan['plan'],
            placement: null,
            placed: [{ session: intradaySession() as unknown as ActiveExternalPlan['placed'][number]['session'], date: DATE, status: 'planned', moved: false }],
        };
        const result = resolveIntradayBundlePlacement(active, DATE, bundleContext());
        expect(result?.outcome).toBe('infeasible');
    });
});

describe('placedSessionForDate with bundleContext', () => {
    it('picks the bundle\'s earliest-order member as primary even when priority tie-break would pick the other', () => {
        // s-pm has higher priority ('key') than s-am ('supporting'); pure priority
        // tie-break would pick s-pm, but the bundle's order (s-am is order 0) must win
        // once the bundle resolves feasibly.
        const active = activePlan([
            intradaySession({ id: 's-am', priority: 'supporting', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 } }),
            intradaySession({ id: 's-pm', title: 'PM', priority: 'key', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        const context = bundleContext({
            scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' }), scheduleWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
        });
        expect(placedSessionForDate(active, DATE, context)?.session.id).toBe('s-am');
        // Omitting bundleContext keeps the exact pre-D-PLACEMENT priority-based pick.
        expect(placedSessionForDate(active, DATE)?.session.id).toBe('s-pm');
    });

    it('falls back to priority tie-break when the bundle is infeasible', () => {
        const active = activePlan([
            intradaySession({ id: 's-am', priority: 'supporting', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 }, definition: { ...fixture01, duration: { min: 500, max: 500 } } }),
            intradaySession({ id: 's-pm', title: 'PM', priority: 'key', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        // No real windows and a 500-minute member forces the legacy single-slot bundle infeasible.
        const context = bundleContext();
        expect(placedSessionForDate(active, DATE, context)?.session.id).toBe('s-pm');
    });
});

describe('externalPlanContextForDate with bundleContext', () => {
    it('resolves to the bundle\'s earliest-order primary session when bundleContext makes the bundle feasible', () => {
        const active = activePlan([
            intradaySession({ id: 's-am', priority: 'supporting', intraday: { window: { startLocal: '06:00', endLocal: '07:00' }, bundleId: 'double-monday', order: 0 } }),
            intradaySession({ id: 's-pm', title: 'PM', priority: 'key', intraday: { window: { startLocal: '17:00', endLocal: '18:00' }, bundleId: 'double-monday', order: 1 } }),
        ]);
        const context = bundleContext({
            scheduleWindows: [scheduleWindow({ id: 'am', startLocal: '06:00', endLocal: '07:00' }), scheduleWindow({ id: 'pm', startLocal: '17:00', endLocal: '18:00' })],
        });
        expect(externalPlanContextForDate(active, DATE, context)?.session.id).toBe('s-am');
        // Omitting bundleContext keeps the exact pre-D-PLACEMENT priority-based pick.
        expect(externalPlanContextForDate(active, DATE)?.session.id).toBe('s-pm');
    });
});
