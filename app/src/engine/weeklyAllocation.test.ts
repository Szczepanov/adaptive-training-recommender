import { describe, expect, it } from 'vitest';
import type { CoverageState } from './coverage';
import {
    attachExactEligibleIdentities,
    deriveRequiredRoleOccurrences,
    occurrenceForTemplate,
    resolveWeeklyRoleReservations,
    WEEKLY_ALLOCATION_SEARCH_BUDGET,
    type AllocationAssignment,
    type AllocationDateEvaluator,
    type ProjectedDateOutcome,
    type RequiredRoleOccurrence,
} from './weeklyAllocation';
import type { SessionTemplate } from './models';

const DATES = ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];

function coverageState(projectedSessions = 0): CoverageState {
    return {
        asOfDate: '2026-08-10', phase: 'build', activeBlockId: 'block_build',
        coverageSetId: 'september_cycling_event',
        requirements: [{
            id: 'coverage_block_build_aerobic_volume_0', key: 'aerobic_volume', label: 'Aerobic volume',
            requirement: 'required', minimumSessions: 2, targetSessions: 2, completedSessions: 0,
            projectedSessions, priority: 'must_have', rollingWindowDays: 7,
            windowStart: '2026-08-03', windowEnd: '2026-09-01', credits: [],
        }, {
            id: 'coverage_block_build_recovery_or_rest_1', key: 'recovery_or_rest', label: 'Recovery',
            requirement: 'required', minimumSessions: 1, targetSessions: 1, completedSessions: 0,
            projectedSessions: 0, priority: 'must_have', rollingWindowDays: 7,
            windowStart: '2026-08-03', windowEnd: '2026-09-01', credits: [],
        }],
    };
}

function occurrence(
    coverageKey: RequiredRoleOccurrence['coverageKey'],
    ordinal: number,
    eligibleTemplateIds: string[],
    windowEnd = '2026-09-01',
): RequiredRoleOccurrence {
    return {
        id: `september_cycling_event|2026-08-03|${windowEnd}|build|${coverageKey}|september_cycling_event:${coverageKey}|${ordinal}`,
        coverageSetId: 'september_cycling_event',
        coverageKey,
        authoredSessionIdentity: `september_cycling_event:${coverageKey}`,
        phase: 'build',
        windowStart: '2026-08-03',
        windowEnd,
        ordinal,
        label: coverageKey,
        eligibleTemplateIds,
        eligibleWorkoutIds: [],
    };
}

interface StubRules {
    /** Templates accepted on a date when nothing else has been assigned. */
    acceptedByDate: Record<string, string[]>;
    /** Applied after each assignment: removes accepted templates from other dates. */
    conflicts?: (assignments: readonly AllocationAssignment[], date: string) => string[];
    fatigueExcluded?: Record<string, string[]>;
    exclusionReasons?: Record<string, Record<string, string[]>>;
}

function stubEvaluator(rules: StubRules, dates: readonly string[] = DATES): AllocationDateEvaluator {
    return {
        forecastDates: dates,
        evaluate(assignments: readonly AllocationAssignment[], date: string): ProjectedDateOutcome {
            const blocked = new Set(rules.conflicts?.(assignments, date) ?? []);
            return {
                date,
                fatigueTier: 'train',
                acceptedTemplateIds: (rules.acceptedByDate[date] ?? []).filter(id => !blocked.has(id)),
                fatigueExcludedTemplateIds: rules.fatigueExcluded?.[date] ?? [],
                exclusionReasons: new Map(Object.entries(rules.exclusionReasons?.[date] ?? {})),
            };
        },
    };
}

describe('ADR-0018 required role occurrences', () => {
    it('creates deterministic distinct ids carrying the canonical identity fields', () => {
        const first = deriveRequiredRoleOccurrences(coverageState());
        const second = deriveRequiredRoleOccurrences(coverageState());
        expect(first).toHaveLength(2);
        expect(first.map(item => item.id)).toEqual(second.map(item => item.id));
        expect(new Set(first.map(item => item.id)).size).toBe(2);
        expect(first.map(item => item.ordinal).sort()).toEqual([0, 1]);
        expect(first[0]).toMatchObject({
            coverageSetId: 'september_cycling_event',
            authoredSessionIdentity: 'september_cycling_event:aerobic_volume',
            windowStart: '2026-08-03',
            windowEnd: '2026-09-01',
            phase: 'build',
        });
    });

    it('reduces projected coverage idempotently and never reserves recovery/rest', () => {
        const remaining = deriveRequiredRoleOccurrences(coverageState(1));
        expect(remaining).toHaveLength(1);
        expect(remaining[0].ordinal).toBe(1);
        expect(deriveRequiredRoleOccurrences(coverageState(2))).toEqual([]);
    });

    it('reports an exact-candidate miss without inventing a similar role', () => {
        // No catalogue template grants the authored key, so there is nothing to search.
        const occurrences = attachExactEligibleIdentities(deriveRequiredRoleOccurrences(coverageState(1)), []);
        expect(occurrences[0].eligibleTemplateIds).toEqual([]);
        const result = resolveWeeklyRoleReservations(occurrences, stubEvaluator({
            acceptedByDate: { '2026-08-11': ['cycling_zone2_standard_01'] },
        }, ['2026-08-11']));
        expect(result.outcomes[0]).toMatchObject({ status: 'missed', reason: 'no_exact_candidate' });
        expect(result.reservationsByDate.size).toBe(0);
    });

    it('matches a template to an occurrence only through its exact eligible identity', () => {
        const target = occurrence('aerobic_volume', 0, ['cycling_zone2_standard_01']);
        const lookalike = { id: 'cycling_recovery_spin_01', modality: 'Cycling', category: 'Recovery' } as unknown as SessionTemplate;
        const exact = { id: 'cycling_zone2_standard_01', modality: 'Cycling', category: 'Moderate Endurance' } as unknown as SessionTemplate;
        expect(occurrenceForTemplate([target], lookalike)).toEqual([]);
        expect(occurrenceForTemplate([target], exact)).toEqual([target]);
    });
});

