import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDaysToLocalDateString } from '../utils/localDate';
import { preflightExternalPlanImport } from './externalPlanImportPreflight';

const reads = vi.hoisted(() => ({
    fixed: vi.fn(),
    blocks: vi.fn(),
    occurrences: vi.fn(),
    activePlan: vi.fn(),
    activePlanRange: vi.fn(),
}));

vi.mock('./fixedActivityService', () => ({ fixedActivityService: { getActivitiesInRangeState: reads.fixed } }));
vi.mock('./planBlockService', () => ({ planBlockService: { getBlocksInRangeState: reads.blocks } }));
vi.mock('./sessionOccurrenceService', () => ({ sessionOccurrenceService: { getOccurrencesInRangeState: reads.occurrences } }));
vi.mock('./activeExternalPlanService', () => ({ activeExternalPlanService: {
    getActivePlanState: reads.activePlan,
    getActivePlanStatesInRange: reads.activePlanRange,
} }));

const plan = {
    schema: 'adaptive-training-recommender/external-plan@1',
    planId: 'new-plan', revision: 1, title: 'New plan', startDate: '2026-08-17', weekCount: 1,
    sessions: [{
        id: 'ride-1', title: 'Ride', priority: 'key',
        placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
        gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
        prescription: { summary: 'Easy ride' },
    }],
} as const;

