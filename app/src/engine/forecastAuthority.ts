import type { AuthoredPlanBlock, FixedActivity, MicrocycleState, ScheduleOverlay, TrainingIntentProfile, UserContext, UserEvent, UserPreferences } from './models';
import type { CompletedExposure } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { evaluatePeriodizationPhase, resolveMultiEventObjectives, type PeriodizationResult } from './periodization';
import { resolvePlanningContext, usesEvergreenProgramming, type PlanningContext } from './planningMode';
import { resolveActivePlanDefinitionForEvent, type PlanDefinition } from './planSchedule';
import { resolveEvergreenPlan, type EvergreenMechanicalInputs, type ResolvedEvergreenPlan } from './evergreenPlanning';
import { buildMicrocycleState } from './microcycle';
import type { AerobicVolumeFloor } from './aerobicVolumeFloor';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { addDaysToLocalDateString } from '../utils/localDate';

export interface ForecastAuthority {
    id: string;
    startDate: string;
    endDate: string;
    planningContext: PlanningContext;
    planDefinition: PlanDefinition | null;
    microcycle: MicrocycleState;
    evergreen: ResolvedEvergreenPlan | null;
    completedHistory: readonly CompletedExposure[];
}

export type ForecastAuthorityResolver = (date: string, projected: readonly CompletedExposure[]) => ForecastAuthority;

/** The IO boundary supplies durable inputs once. Every speculative branch resolves the same
 * production authority using its own occurrence ledger; no branch can seed another branch. */
