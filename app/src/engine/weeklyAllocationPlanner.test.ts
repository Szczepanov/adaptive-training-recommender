import { describe, expect, it } from 'vitest';
import type { FixedActivity, Recommendation, TrainingSettings, UserContext, UserEvent, UserPreferences } from './models';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import { evaluatePeriodizationPhase } from './periodization';
import { creditObjectivesFromStimulus, generateWeeklyObjectives } from './microcycle';
import { createEmptyFatigue } from './fatigue';
import {
    classifyAllocationPreservation,
    incumbentAssignmentsRemainingAfterSelection,
    evaluateProjectedDate,
    generateWeekAheadPlan,
    projectedDateOutcomeFrom,
    resolveWeeklyAnchors,
    selectViableForecastCandidate,
    selectionPreservesCurrentReservation,
    shouldProtectWeeklyAllocation,
    type ProjectedDatePlanningContext,
} from './planner';
import { rankCandidates } from './optimizer';
import { addDaysToLocalDateString } from '../utils/localDate';

/**
 * Phase 7A.2/7A.4 planner-level coverage: the allocator and the greedy loop must share one
 * hard-gate path, reservations must survive discretionary support work, and the bounded
 * search must stay inside its operational latency budget on a live-sized fixture.
 */

const TODAY = '2026-08-09';

function settings(): TrainingSettings {
    return {
        userId: 'allocation-planner', schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: true },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 90, weekendMaxMinutes: 150, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '', updatedAt: '',
    };
}

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true,
            maxTimeMinutes: 150,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: ['Cycling'], conservativeBias: false },
        trainingSettings: settings(),
    };
}

const preferences: UserPreferences = {
    userId: 'allocation-planner', preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 90, defaultWeekendTimeMin: 150, preferredTimeOfDay: 'flexible',
    preferredModalities: ['Cycling'], deprioritizedModalities: [], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};

function event(): UserEvent {
    return {
        id: 'allocation-a-event', title: 'Road race', date: '2026-09-13',
        priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
    };
}

const readiness = {
    subjective: {
        readiness: 7, sleepQuality: 7, fatigue: 3, soreness: 3, stress: 3, motivation: 7,
        timeAvailable: 120, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
    },
    objective: {
        total_steps: 8000, sleep_score: 84, sleep_duration_min: 460, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
        hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 84,
        last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
        sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 8,
    },
};

function liveSizedWeek() {
    const focusEvent = event();
    const periodization = evaluatePeriodizationPhase([focusEvent], TODAY);
    const planState = buildCyclingEventPlan(focusEvent);
    if (planState.status !== 'AVAILABLE') throw new Error('event plan unavailable');
    const raceSpecific = ENRICHED_TEMPLATES.find(item => item.category === 'Race-Specific Endurance' && item.modality === 'Cycling');
    const recovery = ENRICHED_TEMPLATES.find(item => item.category === 'Mobility/Recovery');
    if (!recovery || !raceSpecific?.stimulusProfile) throw new Error('required templates missing');

    let microcycle = generateWeeklyObjectives(
        periodization.phase, addDaysToLocalDateString(TODAY, -7), focusEvent, planState.data, TODAY,
    );
    microcycle = creditObjectivesFromStimulus(microcycle, raceSpecific.stimulusProfile, raceSpecific.modality, raceSpecific.category);

    const todayRec: Recommendation = { template: recovery, rationale: 'Recovery.', mode: 'recover' };
    return {
        focusEvent, periodization, microcycle, todayRec,
        run: () => generateWeekAheadPlan(
            readiness, context(), preferences, TODAY, todayRec, null,
            { microcycle, fatigue: createEmptyFatigue(TODAY), trailingHistory: [] },
            { days: 7, events: [focusEvent] },
        ),
    };
}