describe('preflightExternalPlanImport', () => {
    beforeEach(() => {
        reads.fixed.mockResolvedValue({ status: 'AVAILABLE', data: [] });
        reads.blocks.mockResolvedValue({ status: 'AVAILABLE', data: [] });
        reads.occurrences.mockResolvedValue({ status: 'AVAILABLE', data: [] });
        reads.activePlan.mockResolvedValue({ status: 'MISSING' });
        reads.activePlanRange.mockImplementation(async (userId: string, start: string, end: string, fixed: unknown) => {
            const states = [];
            for (let date = start; date <= end; date = addDaysToLocalDateString(date, 1)) states.push(await reads.activePlan(userId, date, fixed));
            return states;
        });
    });

    it('fails closed when a calendar authority read is unavailable', async () => {
        reads.fixed.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        const result = await preflightExternalPlanImport('u1', plan as never, plan.startDate, '2026-08-16');
        expect(result).toMatchObject({ status: 'unknown', unavailableSources: ['fixed activities'] });
        expect(reads.activePlanRange).not.toHaveBeenCalled();
    });

    it('reports placement shifts produced by the existing resolver', async () => {
        reads.fixed.mockResolvedValue({ status: 'AVAILABLE', data: [{
            id: 'fixed-1', userId: 'u1', title: 'Class', date: '2026-08-18', durationMin: 60,
            fixed: true, isCompleted: false, environment: 'indoor', equipment: [],
        }] });
        const result = await preflightExternalPlanImport('u1', plan as never, plan.startDate, '2026-08-16');
        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.findings).toContainEqual(expect.objectContaining({
                kind: 'placement', date: '2026-08-19', detail: expect.stringContaining('2026-08-18 to 2026-08-19'),
            }));
        }
    });

    it('checks fixed occupancy before the effective boundary when it moves a session into the active window', async () => {
        reads.fixed.mockResolvedValue({ status: 'AVAILABLE', data: [ {
            id: 'fixed-1', userId: 'u1', title: 'Class', date: '2026-08-18', durationMin: 60,
            fixed: true, isCompleted: false, environment: 'indoor', equipment: [],
        } ] });
        const result = await preflightExternalPlanImport('u1', plan as never, '2026-08-19', '2026-08-16');
        expect(reads.fixed).toHaveBeenCalledWith('u1', '2026-08-17', '2026-08-23');
        expect(result).toMatchObject({ status: 'ready', findings: [expect.objectContaining({ kind: 'placement', date: '2026-08-19' })] });
    });

    it('checks current authority on empty dates across the entire effective plan horizon', async () => {
        reads.activePlan.mockResolvedValue({ status: 'AVAILABLE', data: {
            plan: { planId: 'existing', title: 'Existing plan' },
        } });
        const result = await preflightExternalPlanImport('u1', plan as never, plan.startDate, '2026-08-16');
        expect(result.status).toBe('ready');
        expect(reads.activePlanRange).toHaveBeenCalledWith('u1', '2026-08-17', '2026-08-23', []);
        expect(reads.activePlan).toHaveBeenCalledTimes(7);
        if (result.status === 'ready') expect(result.findings).toContainEqual(expect.objectContaining({ kind: 'external_plan', date: '2026-08-17' }));
    });

    it('blocks a date after the plan horizon and treats an existing same-plan occurrence as a conflict', async () => {
        expect(await preflightExternalPlanImport('u1', plan as never, '2026-08-24', '2026-08-16'))
            .toEqual({ status: 'invalid_date' });
        reads.occurrences.mockResolvedValue({ status: 'AVAILABLE', data: [{
            occurrenceId: 'old-occurrence', authority: 'external_plan', date: '2026-08-18', state: 'scheduled',
            externalPlanRef: { planId: 'new-plan', revision: 1, sessionId: 'ride-1', contentHash: 'stale' },
        }] });
        const result = await preflightExternalPlanImport('u1', plan as never, plan.startDate, '2026-08-16');
        expect(result.status).toBe('ready');
        if (result.status === 'ready') expect(result.findings).toContainEqual(expect.objectContaining({ kind: 'authored_occurrence', detail: expect.stringContaining('old-occurrence') }));
    });

    it('requires acknowledgement when a same-plan revision changes rest directives or resets a placement overlay', async () => {
        reads.activePlan.mockResolvedValue({ status: 'AVAILABLE', data: {
            plan: { ...plan, restDays: [{ id: 'rest', week: 1, day: 'friday' }] },
            placement: { assignments: [{ sessionId: 'ride-1', date: '2026-08-20', status: 'moved' }] },
        } });
        const result = await preflightExternalPlanImport('u1', plan as never, plan.startDate, '2026-08-16', {
            ...plan, restDays: [{ id: 'rest', week: 1, day: 'friday' }],
        } as never);
        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.findings.some(item => item.kind === 'rest_directive')).toBe(true);
            expect(result.findings.filter(item => item.kind === 'placement' && item.detail.includes('resets'))).toHaveLength(1);
        }
    });

    it('acknowledges rest changes from the prior immutable revision and checks rest-day conflicts', async () => {
        reads.fixed.mockResolvedValue({ status: 'AVAILABLE', data: [{
            id: 'fixed-1', userId: 'u1', title: 'Class', date: '2026-08-21', durationMin: 60,
            fixed: true, isCompleted: false, environment: 'indoor', equipment: [],
        }] });
        reads.occurrences.mockResolvedValue({ status: 'AVAILABLE', data: [{
            occurrenceId: 'existing-session', authority: 'authored', date: '2026-08-21', state: 'scheduled',
        }] });
        const restPlan = { ...plan, sessions: [], restDays: [{ id: 'new-rest', week: 1, day: 'friday' }] };
        const priorPlan = { ...plan, sessions: [], restDays: [{ id: 'old-rest', week: 1, day: 'thursday' }] };
        const result = await preflightExternalPlanImport('u1', restPlan as never, plan.startDate, '2026-08-16', priorPlan as never);
        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.findings).toContainEqual(expect.objectContaining({ kind: 'rest_directive' }));
            expect(result.findings).toContainEqual(expect.objectContaining({ kind: 'fixed_activity', date: '2026-08-21' }));
            expect(result.findings).toContainEqual(expect.objectContaining({ kind: 'authored_occurrence', date: '2026-08-21' }));
        }
    });

    it('rejects effective dates before today', async () => {
        expect(await preflightExternalPlanImport('u1', plan as never, '2026-08-15', '2026-08-16'))
            .toEqual({ status: 'invalid_date' });
        expect(reads.fixed).not.toHaveBeenCalled();
    });
});
