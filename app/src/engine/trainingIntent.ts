import type { AuthoredPlanBlock, DailyReadiness, FatigueState, MicrocycleState, PlannedDose, TrainingIntentProfile, UserEvent, WeeklyObjective } from './models';
import { computeInternalResponseStrain, buildFatigueStateFromHistory, type FatigueFusionPolicy } from './fatigue';
import { buildMicrocycleState, getUnresolvedObjectives } from './microcycle';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { evaluatePeriodizationPhase, resolveMultiEventObjectives, type DroppedContributorObjective, type PeriodizationResult } from './periodization';
import { resolvePlanDefinitionForEvent, type PlanDefinition } from './planSchedule';
import { addDaysToLocalDateString } from '../utils/localDate';
import { resolvePlanningContext, type PlanningContext } from './planningMode';
import { applyPlanningOverlays } from './planningOverlays';
import { getPerformedTrainingFactsInRange, type PerformedTrainingFactsSnapshot } from './performedTrainingFacts';

export type PlannedRecoveryReason =
  | 'scheduled_recovery'   // Prescribed microcycle rest day
  | 'load_target_reached' // Weekly strain cap met
  | 'key_session_shield'; // Protecting tomorrow's key anchor

export type ExecutionModifier =
  | 'readiness_reduction'
  | 'safety_constraint';

export interface TrainingIntent {
    /** Per-decision resolved context; distinct from the persisted `TrainingIntentProfile`,
     * which is durable athlete input rather than a computed decision result. */
    planningContext: PlanningContext;
    periodization: PeriodizationResult;
    unresolvedObjectives: WeeklyObjective[];
    plannedDose: PlannedDose;
    fatigue: FatigueState;
    /** Operational history for fatigue/objective/microcycle bookkeeping. This stays bounded
     * to the requested short planning window even when athlete-state inference needs a
     * wider observation window. */
    history: CompletedExposure[];
    /** Canonical performed-training facts for narrow recency/spacing cutovers. Legacy
     * history remains the fatigue/objective authority until later ADR-0034 PRs migrate it. */
    performedTrainingFacts: PerformedTrainingFactsSnapshot | null;
    /** The short operational snapshot. Evergreen performance planning may attach a wider
     * `athleteStateEvidence` window, but that evidence is never replayed into `history`. */
    historySnapshot: TrainingHistorySnapshot | null;
    microcycle: MicrocycleState;
    /** Phase 5.6: a contributor objective dropped because it fell inadmissible during the
     *  taper authority's taper window (see periodization.ts resolveMultiEventObjectives).
     *  Empty in the overwhelmingly common single-or-no-event case. */
    droppedContributorObjectives: DroppedContributorObjective[];
    sessionRole?: 'anchor' | 'supporting' | 'recovery';
    recoveryIntent?: {
        reason: PlannedRecoveryReason;
        priority: number;
    } | null;
    executionModifier?: ExecutionModifier | null;
}

const MAX_PLANNED_VOLUME = 1;
const MAX_PLANNED_INTENSITY = 1.2;
const ATHLETE_STATE_HISTORY_WINDOW_DAYS = 28;

function boundedPlannedDose(volume: number, intensity: number): PlannedDose {
    return {
        volume: Math.max(0, Math.min(MAX_PLANNED_VOLUME, Number.isFinite(volume) ? volume : 0)),
        intensity: Math.max(0, Math.min(MAX_PLANNED_INTENSITY, Number.isFinite(intensity) ? intensity : 0)),
    };
}

function needsEstablishedPerformanceEvidence(planningContext: PlanningContext): boolean {
    if (planningContext.mode !== 'evergreen') return false;
    return planningContext.profile.priorities.some(priority =>
        priority === 'endurance' || priority === 'speed_power' || priority === 'sport_readiness');
}

/**
 * Generic-mode fallback for events without an authored PlanDefinition. Volume retains the
 * existing objective-urgency calculation; intensity follows the generic periodization phase.
 */
export function resolvePlannedDose(
    phase: { volumeScale: number; intensityScale: number },
    objectives: readonly WeeklyObjective[],
    unresolvedObjectives: readonly WeeklyObjective[],
): PlannedDose {
    const urgency = objectives.length === 0 ? 0 : unresolvedObjectives.length / objectives.length;
    return boundedPlannedDose(
        (phase.volumeScale / 1.1) * (0.7 + (0.3 * urgency)),
        phase.intensityScale,
    );
}

/**
 * Single ownership rule for planned dose. In ADR-0012 explicit mode the active authored
 * PlanBlock owns BOTH dimensions, bounded only by the persisted PlannedDose contract;
 * generic days-to-event periodization is used only when no authored block is active for
 * this event/date.
 */
export function resolvePlannedDoseForDate(
    phase: { volumeScale: number; intensityScale: number },
    objectives: readonly WeeklyObjective[],
    unresolvedObjectives: readonly WeeklyObjective[],
    planDefinition: PlanDefinition | null | undefined,
    date: string,
): PlannedDose {
    const activeBlock = planDefinition?.blocks.find(block => block.startDate <= date && date <= block.endDate);
    if (activeBlock) {
        return boundedPlannedDose(activeBlock.volumeScale, activeBlock.intensityScale);
    }
    return resolvePlannedDose(phase, objectives, unresolvedObjectives);
}

/** Fetch the bounded history once and reuse that immutable revision across every
 * decision horizon in a dashboard refresh. Legacy fixture providers can omit it. */
