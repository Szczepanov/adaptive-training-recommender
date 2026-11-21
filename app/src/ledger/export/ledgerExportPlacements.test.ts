import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { AS_OF, fullInput, fullRecords, withExtra } from './ledgerExportFixtures.testSupport.ts';
import type { PlacementInput, PlanRevisionInput } from './inputs.ts';
import { PLACEMENT_FORWARD_DAYS } from './window.ts';

const assignments = (dates: Record<string, string>): PlacementInput['assignments'] =>
    Object.entries(dates).map(([sessionId, date]) => ({ sessionId, date, status: 'planned' as const }));

const withPlacements = (purpose: 'morning' | 'planning' | 'diagnostic', dates: Record<string, string>,
    revisions?: readonly PlanRevisionInput[]) => buildLedgerExport(fullInput({
    purpose,
    records: {
        ...fullRecords(),
        ...(revisions ? { planRevisions: revisions } : {}),
        placements: [{ planId: 'plan-1', revision: 2, assignments: assignments(dates) }],
    },
}));

const ids = (result: ReturnType<typeof withPlacements>) => result.coachingHistory.placements.items.map(i => i.fields.sessionId.value);

const REVISION: PlanRevisionInput = {
    planId: 'plan-1', revision: 2, contentHash: 'sha256:abc', importedAt: '2026-11-10T08:00:00Z',
    schema: 'adaptive-training-recommender/external-plan@6',
    sessions: [
        { id: 's1', title: 'Tempo ride', priority: 'key', summary: '3x10 at threshold', stepNotes: ['Stay seated', 'Cadence 90'], fallback: 'Easy spin' },
        { id: 's2', title: 'Recovery' },
    ],
};

describe('upcoming placements (forward window)', () => {
    it('declares the forward days per purpose', () => {
        expect(PLACEMENT_FORWARD_DAYS).toEqual({ morning: 7, planning: 14, diagnostic: 0 });
    });

    it('includes a placement dated asOfDate+7 in morning and excludes +8', () => {
        const result = withPlacements('morning', { in7: '2026-11-27', out8: '2026-11-28' });
        expect(AS_OF).toBe('2026-11-20');
        expect(ids(result)).toEqual(['in7']);
    });

    it('planning reaches asOfDate+14', () => {
        const result = withPlacements('planning', { in14: '2026-12-04', out15: '2026-12-05' });
        expect(ids(result)).toEqual(['in14']);
    });

    it('does not extend diagnostic forward', () => {
        expect(ids(withPlacements('diagnostic', { today: AS_OF, next: '2026-11-21' }))).toEqual(['today']);
    });

    it('keeps overrides on the historical bounds', () => {
        const result = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: { ...fullRecords(), placements: [{ planId: 'plan-1', revision: 2,
                assignments: [{ sessionId: 'future', date: '2026-11-25', status: 'moved' }] }] },
        }));
        expect(ids(result)).toEqual(['future']);
        expect(result.coachingHistory.overrides.items.filter(item => !item.id.startsWith('choice:'))).toEqual([]);
    });

    it('counts out-of-window placements in droppedOutOfWindow', () => {
        const result = withPlacements('morning', { old: '2026-09-01', in7: '2026-11-27', out8: '2026-11-28', out9: '2026-11-29' });
        expect(result.coachingHistory.placements.droppedOutOfWindow).toBe(3);
        expect(result.coachingHistory.overrides.droppedOutOfWindow).toBeUndefined();
    });
});

describe('placement session content', () => {
    const item = (result: ReturnType<typeof withPlacements>, id: string) =>
        result.coachingHistory.placements.items.find(i => i.fields.sessionId.value === id)!.fields;

    it('joins title, priority, summary, stepNotes and fallback from the plan revision', () => {
        const fields = item(withPlacements('morning', { s1: '2026-11-21', s2: '2026-11-22' }, [REVISION]), 's1');
        expect(fields.title).toMatchObject({ value: 'Tempo ride', state: 'measured' });
        expect(fields.priority).toMatchObject({ value: 'key', state: 'measured' });
        expect(fields.summary).toMatchObject({ value: '3x10 at threshold', state: 'measured' });
        expect(fields.stepNotes).toMatchObject({ value: ['Stay seated', 'Cadence 90'], state: 'measured' });
        expect(fields.fallback).toMatchObject({ value: 'Easy spin', state: 'measured' });
    });

    it('marks absent optional content not_recorded', () => {
        const fields = item(withPlacements('morning', { s1: '2026-11-21', s2: '2026-11-22' }, [REVISION]), 's2');
        expect(fields.title.state).toBe('measured');
        for (const key of ['priority', 'summary', 'stepNotes', 'fallback'] as const) {
            expect(fields[key]).toMatchObject({ value: null, state: 'not_recorded' });
        }
    });

    it('marks a session missing from its revision not_recorded', () => {
        const fields = item(withPlacements('morning', { gone: '2026-11-21' }, [REVISION]), 'gone');
        expect(fields.title).toMatchObject({ value: null, state: 'not_recorded' });
    });

    it('marks content unavailable when the revision is not exported and the source is healthy', () => {
        const fields = item(withPlacements('morning', { s1: '2026-11-21' }, []), 's1');
        expect(fields.title).toMatchObject({ value: null, state: 'unavailable' });
        expect(fields.stepNotes.state).toBe('unavailable');
    });

    it('marks content invalid when the revision failed verification', () => {
        const result = buildLedgerExport(fullInput({
            purpose: 'morning',
            sources: { external_plan_revisions: { state: 'invalid', readAt: '2026-11-20T06:00:00Z' } },
            records: { ...fullRecords(), planRevisions: [],
                placements: [{ planId: 'plan-1', revision: 2, assignments: assignments({ s1: '2026-11-21' }) }] },
        }));
        expect(item(result, 's1').title).toMatchObject({ value: null, state: 'invalid' });
        expect(item(result, 's1').fallback.state).toBe('invalid');
    });

    it('redacts identity tokens in authored content like other free text', () => {
        const revision = { ...REVISION, sessions: [{ id: 's1', title: 'Ride for owner-secret', summary: 'mail a@b.com' }] };
        const result = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: { ...withExtra(fullRecords(), { userId: 'owner-secret' }), planRevisions: [revision],
                placements: [{ planId: 'plan-1', revision: 2, assignments: assignments({ s1: '2026-11-21' }) }] },
        }));
        expect(JSON.stringify(result)).not.toMatch(/owner-secret|a@b\.com/);
    });
});