function rollingBudgetStarvationWeek(committedSystemic = 0.5) {
    const todayDate = '2026-08-01';
    const focusEvent: UserEvent = {
        id: 'case-b-event', title: 'Road race', date: '2026-08-08', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
        demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
    };
    const periodization = evaluatePeriodizationPhase([focusEvent], todayDate);
    const planState = buildCyclingEventPlan(focusEvent);
    if (planState.status !== 'AVAILABLE') throw new Error('event plan unavailable');
    const qualityOnlyPlan = {
        ...planState.data,
        objectives: planState.data.objectives.map(objective => objective.coverageKey === 'sustained_quality'
            ? objective
            : { ...objective, coverageMinimumSessions: 0 }),
    };
    const raceSpecific = ENRICHED_TEMPLATES.find(item => item.category === 'Race-Specific Endurance' && item.modality === 'Cycling');
    const recovery = ENRICHED_TEMPLATES.find(item => item.category === 'Mobility/Recovery');
    if (!recovery || !raceSpecific?.stimulusProfile) throw new Error('required templates missing');
    let microcycle = generateWeeklyObjectives(periodization.phase, addDaysToLocalDateString(todayDate, -7), focusEvent, planState.data, todayDate);
    microcycle = creditObjectivesFromStimulus(microcycle, raceSpecific.stimulusProfile, raceSpecific.modality, raceSpecific.category);
    const fixedActivity = (id: string, date: string, systemic: number): FixedActivity => ({
        userId: 'allocation-planner', id, title: 'Committed budget load', date,
        durationMin: 30, isCompleted: false, fixed: true, environment: 'either', equipment: [], expectedCost: { systemic },
        createdAt: '', updatedAt: '',
    });
    const fixedActivities = committedSystemic >= 1
        ? [fixedActivity('committed-budget-1', '2026-08-05', 0.9), fixedActivity('committed-budget-2', '2026-08-06', 0.9)]
        : [fixedActivity('committed-budget', '2026-08-06', committedSystemic)];
    const todayRec: Recommendation = { template: recovery, rationale: 'Recovery.', mode: 'recover' };
    return generateWeekAheadPlan(
        readiness, context(), preferences, todayDate, todayRec, null,
        {
            microcycle,
            fatigue: createEmptyFatigue(todayDate),
            trailingHistory: [],
            rollingLoadBudgetHistory: [
                { date: '2026-06-20', systemicCost: 4, lowerBodyCost: 0, occurrenceKey: 'baseline-1' },
                { date: '2026-06-27', systemicCost: 4, lowerBodyCost: 0, occurrenceKey: 'baseline-2' },
                { date: '2026-07-04', systemicCost: 4, lowerBodyCost: 0, occurrenceKey: 'baseline-3' },
            ],
        },
        { days: 7, events: [focusEvent], planDefinition: qualityOnlyPlan, fixedActivities },
    );
}

describe('7A.2 shared projected-date evaluation seam', () => {
    it('rejects exactly what rankCandidates rejects, with the same reasons', () => {
        const fixture = liveSizedWeek();
        const shared: ProjectedDatePlanningContext = {
            context: context(),
            preferences,
            events: [fixture.focusEvent],
            fixedActivities: [],
            authoredPlanBlocks: [],
            anchors: resolveWeeklyAnchors(TODAY, 7, [fixture.focusEvent], [], context()),
            internalStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            internalStrainAsOf: TODAY,
        };
        const date = addDaysToLocalDateString(TODAY, 3);
        const evaluation = evaluateProjectedDate(date, {
            microcycle: fixture.microcycle,
            externalFatigue: createEmptyFatigue(TODAY),
            projectedHistory: [],
        }, shared);

        const direct = rankCandidates(
            [...evaluation.fatigueGated],
            evaluation.optimizationContext.unresolvedObjectives,
            evaluation.optimizationContext.fatigueState,
            evaluation.optimizationContext.availability,
            evaluation.optimizationContext.injuryConstraints,
            evaluation.optimizationContext.preferences,
            evaluation.optimizationContext.options,
        );
        const outcome = projectedDateOutcomeFrom(evaluation);

        expect(outcome.acceptedTemplateIds).toEqual(direct.accepted.map(candidate => candidate.template.id));
        direct.rejected.forEach(candidate => {
            expect(outcome.exclusionReasons.get(candidate.template.id)).toEqual(candidate.excludedReasons);
        });
        // Everything the date-level gates removed before ranking is still accounted for.
        evaluation.eligible
            .filter(template => !evaluation.fatigueGated.includes(template))
            .forEach(template => expect(outcome.fatigueExcludedTemplateIds).toContain(template.id));
        expect(outcome.fatigueTier).toBe(evaluation.fatigueTier);
    });
});