export function createForecastAuthorityResolver(inputs: {
    todayDate: string;
    days: number;
    events: UserEvent[];
    profile: TrainingIntentProfile | null;
    history: readonly CompletedExposure[];
    historySnapshot: TrainingHistorySnapshot | null;
    preferences: UserPreferences | null;
    context: UserContext;
    fixedActivities: readonly FixedActivity[];
    authoredPlanBlocks: readonly AuthoredPlanBlock[];
    scheduleOverlays: readonly ScheduleOverlay[];
    eventStrengthSupportSessions: number;
    aerobicVolumeFloor: AerobicVolumeFloor | null;
    isAdverseRecovery: boolean;
    hasCurrentClinicalSymptoms: boolean;
    mechanical: EvergreenMechanicalInputs;
    initialEvergreen?: ResolvedEvergreenPlan | null;
}): ForecastAuthorityResolver {
    const contextOn = (date: string) => resolvePlanningContext(inputs.profile,
        evaluatePeriodizationPhase(inputs.events, date, inputs.todayDate), date, null, inputs.authoredPlanBlocks);
    const ownerOn = (date: string): string => {
        const context = contextOn(date);
        return usesEvergreenProgramming(context) ? 'evergreen'
            : `${context.eventStrategy ?? context.mode}:${context.focusEvent?.id ?? ''}`;
    };
    const segments: Array<{ id: string; owner: string; startDate: string; endDate: string }> = [];
    // Include a full rolling week beyond the strip so ownership and packing are not
    // truncated by the visible forecast horizon.
    for (let offset = 0; offset <= inputs.days + 7; offset++) {
        const date = addDaysToLocalDateString(inputs.todayDate, offset);
        const owner = ownerOn(date);
        const previous = segments.at(-1);
        const rollingWeekExpired = previous?.owner === 'evergreen'
            && date > addDaysToLocalDateString(previous.startDate, 6);
        if (previous?.owner === owner && !rollingWeekExpired) previous.endDate = date;
        else segments.push({ id: `${owner}@${date}`, owner, startDate: date, endDate: date });
    }
    const seeds = new Map<string, ForecastAuthority>();
    return (date, projected) => {
        const segment = segments.find(item => item.startDate <= date && date <= item.endDate);
        if (!segment) throw new Error(`Forecast authority outside resolved horizon: ${date}`);
        const priorProjected = projected.filter(exposure => exposure.date < segment.startDate)
            .sort((left, right) => left.date.localeCompare(right.date)
                || (left.occurrenceKey ?? '').localeCompare(right.occurrenceKey ?? ''));
        const key = `${segment.id}:${JSON.stringify(priorProjected)}`;
        const cached = seeds.get(key);
        if (cached) return cached;
        const mergeEvidence = (base: readonly CompletedExposure[], windowDays: number) => {
            const start = addDaysToLocalDateString(segment.startDate, -windowDays);
            const ledger = new Map<string, CompletedExposure>();
            [...base, ...priorProjected].filter(exposure => exposure.date >= start && exposure.date < segment.startDate)
                .forEach((exposure, index) => ledger.set(exposure.occurrenceKey ?? `historical:${index}`, exposure));
            return [...ledger.values()].sort((left, right) => left.date.localeCompare(right.date));
        };
        const history = mergeEvidence(inputs.history, 7);
        const snapshot = inputs.historySnapshot;
        const stateEvidence = snapshot?.athleteStateEvidence;
        const projectedSnapshot = snapshot ? {
            ...snapshot, throughDateExclusive: segment.startDate, exposures: mergeEvidence(snapshot.exposures, snapshot.windowDays),
            ...(stateEvidence ? { athleteStateEvidence: {
                ...stateEvidence, exposures: mergeEvidence(stateEvidence.exposures, stateEvidence.observedWindowDays),
            } } : {}),
        } : null;
        const planningContext = contextOn(segment.startDate);
        const periodization = evaluatePeriodizationPhase(inputs.events, segment.startDate, inputs.todayDate);
        const evergreen = segment.startDate === inputs.todayDate && inputs.initialEvergreen !== undefined
            ? inputs.initialEvergreen : resolveEvergreenPlan(planningContext, periodization.phase, history, projectedSnapshot,
            inputs.preferences, inputs.context, segment.startDate, inputs.fixedActivities, 7,
            inputs.isAdverseRecovery, inputs.scheduleOverlays, new Map(), inputs.aerobicVolumeFloor,
            inputs.hasCurrentClinicalSymptoms, {
                ...inputs.mechanical,
                exposureHistory: mergeEvidence(inputs.mechanical.exposureHistory ?? inputs.history,
                    inputs.mechanical.observedWindowDays ?? 7),
            });
        const planDefinition = evergreen?.planDefinition ?? (planningContext.eventStrategy === 'structured_plan'
            ? resolveDateLocalPlanDefinition(null, periodization, segment.startDate,
                inputs.authoredPlanBlocks, inputs.eventStrengthSupportSessions) : null);
        let microcycle = evergreen?.microcycle ?? buildMicrocycleState(periodization.phase,
            addDaysToLocalDateString(segment.startDate, -7), history, planningContext.focusEvent, planDefinition, segment.startDate);
        if (!evergreen) microcycle = { ...microcycle, objectives: resolveMultiEventObjectives(
            inputs.events, segment.startDate, periodization, microcycle.objectives).objectives };
        const resolved = { ...segment, planningContext, planDefinition, microcycle, evergreen,
            completedHistory: inputs.history };
        seeds.set(key, resolved);
        return resolved;
    };
}

export function resolveDateLocalPlanDefinition(
    suppliedPlanDefinition: PlanDefinition | null | undefined,
    periodization: PeriodizationResult,
    date: string,
    authoredPlanBlocks: readonly AuthoredPlanBlock[],
    eventStrengthSupportSessions: number,
): PlanDefinition | null {
    const activeEventPlan = resolveActivePlanDefinitionForEvent(
        periodization.focusEvent,
        date,
        authoredPlanBlocks,
        eventStrengthSupportSessions,
    );
    const suppliedOwnsDate = suppliedPlanDefinition?.blocks.some(block => block.startDate <= date && date <= block.endDate);
    if (suppliedOwnsDate && suppliedPlanDefinition?.coverageSetId !== EVERGREEN_GENERAL_COVERAGE_SET.id) return suppliedPlanDefinition ?? null;
    return activeEventPlan ?? (suppliedOwnsDate ? suppliedPlanDefinition ?? null : null);
}
