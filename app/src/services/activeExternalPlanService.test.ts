import { describe, expect, it, vi } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA, type ExternalPlanHeader, type ExternalPlanRevisionActivation, type ExternalTrainingPlan } from '../engine/models';
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
import { computeContentHash } from './externalPlanService';

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
    revisionsByPlan?: Record<string, ExternalTrainingPlan>;
    activations?: DataState<ExternalPlanRevisionActivation[]>;
    revisions?: DataState<ExternalTrainingPlan>;
    placement?: DataState<never> | DataState<ReturnType<typeof placementDoc>>;
} = {}): ExternalPlanService {
    return {
        listPlanIds: vi.fn(async () => options.ids ?? ({ status: 'AVAILABLE', data: ['autumn-block'], revision: null } as DataState<string[]>)),
        getHeaderState: vi.fn(async (_userId: string, planId: string) =>
            options.headers?.[planId] ?? ({ status: 'AVAILABLE', data: await matchingHeader(), revision: 'hash-1' } as DataState<ExternalPlanHeader>)),
        getRevisionState: vi.fn(async (_userId: string, planId: string) => options.revisions ?? ({ status: 'AVAILABLE', data: options.revisionsByPlan?.[planId] ?? plan(), revision: '1' } as DataState<ExternalTrainingPlan>)),
        getActivationState: vi.fn(async () => options.activations ?? ({ status: 'AVAILABLE', data: [], revision: '0' })),
        getPlacementState: vi.fn(async () => options.placement ?? ({ status: 'MISSING' })),
    } as unknown as ExternalPlanService;
}