describe('ADR-0018 stateful reservation search', () => {
    it('reserves each occurrence on a distinct date and reports the exact identity', () => {
        const occurrences = [
            occurrence('aerobic_volume', 0, ['zone2']),
            occurrence('sustained_quality', 0, ['threshold']),
        ];
        const result = resolveWeeklyRoleReservations(occurrences, stubEvaluator({
            acceptedByDate: Object.fromEntries(DATES.map(date => [date, ['zone2', 'threshold']])),
        }));
        expect(result.fulfilledCount).toBe(2);
        expect(result.outcomes.every(outcome => outcome.status === 'reserved')).toBe(true);
        expect(new Set([...result.reservationsByDate.keys()]).size).toBe(2);
        expect([...result.reservationsByDate.values()].map(item => item.templateId).sort())
            .toEqual(['threshold', 'zone2']);
    });

    it('does not reserve two assignments that are individually feasible but jointly infeasible', () => {
        // Both roles only fit on the 11th and 12th, but taking either date makes every
        // other date unusable -- exactly the stateful case a bipartite matching gets wrong.
        const occurrences = [
            occurrence('aerobic_volume', 0, ['zone2']),
            occurrence('sustained_quality', 0, ['threshold']),
        ];
        const result = resolveWeeklyRoleReservations(occurrences, stubEvaluator({
            acceptedByDate: { '2026-08-11': ['zone2', 'threshold'], '2026-08-12': ['zone2', 'threshold'] },
            conflicts: assignments => (assignments.length > 0 ? ['zone2', 'threshold'] : []),
        }, ['2026-08-11', '2026-08-12']));

        expect(result.fulfilledCount).toBe(1);
        const missed = result.outcomes.filter(outcome => outcome.status === 'missed');
        expect(missed).toHaveLength(1);
        expect(missed[0].reservation.assignedDate).toBeNull();
        expect(missed[0].reason).toBeDefined();
    });

    it('places both occurrences of a two-session role on different dates', () => {
        const occurrences = [occurrence('aerobic_volume', 0, ['zone2']), occurrence('aerobic_volume', 1, ['zone2'])];
        const result = resolveWeeklyRoleReservations(occurrences, stubEvaluator({
            acceptedByDate: { '2026-08-11': ['zone2'], '2026-08-12': ['zone2'] },
        }, ['2026-08-11', '2026-08-12']));
        expect(result.fulfilledCount).toBe(2);
        expect([...result.reservationsByDate.keys()].sort()).toEqual(['2026-08-11', '2026-08-12']);
    });

    it('records a conflict-only loss as no_conflict_free_date', () => {
        const result = resolveWeeklyRoleReservations([
            occurrence('aerobic_volume', 0, ['zone2']),
            occurrence('sustained_quality', 0, ['threshold']),
        ], stubEvaluator({ acceptedByDate: { '2026-08-11': ['zone2', 'threshold'] } }, ['2026-08-11']));
        const missed = result.outcomes.filter(outcome => outcome.status === 'missed');
        expect(missed).toHaveLength(1);
        expect(missed[0].reason).toBe('no_conflict_free_date');
    });

    it('attributes a no-branch safety exclusion rather than a scheduling conflict', () => {
        const result = resolveWeeklyRoleReservations([occurrence('sustained_quality', 0, ['threshold'])], stubEvaluator({
            acceptedByDate: { '2026-08-11': [], '2026-08-12': [] },
            exclusionReasons: {
                '2026-08-11': { threshold: ['QUALITY_SPACING_VIOLATION'] },
                '2026-08-12': { threshold: ['QUALITY_SPACING_VIOLATION'] },
            },
        }, ['2026-08-11', '2026-08-12']));
        expect(result.outcomes[0]).toMatchObject({ status: 'missed', reason: 'hard_safety_or_recovery' });
        expect(result.outcomes[0].observedBlockers).toContain('2026-08-11:QUALITY_SPACING_VIOLATION');
    });

    it('attributes a projected-fatigue ceiling separately from a hard safety gate', () => {
        const result = resolveWeeklyRoleReservations([occurrence('sustained_quality', 0, ['threshold'])], stubEvaluator({
            acceptedByDate: { '2026-08-11': [] },
            fatigueExcluded: { '2026-08-11': ['threshold'] },
        }, ['2026-08-11']));
        expect(result.outcomes[0]).toMatchObject({ status: 'missed', reason: 'projected_fatigue' });
    });

    it('never seeds a reservation onto an immutable today/tomorrow date', () => {
        const result = resolveWeeklyRoleReservations([occurrence('aerobic_volume', 0, ['zone2'])], stubEvaluator({
            acceptedByDate: { '2026-08-11': ['zone2'], '2026-08-12': ['zone2'] },
        }, ['2026-08-11', '2026-08-12']), { unavailableDates: new Set(['2026-08-11']) });
        expect([...result.reservationsByDate.keys()]).toEqual(['2026-08-12']);
    });

    it('records a relocation as wasMoved on the same occurrence id', () => {
        const target = occurrence('aerobic_volume', 0, ['zone2']);
        const result = resolveWeeklyRoleReservations([target], stubEvaluator({
            acceptedByDate: { '2026-08-12': ['zone2'] },
        }, ['2026-08-12']), { nominatedDates: new Map([[target.id, '2026-08-11']]) });
        expect(result.outcomes[0].reservation).toMatchObject({
            occurrenceId: target.id, nominatedDate: '2026-08-11', assignedDate: '2026-08-12', wasMoved: true,
        });
    });
});

