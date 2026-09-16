import { describe, expect, it } from 'vitest';
import { computeDailyLedger } from '../engine/dailyLedger';
import { resolvePlacement } from '../engine/externalPlacement';
import type { ExternalPlanHeader, ScheduleWindow } from '../engine/models';
import { EXTERNAL_PLAN_SCHEMA_V4 } from '../sessions/externalPlanV4';
import fixture01 from '../sessions/fixtures/01-full-body-maintenance.json';
import {
    resolveIntradayBundlePlacement,
    type ActiveExternalPlan,
    type IntradayBundlePlacementContext,
} from './activeExternalPlanService';

const DATE = '2026-08-17';

function header(): ExternalPlanHeader {
    return {
        userId: 'u1',
        planId: 'context-plan',
        revision: 1,
        title: 'Context plan',
        startDate: DATE,
        weekCount: 1,
        contentHash: 'hash-1',
        importedAt: '2026-08-16T10:00:00Z',
        supersededFrom: null,
        updatedAt: '2026-08-16T10:00:00Z',
    };
}

function session(gating: { environment?: 'indoor' | 'outdoor' | 'either'; equipment?: string[] }) {
    return {
        id: 's1',
        title: 'Context-sensitive session',
        priority: 'key',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: {
            modality: 'strength',
            intensity: 'moderate',
            durationMin: 45,
            durationMax: 55,
            ...gating,
        },
        definition: fixture01,
        intraday: {
            window: { startLocal: '06:00', endLocal: '07:30' },
            bundleId: 'context-bundle',
            order: 0,
        },
    };
}

function activePlan(gating: { environment?: 'indoor' | 'outdoor' | 'either'; equipment?: string[] }): ActiveExternalPlan {
    const plan = {
        schema: EXTERNAL_PLAN_SCHEMA_V4,
        planId: 'context-plan',
        revision: 1,
        title: 'Context plan',
        startDate: DATE,
        weekCount: 1,
        sessions: [session(gating)],
        restDays: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- focused wiring test; the v4 validator owns fixture shape validation.
    const typedPlan = plan as any;
    return { header: header(), plan: typedPlan, placement: null, placed: resolvePlacement(typedPlan, null, {}) };
}

function scheduleWindow(overrides: Partial<ScheduleWindow> = {}): ScheduleWindow {
    return {
        id: 'w1',
        userId: 'u1',
        date: DATE,
        startLocal: '06:00',
        endLocal: '07:30',
        revision: 1,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        ...overrides,
    };
}

function context(window: ScheduleWindow): IntradayBundlePlacementContext {
    return {
        scheduleWindows: [window],
        fixedActivities: [],
        ledger: computeDailyLedger({ dailyMinuteCeiling: 120, dailySystemicCostCeiling: 1 }, []),
    };
}

describe('resolveIntradayBundlePlacement window context wiring', () => {
    it('projects session environment gating into D-PLACEMENT', () => {
        const result = resolveIntradayBundlePlacement(
            activePlan({ environment: 'outdoor', equipment: [] }),
            DATE,
            context(scheduleWindow({ environment: 'indoor' })),
        );

        expect(result?.outcome).toBe('infeasible');
        expect(result?.reason).toMatch(/equipment\/environment/i);
    });

    it('projects session equipment gating into D-PLACEMENT', () => {
        const result = resolveIntradayBundlePlacement(
            activePlan({ environment: 'either', equipment: ['free_weights'] }),
            DATE,
            context(scheduleWindow({ environment: 'indoor', equipment: ['indoor_bike'] })),
        );

        expect(result?.outcome).toBe('infeasible');
        expect(result?.reason).toMatch(/equipment\/environment/i);
    });

    it('places the session when the real window satisfies both authored constraints', () => {
        const result = resolveIntradayBundlePlacement(
            activePlan({ environment: 'indoor', equipment: ['free_weights'] }),
            DATE,
            context(scheduleWindow({ environment: 'indoor', equipment: ['free_weights', 'indoor_bike'] })),
        );

        expect(result?.outcome).toBe('placed');
        expect(result?.bindings?.[0]?.windowId).toBe('w1');
    });
});
