import { describe, expect, it } from 'vitest';
import { evaluatePeriodizationPhase, resolveMultiEventObjectives } from './periodization';
import { resolvePlannedDoseForDate } from './trainingIntent';
import {
    isValidSeasonTrace,
    seasonTrace,
    SUPPORTING_RECOVERY_POLICY,
    SUPPORTING_TAPER_MAX_VOLUME_REDUCTION,
    TRAIN_THROUGH_REPLACEMENT_LEAD_DAYS,
} from './seasonSupport';
import { trainingIntentKnowledgeRefs } from './knowledgeLineage';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';
import type { UserEvent, WeeklyObjective } from './models';

const DEMAND = {
    aerobicEndurance: 0.8, thresholdPower: 0.7, vo2MaxPower: 0.5, repeatedSurges: 0.5,
    sprintPower: 0.2, fatigueResistance: 0.8, neuromuscular: 0.3,
};
function event(overrides: Partial<UserEvent> & Pick<UserEvent, 'id' | 'date' | 'priority'>): UserEvent {
    return { title: overrides.id, lifecycle: 'scheduled', category: 'cycling_event', demandProfile: DEMAND, ...overrides };
}
const A = event({ id: 'a-gran-fondo', date: '2026-09-12', priority: 'A' });
const B = event({ id: 'b-club', date: '2026-07-04', priority: 'B', starPriority: 3 });
const B_PLUS = event({ id: 'b-plus', date: '2026-07-18', priority: 'B', starPriority: 4 });
const C = event({ id: 'c-crit', date: '2026-06-20', priority: 'C', starPriority: 1 });

function objective(key: WeeklyObjective['key'], requiredCredit: number): WeeklyObjective {
    return { id: `obj-${key}`, key, title: key, requiredCredit, targetExposures: requiredCredit, completedExposures: 0, targetStimulus: {} };
}

describe('supporting-event dose limits', () => {
    it('tapers a B proportionately inside its own taper without displacing the A-event focus', () => {
        const result = evaluatePeriodizationPhase([A, B, C], '2026-07-02');
        expect(result.focusEvent?.id).toBe('a-gran-fondo');
        expect(result.phase.phaseName).toBe('Build');
        expect(result.phase.supportingEventScale).toMatchObject({ eventId: 'b-club', kind: 'taper', role: 'benchmark' });
        // 2 days out of a 5-day taper: 60% progress of the 0.15 maximum reduction.
        expect(result.phase.volumeScale).toBeCloseTo(1 - SUPPORTING_TAPER_MAX_VOLUME_REDUCTION.benchmark * 0.6, 10);
        expect(result.phase.intensityScale).toBe(0.9);
        expect(result.phase.taperActive).toBe(false);
    });

    it('never clips intensity during a taper, including Specificity, and waits for real reduction', () => {
        const aLater = event({ id: 'a-later', date: '2026-07-20', priority: 'A' });
        const bNear = event({ id: 'b-near', date: '2026-07-10', priority: 'B' });
        const first = evaluatePeriodizationPhase([aLater, bNear], '2026-07-05');
        expect(first.phase.phaseName).toBe('Specificity');
        expect(first.phase.supportingEventScale).toBeUndefined();
        expect(first.phase.intensityScale).toBe(1.1);
        const next = evaluatePeriodizationPhase([aLater, bNear], '2026-07-06');
        expect(next.phase.supportingEventScale).toMatchObject({ kind: 'taper', intensityScale: null });
        expect(next.phase.intensityScale).toBe(1.1);
        expect(next.phase.volumeScale).toBeLessThan(1);
    });

    it('does not touch the dose outside the supporting taper or for a C race', () => {
        const before = evaluatePeriodizationPhase([A, B, C], '2026-06-25');
        expect(before.phase.supportingEventScale).toBeUndefined();
        expect(before.phase.volumeScale).toBe(1.1);
        const craftDay = evaluatePeriodizationPhase([A, C], '2026-06-20');
        expect(craftDay.phase.supportingEventScale).toBeUndefined();
        expect(craftDay.phase.volumeScale).toBe(1.1);
    });

    it('limits a B+ more than a B, with a bounded recovery afterwards', () => {
        const taper = evaluatePeriodizationPhase([A, B_PLUS], '2026-07-18');
        expect(taper.phase.volumeScale).toBeCloseTo(1 - SUPPORTING_TAPER_MAX_VOLUME_REDUCTION.benchmark_peak, 10);
        const done = { ...B_PLUS, lifecycle: 'completed' as const };
        const recovery = evaluatePeriodizationPhase([A, done], '2026-07-19');
        expect(recovery.phase.supportingEventScale).toMatchObject({ kind: 'recovery', volumeScale: SUPPORTING_RECOVERY_POLICY.benchmark_peak.scale });
        expect(evaluatePeriodizationPhase([A, done], '2026-07-21').phase.supportingEventScale).toBeUndefined();
    });

    it('yields to the primary target while it tapers or recovers', () => {
        const insideTaper = event({ id: 'b-in-taper', date: '2026-09-10', priority: 'B' });
        const result = evaluatePeriodizationPhase([A, insideTaper], '2026-09-09');
        expect(result.phase.phaseName).toBe('Peak/Taper');
        expect(result.phase.supportingEventScale).toBeUndefined();
        expect(result.seasonRoadmap?.conflicts.map(conflict => conflict.kind)).toEqual(['inside_peak_taper']);
    });

    it('narrows an authored structured block only as a minimum', () => {
        const supportingEventScale = { volumeScale: 0.9, intensityScale: 1 };
        const plan = { blocks: [{ startDate: '2026-07-01', endDate: '2026-07-10', volumeScale: 1.1, intensityScale: 0.9 }] } as never;
        const dose = resolvePlannedDoseForDate({ volumeScale: 1, intensityScale: 1, supportingEventScale }, [], [], plan, '2026-07-02');
        expect(dose).toEqual({ volume: 0.9, intensity: 0.9 });
        expect(resolvePlannedDoseForDate({ volumeScale: 1, intensityScale: 1 }, [], [], plan, '2026-07-02')).toEqual({ volume: 1, intensity: 0.9 });
    });
});

