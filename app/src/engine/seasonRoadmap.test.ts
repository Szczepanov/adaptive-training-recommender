import { describe, expect, it } from 'vitest';
import { evaluatePeriodizationPhase, goalToUserEvent } from './periodization';
import {
    describeSeasonRoadmap,
    resolveSeasonRoadmap,
    SEASON_B_PLUS_STAR_PRIORITY,
    SEASON_OUTCOME_LOOKBACK_DAYS,
    SEASON_PEAK_RECOVERY_GAP_DAYS,
} from './seasonRoadmap';
import type { UserEvent } from './models';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';

const DEMAND = {
    aerobicEndurance: 0.8, thresholdPower: 0.7, vo2MaxPower: 0.5, repeatedSurges: 0.5,
    sprintPower: 0.2, fatigueResistance: 0.8, neuromuscular: 0.3,
};

function event(overrides: Partial<UserEvent> & Pick<UserEvent, 'id' | 'date' | 'priority'>): UserEvent {
    return { title: overrides.id, lifecycle: 'scheduled', category: 'cycling_event', demandProfile: DEMAND, ...overrides };
}

const AS_OF = '2026-06-01';
const A = event({ id: 'a-gran-fondo', date: '2026-09-12', priority: 'A' });
const B_PLUS = event({ id: 'b-plus-stage', date: '2026-07-18', priority: 'B', starPriority: 4 });
const B = event({ id: 'b-club', date: '2026-07-04', priority: 'B', starPriority: 3 });
const C = event({ id: 'c-crit', date: '2026-06-20', priority: 'C', starPriority: 1 });

describe('resolveSeasonRoadmap', () => {
    it('produces one coherent A+B+/B/C roadmap with the distant A as primary', () => {
        const roadmap = resolveSeasonRoadmap([C, A, B, B_PLUS], AS_OF);
        expect(roadmap.primaryEventId).toBe('a-gran-fondo');
        expect(roadmap.entries.map(entry => [entry.eventId, entry.role])).toEqual([
            ['a-gran-fondo', 'primary_peak'],
            ['b-club', 'benchmark'],
            ['b-plus-stage', 'benchmark_peak'],
            ['c-crit', 'train_through'],
        ]);
        expect(roadmap.conflicts).toEqual([]);
    });

    it('is independent of input order', () => {
        const forward = resolveSeasonRoadmap([A, B_PLUS, B, C], AS_OF);
        const reversed = resolveSeasonRoadmap([C, B, B_PLUS, A], AS_OF);
        expect(reversed).toEqual(forward);
    });

    it('derives B+ from the star control only, never from a 3-star B', () => {
        expect(SEASON_B_PLUS_STAR_PRIORITY).toBe(4);
        const roles = resolveSeasonRoadmap([A, B], AS_OF).entries.map(entry => entry.role);
        expect(roles).toEqual(['primary_peak', 'benchmark']);
        const fromGoal = goalToUserEvent({
            id: 'g', title: 'Stage race', targetDate: '2026-07-18', priority: 4, status: 'active', eventCategory: 'cycling_event',
        } as never);
        expect(fromGoal).toMatchObject({ priority: 'B', starPriority: 4 });
    });

    it('agrees with evaluatePeriodizationPhase on the primary target', () => {
        const secondA = event({ id: 'a2', date: '2026-08-01', priority: 'A' });
        for (const events of [[A, B, C], [B, C], [C], [B_PLUS, A], [secondA, A]]) {
            for (const date of ['2026-06-01', '2026-07-30', '2026-09-10']) {
                const roadmap = resolveSeasonRoadmap(events, date);
                const periodization = evaluatePeriodizationPhase(events, date);
                expect(roadmap.primaryEventId).toBe(periodization.focusEvent?.id ?? null);
            }
        }
    });

    it('excludes cancelled, DNS, rescheduled and stale events and keeps recent completed outcomes', () => {
        const done = event({ id: 'done-b', date: '2026-05-20', priority: 'B', lifecycle: 'completed' });
        const old = event({ id: 'old-b', date: '2026-04-01', priority: 'B', lifecycle: 'completed' });
        const dnf = event({ id: 'dnf-b', date: '2026-05-25', priority: 'B', lifecycle: 'DNF' });
        const stale = event({ id: 'stale', date: '2026-05-01', priority: 'C' });
        const cancelled = event({ id: 'cancelled', date: '2026-06-10', priority: 'A', lifecycle: 'cancelled' });
        const roadmap = resolveSeasonRoadmap([A, done, old, dnf, stale, cancelled], AS_OF);
        expect(roadmap.entries.map(entry => [entry.eventId, entry.status])).toEqual([
            ['a-gran-fondo', 'upcoming'], ['done-b', 'completed'], ['dnf-b', 'dnf'],
        ]);
        expect(SEASON_OUTCOME_LOOKBACK_DAYS).toBe(28);
    });

    it('is empty without upcoming events', () => {
        expect(resolveSeasonRoadmap([], AS_OF)).toMatchObject({ primaryEventId: null, entries: [], conflicts: [] });
    });
});