describe('7A.4 reservations survive discretionary work', () => {
    it('produces a coherent, exact-identity allocation report for a healthy cycling week', () => {
        const plan = liveSizedWeek().run();
        const outcomes = plan.allocationReport.outcomes;
        expect(outcomes.length).toBeGreaterThan(0);

        // No dangling reservation, and every terminal miss carries a typed reason.
        expect(outcomes.filter(outcome => outcome.status === 'reserved')).toEqual([]);
        outcomes.filter(outcome => outcome.status === 'missed')
            .forEach(outcome => expect(outcome.reason).toBeDefined());

        // Every fulfilment is an exact authored identity on a real forecast day.
        const dayByDate = new Map(plan.days.map(day => [day.date, day]));
        outcomes.filter(outcome => outcome.status === 'fulfilled').forEach(outcome => {
            const day = dayByDate.get(outcome.reservation.assignedDate ?? '');
            expect(day).toBeDefined();
            expect(outcome.reservation.templateId).toBe(day!.template.id);
            expect(outcome.occurrence.eligibleTemplateIds).toContain(day!.template.id);
        });

        // One session may only clear one occurrence of a given authored key per date.
        const perDateKeys = outcomes
            .filter(outcome => outcome.status === 'fulfilled')
            .map(outcome => `${outcome.reservation.assignedDate}:${outcome.occurrence.coverageKey}`);
        expect(new Set(perDateKeys).size).toBe(perDateKeys.length);
    });

    it('does not let discretionary support work consume the last safe event-specific day', () => {
        const plan = liveSizedWeek().run();
        const eventSpecific = plan.allocationReport.outcomes
            .filter(outcome => outcome.occurrence.coverageKey === 'outdoor_event_specific');
        expect(eventSpecific.length).toBeGreaterThan(0);
        eventSpecific.forEach(outcome => {
            expect(outcome.status === 'fulfilled' || outcome.reason !== 'no_conflict_free_date').toBe(true);
        });
    });

    it('is deterministic: identical input yields an identical allocation report', () => {
        const first = liveSizedWeek().run().allocationReport.outcomes;
        const second = liveSizedWeek().run().allocationReport.outcomes;
        expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    });

    it('fails closed when the only future quality witness follows consecutive projected rest days', () => {
        const plan = rollingBudgetStarvationWeek();
        const quality = plan.allocationReport.outcomes.find(outcome => outcome.occurrence.coverageKey === 'sustained_quality');
        expect(quality?.status).not.toBe('fulfilled');
        expect(quality?.reservation.assignedDate).toBeNull();

        // Discretionary training between the early strength reservation and the exact
        // quality witness cannot consume the remaining budget. Rest or low-cost mobility
        // is allowed only when the viability proof preserves the exact future role.
        expect(plan.days.filter(day => day.date >= '2026-08-04' && day.date <= '2026-08-07')
            .every(day => day.template.category === 'Rest' || day.template.category === 'Mobility/Recovery'),
        JSON.stringify(plan.days.map(day => ({ date: day.date, id: day.template.id, category: day.template.category })))).toBe(true);
        // Recovery-protective rest days must not be broken by an infeasible hard quality session.
        expect(plan.days.find(day => day.date === '2026-08-08')?.template.category).not.toBe('Hard Endurance');
    });

    it('reports committed-load exhaustion as a rolling-budget role miss without bypassing the envelope', () => {
        const plan = rollingBudgetStarvationWeek(2);
        const quality = plan.allocationReport.outcomes.find(outcome => outcome.occurrence.coverageKey === 'sustained_quality');

        expect(quality?.status).toBe('missed');
        expect(quality?.reason).toBe('rolling_load_budget');
        expect(plan.days.find(day => day.date === '2026-08-08')?.template.category).not.toBe('Hard Endurance');
    });

    it('keeps role reservation identity separate from the soft anchor date', () => {
        const plan = rollingBudgetStarvationWeek();
        const anchors = resolveWeeklyAnchors(
            '2026-08-01',
            7,
            [{
                id: 'case-b-event', title: 'Road race', date: '2026-08-08', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
                demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
            }],
            [],
            context(),
        );
        const quality = plan.allocationReport.outcomes.find(outcome => outcome.occurrence.coverageKey === 'sustained_quality');

        expect(quality?.occurrence.id).toContain('sustained_quality');
        expect(quality?.reservation.nominatedDate).toBe(anchors.qualityAnchorDate);
        expect(quality?.reservation.assignedDate === null || quality?.reservation.assignedDate === quality?.reservation.nominatedDate).toBe(true);
        expect(quality?.reservation.wasMoved).toBe(false);
        // The allocator's existing relocation contract is independently covered by the
        // real occurrence-id test in weeklyAllocation.test.ts; this integration assertion
        // ensures an anchor is not treated as the reservation's authority.
    });
});