async function matchingHeader(overrides: Partial<ExternalPlanHeader> = {}) {
    const revision = overrides.revision ?? 1;
    const revisionPlan = plan({
        ...(overrides.planId ? { planId: overrides.planId } : {}),
        ...(overrides.title ? { title: overrides.title } : {}),
        ...(overrides.startDate ? { startDate: overrides.startDate } : {}),
        ...(overrides.weekCount ? { weekCount: overrides.weekCount } : {}),
        revision,
    });
    return header({ contentHash: await computeContentHash(revisionPlan as never), ...overrides });
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

    it('reuses plan authority reads while resolving a date range', async () => {
        const plans = stubPlans();
        const states = await new ActiveExternalPlanService(plans).getActivePlanStatesInRange('u1', '2026-08-17', '2026-08-19');
        expect(states.map(state => state.status)).toEqual(['AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
        expect(plans.listPlanIds).toHaveBeenCalledTimes(1);
        expect(plans.getHeaderState).toHaveBeenCalledTimes(1);
        expect(plans.getActivationState).toHaveBeenCalledTimes(1);
        expect(plans.getRevisionState).toHaveBeenCalledTimes(1);
        expect(plans.getPlacementState).toHaveBeenCalledTimes(1);
    });


    it('falls back to the prior effective revision until the successor horizon begins', async () => {
        const predecessor = plan({ revision: 1, startDate: '2026-08-17', weekCount: 2 });
        const successor = plan({ revision: 2, startDate: '2026-08-24', weekCount: 1 });
        const predecessorHash = await computeContentHash(predecessor as never);
        const successorHash = await computeContentHash(successor as never);
        const plans = {
            listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE', data: ['autumn-block'], revision: null })),
            getHeaderState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: header({
                    revision: 2,
                    startDate: successor.startDate,
                    weekCount: successor.weekCount,
                    contentHash: successorHash,
                    importedAt: '2026-08-20T08:00:00Z',
                    supersededFrom: '2026-08-20',
                }),
                revision: successorHash,
            })),
            getActivationState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: [
                    {
                        userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: predecessorHash,
                        effectiveFrom: '2026-08-17', activatedAt: '2026-08-16T10:00:00Z',
                    },
                    {
                        userId: 'u1', planId: 'autumn-block', revision: 2, contentHash: successorHash,
                        effectiveFrom: '2026-08-20', activatedAt: '2026-08-20T08:00:00Z',
                    },
                ],
                revision: '2',
            })),
            getRevisionState: vi.fn(async (_userId: string, _planId: string, revision: number) => ({
                status: 'AVAILABLE',
                data: revision === 1 ? predecessor : successor,
                revision: String(revision),
            })),
            getPlacementState: vi.fn(async () => ({ status: 'MISSING' })),
        } as unknown as ExternalPlanService;

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-21');

        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.header.revision).toBe(1);
        expect(state.data.plan.startDate).toBe('2026-08-17');
        expect(plans.getRevisionState).toHaveBeenCalledWith('u1', 'autumn-block', 2);
        expect(plans.getRevisionState).toHaveBeenCalledWith('u1', 'autumn-block', 1);
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
            revisionsByPlan: { 'newer-block': plan({ planId: 'newer-block' }) },
            headers: {
                'autumn-block': { status: 'AVAILABLE', data: await matchingHeader(), revision: 'hash-1' },
                'newer-block': {
                    status: 'AVAILABLE',
                    data: await matchingHeader({ planId: 'newer-block', importedAt: '2026-08-17T10:00:00Z' }),
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

    it('resolves an R1 → future R2 → R3 chain deterministically per date', async () => {
        const r1 = plan({ revision: 1, startDate: '2026-08-17', weekCount: 4 });
        const r2 = plan({ revision: 2, startDate: '2026-08-24', weekCount: 4 });
        const r3 = plan({ revision: 3, startDate: '2026-08-31', weekCount: 4 });
        const hashes = {
            1: await computeContentHash(r1 as never),
            2: await computeContentHash(r2 as never),
            3: await computeContentHash(r3 as never),
        };
        const byRevision = { 1: r1, 2: r2, 3: r3 } as const;
        const activations = (['2026-08-17', '2026-08-24', '2026-08-31'] as const).map((effectiveFrom, index) => {
            const revision = (index + 1) as 1 | 2 | 3;
            return {
                userId: 'u1', planId: 'autumn-block', revision, contentHash: hashes[revision],
                effectiveFrom, activatedAt: `${effectiveFrom}T08:00:00Z`,
            };
        });
        const latestHash = hashes[3];
        const plans = {
            listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE', data: ['autumn-block'], revision: null })),
            getHeaderState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: header({
                    revision: 3, startDate: r3.startDate, weekCount: r3.weekCount,
                    contentHash: latestHash, importedAt: '2026-08-31T08:00:00Z', supersededFrom: '2026-08-31',
                }),
                revision: latestHash,
            })),
            getActivationState: vi.fn(async () => ({ status: 'AVAILABLE', data: activations, revision: '3' })),
            getRevisionState: vi.fn(async (_userId: string, _planId: string, revision: number) => ({
                status: 'AVAILABLE', data: byRevision[revision as 1 | 2 | 3], revision: String(revision),
            })),
            getPlacementState: vi.fn(async () => ({ status: 'MISSING' })),
        } as unknown as ExternalPlanService;
        const service = new ActiveExternalPlanService(plans);

        const before = await service.getActivePlanState('u1', '2026-08-21');
        if (before.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(before.data.header.revision).toBe(1);
        expect(before.data.plan.startDate).toBe('2026-08-17');

        const middle = await service.getActivePlanState('u1', '2026-08-27');
        if (middle.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(middle.data.header.revision).toBe(2);
        expect(middle.data.plan.startDate).toBe('2026-08-24');

        const last = await service.getActivePlanState('u1', '2026-09-02');
        if (last.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(last.data.header.revision).toBe(3);
        expect(last.data.plan.startDate).toBe('2026-08-31');
    });

    it('attempts the newest applicable activation first, then falls back across a horizon gap', async () => {
        const predecessor = plan({ revision: 1, startDate: '2026-08-17', weekCount: 2 });
        const successor = plan({ revision: 2, startDate: '2026-08-24', weekCount: 1 });
        const predecessorHash = await computeContentHash(predecessor as never);
        const successorHash = await computeContentHash(successor as never);
        const getRevisionState = vi.fn(async (_userId: string, _planId: string, revision: number) => ({
            status: 'AVAILABLE',
            data: revision === 1 ? predecessor : successor,
            revision: String(revision),
        }));
        const plans = {
            listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE', data: ['autumn-block'], revision: null })),
            getHeaderState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: header({
                    revision: 2, startDate: successor.startDate, weekCount: successor.weekCount,
                    contentHash: successorHash, importedAt: '2026-08-20T08:00:00Z', supersededFrom: '2026-08-20',
                }),
                revision: successorHash,
            })),
            getActivationState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: [
                    {
                        userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: predecessorHash,
                        effectiveFrom: '2026-08-17', activatedAt: '2026-08-16T10:00:00Z',
                    },
                    {
                        userId: 'u1', planId: 'autumn-block', revision: 2, contentHash: successorHash,
                        effectiveFrom: '2026-08-20', activatedAt: '2026-08-20T08:00:00Z',
                    },
                ],
                revision: '2',
            })),
            getRevisionState,
            getPlacementState: vi.fn(async () => ({ status: 'MISSING' })),
        } as unknown as ExternalPlanService;

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-21');
        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.header.revision).toBe(1);
        // The resolver tried the newest applicable activation (revision 2) first and only
        // then fell back to the covering predecessor -- call order proves the attempt.
        const callOrder = getRevisionState.mock.calls.map(call => call[2] as number);
        expect(callOrder).toEqual([2, 1]);
    });

    it('skips a newest activation whose horizon misses the date in favor of a covering predecessor', async () => {
        const predecessor = plan({ revision: 1, startDate: '2026-08-17', weekCount: 4 });
        const successor = plan({ revision: 2, startDate: '2026-09-07', weekCount: 2 });
        const predecessorHash = await computeContentHash(predecessor as never);
        const successorHash = await computeContentHash(successor as never);
        const plans = {
            listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE', data: ['autumn-block'], revision: null })),
            getHeaderState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: header({
                    revision: 2, startDate: successor.startDate, weekCount: successor.weekCount,
                    contentHash: successorHash, importedAt: '2026-08-20T08:00:00Z', supersededFrom: '2026-08-20',
                }),
                revision: successorHash,
            })),
            getActivationState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: [
                    {
                        userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: predecessorHash,
                        effectiveFrom: '2026-08-17', activatedAt: '2026-08-16T10:00:00Z',
                    },
                    {
                        userId: 'u1', planId: 'autumn-block', revision: 2, contentHash: successorHash,
                        effectiveFrom: '2026-08-20', activatedAt: '2026-08-20T08:00:00Z',
                    },
                ],
                revision: '2',
            })),
            getRevisionState: vi.fn(async (_userId: string, _planId: string, revision: number) => ({
                status: 'AVAILABLE',
                data: revision === 1 ? predecessor : successor,
                revision: String(revision),
            })),
            getPlacementState: vi.fn(async () => ({ status: 'MISSING' })),
        } as unknown as ExternalPlanService;

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-25');
        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.header.revision).toBe(1);
    });

    it('fails closed with the full activation path when activation content disagrees', async () => {
        const revisionPlan = plan({ revision: 1 });
        const plans = stubPlans({
            headers: {
                'autumn-block': { status: 'AVAILABLE', data: await matchingHeader(), revision: 'hash-1' },
            },
            revisions: { status: 'AVAILABLE', data: revisionPlan, revision: '1' },
            activations: {
                status: 'AVAILABLE',
                data: [{
                    userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: 'f'.repeat(64),
                    effectiveFrom: '2026-08-17', activatedAt: '2026-08-16T10:00:00Z',
                }],
                revision: '1',
            },
        });

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18');
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('unreachable');
        expect(state.issues).toEqual([{
            code: 'activation-content-mismatch',
            documentPath: 'users/u1/external_plans/autumn-block/activations/1',
        }]);
    });

    it('treats another revision overlay as no overlay, never as this revision placement', async () => {
        const plans = stubPlans({
            placement: {
                status: 'AVAILABLE',
                data: { ...placementDoc([{ sessionId: 'w1-threshold', date: '2026-08-19', status: 'moved' }]), revision: 1 },
                revision: 'x',
            } as never,
            activations: {
                status: 'AVAILABLE',
                data: [{
                    userId: 'u1', planId: 'autumn-block', revision: 2, contentHash: await computeContentHash(plan({ revision: 2 }) as never),
                    effectiveFrom: '2026-08-17', activatedAt: '2026-08-16T10:00:00Z',
                }],
                revision: '1',
            },
            revisions: { status: 'AVAILABLE', data: plan({ revision: 2 }), revision: '2' },
            headers: {
                'autumn-block': {
                    status: 'AVAILABLE',
                    data: await matchingHeader({ revision: 2, contentHash: await computeContentHash(plan({ revision: 2 }) as never) }),
                    revision: 'hash-2',
                },
            },
        });

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18');
        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(state.data.placement).toBeNull();
        expect(state.data.placed.find(item => item.session.id === 'w1-threshold'))
            .toMatchObject({ date: '2026-08-18', moved: false });
    });

    it('honors a Warsaw DST-boundary effectiveFrom with calendar-date comparison', async () => {
        // Europe/Warsaw leaves DST on 2026-10-25; the resolver compares LocalDateString
        // values, so the boundary date itself already belongs to the successor.
        const predecessor = plan({ revision: 1, startDate: '2026-10-19', weekCount: 3 });
        const successor = plan({ revision: 2, startDate: '2026-10-25', weekCount: 2 });
        const predecessorHash = await computeContentHash(predecessor as never);
        const successorHash = await computeContentHash(successor as never);
        const plans = {
            listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE', data: ['autumn-block'], revision: null })),
            getHeaderState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: header({
                    revision: 2, startDate: successor.startDate, weekCount: successor.weekCount,
                    contentHash: successorHash, importedAt: '2026-10-25T00:30:00Z', supersededFrom: '2026-10-25',
                }),
                revision: successorHash,
            })),
            getActivationState: vi.fn(async () => ({
                status: 'AVAILABLE',
                data: [
                    {
                        userId: 'u1', planId: 'autumn-block', revision: 1, contentHash: predecessorHash,
                        effectiveFrom: '2026-10-19', activatedAt: '2026-10-18T10:00:00Z',
                    },
                    {
                        userId: 'u1', planId: 'autumn-block', revision: 2, contentHash: successorHash,
                        effectiveFrom: '2026-10-25', activatedAt: '2026-10-25T00:30:00Z',
                    },
                ],
                revision: '2',
            })),
            getRevisionState: vi.fn(async (_userId: string, _planId: string, revision: number) => ({
                status: 'AVAILABLE',
                data: revision === 1 ? predecessor : successor,
                revision: String(revision),
            })),
            getPlacementState: vi.fn(async () => ({ status: 'MISSING' })),
        } as unknown as ExternalPlanService;
        const service = new ActiveExternalPlanService(plans);

        const dayBefore = await service.getActivePlanState('u1', '2026-10-24');
        if (dayBefore.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(dayBefore.data.header.revision).toBe(1);

        const boundary = await service.getActivePlanState('u1', '2026-10-25');
        if (boundary.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(boundary.data.header.revision).toBe(2);
    });

    it('propagates unreadable activation history instead of reporting MISSING', async () => {
        const plans = stubPlans({
            activations: { status: 'UNAVAILABLE', operation: 'read activation history', retryable: true },
        });
        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18');
        expect(state.status).toBe('UNAVAILABLE');
        expect(state).toMatchObject({ operation: 'read activation history' });
    });

    it('propagates an unreadable applicable revision instead of falling back silently', async () => {
        const plans = stubPlans({
            revisions: { status: 'UNAVAILABLE', operation: 'read external plan revision', retryable: true },
        });
        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18');
        expect(state.status).toBe('UNAVAILABLE');
    });

    it('fails closed when an activation references a missing immutable revision', async () => {
        const revisionPlan = plan({ revision: 1 });
        const plans = stubPlans({
            headers: {
                'autumn-block': { status: 'AVAILABLE', data: await matchingHeader(), revision: 'hash-1' },
            },
            activations: {
                status: 'AVAILABLE',
                data: [{
                    userId: 'u1',
                    planId: 'autumn-block',
                    revision: 1,
                    contentHash: await computeContentHash(revisionPlan as never),
                    effectiveFrom: '2026-08-17',
                    activatedAt: '2026-08-16T10:00:00Z',
                }],
                revision: '1',
            },
            revisions: { status: 'MISSING' },
        });

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18');
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('unreachable');
        expect(state.issues).toEqual([{
            code: 'activation-revision-missing',
            documentPath: 'users/u1/external_plans/autumn-block/revisions/1',
        }]);
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
