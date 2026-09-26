import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDemandProfile } from './eventPresets';
import { eventStrengthSupportSessions, resolveTrainingIntent } from './trainingIntent';
import { buildCoverageState, coverageNeedTierForTemplate } from './coverage';
import { deriveRequiredRoleOccurrences } from './weeklyAllocation';
import { creditObjectivesFromStimulus, generateWeeklyObjectives } from './microcycle';
import { buildCyclingEventPlan, resolvePlanDefinitionForEvent } from './planSchedule';
import { context, preferences, readiness } from './weeklyAllocationPlanner.fixtures';
import { evaluatePeriodizationPhase } from './periodization';
import { createEmptyFatigue } from './fatigue';
import { generateWeekAheadPlan } from './planner';
import { ENRICHED_TEMPLATES } from './templates';
import { strengthRequirement } from './evergreenStrategy';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { PlanningContext } from './planningMode';
import type { DailyReadiness, Recommendation, TrainingIntentProfile, UserEvent } from './models';
import type { TrainingHistoryProvider } from './trainingHistory';

const date = '2026-08-01';
const event: UserEvent = {
    id: 'hybrid-road-race', title: 'Road race', date: '2026-09-13', priority: 'A',
    lifecycle: 'scheduled', category: 'cycling_event',
    demandProfile: resolveDemandProfile('cycling_event', 'road_race'),
};
const historyProvider: TrainingHistoryProvider = { reconstruct: async () => [] };

function profile(priorities: TrainingIntentProfile['priorities']): TrainingIntentProfile {
    return {
        userId: 'hybrid-athlete', planningMode: 'event_directed', priorities,
        weeklyCommitment: { minSessions: 5, targetSessions: 6, maxSessions: 7 },
        organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
    };
}

describe('cycling hybrid event strength support (#801)', () => {
    it('preserves distinct exact roles from an active durable strength priority', async () => {
        const intent = await resolveTrainingIntent(
            'hybrid-athlete', [event], date, readiness, 7, historyProvider,
            undefined, [], profile(['endurance', 'strength_muscle']),
        );
        const plan = resolvePlanDefinitionForEvent(event, [], intent.eventStrengthSupportSessions);
        if (!plan) throw new Error('event plan unavailable');
        const coverage = buildCoverageState(plan, date);
        const strength = coverage.requirements.filter(item =>
            item.key === 'primary_strength' || item.key === 'compact_strength');
        expect(strength.map(item => [item.key, item.minimumSessions])).toEqual([
            ['primary_strength', 1], ['compact_strength', 1],
        ]);
        const occurrences = deriveRequiredRoleOccurrences(coverage).filter(item =>
            item.coverageKey === 'primary_strength' || item.coverageKey === 'compact_strength');
        expect(occurrences.map(item => item.coverageKey).sort()).toEqual(['compact_strength', 'primary_strength']);

        const physiological = generateWeeklyObjectives(
            intent.periodization.phase, date, event, plan, date,
        ).objectives.filter(item => item.key === 'strength_maintenance');
        expect(physiological).toHaveLength(1);
    });

    it('leaves profile-less and endurance-only event plans at one required strength role', async () => {
        const baseline = resolvePlanDefinitionForEvent(event);
        expect(baseline?.objectives.some(item => item.coverageKey === 'compact_strength')).toBe(false);
        const intent = await resolveTrainingIntent(
            'endurance-athlete', [event], date, readiness, 7, historyProvider,
            undefined, [], profile(['endurance']),
        );
        expect(intent.eventStrengthSupportSessions).toBe(0);
        const resolved = resolvePlanDefinitionForEvent(event, [], intent.eventStrengthSupportSessions);
        expect(resolved?.objectives.some(item => item.coverageKey === 'compact_strength')).toBe(false);
    });

    it('does not carry the support minimum into taper or race blocks', async () => {
        const intent = await resolveTrainingIntent(
            'hybrid-athlete', [event], date, readiness, 7, historyProvider,
            undefined, [], profile(['endurance', 'strength_muscle']),
        );
        const plan = resolvePlanDefinitionForEvent(event, [], intent.eventStrengthSupportSessions);
        if (!plan) throw new Error('event plan unavailable');
        expect(plan.objectives.filter(item =>
            (item.blockId === 'block_taper' || item.blockId === 'block_race')
            && item.coverageKey === 'compact_strength')).toHaveLength(0);
    });
});