describe('revisions referenced only by a future placement', () => {
    const OLDER: PlanRevisionInput = { ...REVISION, revision: 1, contentHash: 'sha256:old', importedAt: '2026-10-01T08:00:00Z',
        sessions: [{ id: 'old-1', title: 'Old plan ride', summary: 'Kept from revision 1' }] };
    const LATEST: PlanRevisionInput = { ...REVISION, sessions: [] };
    const build = (purpose: 'morning' | 'planning', date: string, revisions: readonly PlanRevisionInput[] = [OLDER, LATEST]) =>
        buildLedgerExport(fullInput({
            purpose,
            records: { ...fullRecords(), planRevisions: revisions, plannedToPerformed: [],
                placements: [{ planId: 'plan-1', revision: 1, assignments: [{ sessionId: 'old-1', date, status: 'planned' }] }] },
        }));

    it.each([['morning', '2026-11-27'], ['planning', '2026-12-04']] as const)(
        'exports the %s placement content and the revision-1 header at the inclusive forward bound', (purpose, date) => {
            const result = build(purpose, date);
            const [placement] = result.coachingHistory.placements.items;
            expect(placement.fields).toMatchObject({ revision: { value: 1 }, title: { value: 'Old plan ride', state: 'measured' },
                summary: { value: 'Kept from revision 1' } });
            expect(result.coachingHistory.planRevisions.items.map(row => row.id)).toEqual(['plan-1@1', 'plan-1@2']);
        });

    it('does not retain the older revision when its only placement is past the forward bound', () => {
        const result = build('morning', '2026-11-28');
        expect(result.coachingHistory.placements.items).toEqual([]);
        expect(result.coachingHistory.planRevisions.items.map(row => row.id)).toEqual(['plan-1@2']);
    });

    it('keeps content unavailable when the older revision could not be read', () => {
        const result = build('morning', '2026-11-25', [LATEST]);
        expect(result.coachingHistory.placements.items[0].fields.title).toMatchObject({ value: null, state: 'unavailable' });
        expect(result.coachingHistory.planRevisions.items.map(row => row.id)).toEqual(['plan-1@2']);
    });

    it('degrades only an unverified legacy-overlay revision while keeping verified revisions and outcomes intact', () => {
        const unverifiedLatest: PlanRevisionInput = { ...REVISION, revision: 3, contentHash: 'sha256:bad', importedAt: '2026-11-20T08:00:00Z' };
        const result = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: {
                ...fullRecords(),
                planRevisions: [OLDER, REVISION, unverifiedLatest],
                unverifiedPlanRevisions: [{ planId: 'plan-1', revision: 1 }, { planId: 'plan-1', revision: 3 }],
                plannedToPerformed: [],
                planExecutions: [],
                placements: [
                    { planId: 'plan-1', revision: 1, assignments: [{ sessionId: 'old-1', date: '2026-11-19', status: 'planned' }] },
                    { planId: 'plan-1', revision: 2, assignments: [{ sessionId: 's1', date: '2026-11-19', status: 'planned' }] },
                ],
            },
        }));
        expect(result.coachingHistory.planRevisions.state).toBe('measured');
        expect(result.coachingHistory.planRevisions.items.map(row => row.id)).toEqual(['plan-1@2']);
        const unverified = result.coachingHistory.placements.items.find(i => i.id === 'plan-1@1:old-1')!;
        expect(unverified.fields.title).toMatchObject({ value: null, state: 'unavailable' });
        expect(unverified.fields.outcome.value).toBe('unknown');

        const verified = result.coachingHistory.placements.items.find(i => i.id === 'plan-1@2:s1')!;
        expect(verified.fields.title).toMatchObject({ value: 'Tempo ride', state: 'measured' });
        expect(verified.fields.outcome.value).toBe('missed');
    });
});

describe('placement events stay cut off at asOfDate', () => {
    it('omits a status change recorded after asOfDate from a future placement', () => {
        const event = (changedOn: string, date: string) => ({
            userId: 'u', planId: 'plan-1', revision: 2, changedOn, recordedAt: `${changedOn}T08:00:00Z`,
            previous: [{ sessionId: 's3', date: '2026-11-21', status: 'planned' as const }],
            assignments: [{ sessionId: 's3', date, status: 'moved' as const }], successors: {},
        });
        const result = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: { ...fullRecords(), placementHistory: [event('2026-11-19', '2026-11-22'), event('2026-11-21', '2026-11-24')] },
        }));
        const s3 = result.coachingHistory.placements.items.find(row => row.fields.sessionId.value === 's3')!;
        // The as-of state is the 2026-11-19 change; the later move is not visible yet.
        expect(s3.observedOn).toBe('2026-11-22');
        const history = s3.fields.statusHistory.value as { changedOn: string }[];
        expect(history.map(item => item.changedOn)).toEqual(['2026-11-19']);
    });
});