describe('ADR-0018 D-BOUND search budget', () => {
    it('returns a deterministic best-known partial result and never a false miss on exhaustion', () => {
        const occurrences = Array.from({ length: 6 }, (_, index) => occurrence('aerobic_volume', index, ['zone2']));
        const rules: StubRules = { acceptedByDate: Object.fromEntries(DATES.map(date => [date, ['zone2']])) };
        const budget = { ...WEEKLY_ALLOCATION_SEARCH_BUDGET, maxTransitions: 3 };
        const first = resolveWeeklyRoleReservations(occurrences, stubEvaluator(rules), { budget });
        const second = resolveWeeklyRoleReservations(occurrences, stubEvaluator(rules), { budget });

        expect(first.budgetExhausted).toBe(true);
        expect(first.transitionsUsed).toBeLessThanOrEqual(3);
        expect(first.outcomes.map(outcome => `${outcome.occurrence.id}:${outcome.status}`))
            .toEqual(second.outcomes.map(outcome => `${outcome.occurrence.id}:${outcome.status}`));
        expect(first.outcomes.some(outcome => outcome.status === 'missed')).toBe(false);
        expect(first.outcomes.some(outcome => outcome.status === 'unresolved_search_budget')).toBe(true);
    });

    it('treats an over-cap candidate list as budget exhaustion, not infeasibility', () => {
        // One date, two roles: the second cannot be placed, but its candidate list was
        // truncated by the four-per-occurrence cap, so no infeasibility was proven.
        const target = occurrence('aerobic_volume', 0, ['a', 'b', 'c', 'd', 'e']);
        const blocker = occurrence('sustained_quality', 0, ['a', 'b', 'c', 'd', 'e'], '2026-08-20');
        const result = resolveWeeklyRoleReservations([blocker, target], stubEvaluator({
            acceptedByDate: { '2026-08-11': ['a', 'b', 'c', 'd', 'e'] },
        }, ['2026-08-11']));
        expect(result.fulfilledCount).toBe(1);
        expect(result.outcomes.filter(outcome => outcome.status === 'missed')).toEqual([]);
        expect(result.outcomes.filter(outcome => outcome.status === 'unresolved_search_budget')).toHaveLength(1);
    });

    it('reports occurrences beyond the per-search cap as unresolved rather than missed', () => {
        const occurrences = Array.from({ length: 16 }, (_, index) => occurrence('aerobic_volume', index, ['zone2']));
        const result = resolveWeeklyRoleReservations(occurrences, stubEvaluator({
            acceptedByDate: Object.fromEntries(DATES.map(date => [date, ['zone2']])),
        }));
        expect(result.outcomes).toHaveLength(16);
        expect(result.outcomes.filter(outcome => outcome.status === 'missed')).toEqual([]);
        expect(result.budgetExhausted).toBe(true);
    });

    it('sorts occurrences by deadline before the cap so truncation is reproducible', () => {
        const early = occurrence('aerobic_volume', 0, ['zone2'], '2026-08-15');
        const late = occurrence('sustained_quality', 0, ['zone2'], '2026-08-30');
        const result = resolveWeeklyRoleReservations([late, early], stubEvaluator({
            acceptedByDate: { '2026-08-11': ['zone2'] },
        }, ['2026-08-11']));
        expect(result.reservationsByDate.get('2026-08-11')?.occurrence.id).toBe(early.id);
    });
});