describe('cycling build strength support in the weekly allocator (#801)', () => {
    const buildDate = '2026-08-01';

    function week(
        supportSessions: number,
        mutate: (ctx: ReturnType<typeof context>, day: typeof readiness) => void = () => {},
    ) {
        const periodization = evaluatePeriodizationPhase([event], buildDate);
        const planState = buildCyclingEventPlan(event, [], supportSessions);
        if (planState.status !== 'AVAILABLE') throw new Error('event plan unavailable');
        const raceSpecific = ENRICHED_TEMPLATES.find(item => item.category === 'Race-Specific Endurance' && item.modality === 'Cycling');
        const recovery = ENRICHED_TEMPLATES.find(item => item.category === 'Mobility/Recovery');
        if (!raceSpecific?.stimulusProfile || !recovery) throw new Error('templates missing');
        let microcycle = generateWeeklyObjectives(periodization.phase, addDaysToLocalDateString(buildDate, -7), event, planState.data, buildDate);
        microcycle = creditObjectivesFromStimulus(microcycle, raceSpecific.stimulusProfile, raceSpecific.modality, raceSpecific.category);
        const ctx = context();
        const day = structuredClone(readiness);
        mutate(ctx, day);
        const todayRec: Recommendation = { template: recovery, rationale: 'Recovery.', mode: 'recover' };
        return generateWeekAheadPlan(day as DailyReadiness, ctx, preferences, buildDate, todayRec, null,
            { microcycle, fatigue: createEmptyFatigue(buildDate), trailingHistory: [] },
            { days: 7, events: [event], planDefinition: planState.data });
    }
    const outcome = (plan: ReturnType<typeof week>, key: string) =>
        plan.allocationReport.outcomes.find(item => item.occurrence.coverageKey === key);
    const adverse = (_ctx: ReturnType<typeof context>, day: typeof readiness) => {
        Object.assign(day.subjective, { readiness: 3, fatigue: 8, soreness: 8 });
        Object.assign(day.objective, { hrv_delta: -15, rhr_delta: 7, body_battery_wake: 25, sleep_score: 45 });
    };

    it('derives the support count from the evergreen strength floor, so planning mode alone does not cut 2 to 1', () => {
        const floor = strengthRequirement('required').floor?.dose.value ?? 0;
        const eventContext = { mode: 'event_directed' } as PlanningContext;
        expect(floor).toBe(2);
        expect(1 + eventStrengthSupportSessions(eventContext, profile(['endurance', 'strength_muscle']))).toBe(floor);
        expect(eventStrengthSupportSessions(eventContext, profile(['endurance']))).toBe(0);
        expect(eventStrengthSupportSessions({ mode: 'evergreen' } as PlanningContext, profile(['endurance', 'strength_muscle']))).toBe(0);
    });

    it('reserves two distinct resistance exposures in a normal build week without moving the quality anchor', () => {
        const baseline = week(0);
        const supported = week(1);
        const primary = outcome(supported, 'primary_strength');
        const support = outcome(supported, 'compact_strength');
        expect(primary?.status).toBe('fulfilled');
        expect(support?.status).toBe('fulfilled');
        expect(primary?.reservation.assignedDate).not.toBe(support?.reservation.assignedDate);
        expect(support?.reservation.workoutId).toBe('strength_compact_power_01');
        // Primary roles keep exactly their baseline outcome and dates.
        for (const key of ['aerobic_volume', 'primary_strength', 'sustained_quality', 'outdoor_event_specific']) {
            expect(outcome(supported, key)?.status).toBe(outcome(baseline, key)?.status);
            expect(outcome(supported, key)?.reservation.assignedDate).toBe(outcome(baseline, key)?.reservation.assignedDate);
        }
        const strengthDays = supported.days.filter(day => day.template.modality === 'Strength');
        expect(strengthDays).toHaveLength(2);
        expect(new Set(strengthDays.map(day => day.date)).size).toBe(2);
    });

    it('defers the support exposure with a typed reason under adverse recovery without changing primary outcomes', () => {
        const baseline = week(0, adverse);
        const supported = week(1, adverse);
        // Typed deferral, never an unresolved search: fatigue gates the early free dates and the
        // last remaining dates belong to primary roles, so either reason is truthful.
        const deferred = outcome(supported, 'compact_strength');
        expect(deferred?.status).toBe('missed');
        expect(['projected_fatigue', 'subordinate_to_required_roles', 'hard_safety_or_recovery']).toContain(deferred?.reason);
        for (const key of ['aerobic_volume', 'primary_strength', 'sustained_quality']) {
            expect(outcome(supported, key)?.status).toBe(outcome(baseline, key)?.status);
        }
    });

    it('reports a typed shortfall when constrained capacity cannot fit the support exposure', () => {
        const capped = (ctx: ReturnType<typeof context>) => {
            ctx.trainingSettings!.defaults.weekdayMaxMinutes = 20;
            ctx.trainingSettings!.defaults.weekendMaxMinutes = 20;
            ctx.constraints.maxTimeMinutes = 20;
        };
        const support = outcome(week(1, capped), 'compact_strength');
        // Nothing fits a 20-minute cap: the time gate is the reason, not the primary roles.
        expect(support).toMatchObject({ status: 'missed', reason: 'no_exact_candidate' });
    });

    it('ranks an unmet support role as deferred support in today\'s pick, never as urgent as a primary role', () => {
        const plan = buildCyclingEventPlan(event, [], 1);
        if (plan.status !== 'AVAILABLE') throw new Error('event plan unavailable');
        const compact = ENRICHED_TEMPLATES.find(item => item.id === 'str_power_01');
        const fullBody = ENRICHED_TEMPLATES.find(item => item.id === 'str_full_01');
        if (!compact || !fullBody) throw new Error('templates missing');
        const noHistory = buildCoverageState(plan.data, '2026-08-05');
        expect(coverageNeedTierForTemplate(noHistory, fullBody)).toBe(1);
        expect(coverageNeedTierForTemplate(noHistory, compact)).toBe(2);
    });

    it('lets a primary definition for the same coverage key win over a support tier without losing its minimum', () => {
        const plan = buildCyclingEventPlan(event, [], 1);
        if (plan.status !== 'AVAILABLE') throw new Error('event plan unavailable');
        const support = plan.data.objectives.find(item => item.coverageKey === 'compact_strength');
        if (!support) throw new Error('support objective missing');
        const merged = {
            ...plan.data,
            objectives: [...plan.data.objectives, { ...support, reservationTier: undefined, priority: 'must_have' as const, coverageMinimumSessions: 2, coverageTargetSessions: 2 }],
        };
        const requirement = buildCoverageState(merged, '2026-08-05').requirements.find(item => item.key === 'compact_strength');
        expect(requirement).toMatchObject({ minimumSessions: 2, targetSessions: 2, priority: 'must_have' });
        expect(requirement?.reservationTier).toBeUndefined();
    });

    it('keeps support roles out of peak, taper and race blocks and never inflates primary-strength credit', () => {
        const plan = buildCyclingEventPlan(event, [], 1);
        if (plan.status !== 'AVAILABLE') throw new Error('event plan unavailable');
        expect(plan.data.objectives.filter(item => item.coverageKey === 'compact_strength').map(item => item.blockId)).toEqual(['block_build']);
        const state = buildCoverageState(plan.data, '2026-08-05', [{ date: '2026-08-03', templateId: 'str_power_01' }]);
        expect(state.requirements.find(item => item.key === 'primary_strength')?.completedSessions).toBe(0);
        expect(state.requirements.find(item => item.key === 'compact_strength')).toMatchObject({ completedSessions: 1, reservationTier: 'support' });
    });
});