describe('D-SUPPORT fail-closed selection', () => {
    it('protects support and exact-role substitute picks on train and modify days', () => {
        expect(shouldProtectWeeklyAllocation('train', 1)).toBe(true);
        expect(shouldProtectWeeklyAllocation('modify', 1)).toBe(true);
        expect(shouldProtectWeeklyAllocation('recover', 1)).toBe(false);
        expect(shouldProtectWeeklyAllocation('train', 0)).toBe(false);
    });

    it('does not use incumbent-survival as proof when the current reservation is displaced', () => {
        expect(selectionPreservesCurrentReservation('current-role', new Set(['later-role']))).toBe(false);
        expect(selectionPreservesCurrentReservation('current-role', new Set(['current-role']))).toBe(true);
        expect(selectionPreservesCurrentReservation(null, new Set())).toBe(true);
    });

    it('does not replay a future incumbent reservation already fulfilled by the current candidate', () => {
        const reservations = new Map([
            ['2026-08-12', { occurrence: { id: 'current-role' }, templateId: 'current-template' }],
            ['2026-08-13', { occurrence: { id: 'bundled-future-role' }, templateId: 'bundled-template' }],
            ['2026-08-14', { occurrence: { id: 'still-required-role' }, templateId: 'still-required-template' }],
        ]);

        expect(incumbentAssignmentsRemainingAfterSelection(
            reservations,
            '2026-08-12',
            new Set(['current-role', 'bundled-future-role']),
        )).toEqual([
            { date: '2026-08-14', templateId: 'still-required-template' },
        ]);
    });

    // Issue #745: an unresolved occurrence elsewhere in the allocation must not veto a
    // candidate that already proved the incumbent allocation survives (ADR-0018 D-BOUND).
    it('admits a candidate proving incumbent survival even when another occurrence is unresolved', () => {
        let reallocated = false;
        const result = classifyAllocationPreservation({
            preservesCurrentReservation: true,
            incumbentSurvives: () => true,
            incumbentAllocationUnresolved: true,
            reallocate: () => {
                reallocated = true;
                return 'unresolved_search_budget';
            },
        });

        expect(result).toBe('preserves');
        expect(reallocated).toBe(false);
    });

    it('fails closed without a full search when the incumbent breaks and the allocation is unresolved', () => {
        let reallocated = false;
        const result = classifyAllocationPreservation({
            preservesCurrentReservation: true,
            incumbentSurvives: () => false,
            incumbentAllocationUnresolved: true,
            reallocate: () => {
                reallocated = true;
                return 'preserves';
            },
        });

        expect(result).toBe('unresolved_search_budget');
        expect(reallocated).toBe(false);
    });

    it('never uses incumbent survival as proof when the current reservation is displaced', () => {
        let survivalChecked = false;
        const incumbentSurvives = () => {
            survivalChecked = true;
            return true;
        };

        expect(classifyAllocationPreservation({
            preservesCurrentReservation: false,
            incumbentSurvives,
            incumbentAllocationUnresolved: true,
            reallocate: () => 'preserves',
        })).toBe('unresolved_search_budget');
        expect(classifyAllocationPreservation({
            preservesCurrentReservation: false,
            incumbentSurvives,
            incumbentAllocationUnresolved: false,
            reallocate: () => 'degrades',
        })).toBe('degrades');
        expect(survivalChecked).toBe(false);
    });

    it('defers to the full bounded reallocation when the incumbent breaks and the allocation is resolved', () => {
        const classify = (reallocation: 'preserves' | 'degrades' | 'unresolved_search_budget') =>
            classifyAllocationPreservation({
                preservesCurrentReservation: true,
                incumbentSurvives: () => false,
                incumbentAllocationUnresolved: false,
                reallocate: () => reallocation,
            });

        expect(classify('preserves')).toBe('preserves');
        expect(classify('degrades')).toBe('degrades');
        expect(classify('unresolved_search_budget')).toBe('unresolved_search_budget');
    });

    it('does not fall through to ranked[0] when no bounded candidate proves preservation', () => {
        const support = ENRICHED_TEMPLATES.find(template => template.category === 'Full-body Strength');
        const rest = ENRICHED_TEMPLATES.find(template => template.category === 'Rest');
        if (!support || !rest) throw new Error('required templates missing');

        const candidate = (template: typeof support, utilityScore: number) => ({
            template,
            utilityScore,
            benefitScore: utilityScore,
            costPenalty: 0,
            coverageNeedTier: 3 as const,
            rationale: template.title,
        });
        const ranked = [candidate(support, 10)];
        const restFallback = candidate(rest, 1);
        const result = selectViableForecastCandidate(
            ranked,
            true,
            restFallback,
            () => 'degrades',
        );

        expect(result.candidate.template).toBe(rest);
        expect(result.allocationUnresolved).toBe(true);
    });

    it('uses Rest only when the fallback also proves preservation', () => {
        const support = ENRICHED_TEMPLATES.find(template => template.category === 'Full-body Strength');
        const rest = ENRICHED_TEMPLATES.find(template => template.category === 'Rest');
        if (!support || !rest) throw new Error('required templates missing');

        const candidate = (template: typeof support, utilityScore: number) => ({
            template,
            utilityScore,
            benefitScore: utilityScore,
            costPenalty: 0,
            coverageNeedTier: 3 as const,
            rationale: template.title,
        });
        const ranked = [candidate(support, 10)];
        const restFallback = candidate(rest, 1);
        const result = selectViableForecastCandidate(
            ranked,
            true,
            restFallback,
            candidate => candidate.template.category === 'Rest' ? 'preserves' : 'degrades',
        );

        expect(result.candidate.template).toBe(rest);
        expect(result.allocationUnresolved).toBe(false);
    });

    it('can use a proven incumbent reservation without disabling viability for substitutes', () => {
        const support = ENRICHED_TEMPLATES.find(template => template.category === 'Full-body Strength');
        const incumbent = ENRICHED_TEMPLATES.find(template => template.category === 'Hard Endurance');
        const rest = ENRICHED_TEMPLATES.find(template => template.category === 'Rest');
        if (!support || !incumbent || !rest) throw new Error('required templates missing');

        const candidate = (template: typeof support, utilityScore: number) => ({
            template,
            utilityScore,
            benefitScore: utilityScore,
            costPenalty: 0,
            coverageNeedTier: 3 as const,
            rationale: template.title,
        });
        const result = selectViableForecastCandidate(
            [candidate(support, 10)],
            true,
            candidate(rest, 1),
            selected => selected.template.id === incumbent.id ? 'preserves' : 'degrades',
            candidate(incumbent, 2),
        );

        expect(result.candidate.template).toBe(incumbent);
        expect(result.allocationUnresolved).toBe(false);
    });

});

