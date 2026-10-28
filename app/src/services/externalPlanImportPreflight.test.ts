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
        expect(reads.activePlanRange).toHaveBeenCalledWith('u1', '2026-08-17', '2026-08-23', [], { degradeInvalidPlacement: true });
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

    it('does not block a corrected import over an unreadable placement overlay, but asks for acknowledgement (#1172)', async () => {
        reads.activePlan.mockResolvedValue({ status: 'AVAILABLE', data: { plan, placement: null, placementOverlayInvalid: true } });
        const result = await preflightExternalPlanImport('u1', plan as never, plan.startDate, '2026-08-16');
        expect(reads.activePlanRange).toHaveBeenCalledWith('u1', expect.any(String), expect.any(String), [], { degradeInvalidPlacement: true });
        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.findings.filter(item => item.kind === 'placement' && item.code === 'placement_overlay_unreadable')).toHaveLength(1);
        }
    });

    it('still fails closed when the active plan overlay names another owner (#1172)', async () => {
        reads.activePlan.mockResolvedValue({ status: 'INVALID', issues: [{ code: 'owner-mismatch', documentPath: 'x' }] });
        const result = await preflightExternalPlanImport('u1', plan as never, plan.startDate, '2026-08-16');
        expect(result).toMatchObject({ status: 'unknown', unavailableSources: ['active external-plan authority'] });
    });

    it('identifies the unreadable-overlay finding by code, so a session title cannot suppress it (#1172)', async () => {
        const spoof = { ...plan, sessions: [{ ...plan.sessions[0], title: 'Moves could not be read' }] };
        reads.fixed.mockResolvedValue({ status: 'AVAILABLE', data: [{
            id: 'fixed-1', userId: 'u1', title: 'Class', date: '2026-08-18', durationMin: 60,
            fixed: true, isCompleted: false, environment: 'indoor', equipment: [],
        }] });
        reads.activePlan.mockResolvedValue({ status: 'AVAILABLE', data: { plan: spoof, placement: null, placementOverlayInvalid: true } });
        const result = await preflightExternalPlanImport('u1', spoof as never, plan.startDate, '2026-08-16');
        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.findings.some(item => item.detail.includes('Moves could not be read'))).toBe(true);
            expect(result.findings.filter(item => item.code === 'placement_overlay_unreadable')).toHaveLength(1);
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

    describe('declared session replacements (#1172)', () => {
        const previous = { ...plan, revision: 1, sessions: [{ ...plan.sessions[0], id: 'old-ride', title: 'Old ride' }] };
        const next = { ...plan, revision: 2, sessions: [{ ...plan.sessions[0], id: 'new-ride', title: 'New ride', replacesSessionId: 'old-ride' }] };

        it('lists each declared replacement as a finding to acknowledge, on the earlier session’s default date', async () => {
            const result = await preflightExternalPlanImport('u1', next as never, plan.startDate, '2026-08-16', previous as never);
            expect(result.status).toBe('ready');
            if (result.status === 'ready') {
                expect(result.findings.filter(item => item.code === 'session_replacement_declared')).toEqual([{
                    kind: 'session_replacement', code: 'session_replacement_declared', date: '2026-08-18',
                    detail: 'New ride replaces Old ride from revision 1. Old ride stays on its date and is marked as replaced.',
                }]);
            }
        });

        it('uses the earlier session’s moved date from its current placement', async () => {
            reads.activePlan.mockResolvedValue({ status: 'AVAILABLE', data: { plan: previous,
                placement: { assignments: [{ sessionId: 'old-ride', date: '2026-08-20', status: 'moved' }] } } });
            const result = await preflightExternalPlanImport('u1', next as never, plan.startDate, '2026-08-16', previous as never);
            expect(result.status === 'ready' && result.findings.find(item => item.code === 'session_replacement_declared')?.date).toBe('2026-08-20');
        });

        it('allows an identical same-revision retry without revalidating its old declarations', async () => {
            const result = await preflightExternalPlanImport('u1', next as never, plan.startDate, '2026-08-16', next as never);
            expect(result.status).toBe('ready');
        });

        it('does not treat changed content in the same revision as an identical retry', async () => {
            const changed = { ...next, title: 'Changed' };
            const result = await preflightExternalPlanImport('u1', changed as never, plan.startDate, '2026-08-16', next as never);
            expect(result.status).toBe('invalid_replacements');
        });

        it('blocks replacing a session before the activation boundary', async () => {
            const result = await preflightExternalPlanImport('u1', next as never, '2026-08-19', '2026-08-16', previous as never);
            expect(result).toMatchObject({ status: 'invalid_replacements', issues: [{ code: 'replaced-session-before-effective-date' }] });
        });

        it('checks the moved date against the boundary instead of the authored date', async () => {
            reads.activePlan.mockResolvedValue({ status: 'AVAILABLE', data: { plan: previous,
                placement: { assignments: [{ sessionId: 'old-ride', date: '2026-08-17', status: 'moved' }] } } });
            const rejected = await preflightExternalPlanImport('u1', next as never, '2026-08-18', '2026-08-16', previous as never);
            expect(rejected).toMatchObject({ status: 'invalid_replacements', issues: [{ code: 'replaced-session-before-effective-date' }] });
            reads.activePlan.mockResolvedValue({ status: 'AVAILABLE', data: { plan: previous,
                placement: { assignments: [{ sessionId: 'old-ride', date: '2026-08-19', status: 'moved' }] } } });
            const accepted = await preflightExternalPlanImport('u1', next as never, '2026-08-19', '2026-08-16', previous as never);
            expect(accepted.status).toBe('ready');
        });

        it('blocks a declaration that names a session missing from the previous revision', async () => {
            const ghost = { ...next, sessions: [{ ...next.sessions[0], replacesSessionId: 'ghost' }] };
            const result = await preflightExternalPlanImport('u1', ghost as never, plan.startDate, '2026-08-16', previous as never);
            expect(result).toEqual({ status: 'invalid_replacements', issues: [{
                code: 'replaced-session-not-found', field: 'sessions[0].replacesSessionId', sessionId: 'new-ride', replacesSessionId: 'ghost',
            }] });
            expect(reads.fixed).not.toHaveBeenCalled();
        });

        it('blocks a declaration when there is no previous revision', async () => {
            const result = await preflightExternalPlanImport('u1', next as never, plan.startDate, '2026-08-16', null);
            expect(result).toMatchObject({ status: 'invalid_replacements', issues: [{ code: 'replacement-previous-revision-missing' }] });
        });

        it('blocks replacing a session the current placement records as completed', async () => {
            reads.activePlan.mockResolvedValue({ status: 'AVAILABLE', data: { plan: previous,
                placement: { assignments: [{ sessionId: 'old-ride', date: '2026-08-18', status: 'completed' }] } } });
            const result = await preflightExternalPlanImport('u1', next as never, plan.startDate, '2026-08-16', previous as never);
            expect(result).toMatchObject({ status: 'invalid_replacements', issues: [{
                code: 'replaced-session-completed', field: 'sessions[0].replacesSessionId', replacesSessionId: 'old-ride',
            }] });
        });

        it('adds nothing for a revision without declarations', async () => {
            const plain = { ...next, sessions: [{ ...plan.sessions[0], id: 'new-ride', title: 'Old ride' }] };
            const result = await preflightExternalPlanImport('u1', plain as never, plan.startDate, '2026-08-16', previous as never);
            expect(result.status === 'ready' && result.findings.some(item => item.kind === 'session_replacement')).toBe(false);
        });
    });

    it('rejects effective dates before today', async () => {
        expect(await preflightExternalPlanImport('u1', plan as never, '2026-08-15', '2026-08-16'))
            .toEqual({ status: 'invalid_date' });
        expect(reads.fixed).not.toHaveBeenCalled();
    });
});