describe('C race as key-session replacement', () => {
    const nearC = event({ id: 'c-near', date: '2026-07-02', priority: 'C' });

    it('reserves one quality slot instead of layering its own objectives', () => {
        const authority = evaluatePeriodizationPhase([A, nearC], '2026-06-30');
        const resolution = resolveMultiEventObjectives([A, nearC], '2026-06-30', authority, [
            objective('threshold_quality', 2), objective('zone2_aerobic', 3),
        ]);
        expect(resolution.objectives.map(item => [item.key, item.requiredCredit])).toEqual([['threshold_quality', 1], ['zone2_aerobic', 3]]);
        expect(resolution.droppedContributorObjectives).toEqual([expect.objectContaining({
            eventId: 'c-near', objectiveKey: 'threshold_quality', reason: 'train_through_replaces_key_session',
        })]);
    });

    it('never goes below zero and never layers when no quality objective exists or the race is far', () => {
        const authority = evaluatePeriodizationPhase([A, nearC], '2026-06-30');
        expect(resolveMultiEventObjectives([A, nearC], '2026-06-30', authority, [objective('zone2_aerobic', 3)]))
            .toMatchObject({ objectives: [expect.objectContaining({ key: 'zone2_aerobic' })], droppedContributorObjectives: [] });
        const spent = resolveMultiEventObjectives([A, nearC], '2026-06-30', authority, [objective('threshold_quality', 0.5)]);
        expect(spent.objectives[0].requiredCredit).toBe(0);
        const farDate = '2026-06-10';
        expect(TRAIN_THROUGH_REPLACEMENT_LEAD_DAYS).toBe(3);
        const farAuthority = evaluatePeriodizationPhase([A, nearC], farDate);
        const far = resolveMultiEventObjectives([A, nearC], farDate, farAuthority, [objective('threshold_quality', 2)]);
        expect(far.objectives).toHaveLength(1);
        expect(far.objectives[0].requiredCredit).toBe(2);
        expect(far.droppedContributorObjectives).toEqual([]);
    });

    it('does not claim a replacement for evergreen-programmed dates', () => {
        const authority = evaluatePeriodizationPhase([A, nearC], '2026-06-30');
        const resolution = resolveMultiEventObjectives([A, nearC], '2026-06-30', authority, [objective('threshold_quality', 2)],
            { trainThroughReplacement: false });
        expect(resolution.objectives[0].requiredCredit).toBe(2);
        expect(resolution.droppedContributorObjectives).toEqual([]);
    });

    it('records the season claim in the decision knowledge lineage', () => {
        const base = { history: [], periodization: { focusEvent: null, phase: { taperActive: false } } };
        expect(trainingIntentKnowledgeRefs(base)).not.toContain(KNOWLEDGE_CLAIM_IDS.seasonRoadmapPolicy);
        expect(trainingIntentKnowledgeRefs({ ...base, periodization: { focusEvent: null, phase: { taperActive: false, supportingEventScale: {} } } }))
            .toContain(KNOWLEDGE_CLAIM_IDS.seasonRoadmapPolicy);
        expect(trainingIntentKnowledgeRefs({ ...base, droppedContributorObjectives: [{ reason: 'train_through_replaces_key_session' }] }))
            .toContain(KNOWLEDGE_CLAIM_IDS.seasonRoadmapPolicy);
    });

    it('does not mutate the authority objectives it was given', () => {
        const input = [objective('threshold_quality', 2)];
        const authority = evaluatePeriodizationPhase([A, nearC], '2026-06-30');
        resolveMultiEventObjectives([A, nearC], '2026-06-30', authority, input);
        expect(input[0].requiredCredit).toBe(2);
    });
});