describe('event-plan construction threading guard (#801)', () => {
    // The first #801 attempt computed the support count in resolveTrainingIntent only, while
    // the optimizer, planner and sequence search silently rebuilt the plan without it.
    // Every decision-path construction must forward the durable-intent count.
    const DIAGNOSTIC_ONLY = new Set([
        'planningMode.ts', // only asks whether a structured plan exists for the event
        'simulation/analyze.ts', // forecast/daily parity diagnostic; support roles carry no objective credit
    ]);

    function sources(dir: string, prefix = ''): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) return sources(join(dir, entry.name), relative);
            return entry.name.endsWith('.ts') && !entry.name.includes('.test.') && !entry.name.includes('.fixtures.') ? [relative] : [];
        });
    }

    it('passes the support count to every decision-path resolvePlanDefinitionForEvent call', () => {
        const engineDir = __dirname;
        const offenders = sources(engineDir)
            .filter(file => !DIAGNOSTIC_ONLY.has(file) && file !== 'planSchedule.ts')
            .flatMap(file => {
                const text = readFileSync(join(engineDir, file), 'utf-8');
                return [...text.matchAll(/resolvePlanDefinitionForEvent\(([^;]*?)\)/gs)]
                    .filter(match => !/strengthSupportSessions/i.test(match[1]))
                    .map(match => `${file}: resolvePlanDefinitionForEvent(${match[1].replace(/\s+/g, ' ')})`);
            });
        expect(offenders).toEqual([]);
    });
});
