import { describe, expect, it, vi } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA, type ExternalPlanHeader, type ExternalTrainingPlan } from '../engine/models';
import type { DataState } from '../engine/dataState';
import {
    ActiveExternalPlanService,
    governedPlacedSessions,
    governedPlanDays,
    governedRestDates,
    governingPlanTitles,
    type ActiveExternalPlan,
} from './activeExternalPlanService';
import type { ExternalPlanService } from './externalPlanService';
import { computeContentHash } from './externalPlanService';

const gating = { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] } as const;

function session(id: string, week: number, preferredDay: 'tuesday' | 'thursday') {
    return {
        id, title: id, priority: 'key' as const,
        placement: { week, preferredDay, flexibility: 'preferred' as const, ifMissed: 'drop' as const },
        gating: { ...gating, equipment: [] },
        prescription: { summary: id },
    };
}

/** Two weeks from Monday 2026-08-17, with a session in each week. */
const outgoing: ExternalTrainingPlan = {
    schema: EXTERNAL_PLAN_SCHEMA, planId: 'autumn-block', revision: 1, title: 'Autumn block',
    startDate: '2026-08-17', weekCount: 2,
    sessions: [session('autumn-w1-thu', 1, 'thursday'), session('autumn-w2-tue', 2, 'tuesday')],
};

/** A different plan, imported later, starting the following Monday (2026-08-24). */
const incoming: ExternalTrainingPlan = {
    schema: EXTERNAL_PLAN_SCHEMA, planId: 'winter-block', revision: 1, title: 'Winter block',
    startDate: '2026-08-24', weekCount: 1,
    sessions: [session('winter-w1-tue', 1, 'tuesday')],
};

async function headerFor(plan: ExternalTrainingPlan, importedAt: string): Promise<ExternalPlanHeader> {
    return {
        userId: 'u1', planId: plan.planId, revision: plan.revision, title: plan.title,
        startDate: plan.startDate, weekCount: plan.weekCount,
        contentHash: await computeContentHash(plan as never),
        importedAt, supersededFrom: importedAt.slice(0, 10), updatedAt: importedAt,
    };
}

async function twoPlanService(): Promise<ActiveExternalPlanService> {
    const plans: Record<string, ExternalTrainingPlan> = { 'autumn-block': outgoing, 'winter-block': incoming };
    const headers: Record<string, ExternalPlanHeader> = {
        'autumn-block': await headerFor(outgoing, '2026-08-16T10:00:00Z'),
        'winter-block': await headerFor(incoming, '2026-08-20T07:00:00Z'),
    };
    return new ActiveExternalPlanService({
        listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE', data: Object.keys(plans), revision: null })),
        getHeaderState: vi.fn(async (_userId: string, planId: string) => ({ status: 'AVAILABLE', data: headers[planId], revision: null })),
        getActivationState: vi.fn(async () => ({ status: 'AVAILABLE', data: [], revision: null })),
        getRevisionState: vi.fn(async (_userId: string, planId: string) => ({ status: 'AVAILABLE', data: plans[planId], revision: '1' })),
        getPlacementState: vi.fn(async () => ({ status: 'MISSING' })),
    } as unknown as ExternalPlanService);
}

describe('governed plan days (a newly imported plan that starts later)', () => {
    it('shows each date under the plan that governs it, not today\'s plan for the whole window', async () => {
        const service = await twoPlanService();

        const state = await service.getGovernedPlanDays('u1', '2026-08-20', 7);

        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.map(day => `${day.date}:${day.active?.plan.planId ?? 'none'}`)).toEqual([
            '2026-08-20:autumn-block', '2026-08-21:autumn-block', '2026-08-22:autumn-block', '2026-08-23:autumn-block',
            '2026-08-24:winter-block', '2026-08-25:winter-block', '2026-08-26:winter-block',
        ]);
        // The outgoing plan's week-2 session on 08-25 must not appear: the incoming plan owns that date.
        expect(governedPlacedSessions(state.data).map(item => `${item.date}:${item.session.id}`))
            .toEqual(['2026-08-20:autumn-w1-thu', '2026-08-25:winter-w1-tue']);
        expect(governingPlanTitles(state.data)).toEqual(['Autumn block', 'Winter block']);
    });

    it('shows an upcoming plan even when no plan governs the first day of the window', async () => {
        const service = await twoPlanService();

        const state = await service.getGovernedPlanDays('u1', '2026-08-15', 4);

        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.map(day => `${day.date}:${day.active?.plan.planId ?? 'none'}`)).toEqual([
            '2026-08-15:none', '2026-08-16:none', '2026-08-17:autumn-block', '2026-08-18:autumn-block',
        ]);
        expect(governingPlanTitles(state.data)).toEqual(['Autumn block']);
    });

    it('reports no plan on dates after every plan has ended', async () => {
        const service = await twoPlanService();

        const state = await service.getGovernedPlanDays('u1', '2026-08-31', 3);

        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.every(day => day.active === null)).toBe(true);
        expect(governingPlanTitles(state.data)).toEqual([]);
    });

    it('marks each authored rest day under the plan that governs that date', async () => {
        const restful = {
            ...incoming,
            restDays: [{ id: 'winter-w1-wed', week: 1, day: 'wednesday' }],
        } as unknown as ExternalTrainingPlan;
        // The outgoing plan's own rest day on 08-26 must not count: the incoming plan owns that date.
        const outgoingWithRest = {
            ...outgoing,
            restDays: [{ id: 'autumn-w1-sat', week: 1, day: 'saturday' }, { id: 'autumn-w2-thu', week: 2, day: 'thursday' }],
        } as unknown as ExternalTrainingPlan;
        const active = (plan: ExternalTrainingPlan) => ({ plan, placed: [] }) as unknown as ActiveExternalPlan;
        const days = [
            { date: '2026-08-22', active: active(outgoingWithRest) },
            { date: '2026-08-23', active: active(outgoingWithRest) },
            { date: '2026-08-26', active: active(restful) },
            { date: '2026-08-27', active: active(restful) },
            { date: '2026-08-28', active: null },
        ];

        expect(governedRestDates(days)).toEqual(['2026-08-22', '2026-08-26']);
    });

    it('fails closed when any date in the window cannot be resolved', () => {
        const available = { status: 'AVAILABLE', data: {} as ActiveExternalPlan, revision: null } as const;
        const unavailable: DataState<ActiveExternalPlan> = { status: 'UNAVAILABLE', operation: 'read plans', retryable: true };

        expect(governedPlanDays('2026-08-20', [available, { status: 'MISSING' }, unavailable])).toBe(unavailable);
    });
});
