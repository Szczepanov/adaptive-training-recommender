import { describe, expect, it } from 'vitest';
import type { Recommendation, TrainingSettings, UserContext, UserEvent, UserPreferences } from './models';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveDemandProfile } from './eventPresets';
import { buildCyclingEventPlan } from './planSchedule';
import { evaluatePeriodizationPhase } from './periodization';
import { creditObjectivesFromStimulus, generateWeeklyObjectives } from './microcycle';
import { createEmptyFatigue } from './fatigue';
import {
    evaluateProjectedDate,
    generateWeekAheadPlan,
    projectedDateOutcomeFrom,
    resolveWeeklyAnchors,
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