describe('season trace', () => {
    it('is absent for a single event so ordinary audits stay unchanged', () => {
        expect(seasonTrace(evaluatePeriodizationPhase([A], '2026-07-02'))).toBeUndefined();
        expect(seasonTrace(evaluatePeriodizationPhase([], '2026-07-02'))).toBeUndefined();
    });

    it('is compact, valid and rejects malformed shapes', () => {
        const laterC = event({ id: 'c-later', date: '2026-07-10', priority: 'C' });
        const trace = seasonTrace(evaluatePeriodizationPhase([A, B, laterC], '2026-07-02'))!;
        expect(trace.entries.map(entry => entry.role)).toEqual(['primary_peak', 'benchmark', 'train_through']);
        expect(trace.supportingScale).toMatchObject({ eventId: 'b-club' });
        expect(isValidSeasonTrace(trace)).toBe(true);
        expect(isValidSeasonTrace({ ...trace, extra: 1 })).toBe(false);
        expect(isValidSeasonTrace({ ...trace, entries: [{ ...trace.entries[0], role: 'boss' }] })).toBe(false);
        expect(isValidSeasonTrace({ ...trace, supportingScale: { ...trace.supportingScale!, volumeScale: 0 } })).toBe(false);
        expect(isValidSeasonTrace({ ...trace, conflicts: [{ kind: 'x' }] })).toBe(false);
        expect(isValidSeasonTrace(null)).toBe(false);
        const crowded = Array.from({ length: 12 }, (_, index) => event({ id: `c-${index}`, date: '2026-07-10', priority: 'C' }));
        const crowdedTrace = seasonTrace(evaluatePeriodizationPhase(crowded, '2026-07-02'))!;
        expect(crowdedTrace.conflicts[0].eventIds).toHaveLength(8);
        expect(isValidSeasonTrace(crowdedTrace)).toBe(true);
    });
});

describe('supporting-event policy alignment (ADR-0033)', () => {
    it('keeps the registered claim and implemented constants in step', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.seasonRoadmapPolicy).statement;
        expect(claim).toContain(`at most ${SUPPORTING_TAPER_MAX_VOLUME_REDUCTION.benchmark_peak}`);
        expect(claim).toContain(`at most ${SUPPORTING_TAPER_MAX_VOLUME_REDUCTION.benchmark}`);
        expect(claim).toContain(`${SUPPORTING_RECOVERY_POLICY.benchmark_peak.days} days at ${SUPPORTING_RECOVERY_POLICY.benchmark_peak.scale}`);
        expect(claim).toContain(`${SUPPORTING_RECOVERY_POLICY.benchmark.days} day at ${SUPPORTING_RECOVERY_POLICY.benchmark.scale}`);
        expect(claim).toContain(`within ${TRAIN_THROUGH_REPLACEMENT_LEAD_DAYS} days`);
    });
});
