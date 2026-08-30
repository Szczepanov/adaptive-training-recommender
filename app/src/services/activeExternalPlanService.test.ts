import { describe, expect, it, vi } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA, type ExternalPlanHeader, type ExternalTrainingPlan } from '../engine/models';
import type { DataState } from '../engine/dataState';
import {
    ActiveExternalPlanService,
    externalPlanContextForDate,
    externalPlanContextsForDate,
    placedSessionForDate,
    placedSessionsForDate,
    planEndDate,
    type ActiveExternalPlan,
} from './activeExternalPlanService';
import type { ExternalPlanService } from './externalPlanService';

function plan(overrides: Partial<ExternalTrainingPlan> = {}): ExternalTrainingPlan {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'autumn-block', revision: 1, title: 'Autumn block',
        startDate: '2026-08-17', weekCount: 2,
        sessions: [
            {
                id: 'w1-threshold', title: 'Threshold', priority: 'key',
                placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
                prescription: { summary: '3x12.' },
            },
            {
                id: 'w1-easy', title: 'Easy spin', priority: 'supporting',
                placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
                prescription: { summary: 'Zone 2.' },
            },
        ],
        ...overrides,
    };
}

function header(overrides: Partial<ExternalPlanHeader> = {}): ExternalPlanHeader {
    return {
        userId: 'u1', planId: 'autumn-block', revision: 1, title: 'Autumn block',
        startDate: '2026-08-17', weekCount: 2, contentHash: 'hash-1',
        importedAt: '2026-08-16T10:00:00Z', supersededFrom: null, updatedAt: '2026-08-16T10:00:00Z',
        ...overrides,
    };
}

/** A stub of only the four reads the resolver performs. */
function stubPlans(options: {
    ids?: DataState<string[]>;
    headers?: Record<string, DataState<ExternalPlanHeader>>;
    revisions?: DataState<ExternalTrainingPlan>;
    placement?: DataState<never> | DataState<ReturnType<typeof placementDoc>>;
} = {}): ExternalPlanService {
    return {
        listPlanIds: vi.fn(async () => options.ids ?? ({ status: 'AVAILABLE', data: ['autumn-block'], revision: null } as DataState<string[]>)),
        getHeaderState: vi.fn(async (_userId: string, planId: string) =>
            options.headers?.[planId] ?? ({ status: 'AVAILABLE', data: header(), revision: 'hash-1' } as DataState<ExternalPlanHeader>)),
        getRevisionState: vi.fn(async () => options.revisions ?? ({ status: 'AVAILABLE', data: plan(), revision: '1' } as DataState<ExternalTrainingPlan>)),
        getPlacementState: vi.fn(async () => options.placement ?? ({ status: 'MISSING' })),
    } as unknown as ExternalPlanService;
}

function placementDoc(assignments: { sessionId: string; date: string; status: 'planned' | 'moved' | 'dropped' | 'completed' | 'superseded' }[]) {
    return { userId: 'u1', planId: 'autumn-block', revision: 1, assignments, updatedAt: '2026-08-18T07:00:00Z' };
}

describe('planEndDate', () => {
    it('is inclusive of the last day of the last week', () => {
        expect(planEndDate({ startDate: '2026-08-17', weekCount: 2 })).toBe('2026-08-30');
    });
});

