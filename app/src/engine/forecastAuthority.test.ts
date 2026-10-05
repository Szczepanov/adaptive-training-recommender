import { describe, expect, it } from 'vitest';
import type { AuthoredPlanBlock, DailyReadiness, Recommendation, TrainingIntentProfile, UserContext, UserEvent, UserPreferences } from './models';
import { completedExposureFromProjection, generateWeekAheadPlanWithIntent, type ProjectionExposure, type WeekAheadDay, type WeekAheadPlan } from './planner';
import { evaluateTrainingWithIntent } from './rules';
import { resolveTrainingIntent } from './trainingIntent';
import { resolveEvergreenPlan } from './evergreenPlanning';
import { evaluatePeriodizationPhase } from './periodization';
import { resolvePlanningContext, usesEvergreenProgramming } from './planningMode';
import { resolveActivePlanDefinitionForEvent, type PlanDefinition } from './planSchedule';
import { buildCoverageState, resolveCoverageHistory, type CoverageState } from './coverage';
import { runScenario, toCompletedExposure } from './simulation/analyze';
import { SCENARIOS } from './simulation/scenarios';
import { inferAthleteTrainingState } from './evergreenStrategy';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { addDaysToLocalDateString } from '../utils/localDate';

const readiness: DailyReadiness = {
    subjective: { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8, timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null },
    objective: { total_steps: 8000, sleep_score: 85, sleep_duration_min: 480, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0, hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 90, last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null, sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0, hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7 },
};
const context: UserContext = { goals: { shortTerm: '', midTerm: '', longTerm: '' }, constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 60 }, preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false } };
const preferences: UserPreferences = { userId: 'u1', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60, preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [], explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '' };
const profile: TrainingIntentProfile = {
    userId: 'u1', planningMode: 'event_directed', priorities: ['health'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
    capabilityMaintenance: { enabled: true, capabilities: ['linear_speed_skill'] },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
};
const event: UserEvent = { id: 'race', title: 'Synthetic cycling event', date: '2026-09-13', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event', demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.7, repeatedSurges: 0.7, sprintPower: 0.3, fatigueResistance: 0.8, neuromuscular: 0.3 } };
const rest: Recommendation = { template: ENRICHED_TEMPLATES_BY_ID.get('rest_01')!, rationale: 'fixture', mode: 'recover' };

function historyProvider(exposures: readonly CompletedExposure[]): TrainingHistoryProvider {
    const bounded = (date: string, days: number) => exposures.filter(exposure =>
        exposure.date >= addDaysToLocalDateString(date, -days) && exposure.date < date);
    return {
        reconstruct: async (_userId, date, days) => bounded(date, days),
        getSnapshot: async (_userId, date, days): Promise<TrainingHistorySnapshot> => ({
            throughDateExclusive: date, windowDays: days, exposures: bounded(date, days), completedEvents: [],
            sourceStates: { activities: { status: 'AVAILABLE', revision: 'synthetic' }, recommendations: { status: 'AVAILABLE', revision: 'synthetic' }, manualTraining: { status: 'MISSING' } },
            generatedAt: '', revision: `synthetic:${date}:${days}`,
        }),
    };
}

function recommendationDay(date: string, recommendation: Recommendation): WeekAheadDay {
    return { date, dayOffset: 0, confidence: 'provisional', phaseName: 'Base',
        template: recommendation.template, mode: recommendation.mode === 'recover' ? 'recover' : 'train',
        rationale: recommendation.rationale, addressesObjectives: [], activeDose: recommendation.activeDose };
}

function contexts(start: string, days: number, events: UserEvent[], intentProfile = profile, blocks: AuthoredPlanBlock[] = []) {
    return Array.from({ length: days + 1 }, (_, offset) => {
        const date = addDaysToLocalDateString(start, offset);
        return { date, context: resolvePlanningContext(intentProfile,
            evaluatePeriodizationPhase(events, date, start), date, null, blocks) };
    });
}

function requirements(state: CoverageState | undefined) {
    return state?.requirements.map(requirement => ({
        key: requirement.key, minimumSessions: requirement.minimumSessions, targetSessions: requirement.targetSessions,
        requirement: requirement.requirement, minimumDurationMinutes: requirement.minimumDurationMinutes,
        exactWorkoutIds: requirement.exactWorkoutIds, eligibleWorkoutIds: requirement.eligibleWorkoutIds,
    }));
}

function activeBlock(plan: PlanDefinition | null, date: string) {
    return plan?.blocks.find(block => block.startDate <= date && date <= block.endDate) ?? null;
}

async function forecast(start: string, events: UserEvent[], days = 7, intentProfile = profile,
    blocks: AuthoredPlanBlock[] = [], today = rest, initialHistory: readonly CompletedExposure[] = []) {
    return generateWeekAheadPlanWithIntent('u1', readiness, context, preferences, events, start, today,
        null, { days, authoredPlanBlocks: blocks, mechanicalCheckinHistory: [] }, historyProvider(initialHistory), undefined, intentProfile);
}

/** The oracle takes the forecast sessions as performed facts, then enters the independent live path. */
async function expectLiveAuthority(plan: WeekAheadPlan, start: string, target: string, events: UserEvent[],
    intentProfile = profile, blocks: AuthoredPlanBlock[] = [], today = rest, initialHistory: readonly CompletedExposure[] = []) {
    const performed = [...initialHistory, ...[recommendationDay(start, today), ...plan.days.filter(day => day.date < target)]
        .map(day => toCompletedExposure(day))];
    const provider = historyProvider(performed);
    const recommendation = await evaluateTrainingWithIntent('u1', readiness, context, events, target,
        undefined, provider, undefined, [], blocks, intentProfile, preferences);
    const intent = await resolveTrainingIntent('u1', events, target, readiness, 7, provider, undefined, blocks, intentProfile);
    const evergreen = resolveEvergreenPlan(intent.planningContext, intent.periodization.phase,
        intent.history, intent.historySnapshot, preferences, context, target, [], 7, false, [], new Map(),
        intent.aerobicVolumeFloor, false, { exposureHistory: intent.mechanicalExposureHistory,
            observedWindowDays: intent.mechanicalEvidenceObservedWindowDays, checkinHistory: [] });
    const livePlan = evergreen?.planDefinition ?? resolveActivePlanDefinitionForEvent(
        intent.planningContext.focusEvent, target, blocks, intent.eventStrengthSupportSessions);
    const liveMicrocycle = evergreen?.microcycle ?? intent.microcycle;
    const liveCoverage = buildCoverageState(livePlan, target,
        resolveCoverageHistory(intent.performedTrainingFacts, intent.history), undefined, intent.aerobicVolumeFloor);
    const day = plan.days.find(candidate => candidate.date === target)!;
    expect(day, 'the boundary must appear in the projected strip').toBeDefined();
    const authority = plan.authoritySegments?.find(segment => segment.id === day.diagnostics?.authorityId);
    expect(authority, 'the projected day must name its authority segment').toBeDefined();
    const forecastCoverage = day.diagnostics?.coverageState;
    // Compare every programming authority named by #933, rather than only mode labels or chosen templates.
    expect({
        mode: authority!.planningContext.mode,
        strategy: authority!.planningContext.eventStrategy,
        focusEvent: authority!.planningContext.focusEvent?.id ?? null,
        coverageSet: forecastCoverage?.coverageSetId,
        block: activeBlock(authority!.planDefinition, target),
        activeBlockId: forecastCoverage?.activeBlockId,
        objectives: day.diagnostics?.activeObjectives?.map(objective => objective.key).sort(),
        weeklyRequirements: requirements(forecastCoverage),
        doseOwner: authority!.planDefinition?.coverageSetId,
        plannedDose: day.diagnostics?.plannedDose,
        capabilityMaintenance: authority!.evergreen?.capabilityMaintenance ?? null,
    }).toEqual({
        mode: intent.planningContext.mode,
        strategy: intent.planningContext.eventStrategy,
        focusEvent: intent.planningContext.focusEvent?.id ?? null,
        coverageSet: liveCoverage.coverageSetId,
        block: activeBlock(livePlan, target),
        activeBlockId: liveCoverage.activeBlockId,
        objectives: liveMicrocycle.objectives.map(objective => objective.key).sort(),
        weeklyRequirements: requirements(liveCoverage),
        doseOwner: livePlan?.coverageSetId,
        plannedDose: recommendation.plannedDose,
        capabilityMaintenance: recommendation.capabilityMaintenance ?? null,
    });
    expect(authority!.evergreen?.capabilityMaintenance ?? null).toEqual(evergreen?.capabilityMaintenance ?? null);
    return { day, authority: authority!, liveCoverage, liveMicrocycle, evergreen, intent, performed };
}

describe('#933 date-local forecast programming authority', () => {
    it('hands Evergreen fallback to the structured event plan at the production activation boundary', async () => {
        const start = '2026-06-18';
        const probe = contexts(start, 7, [event]);
        const boundary = probe.find(({ context: resolved }) => !usesEvergreenProgramming(resolved))!.date;
        expect(probe[0].context.eventStrategy).toBe('evergreen_fallback');
        expect(boundary).toBe('2026-06-21');
        const plan = await forecast(start, [event]);
        const { authority } = await expectLiveAuthority(plan, start, boundary, [event]);
        expect(authority.planningContext.eventStrategy).toBe('structured_plan');
        const segments = plan.authoritySegments!;
        expect(segments.map(segment => segment.startDate)).toEqual([start, boundary]);
        expect(segments[0].planDefinition?.coverageSetId).toBe('evergreen_general');
        expect(authority.planDefinition?.coverageSetId).not.toBe('evergreen_general');
        const sameRole = plan.allocationReport.outcomes.filter(outcome => outcome.occurrence.coverageKey === 'primary_strength');
        expect(new Set(sameRole.map(outcome => outcome.occurrence.authorityId)).size).toBe(2);
        expect(new Set(plan.allocationReport.outcomes.map(outcome => outcome.occurrence.id)).size)
            .toBe(plan.allocationReport.outcomes.length);
    });

    it.each(['completed', 'DNF'] as const)('hands %s event recovery back to Evergreen at D+4, before the authored D+7 block ends', async lifecycle => {
        const completedEvent = { ...event, lifecycle };
        const start = '2026-09-14';
        const probe = contexts(start, 7, [completedEvent]);
        const boundary = probe.find(({ context: resolved }) => usesEvergreenProgramming(resolved))!.date;
        expect(probe[0].context.eventStrategy).toBe('structured_plan');
        expect(boundary).toBe('2026-09-17');
        const recoveryPlan = resolveActivePlanDefinitionForEvent(completedEvent, start)!;
        expect(activeBlock(recoveryPlan, boundary)).toMatchObject({ phase: 'recovery', endDate: '2026-09-20' });
        const plan = await forecast(start, [completedEvent]);
        const { authority, day } = await expectLiveAuthority(plan, start, boundary, [completedEvent]);
        expect(authority.planningContext.mode).toBe('evergreen');
        expect(authority.evergreen?.capabilityMaintenance).not.toBeNull();
        expect(day.diagnostics?.coverageState?.coverageSetId).toBe('evergreen_general');
        expect(plan.authoritySegments?.map(segment => segment.startDate)).toEqual([start, boundary]);
    });

    it('keeps an explicitly Evergreen profile on one authority even when an event plan starts', async () => {
        const evergreenProfile = { ...profile, planningMode: 'evergreen' as const };
        const start = '2026-06-18';
        expect(contexts(start, 6, [event], evergreenProfile).every(({ context: resolved }) => usesEvergreenProgramming(resolved))).toBe(true);
        const plan = await forecast(start, [event], 6, evergreenProfile);
        expect(plan.authoritySegments).toHaveLength(1);
        expect(plan.days.every(day => day.diagnostics?.coverageState?.coverageSetId === 'evergreen_general')).toBe(true);
        expect(new Set(plan.days.map(day => day.diagnostics?.authorityId)).size).toBe(1);
    });

    it('honors an eligible early authored travel interval and gives returning Evergreen roles new occurrence identities', async () => {
        const start = '2026-06-07';
        const travel: AuthoredPlanBlock[] = [{ id: 'early', userId: 'u1', eventId: event.id,
            phase: 'travel', startDate: '2026-06-09', endDate: '2026-06-11', volumeScale: 0.4, intensityScale: 0.4,
            createdAt: '', updatedAt: '' }];
        const probe = contexts(start, 7, [event], profile, travel);
        expect(probe.filter(({ context: resolved }) => !usesEvergreenProgramming(resolved)).map(item => item.date))
            .toEqual(['2026-06-09', '2026-06-10', '2026-06-11']);
        const plan = await forecast(start, [event], 7, profile, travel);
        await expectLiveAuthority(plan, start, '2026-06-09', [event], profile, travel);
        await expectLiveAuthority(plan, start, '2026-06-12', [event], profile, travel);
        expect(plan.authoritySegments?.map(segment => segment.startDate)).toEqual([start, '2026-06-09', '2026-06-12']);
        const evergreenSegments = plan.authoritySegments!.filter(segment => usesEvergreenProgramming(segment.planningContext));
        expect(new Set(evergreenSegments.map(segment => segment.id)).size).toBe(2);
        const strength = plan.allocationReport.outcomes.filter(outcome => outcome.occurrence.coverageKey === 'primary_strength');
        expect(new Set(strength.map(outcome => outcome.occurrence.authorityId)).size).toBe(2);
        expect(new Set(strength.map(outcome => outcome.occurrence.id)).size).toBe(strength.length);
    });

    it('counts the reduced T-1 session exactly once in the new owner’s objective credit', async () => {
        const start = '2026-06-20';
        const strengthTemplate = ENRICHED_TEMPLATES_BY_ID.get('str_full_01');
        expect(strengthTemplate).toBeDefined();
        const today: Recommendation = { template: strengthTemplate!, activeDose: strengthTemplate!.easierDose,
            rationale: 'Synthetic reduced T-1 session', mode: 'train' };
        const plan = await forecast(start, [event], 3, profile, [], today);
        const { day, liveMicrocycle, performed } = await expectLiveAuthority(plan, start, '2026-06-21', [event], profile, [], today);
        expect(performed).toHaveLength(1);
        const forecastStrength = day.diagnostics!.activeObjectives!.find(objective => objective.key === 'strength_maintenance')!;
        const liveStrength = liveMicrocycle.objectives.find(objective => objective.key === 'strength_maintenance')!;
        const earnedOnce = liveStrength.completedCredit ?? liveStrength.completedExposures;
        expect(earnedOnce).toBeGreaterThan(0);
        expect(earnedOnce).toBeLessThan(1);
        expect(forecastStrength.completedCredit + forecastStrength.projectedCredit).toBeCloseTo(earnedOnce);
    });

    it('retains roles packed beyond a short forecast as planned_beyond_horizon', async () => {
        const start = '2026-09-15';
        const completedEvent = { ...event, lifecycle: 'completed' as const };
        const plan = await forecast(start, [completedEvent], 3);
        const boundary = contexts(start, 3, [completedEvent]).find(({ context: resolved }) => usesEvergreenProgramming(resolved))!.date;
        await expectLiveAuthority(plan, start, boundary, [completedEvent]);
        const later = plan.allocationReport.outcomes.filter(outcome =>
            outcome.occurrence.plannedDate && outcome.occurrence.plannedDate > plan.days.at(-1)!.date);
        expect(later.length).toBeGreaterThan(0);
        expect(later.every(outcome => outcome.status === 'planned_beyond_horizon' && outcome.reason === undefined)).toBe(true);
    });

    it('crosses the completed-event authority boundary through the registered simulation scenario', async () => {
        const scenario = SCENARIOS.find(candidate => candidate.id === 'cycling_recovery_authority_exit');
        expect(scenario).toBeDefined();
        const fixture = { ...scenario!, context, preferences, trainingIntentProfile: profile,
            readinessForWeek: () => readiness, readinessForDate: undefined };
        const events = [...(fixture.events ?? (fixture.event ? [fixture.event] : []))];
        const boundary = contexts(fixture.startDate, 6, events).find(({ context: resolved }) => usesEvergreenProgramming(resolved))!.date;
        const captures: Array<{ plan: WeekAheadPlan; today: Recommendation }> = [];
        const result = await runScenario(fixture, async (...args) => {
            const plan = await generateWeekAheadPlanWithIntent(...args);
            captures.push({ plan, today: args[6] });
            return plan;
        });
        expect(result.weeksSimulated).toBe(1);
        expect(captures).toHaveLength(1);
        const { plan, today } = captures[0];
        expect(plan.authoritySegments![0].planningContext.eventStrategy).toBe('structured_plan');
        const { day } = await expectLiveAuthority(plan, fixture.startDate, boundary, events, profile, [], today, fixture.initialHistory);
        expect(day.diagnostics?.coverageState?.coverageSetId).toBe('evergreen_general');
        const originalOwner = plan.authoritySegments![0].id;
        expect(plan.days.filter(projected => projected.date >= boundary)
            .every(projected => projected.diagnostics?.authorityId !== originalOwner)).toBe(true);
    });

    it('keeps external mode without a placed session on the labelled Evergreen fallback', async () => {
        const externalProfile = { ...profile, planningMode: 'externally_planned' as const };
        const start = '2026-06-18';
        const plan = await forecast(start, [event], 6, externalProfile);
        expect(plan.authoritySegments).toHaveLength(1);
        expect(plan.authoritySegments![0].planningContext).toMatchObject({
            mode: 'evergreen', externalFallback: true, eventStrategy: null, focusEvent: null,
        });
        expect(plan.days.every(day => day.diagnostics?.coverageState?.coverageSetId === 'evergreen_general')).toBe(true);
    });

    it('merges projected pre-boundary sessions into the proven wider athlete-state evidence before packing endurance dose', async () => {
        const start = '2026-09-14';
        const completedEvent = { ...event, lifecycle: 'completed' as const };
        const enduranceProfile = { ...profile, priorities: ['endurance'] as TrainingIntentProfile['priorities'] };
        // Eleven recorded sessions are just below the established-athlete gate. Performed
        // forecast sessions must enter the same proven 28-day state window as the live path.
        const initialHistory: CompletedExposure[] = Array.from({ length: 11 }, (_, index) => ({
            ...toCompletedExposure(recommendationDay(addDaysToLocalDateString(start, -24 + index * 2), {
                template: ENRICHED_TEMPLATES_BY_ID.get('end_easy_01')!, mode: 'train', rationale: 'Synthetic chronic cycling',
            })),
            occurrenceKey: `historical-cycling:${index}`,
            trainingRecordLike: { type: 'Cycling zone 2', duration_min: 75, training_effect: 2, intensity_tag: 'easy' },
        }));
        const boundary = contexts(start, 6, [completedEvent], enduranceProfile)
            .find(({ context: resolved }) => usesEvergreenProgramming(resolved))!.date;
        const plan = await forecast(start, [completedEvent], 6, enduranceProfile, [], rest, initialHistory);
        const { authority, evergreen, intent, performed } = await expectLiveAuthority(
            plan, start, boundary, [completedEvent], enduranceProfile, [], rest, initialHistory);
        const stateEvidence = intent.historySnapshot!.athleteStateEvidence!;
        expect(stateEvidence.observedWindowDays).toBe(28);
        expect(stateEvidence.exposures.map(exposure => exposure.occurrenceKey))
            .toEqual(performed.map(exposure => exposure.occurrenceKey));
        expect(inferAthleteTrainingState(initialHistory, 28).trainingAgeProxy).toBe('developing');
        expect(inferAthleteTrainingState(stateEvidence.exposures, 28).trainingAgeProxy).toBe('established');
        expect(authority.evergreen!.budget.requirements).toEqual(evergreen!.budget.requirements);
        const withoutProjected = resolveEvergreenPlan(intent.planningContext, intent.periodization.phase,
            intent.history.filter(exposure => exposure.date < start),
            { ...intent.historySnapshot!, athleteStateEvidence: { observedWindowDays: 28, exposures: initialHistory } },
            preferences, context, boundary, [], 7, false, [], new Map(), intent.aerobicVolumeFloor, false,
            { exposureHistory: initialHistory, observedWindowDays: 28, checkinHistory: [] });
        expect(authority.evergreen!.budget.requirements).not.toEqual(withoutProjected!.budget.requirements);
    });

    it('preserves the exact T-1 capability identity when recovery hands back to Evergreen', async () => {
        const start = '2026-09-16';
        const completedEvent = { ...event, lifecycle: 'completed' as const };
        const today: Recommendation = {
            template: ENRICHED_TEMPLATES_BY_ID.get('field_technical_01')!,
            mode: 'train', rationale: 'Synthetic exact linear-speed skill touch at D+3',
        };
        const boundary = contexts(start, 3, [completedEvent])
            .find(({ context: resolved }) => usesEvergreenProgramming(resolved))!.date;
        expect(boundary).toBe('2026-09-17');
        const plan = await forecast(start, [completedEvent], 3, profile, [], today);
        const { authority, intent } = await expectLiveAuthority(plan, start, boundary, [completedEvent], profile, [], today);
        expect(intent.mechanicalEvidenceObservedWindowDays).toBe(28);
        expect(authority.evergreen!.capabilityMaintenance!.capabilities.find(capability =>
            capability.capability === 'linear_speed_skill')).toMatchObject({ status: 'satisfied', lastQualifyingDate: start });
    });

    it('derives catalog workout identity only for exact projected evidence and preserves explicit fixed identities', () => {
        const template = ENRICHED_TEMPLATES_BY_ID.get('field_technical_01')!;
        const projected: ProjectionExposure = { occurrenceKey: 'fixed:synthetic', date: '2026-09-16',
            templateId: template.id, modality: template.modality, category: template.category,
            stimulus: template.stimulusProfile!, durationMin: template.durationMin };
        const exact = completedExposureFromProjection(projected);
        expect(exact.workoutId).toBeDefined();
        for (const stimulusConfidence of ['inferred', 'unknown'] as const) {
            expect(completedExposureFromProjection({ ...projected, stimulusConfidence }).workoutId).toBeUndefined();
        }
        expect(completedExposureFromProjection({ ...projected, workoutId: 'explicit-fixed-workout',
            stimulusConfidence: 'inferred' }).workoutId).toBe('explicit-fixed-workout');
    });

    it('retains contributor objective keys when Evergreen hands authority to a structured cycling plan', async () => {
        const start = '2026-06-18';
        const governingEvent: UserEvent = { ...event, demandProfile: { ...event.demandProfile,
            thresholdPower: 0.1, vo2MaxPower: 0.1, repeatedSurges: 0.1 } };
        const contributor: UserEvent = { ...event, id: 'running-contributor', title: 'Synthetic running contributor',
            category: 'running_race', date: '2026-07-12', priority: 'B',
            demandProfile: { ...event.demandProfile, thresholdPower: 0.8, vo2MaxPower: 0.8, repeatedSurges: 0.8 } };
        const events = [governingEvent, contributor];
        const boundary = contexts(start, 6, events)
            .find(({ context: resolved }) => !usesEvergreenProgramming(resolved))!.date;
        expect(boundary).toBe('2026-06-21');
        const plan = await forecast(start, events, 6);
        const { authority, day } = await expectLiveAuthority(plan, start, boundary, events);
        expect(authority.planningContext.focusEvent?.id).toBe(governingEvent.id);
        const block = activeBlock(authority.planDefinition, boundary)!;
        const authoredKeys = authority.planDefinition!.objectives.filter(objective => objective.blockId === block.id)
            .map(objective => objective.key);
        expect(authoredKeys).not.toContain('threshold_quality');
        expect(authoredKeys).not.toContain('surge_repeatability');
        expect(day.diagnostics!.activeObjectives!.map(objective => objective.key))
            .toEqual(expect.arrayContaining(['threshold_quality', 'surge_repeatability']));
    });
});