describe('season conflicts', () => {
    it('gives an exact shared date one deterministic owner and a typed conflict', () => {
        const twin = event({ id: 'a-twin', date: '2026-09-12', priority: 'A' });
        const roadmap = resolveSeasonRoadmap([twin, A], AS_OF);
        const owners = roadmap.entries.filter(entry => entry.dateOwner).map(entry => entry.eventId);
        expect(owners).toEqual(['a-gran-fondo']);
        expect(roadmap.conflicts).toEqual([expect.objectContaining({
            kind: 'same_day_authority', severity: 'blocking', date: '2026-09-12', eventIds: ['a-gran-fondo', 'a-twin'],
        })]);
    });

    it('flags a supporting event inside a peak taper', () => {
        const inside = event({ id: 'b-in-taper', date: '2026-09-09', priority: 'B', starPriority: 3 });
        const craft = event({ id: 'c-in-taper', date: '2026-09-10', priority: 'C' });
        const roadmap = resolveSeasonRoadmap([A, inside, craft], AS_OF);
        expect(roadmap.conflicts.map(conflict => [conflict.kind, conflict.severity, conflict.eventIds[1]])).toEqual([
            ['inside_peak_taper', 'blocking', 'b-in-taper'],
            ['inside_peak_taper', 'advisory', 'c-in-taper'],
        ]);
    });

    it('flags two peaks without room to recover between them', () => {
        // A (Sat 2026-09-12) tapers from Monday 2026-09-07; a B+ on 09-03 leaves 4 days.
        const tight = event({ id: 'b-plus-tight', date: '2026-09-03', priority: 'B', starPriority: 4 });
        const roadmap = resolveSeasonRoadmap([A, tight], AS_OF);
        expect(SEASON_PEAK_RECOVERY_GAP_DAYS).toBe(7);
        expect(roadmap.conflicts).toEqual([expect.objectContaining({
            kind: 'insufficient_peak_recovery', severity: 'blocking', eventIds: ['b-plus-tight', 'a-gran-fondo'],
        })]);
        const roomy = event({ id: 'b-plus-roomy', date: '2026-08-15', priority: 'B', starPriority: 4 });
        expect(resolveSeasonRoadmap([A, roomy], AS_OF).conflicts).toEqual([]);
    });

    it('treats an A and a same-day C as advisory, and two benchmarks as blocking', () => {
        const craft = event({ id: 'c-same-day', date: '2026-09-12', priority: 'C' });
        expect(resolveSeasonRoadmap([A, craft], AS_OF).conflicts[0]).toMatchObject({ kind: 'same_day_authority', severity: 'advisory' });
        const clubA = event({ id: 'b-a', date: '2026-07-04', priority: 'B' });
        const clubB = event({ id: 'b-b', date: '2026-07-04', priority: 'B' });
        expect(resolveSeasonRoadmap([clubA, clubB], AS_OF).conflicts[0]).toMatchObject({ severity: 'blocking' });
    });

    it('checks peak recovery against the date when the later peak has no taper', () => {
        const target = (id: string, date: string) => event({ id, date, priority: 'A', category: 'general_target' });
        const roadmap = resolveSeasonRoadmap([target('t1', '2026-08-01'), target('t2', '2026-08-04')], AS_OF);
        expect(roadmap.conflicts).toEqual([expect.objectContaining({ kind: 'insufficient_peak_recovery', eventIds: ['t1', 't2'] })]);
    });

    it('diverges from the focus event only inside the post-event recovery window', () => {
        const raced = event({ id: 'a-raced', date: '2026-09-12', priority: 'A', lifecycle: 'completed' });
        const next = event({ id: 'c-next', date: '2026-09-20', priority: 'C' });
        expect(evaluatePeriodizationPhase([raced, next], '2026-09-13').focusEvent?.id).toBe('a-raced');
        expect(resolveSeasonRoadmap([raced, next], '2026-09-13').primaryEventId).toBe('c-next');
    });

    it('describes each role and conflict for the Context Brief', () => {
        const twin = event({ id: 'c-twin', date: '2026-06-20', priority: 'C' });
        const text = describeSeasonRoadmap(resolveSeasonRoadmap([A, C, twin], AS_OF)).join('\n');
        expect(text).toContain('primary season target');
        expect(text).toContain('race craft / train-through');
        expect(text).toContain('yields this date');
        expect(text).toContain('Season conflict (advisory)');
    });
});

describe('season roadmap policy alignment (ADR-0033)', () => {
    it('keeps the registered claim and the implemented constants in step', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.seasonRoadmapPolicy);
        expect(claim).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable' });
        expect(claim.statement).toContain(`${SEASON_B_PLUS_STAR_PRIORITY}-star-or-higher B event is a benchmark peak`);
        expect(claim.statement).toContain(`fewer than ${SEASON_PEAK_RECOVERY_GAP_DAYS} days`);
        expect(claim.statement).toContain(`stay in the roadmap for ${SEASON_OUTCOME_LOOKBACK_DAYS} days`);
    });
});
