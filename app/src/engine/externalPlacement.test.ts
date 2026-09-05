import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyConfirmedProposal, impliedDate, proposeReplacement, resolvePlacement, resolveRestDate, resolveRestDatesByDate } from './externalPlacement';
import { EXTERNAL_PLAN_SCHEMA } from './models';
import type { ExternalPlanPlacement, ExternalPlanSession, ExternalRestDirective, ExternalTrainingPlan, FixedActivity } from './models';

const MONDAY = '2026-08-17';

function session(id: string, overrides: Partial<ExternalPlanSession> = {}): ExternalPlanSession {
    return {
        id, title: id, priority: 'supporting',
        placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60, environment: 'either', equipment: [] },
        prescription: { summary: 'x' },
        ...overrides,
    };
}

function plan(sessions: ExternalPlanSession[], weekCount = 2): ExternalTrainingPlan {
    return {
        schema: EXTERNAL_PLAN_SCHEMA, planId: 'block', revision: 1, title: 'Block',
        startDate: MONDAY, weekCount, sessions,
    };
}

function overlay(assignments: ExternalPlanPlacement['assignments']): ExternalPlanPlacement {
    return { userId: 'u1', planId: 'block', revision: 1, assignments, updatedAt: '2026-08-17T06:00:00Z' };
}

/** ADR-0035: a v3 plan is structurally an `ExternalTrainingPlan` plus `restDays` --
 * `resolvePlacement`/`proposeReplacement` are typed against `AnyExternalTrainingPlan`
 * (which includes v3), so this fixture is enough to exercise them without importing the
 * real v3 schema module. */
function planV3(sessions: ExternalPlanSession[], restDays: ExternalRestDirective[], weekCount = 2): ExternalTrainingPlan & { restDays: ExternalRestDirective[] } {
    return { ...plan(sessions, weekCount), restDays };
}

function fixedActivity(date: string): FixedActivity {
    return {
        id: `fa-${date}`, userId: 'u1', title: 'Match', date, durationMin: 90,
        fixed: true, environment: 'outdoor', equipment: [], isCompleted: false,
        createdAt: '', updatedAt: '',
    };
}