describe('ActiveExternalPlanService', () => {
    it('resolves the plan covering the date, with placement applied', async () => {
        const state = await new ActiveExternalPlanService(stubPlans()).getActivePlanState('u1', '2026-08-18');

        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.placed.map(item => `${item.date}:${item.session.id}`))
            .toEqual(['2026-08-18:w1-threshold', '2026-08-20:w1-easy']);
    });

    it('reports MISSING for a date outside every plan rather than picking the nearest', async () => {
        const state = await new ActiveExternalPlanService(stubPlans()).getActivePlanState('u1', '2026-09-15');
        expect(state.status).toBe('MISSING');
    });

    it('reports MISSING when the athlete has imported nothing', async () => {
        const plans = stubPlans({ ids: { status: 'AVAILABLE', data: [], revision: null } });
        expect((await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18')).status).toBe('MISSING');
    });

    it('prefers the most recently imported plan when two cover the same date', async () => {
        const plans = stubPlans({
            ids: { status: 'AVAILABLE', data: ['autumn-block', 'newer-block'], revision: null },
            headers: {
                'autumn-block': { status: 'AVAILABLE', data: header(), revision: 'hash-1' },
                'newer-block': {
                    status: 'AVAILABLE',
                    data: header({ planId: 'newer-block', importedAt: '2026-08-17T10:00:00Z', contentHash: 'hash-2' }),
                    revision: 'hash-2',
                },
            },
        });

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.header.planId).toBe('newer-block');
    });

    it('surfaces an unreadable overlay instead of silently resolving without it', async () => {
        // Treating an unreadable overlay as "no overlay" would undo reschedules the athlete
        // already confirmed, putting sessions back on days they were deliberately moved off.
        const plans = stubPlans({ placement: { status: 'UNAVAILABLE', operation: 'read placement', retryable: true } as DataState<never> });
        expect((await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18')).status).toBe('UNAVAILABLE');
    });

    it('propagates an invalid stored revision rather than resolving a partial plan', async () => {
        const plans = stubPlans({ revisions: { status: 'INVALID', issues: [{ code: 'schema-validation-failed', documentPath: 'users/u1/external_plans/autumn-block/revisions/1' }] } });
        expect((await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18')).status).toBe('INVALID');
    });

    it('lets the overlay move a session off the date the plan implies', async () => {
        const plans = stubPlans({
            placement: { status: 'AVAILABLE', data: placementDoc([{ sessionId: 'w1-threshold', date: '2026-08-19', status: 'moved' }]), revision: 'x' } as never,
        });

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.placed.find(item => item.session.id === 'w1-threshold'))
            .toMatchObject({ date: '2026-08-19', moved: true });
    });
});

describe('placedSessionsForDate & placedSessionForDate', () => {
    const doubleSessionPlan = plan({
        sessions: [
            {
                id: 'w1-easy-ride', title: 'Easy Ride', priority: 'supporting',
                placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
                prescription: { summary: 'Easy aerobic spin.' },
            },
            {
                id: 'w1-strength', title: 'Upper Strength', priority: 'key',
                placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 40, environment: 'indoor', equipment: ['free_weights'] },
                prescription: { summary: 'Upper body maintenance.' },
            },
        ],
    });

    const active = (assignments: Parameters<typeof placementDoc>[0] = []): ActiveExternalPlan => ({
        header: header(),
        plan: plan(),
        placement: assignments.length > 0 ? placementDoc(assignments) : null,
        placed: [
            { session: plan().sessions[0], date: '2026-08-18', status: assignments[0]?.status ?? 'planned', moved: false },
        ],
    });

    const activeDouble: ActiveExternalPlan = {
        header: header(),
        plan: doubleSessionPlan,
        placement: null,
        placed: [
            { session: doubleSessionPlan.sessions[0], date: '2026-08-20', status: 'planned', moved: false },
            { session: doubleSessionPlan.sessions[1], date: '2026-08-20', status: 'planned', moved: false },
        ],
    };

    it('returns a session still to be done', () => {
        expect(placedSessionForDate(active(), '2026-08-18')?.session.id).toBe('w1-threshold');
    });

    it('returns all placed sessions on a double training day', () => {
        const sessions = placedSessionsForDate(activeDouble, '2026-08-20');
        expect(sessions.length).toBe(2);
        expect(sessions.map(s => s.session.id)).toEqual(['w1-easy-ride', 'w1-strength']);
    });

    it('prioritizes the highest-priority session (key over supporting) for placedSessionForDate', () => {
        expect(placedSessionForDate(activeDouble, '2026-08-20')?.session.id).toBe('w1-strength');
    });

    it('returns nothing for a session already completed, dropped or superseded', () => {
        for (const status of ['completed', 'dropped', 'superseded'] as const) {
            expect(placedSessionForDate(active([{ sessionId: 'w1-threshold', date: '2026-08-18', status }]), '2026-08-18'), status).toBeNull();
            expect(placedSessionsForDate(active([{ sessionId: 'w1-threshold', date: '2026-08-18', status }]), '2026-08-18')).toEqual([]);
        }
    });

    it('returns nothing for a day with nothing placed', () => {
        expect(placedSessionForDate(active(), '2026-08-19')).toBeNull();
        expect(placedSessionsForDate(active(), '2026-08-19')).toEqual([]);
    });
});

describe('externalPlanContextForDate and externalPlanContextsForDate', () => {
    const doubleSessionPlan = plan({
        sessions: [
            {
                id: 'w1-easy-ride', title: 'Easy Ride', priority: 'supporting',
                placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
                prescription: { summary: 'Easy aerobic spin.' },
            },
            {
                id: 'w1-strength', title: 'Upper Strength', priority: 'key',
                placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 40, environment: 'indoor', equipment: ['free_weights'] },
                prescription: { summary: 'Upper body maintenance.' },
            },
        ],
    });

    const active: ActiveExternalPlan = {
        header: header({ contentHash: 'stored-hash' }),
        plan: plan(),
        placement: null,
        placed: [{ session: plan().sessions[0], date: '2026-08-18', status: 'planned', moved: false }],
    };

    const activeDouble: ActiveExternalPlan = {
        header: header({ contentHash: 'stored-hash' }),
        plan: doubleSessionPlan,
        placement: null,
        placed: [
            { session: doubleSessionPlan.sessions[0], date: '2026-08-20', status: 'planned', moved: false },
            { session: doubleSessionPlan.sessions[1], date: '2026-08-20', status: 'planned', moved: false },
        ],
    };

    const tripleSessionPlan = plan({
        sessions: [
            {
                id: 'w1-easy-ride', title: 'Easy Ride', priority: 'supporting',
                placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
                prescription: { summary: 'Easy aerobic spin.' },
            },
            {
                id: 'w1-strength', title: 'Upper Strength', priority: 'key',
                placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 40, environment: 'indoor', equipment: ['free_weights'] },
                prescription: { summary: 'Upper body maintenance.' },
            },
            {
                id: 'w1-mobility', title: 'Mobility Routine', priority: 'optional',
                placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
                gating: { modality: 'mobility', intensity: 'recovery', durationMin: 15, durationMax: 20, environment: 'indoor', equipment: [] },
                prescription: { summary: 'Evening mobility.' },
            },
        ],
    });

    const activeTriple: ActiveExternalPlan = {
        header: header({ contentHash: 'stored-hash' }),
        plan: tripleSessionPlan,
        placement: null,
        placed: [
            { session: tripleSessionPlan.sessions[0], date: '2026-08-20', status: 'planned', moved: false },
            { session: tripleSessionPlan.sessions[1], date: '2026-08-20', status: 'planned', moved: false },
            { session: tripleSessionPlan.sessions[2], date: '2026-08-20', status: 'planned', moved: false },
        ],
    };

    it('carries the stored hash, not a recomputed one, so the audit matches the import', () => {
        expect(externalPlanContextForDate(active, '2026-08-18')).toMatchObject({
            planId: 'autumn-block', revision: 1, contentHash: 'stored-hash',
        });
        expect(externalPlanContextForDate(active, '2026-08-18')?.session.id).toBe('w1-threshold');
    });

    it('returns all contexts for double training days in externalPlanContextsForDate', () => {
        const contexts = externalPlanContextsForDate(activeDouble, '2026-08-20');
        expect(contexts.length).toBe(2);
        expect(contexts[0].session.id).toBe('w1-easy-ride');
        expect(contexts[1].session.id).toBe('w1-strength');
        expect(contexts.every(c => c.contentHash === 'stored-hash')).toBe(true);
    });

    it('returns all contexts for triple training days in externalPlanContextsForDate and prioritizes key in placedSessionForDate', () => {
        const sessions = placedSessionsForDate(activeTriple, '2026-08-20');
        expect(sessions.length).toBe(3);
        expect(sessions.map(s => s.session.id)).toEqual(['w1-easy-ride', 'w1-strength', 'w1-mobility']);

        // Key priority takes precedence over supporting and optional
        expect(placedSessionForDate(activeTriple, '2026-08-20')?.session.id).toBe('w1-strength');

        const contexts = externalPlanContextsForDate(activeTriple, '2026-08-20');
        expect(contexts.length).toBe(3);
        expect(contexts.map(c => c.session.id)).toEqual(['w1-easy-ride', 'w1-strength', 'w1-mobility']);
    });

    it('is null on a day the plan places nothing, so the ranked path runs', () => {
        expect(externalPlanContextForDate(active, '2026-08-19')).toBeNull();
        expect(externalPlanContextsForDate(active, '2026-08-19')).toEqual([]);
    });
});