export async function prepareTrainingHistorySnapshot(
    userId: string,
    throughDateExclusive: string,
    windowDays: number = 7,
    historyProvider?: TrainingHistoryProvider,
): Promise<TrainingHistorySnapshot | null> {
    const provider = historyProvider ?? (await import('./firestoreTrainingHistory')).firestoreTrainingHistoryProvider;
    return provider.getSnapshot
        ? provider.getSnapshot(userId, throughDateExclusive, windowDays)
        : null;
}

/** Builds the shared plan-side state for today and future projections. Firestore is
 * intentionally read-only here: the durable inputs are adherence records; objectives,
 * dose and fatigue are freshly derived on every evaluation. */
export async function resolveTrainingIntent(
    userId: string,
    events: UserEvent[],
    date: string,
    readiness: DailyReadiness,
    windowDays: number = 7,
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
    trainingIntentProfile: TrainingIntentProfile | null = null,
    fatigueFusionPolicy: FatigueFusionPolicy = 'max',
): Promise<TrainingIntent> {
    const eventPeriodization = evaluatePeriodizationPhase(events, date);
    const planningContext = resolvePlanningContext(trainingIntentProfile, eventPeriodization, date);
    // PlanningContext is the sole authority for whether event periodization applies.
    // The profile-less event path retains the prior result exactly; an explicit evergreen
    // profile intentionally receives the existing no-event baseline until its dedicated
    // evergreen coverage policy arrives in Phase 7.5.
    const periodization = planningContext.mode === 'event_directed'
        ? eventPeriodization
        : evaluatePeriodizationPhase([], date);
    const operationalSnapshot = preparedHistorySnapshot
        ?? await prepareTrainingHistorySnapshot(userId, date, windowDays, historyProvider);
    const provider = historyProvider ?? (await import('./firestoreTrainingHistory')).firestoreTrainingHistoryProvider;
    const operationalWindowStart = addDaysToLocalDateString(date, -windowDays);
    const operationalHistory = operationalSnapshot?.exposures
        ?? await provider.reconstruct(userId, date, windowDays);
    // A caller may reuse a wider immutable snapshot across several horizons. Keep the
    // operational history explicitly bounded so a 28-day state-evidence read cannot widen
    // fatigue or microcycle bookkeeping by accident.
    const history = operationalHistory.filter(exposure => exposure.date >= operationalWindowStart && exposure.date < date);
    // The live/default path reads canonical occurrences for the narrow spacing cutover.
    // Injected history providers are also used by deterministic projections (including
    // tomorrow's hypothetical "today was completed" history), so they deliberately keep
    // their self-contained reconstructed history as the spacing fallback.
    const performedTrainingFacts = historyProvider
        ? null
        : await getPerformedTrainingFactsInRange(userId, operationalWindowStart, date);

    let historySnapshot = operationalSnapshot;
    if (needsEstablishedPerformanceEvidence(planningContext) && operationalSnapshot) {
        const stateSnapshot = operationalSnapshot.windowDays >= ATHLETE_STATE_HISTORY_WINDOW_DAYS
            ? operationalSnapshot
            : await prepareTrainingHistorySnapshot(
                userId,
                date,
                ATHLETE_STATE_HISTORY_WINDOW_DAYS,
                historyProvider,
            );
        const stateExposures = stateSnapshot?.exposures
            ?? await provider.reconstruct(userId, date, ATHLETE_STATE_HISTORY_WINDOW_DAYS);
        const stateWindowStart = addDaysToLocalDateString(date, -ATHLETE_STATE_HISTORY_WINDOW_DAYS);
        historySnapshot = {
            ...operationalSnapshot,
            athleteStateEvidence: {
                observedWindowDays: ATHLETE_STATE_HISTORY_WINDOW_DAYS,
                exposures: stateExposures.filter(exposure => exposure.date >= stateWindowStart && exposure.date < date),
            },
        };
    }

    const planDefinition = resolvePlanDefinitionForEvent(periodization.focusEvent, authoredPlanBlocks);
    const builtMicrocycle = buildMicrocycleState(
        periodization.phase,
        addDaysToLocalDateString(date, -windowDays),
        history,
        periodization.focusEvent,
        planDefinition,
        date,
    );
    // Phase 5.6: one taper authority (periodization.focusEvent, already resolved by
    // evaluatePeriodizationPhase's total order above), multiple demand contributors. A
    // no-op for the common single-or-no-event case (nothing else in `events` falls in
    // another event's contribution window). This is the single seed-building point shared
    // by today's decision (evaluateTrainingWithIntent), tomorrow's provisional plan
    // (evaluateNextDayPlanWithIntent), and the week-ahead strip
    // (generateWeekAheadPlanWithIntent) -- all three call resolveTrainingIntent.
    const multiEventResolution = resolveMultiEventObjectives(events, date, periodization, builtMicrocycle.objectives);
    const microcycle: MicrocycleState = { ...builtMicrocycle, objectives: multiEventResolution.objectives };
    const unresolvedObjectives = getUnresolvedObjectives(microcycle);
    const fatigue = buildFatigueStateFromHistory(history, computeInternalResponseStrain(readiness), date, fatigueFusionPolicy);
    const plannedDose = applyPlanningOverlays(resolvePlannedDoseForDate(
        periodization.phase,
        microcycle.objectives,
        unresolvedObjectives,
        planDefinition,
        date,
    ), date, authoredPlanBlocks, planDefinition);
    return {
        planningContext, periodization, unresolvedObjectives, plannedDose, fatigue, history, performedTrainingFacts, historySnapshot, microcycle,
        droppedContributorObjectives: multiEventResolution.droppedContributorObjectives,
    };
}