describe('resolvePlacement', () => {
    it('resolves week and preferred day against the plan start date', () => {
        const tuesdayWeek2 = session('s1', { placement: { week: 2, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' } });
        expect(impliedDate(plan([tuesdayWeek2]), tuesdayWeek2)).toBe('2026-08-25');
    });

    it('places a session with no preferred day on its week\'s Monday', () => {
        const anyDay = session('s1', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' } });
        expect(resolvePlacement(plan([anyDay]), null)[0].date).toBe(MONDAY);
    });

    it('lets the stored overlay win over the plan\'s own preference', () => {
        const s1 = session('s1', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' } });
        const placed = resolvePlacement(plan([s1]), overlay([{ sessionId: 's1', date: '2026-08-20', status: 'moved' }]));

        expect(placed[0].date).toBe('2026-08-20');
        expect(placed[0].moved).toBe(true);
        expect(placed[0].status).toBe('moved');
    });

    it('keeps multiple sessions on the same preferred day (double and triple days)', () => {
        const easyAerobic = session('easy-aerobic', {
            title: 'Easy Aerobic Volume',
            placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
        });
        const strengthMaint = session('upper-strength', {
            title: 'Upper-Body Strength Maintenance',
            placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
        });
        const mobility = session('evening-mobility', {
            title: 'Evening Hip & Spine Mobility',
            placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'mobility', intensity: 'recovery', durationMin: 15, durationMax: 25, environment: 'indoor', equipment: [] },
        });
        const placed = resolvePlacement(plan([easyAerobic, strengthMaint, mobility]), null);

        expect(placed.length).toBe(3);
        expect(placed.every(item => item.date === '2026-08-20')).toBe(true);
        expect(placed.every(item => item.moved === false)).toBe(true);
        expect(placed.every(item => item.status === 'planned')).toBe(true);
    });

    it('spreads an unanchored any_day session off a day that already has a preferred session', () => {
        const preferred = session('preferred', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' } });
        const floating = session('floating', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' } });
        const placed = resolvePlacement(plan([floating, preferred]), null);

        expect(placed.find(item => item.session.id === 'preferred')!.date).toBe(MONDAY);
        expect(placed.find(item => item.session.id === 'floating')!.date).not.toBe(MONDAY);
    });

    it('never moves a fixed session, even onto a free day', () => {
        const a = session('a', { placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed', ifMissed: 'drop' } });
        const b = session('b', { placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed', ifMissed: 'drop' } });
        const placed = resolvePlacement(plan([a, b]), null);

        expect(placed.every(item => item.date === MONDAY)).toBe(true);
        expect(placed.every(item => item.moved === false)).toBe(true);
    });

    it('treats an uncompleted fixed activity as occupying its day for floating any_day sessions', () => {
        const floating = session('s1', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' } });
        const placed = resolvePlacement(plan([floating]), null, { fixedActivities: [fixedActivity(MONDAY)] });

        expect(placed[0].date).not.toBe(MONDAY);
    });

    it('ignores a completed fixed activity, whose day is free again for floating sessions', () => {
        const floating = session('s1', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' } });
        const done = { ...fixedActivity(MONDAY), isCompleted: true };
        expect(resolvePlacement(plan([floating]), null, { fixedActivities: [done] })[0].date).toBe(MONDAY);
    });

    it('keeps a moved session holding its new date', () => {
        const moved = session('moved', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' } });
        const other = session('other', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' } });
        const placed = resolvePlacement(plan([moved, other]), overlay([{ sessionId: 'moved', date: '2026-08-19', status: 'moved' }]));

        expect(placed.find(item => item.session.id === 'moved')!.date).toBe('2026-08-19');
        expect(placed.find(item => item.session.id === 'other')!.date).toBe(MONDAY);
    });

    it('frees the date of a dropped session for floating sessions', () => {
        const dropped = session('dropped', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' } });
        const other = session('other', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' } });
        const placed = resolvePlacement(plan([dropped, other]), overlay([{ sessionId: 'dropped', date: MONDAY, status: 'dropped' }]));

        expect(placed.find(item => item.session.id === 'other')!.date).toBe(MONDAY);
    });

    it('spreads floating sessions forward within the week, never backwards into the past', () => {
        const saturdayFixed = session('fixed', { placement: { week: 1, preferredDay: 'saturday', flexibility: 'fixed', ifMissed: 'drop' } });
        const mondayFixed = session('mon', { placement: { week: 1, preferredDay: 'monday', flexibility: 'fixed', ifMissed: 'drop' } });
        const tueFixed = session('tue', { placement: { week: 1, preferredDay: 'tuesday', flexibility: 'fixed', ifMissed: 'drop' } });
        const wedFixed = session('wed', { placement: { week: 1, preferredDay: 'wednesday', flexibility: 'fixed', ifMissed: 'drop' } });
        const thuFixed = session('thu', { placement: { week: 1, preferredDay: 'thursday', flexibility: 'fixed', ifMissed: 'drop' } });
        const friFixed = session('fri', { placement: { week: 1, preferredDay: 'friday', flexibility: 'fixed', ifMissed: 'drop' } });
        const floating = session('flex', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' } });
        const placed = resolvePlacement(plan([saturdayFixed, mondayFixed, tueFixed, wedFixed, thuFixed, friFixed, floating]), null);

        expect(placed.find(item => item.session.id === 'flex')!.date).toBe('2026-08-23');
    });
});

describe('resolveRestDate / resolveRestDatesByDate (ADR-0035)', () => {
    it('resolves a rest directive relative to the plan start date, same as impliedDate does for a session', () => {
        const directive: ExternalRestDirective = { id: 'w1-fri', week: 1, day: 'friday' };
        expect(resolveRestDate(plan([]), directive)).toBe('2026-08-21');
    });

    it('resolves every directive on a v3 plan, keyed by date', () => {
        const restDays: ExternalRestDirective[] = [
            { id: 'w1-fri', week: 1, day: 'friday' },
            { id: 'w2-sun', week: 2, day: 'sunday' },
        ];
        const resolved = resolveRestDatesByDate(planV3([], restDays));
        expect([...resolved.keys()].sort()).toEqual(['2026-08-21', '2026-08-30']);
        expect(resolved.get('2026-08-21')).toEqual(restDays[0]);
    });

    it('returns an empty map for a v1/v2 plan with no restDays field at all', () => {
        expect(resolveRestDatesByDate(plan([])).size).toBe(0);
    });
});

describe('resolvePlacement with an authored rest date (ADR-0035)', () => {
    it('spreads a floating any_day session off a date a rest directive owns', () => {
        const s = session('s1', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'reschedule_within_week' } });
        // s1 has no preferredDay, so its implied date is the week's Monday (2026-08-17) --
        // exactly the date the rest directive below closes.
        const restDays: ExternalRestDirective[] = [{ id: 'w1-mon-rest', week: 1, day: 'monday' }];
        const placed = resolvePlacement(planV3([s], restDays), null);
        expect(placed[0].date).not.toBe('2026-08-17');
        expect(placed[0].moved).toBe(true);
    });

    it('moves a preferred bundle off its wanted date when a rest directive owns it', () => {
        const s = session('s1', { placement: { week: 1, preferredDay: 'friday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' } });
        const restDays: ExternalRestDirective[] = [{ id: 'w1-fri-rest', week: 1, day: 'friday' }];
        const placed = resolvePlacement(planV3([s], restDays), null);
        expect(placed[0].date).not.toBe('2026-08-21');
    });

    it('does not block a fixed session -- a fixed/rest conflict is rejected at import, not resolved here', () => {
        const s = session('s1', { placement: { week: 1, preferredDay: 'friday', flexibility: 'fixed', ifMissed: 'drop' } });
        const restDays: ExternalRestDirective[] = [{ id: 'w1-fri-rest', week: 1, day: 'friday' }];
        const placed = resolvePlacement(planV3([s], restDays), null);
        expect(placed[0].date).toBe('2026-08-21');
    });

    it('does not block an explicit overlay assignment -- a confirmed athlete override wins', () => {
        const s = session('s1', { placement: { week: 1, flexibility: 'any_day', ifMissed: 'reschedule_within_week' } });
        const restDays: ExternalRestDirective[] = [{ id: 'w1-fri-rest', week: 1, day: 'friday' }];
        const placed = resolvePlacement(
            planV3([s], restDays),
            overlay([{ sessionId: 's1', date: '2026-08-21', status: 'planned' }]),
        );
        expect(placed[0].date).toBe('2026-08-21');
    });
});

describe('proposeReplacement', () => {
    it('drops a session whose plan says to let it go', () => {
        const s1 = session('s1', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' } });
        const proposal = proposeReplacement(plan([s1]), null, 's1', MONDAY);

        expect(proposal.outcome).toBe('dropped');
        expect(proposal.date).toBeUndefined();
    });

    it('reschedules within the week when the plan asks for that', () => {
        const s1 = session('s1', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' } });
        const proposal = proposeReplacement(plan([s1]), null, 's1', MONDAY);

        expect(proposal.outcome).toBe('rescheduled');
        expect(proposal.date).toBe('2026-08-18');
    });

    it('does not cross a week boundary for reschedule_within_week', () => {
        const sunday = session('s1', { placement: { week: 1, preferredDay: 'sunday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' } });
        const proposal = proposeReplacement(plan([sunday]), null, 's1', '2026-08-23');

        expect(proposal.outcome).toBe('dropped');
        expect(proposal.rationale).toContain('does not carry it forward');
    });

    it('crosses a week boundary for carry_forward', () => {
        const sunday = session('s1', { placement: { week: 1, preferredDay: 'sunday', flexibility: 'preferred', ifMissed: 'carry_forward' } });
        const proposal = proposeReplacement(plan([sunday]), null, 's1', '2026-08-23');

        expect(proposal.outcome).toBe('rescheduled');
        expect(proposal.date).toBe('2026-08-24');
    });

    it('reports unresolved rather than forcing a session past the plan\'s end', () => {
        const last = session('s1', { placement: { week: 1, preferredDay: 'sunday', flexibility: 'preferred', ifMissed: 'carry_forward' } });
        const proposal = proposeReplacement(plan([last], 1), null, 's1', '2026-08-23');

        expect(proposal.outcome).toBe('unresolved');
        expect(proposal.rationale).toContain('Re-plan');
    });

    it('does not propose a day another session already holds', () => {
        const missed = session('missed', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' } });
        const tuesday = session('tuesday', { placement: { week: 1, preferredDay: 'tuesday', flexibility: 'fixed', ifMissed: 'drop' } });
        const proposal = proposeReplacement(plan([missed, tuesday]), null, 'missed', MONDAY);

        expect(proposal.date).not.toBe('2026-08-18');
    });

    it('does not propose a day a booked commitment already owns', () => {
        const missed = session('missed', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' } });
        const proposal = proposeReplacement(plan([missed]), null, 'missed', MONDAY, { fixedActivities: [fixedActivity('2026-08-18')] });

        expect(proposal.date).not.toBe('2026-08-18');
    });

    it('reports an unknown session id rather than inventing a placement', () => {
        expect(proposeReplacement(plan([session('s1')]), null, 'ghost', MONDAY).outcome).toBe('unresolved');
    });

    it('does not propose a day an authored rest directive already owns (ADR-0035)', () => {
        const missed = session('missed', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' } });
        const restDays: ExternalRestDirective[] = [{ id: 'w1-tue-rest', week: 1, day: 'tuesday' }];
        const proposal = proposeReplacement(planV3([missed], restDays), null, 'missed', MONDAY);

        expect(proposal.date).not.toBe('2026-08-18');
    });
});

describe('confirmation is the only writer', () => {
    it('proposing changes nothing until the proposal is applied', () => {
        const s1 = session('s1', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' } });
        const stored = overlay([{ sessionId: 's1', date: MONDAY, status: 'planned' }]);
        const snapshot = JSON.stringify(stored);

        const proposal = proposeReplacement(plan([s1]), stored, 's1', MONDAY);
        expect(JSON.stringify(stored)).toBe(snapshot);

        const applied = applyConfirmedProposal(stored, proposal);
        expect(applied.assignments.find(item => item.sessionId === 's1')).toMatchObject({ date: '2026-08-18', status: 'moved' });
        expect(JSON.stringify(stored)).toBe(snapshot);
    });

    it('records a dropped session as dropped rather than removing it', () => {
        const stored = overlay([{ sessionId: 's1', date: MONDAY, status: 'planned' }]);
        const applied = applyConfirmedProposal(stored, { sessionId: 's1', missedDate: MONDAY, outcome: 'dropped', rationale: 'x' });

        expect(applied.assignments).toHaveLength(1);
        expect(applied.assignments[0].status).toBe('dropped');
    });

    it('records a drop for a session that has no overlay entry yet', () => {
        const empty = overlay([]);
        const applied = applyConfirmedProposal(empty, { sessionId: 's1', missedDate: MONDAY, outcome: 'dropped', rationale: 'x' });

        expect(applied.assignments).toEqual([{ sessionId: 's1', date: MONDAY, status: 'dropped' }]);
        expect(applied.assignments.every(item => item.date !== '')).toBe(true);
    });

    it('leaves the overlay alone for an unresolved proposal', () => {
        const stored = overlay([{ sessionId: 's1', date: MONDAY, status: 'planned' }]);
        expect(applyConfirmedProposal(stored, { sessionId: 's1', missedDate: MONDAY, outcome: 'unresolved', rationale: 'x' })).toBe(stored);
    });

    it('offers today when a miss is noticed late and today is still free', () => {
        const late = session('s1', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'carry_forward' } });
        const proposal = proposeReplacement(plan([late]), null, 's1', MONDAY, {}, '2026-08-20');

        expect(proposal.outcome).toBe('rescheduled');
        expect(proposal.date).toBe('2026-08-20');
    });

    it('skips today when today is already occupied, but still never proposes the past', () => {
        const late = session('s1', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'carry_forward' } });
        const proposal = proposeReplacement(
            plan([late]), null, 's1', MONDAY,
            { fixedActivities: [fixedActivity('2026-08-20')] }, '2026-08-20',
        );

        expect(proposal.outcome).toBe('rescheduled');
        expect(proposal.date).toBe('2026-08-21');
    });

    it('carries the missed date on every proposal, whatever the outcome', () => {
        const drop = session('s1', { placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' } });
        expect(proposeReplacement(plan([drop]), null, 's1', MONDAY).missedDate).toBe(MONDAY);
        expect(proposeReplacement(plan([drop]), null, 'nope', MONDAY).missedDate).toBe(MONDAY);
    });

    it('never re-ranks or substitutes: the module imports nothing from the selection path', () => {
        const source = readFileSync(join(import.meta.dirname, 'externalPlacement.ts'), 'utf8');
        expect(source).not.toMatch(/from '\.\/optimizer'/);
        expect(source).not.toMatch(/from '\.\/planner'/);
        expect(source).not.toMatch(/from '\.\.\/services\//);
    });
});