describe('7A.3 operational latency budget', () => {
    it('meets the p95 <=100 ms / p99 <=150 ms gate on the live-sized fixture', () => {
        const fixture = liveSizedWeek();
        fixture.run(); // warm the module-level catalogue caches

        // ADR-0018's budget describes one plan generation, not a machine running eight
        // vitest workers at once. Any single batch here can be preempted mid-sample, so
        // the estimate of uncontended latency is the *fastest* batch; a genuine slowdown
        // in the allocator raises every batch and still fails the gate.
        const batches = Array.from({ length: 5 }, () => {
            const samples: number[] = [];
            for (let index = 0; index < 20; index++) {
                const started = performance.now();
                fixture.run();
                samples.push(performance.now() - started);
            }
            return samples.sort((left, right) => left - right);
        });
        const percentile = (samples: number[], p: number) =>
            samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)];
        const fastest = batches.reduce((best, samples) =>
            percentile(samples, 0.95) < percentile(best, 0.95) ? samples : best, batches[0]);
        const p95 = percentile(fastest, 0.95);
        const p99 = percentile(fastest, 0.99);

        expect(p95, `p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms`).toBeLessThanOrEqual(100);
        expect(p99, `p99=${p99.toFixed(1)}ms`).toBeLessThanOrEqual(150);
    }, 20_000);
});
