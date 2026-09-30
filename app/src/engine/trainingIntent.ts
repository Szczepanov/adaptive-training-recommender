import type { AuthoredPlanBlock, DailyReadiness, DimensionalFatigue, FatigueState, MicrocycleState, PlannedDose, TrainingIntentProfile, UserEvent, WeeklyObjective } from './models';
import { computeInternalResponseStrain, buildFatigueStateFromHistory, combineFatigue, type FatigueFusionPolicy } from './fatigue';
import { buildMicrocycleState, getUnresolvedObjectives } from './microcycle';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { evaluatePeriodizationPhase, resolveMultiEventObjectives, type DroppedContributorObjective, type PeriodizationResult } from './periodization';
import { resolveActivePlanDefinitionForEvent, type PlanDefinition } from './planSchedule';
import { addDaysToLocalDateString } from '../utils/localDate';
import { resolvePlanningContext, usesEvergreenProgramming, type PlanningContext } from './planningMode';
import { applyPlanningOverlays } from './planningOverlays';
import type { PerformedTrainingFactsSnapshot } from './performedTrainingFacts';
import { coverageSetFor, EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { resolveSequenceIntent, type SequenceIntentPolicy } from './sequenceIntent';
import { ROLLING_LOAD_BUDGET_LOOKBACK_DAYS } from './rollingLoadBudget';
import { resolvePriorityAOlympicTriathlonTaper } from './taperPlanBudget';
import { AEROBIC_VOLUME_FLOOR_WINDOW_DAYS, CATALOG_AEROBIC_VOLUME_FLOOR, resolveAerobicVolumeFloor, type AerobicVolumeFloor } from './aerobicVolumeFloor';
import { canEmitMechanicalRequirement, strengthRequirement } from './evergreenStrategy';

/**
 * Issue #801: the cycling event plan already authors one exact primary-strength role. For
 * an athlete whose durable intent explicitly includes `strength_muscle`, preserve the rest
 * of the evergreen strategy's registered two-day health floor as a product-policy count seed for build-block support
 * roles, so an event becoming active does not by itself cut two exposures to one. This does
 * not claim that every compact support identity independently satisfies the WHO major-muscle-group guideline.
 * Feasibility, recovery, spacing and anchor authority stay with the weekly allocator,
 * which reserves support only without displacing a primary role.
 */
export function eventStrengthSupportSessions(
    planningContext: PlanningContext,
    profile: TrainingIntentProfile | null | undefined,
): number {
    if (planningContext.mode !== 'event_directed'
        || planningContext.eventStrategy !== 'structured_plan'
        || profile?.priorities.includes('strength_muscle') !== true) return 0;
    const floor = strengthRequirement('required').floor;
    const authoredPrimaryStrengthRoles = 1;
    return floor?.dose.unit === 'sessions' ? Math.max(0, floor.dose.value - authoredPrimaryStrengthRoles) : 0;
}

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
    /** Issue #801: durable-intent support-role count threaded to every event-plan build. */
    eventStrengthSupportSessions: number;
    unresolvedObjectives: WeeklyObjective[];
    plannedDose: PlannedDose;
    fatigue: FatigueState;
    /** Operational history for fatigue/objective/microcycle bookkeeping. This stays bounded
     * to the requested short planning window even when athlete-state inference needs a
     * wider observation window. */
    history: CompletedExposure[];
    /** Wider, read-only evidence used only to derive the individualized rolling load
     * envelope. It must never widen operational fatigue or microcycle bookkeeping. */
    rollingLoadBudgetHistory: CompletedExposure[];
    /** Canonical performed-training facts for narrow recency/spacing cutovers. Legacy
     * history remains the fatigue/objective authority until later ADR-0034 PRs migrate it. */
    performedTrainingFacts: PerformedTrainingFactsSnapshot | null;
    /** The short operational snapshot. Evergreen performance planning may attach a wider
     * `athleteStateEvidence` window, but that evidence is never replayed into `history`. */
    historySnapshot: TrainingHistorySnapshot | null;
    /** Read-only performed-training evidence for the #804 mechanical capability owner. When
     * evergreen can emit a mechanical requirement it carries a dedicated 28-day establishment
     * window. #804 still evaluates progression/continuity only inside its own 14-day window;
     * the extra history exists solely so its "established athlete" gate does not depend on
     * unrelated performance-priority evidence. It is never replayed into `history`. */
    mechanicalExposureHistory: CompletedExposure[];
    /** Observation span for `mechanicalExposureHistory`; optional only for legacy fixtures. */
    mechanicalEvidenceObservedWindowDays?: number;
    /** Issue #757: the athlete-level `aerobic_volume` floor, resolved once from at least 28
     * days of completed evidence so today, tomorrow and the forecast share one value. */
    aerobicVolumeFloor: AerobicVolumeFloor;
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
    sequenceIntent: SequenceIntentPolicy;
}

const MAX_PLANNED_VOLUME = 1;
const MAX_PLANNED_INTENSITY = 1.2;
export const ATHLETE_STATE_HISTORY_WINDOW_DAYS = 28;
export const DEFAULT_OPERATIONAL_HISTORY_WINDOW_DAYS = 7;
const CANONICAL_FACT_REVISION_PREFIX = 'canonical-facts-v1:';

function boundedPlannedDose(volume: number, intensity: number): PlannedDose {
    return {
        volume: Math.max(0, Math.min(MAX_PLANNED_VOLUME, Number.isFinite(volume) ? volume : 0)),
        intensity: Math.max(0, Math.min(MAX_PLANNED_INTENSITY, Number.isFinite(intensity) ? intensity : 0)),
    };
}

function needsEstablishedPerformanceEvidence(planningContext: PlanningContext): boolean {
    if (!usesEvergreenProgramming(planningContext)) return false;
    // Issue #805 (D-A): the capability opt-in deliberately does not widen this evidence. It
    // feeds athlete-state inference, the aerobic floor, power and quality priors, and opting in
    // must not change those decisions; capability cadence reads the #804 mechanical evidence.
    return planningContext.profile.priorities.some(priority =>
        priority === 'endurance' || priority === 'speed_power' || priority === 'sport_readiness');
}

/** Issue #804: whether this intent can emit a mechanical requirement, and therefore whether
 * orchestration must source mechanical exposure evidence and tissue check-ins. */
export function mechanicalEvidenceRequired(planningContext: PlanningContext): boolean {
    return usesEvergreenProgramming(planningContext)
        && canEmitMechanicalRequirement(
            planningContext.profile.priorities,
            planningContext.profile.capabilityMaintenance?.enabled === true,
        );
}

/** The same predicate before a `TrainingIntent` exists (the next-day projection resolves
 * check-ins once for all of its branches). */
export function mechanicalEvidenceRequiredFor(
    trainingIntentProfile: TrainingIntentProfile | null,
    events: UserEvent[],
    date: string,
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
): boolean {
    return mechanicalEvidenceRequired(
        resolvePlanningContext(
            trainingIntentProfile,
            evaluatePeriodizationPhase(events, date),
            date,
            null,
            authoredPlanBlocks,
        ),
    );
}

/**
 * A prepared history snapshot may carry canonical performed facts, but those semantic
 * credits are valid only for the coverage set under which they were derived. Non-canonical
 * revision strings are retained for deterministic injected fixtures; production canonical
 * revisions must carry the descriptor id and fail closed on mismatch/legacy unscoped form.
 */
export function preparedPerformedFactsForCoverageSet(
    facts: PerformedTrainingFactsSnapshot | null | undefined,
    coverageSetId: string,
): PerformedTrainingFactsSnapshot | null {
    if (!facts) return null;
    if (!facts.revision.startsWith(CANONICAL_FACT_REVISION_PREFIX)) return facts;
    return facts.revision.startsWith(`${CANONICAL_FACT_REVISION_PREFIX}${coverageSetId}:`)
        ? facts
        : null;
}

function resolveIntentAuthorities(
    events: UserEvent[],
    date: string,
    authoredPlanBlocks: readonly AuthoredPlanBlock[],
    trainingIntentProfile: TrainingIntentProfile | null,
) {
    const eventPeriodization = evaluatePeriodizationPhase(events, date);
    const planningContext = resolvePlanningContext(
        trainingIntentProfile,
        eventPeriodization,
        date,
        null,
        authoredPlanBlocks,
    );
    // PlanningContext is the sole authority for whether event periodization applies.
    const periodization = planningContext.mode === 'event_directed'
        ? eventPeriodization
        : evaluatePeriodizationPhase([], date);
    const strengthSupportSessions = eventStrengthSupportSessions(planningContext, trainingIntentProfile);
    const planDefinition = planningContext.eventStrategy === 'structured_plan'
        ? resolveActivePlanDefinitionForEvent(
            periodization.focusEvent, date, authoredPlanBlocks, strengthSupportSessions,
        )
        : null;
    const performedFactsCoverageDescriptor = planDefinition
        ? coverageSetFor(planDefinition.coverageSetId)
        : EVERGREEN_GENERAL_COVERAGE_SET;
    return { planningContext, periodization, strengthSupportSessions, planDefinition, performedFactsCoverageDescriptor };
}

/**
 * Descriptor authority shared by online orchestration and resolveTrainingIntent. Canonical
 * performed facts are semantic/coverage-set scoped, so provenance must preload them under
 * the exact descriptor the live evaluator will consume rather than guessing evergreen.
 */
export function resolvePerformedTrainingFactsCoverageDescriptor(
    events: UserEvent[],
    date: string,
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
    trainingIntentProfile: TrainingIntentProfile | null = null,
) {
    return resolveIntentAuthorities(events, date, authoredPlanBlocks, trainingIntentProfile).performedFactsCoverageDescriptor;
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

/** Issue #804/#857: dedicated evidence for mechanical establishment. The 28-day window is
 * intentionally separate from `athleteStateEvidence`: enabling capability maintenance must
 * not change aerobic-floor, power or quality priors. The #804 progression evaluator itself
 * still filters this evidence to its 14-day continuity window. */
async function resolveMechanicalExposureEvidence(
    userId: string,
    date: string,
    historySnapshot: TrainingHistorySnapshot | null,
    operationalSnapshot: TrainingHistorySnapshot | null,
    operationalHistory: readonly CompletedExposure[],
    operationalObservedWindowDays: number,
    provider: TrainingHistoryProvider,
): Promise<{ exposures: CompletedExposure[]; observedWindowDays: number }> {
    const windowDays = ATHLETE_STATE_HISTORY_WINDOW_DAYS;
    const windowStart = addDaysToLocalDateString(date, -windowDays);
    const bounded = (exposures: readonly CompletedExposure[]): CompletedExposure[] =>
        exposures.filter(exposure => exposure.date >= windowStart && exposure.date < date);
    const stateEvidence = historySnapshot?.athleteStateEvidence;
    if (stateEvidence && stateEvidence.observedWindowDays >= windowDays) {
        return { exposures: bounded(stateEvidence.exposures), observedWindowDays: windowDays };
    }
    if (operationalSnapshot && operationalSnapshot.windowDays >= windowDays) {
        return { exposures: bounded(operationalHistory), observedWindowDays: windowDays };
    }
    if (provider.getSnapshot) {
        const mechanicalSnapshot = await provider.getSnapshot(userId, date, windowDays);
        return {
            exposures: bounded(mechanicalSnapshot.exposures),
            observedWindowDays: Math.min(windowDays, Math.max(0, mechanicalSnapshot.windowDays)),
        };
    }
    // A reconstruct-only provider returns exposures but no observation-span proof. The wider
    // read is still useful to #804 progression, but cadence/establishment must fail closed
    // at the span the operational path can actually attest instead of fabricating 28 days.
    return {
        exposures: bounded(await provider.reconstruct(userId, date, windowDays)),
        observedWindowDays: Math.min(windowDays, Math.max(0, operationalObservedWindowDays)),
    };
}

/** Fetch the bounded history once and reuse that immutable revision across every
 * decision horizon in a dashboard refresh. Legacy fixture providers can omit it. */
export async function prepareTrainingHistorySnapshot(
    userId: string,
    throughDateExclusive: string,
    windowDays: number = DEFAULT_OPERATIONAL_HISTORY_WINDOW_DAYS,
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
    windowDays: number = DEFAULT_OPERATIONAL_HISTORY_WINDOW_DAYS,
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
    trainingIntentProfile: TrainingIntentProfile | null = null,
    fatigueFusionPolicy: FatigueFusionPolicy = 'max',
    preparedRollingLoadBudgetSnapshot?: TrainingHistorySnapshot | null,
    carriedInternalStrain?: DimensionalFatigue,
): Promise<TrainingIntent> {
    const {
        planningContext,
        periodization,
        strengthSupportSessions,
        planDefinition,
        performedFactsCoverageDescriptor,
    } = resolveIntentAuthorities(events, date, authoredPlanBlocks, trainingIntentProfile);
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
    // The forecast may supply a separate wider immutable snapshot while the operational
    // decision keeps its narrow audit/fatigue revision. A sufficiently wide operational
    // snapshot can be reused; legacy providers without snapshot support fall back to the
    // bounded operational history rather than fabricating chronic evidence.
    const budgetSnapshot = preparedRollingLoadBudgetSnapshot
        ?? (preparedHistorySnapshot?.windowDays !== undefined
            && preparedHistorySnapshot.windowDays >= ROLLING_LOAD_BUDGET_LOOKBACK_DAYS
            ? preparedHistorySnapshot
            : null)
        ?? (!preparedHistorySnapshot && provider.getSnapshot
            ? await prepareTrainingHistorySnapshot(userId, date, ROLLING_LOAD_BUDGET_LOOKBACK_DAYS, historyProvider)
            : null);
    const needsOlympicTaperReference = resolvePriorityAOlympicTriathlonTaper(
        periodization.focusEvent, date,
    ) !== null;
    // The ordinary operational read is only seven days. When a provider has no snapshot
    // API (including the projected next-day provider), reconstruct the wider evidence
    // solely for the taper budget; do not widen fatigue, objective, or coverage history.
    const budgetHistorySource = budgetSnapshot?.exposures
        ?? (needsOlympicTaperReference
            ? await provider.reconstruct(userId, date, ROLLING_LOAD_BUDGET_LOOKBACK_DAYS)
            : history);
    const budgetWindowStart = addDaysToLocalDateString(date, -ROLLING_LOAD_BUDGET_LOOKBACK_DAYS);
    const rollingLoadBudgetHistory = budgetHistorySource.filter(exposure => exposure.date >= budgetWindowStart && exposure.date < date);
    // Reusing the legacy TrainingHistorySnapshot must not suppress the canonical occurrence
    // read: Firestore history snapshots currently do not embed descriptor-scoped facts. If
    // they do carry facts, accept them only when their canonical revision proves they were
    // derived for this active coverage set. Injected history providers remain self-contained
    // for deterministic projections and therefore fall back to reconstructed history when
    // no matching canonical facts were explicitly provided.
    let performedTrainingFacts = preparedPerformedFactsForCoverageSet(
        preparedHistorySnapshot?.performedTrainingFacts,
        performedFactsCoverageDescriptor.id,
    );
    if (!performedTrainingFacts && !historyProvider) {
        performedTrainingFacts = await (await import('../training-occurrence/performedTrainingFactsService')).getPerformedTrainingFactsInRange(
            userId,
            operationalWindowStart,
            date,
            { coverageSetDescriptor: performedFactsCoverageDescriptor },
        );
    }

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

    // Mechanical establishment has its own evidence stream (#857). This is loaded exactly
    // when #804 can emit, including an explicit #805 opt-in, without widening the general
    // athlete-state evidence used by aerobic/power/quality policy.
    const mechanicalEvidence = mechanicalEvidenceRequired(planningContext)
        ? await resolveMechanicalExposureEvidence(
            userId, date, historySnapshot, operationalSnapshot, operationalHistory,
            operationalSnapshot?.windowDays ?? windowDays, provider,
        )
        : {
            exposures: history,
            observedWindowDays: operationalSnapshot?.windowDays ?? windowDays,
        };
    const mechanicalExposureHistory = mechanicalEvidence.exposures;

    // Issue #757: the floor reuses evidence this resolution already holds and never adds a
    // read. A caller-prepared snapshot fixes the history revision for every horizon of a
    // refresh, so a rolling-load window fetched separately by one horizon (the week-ahead
    // forecast) is ignored then; otherwise today and the forecast could disagree. Without
    // evidence spanning the window, the floor fails closed to the catalog minimum.
    const spansFloorWindow = (days: number | undefined): boolean => (days ?? 0) >= AEROBIC_VOLUME_FLOOR_WINDOW_DAYS;
    const stateEvidence = historySnapshot?.athleteStateEvidence;
    const aerobicFloorEvidence = stateEvidence && spansFloorWindow(stateEvidence.observedWindowDays)
        ? stateEvidence.exposures
        : spansFloorWindow(operationalSnapshot?.windowDays)
            ? operationalHistory
            : !preparedHistorySnapshot && spansFloorWindow(budgetSnapshot?.windowDays)
                ? rollingLoadBudgetHistory
                : null;
    const aerobicVolumeFloor = aerobicFloorEvidence
        ? resolveAerobicVolumeFloor(aerobicFloorEvidence, date)
        : CATALOG_AEROBIC_VOLUME_FLOOR;

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
    const branchInternalStrain = computeInternalResponseStrain(readiness);
    const internalStrain = carriedInternalStrain
        ? combineFatigue(branchInternalStrain, carriedInternalStrain)
        : branchInternalStrain;
    const fatigue = buildFatigueStateFromHistory(history, internalStrain, date, fatigueFusionPolicy);
    const plannedDose = applyPlanningOverlays(resolvePlannedDoseForDate(
        periodization.phase,
        microcycle.objectives,
        unresolvedObjectives,
        planDefinition,
        date,
    ), date, authoredPlanBlocks, planDefinition);
    return {
        planningContext, periodization, eventStrengthSupportSessions: strengthSupportSessions, unresolvedObjectives, plannedDose, fatigue, history, rollingLoadBudgetHistory, performedTrainingFacts, historySnapshot, mechanicalExposureHistory,
        mechanicalEvidenceObservedWindowDays: mechanicalEvidence.observedWindowDays,
        aerobicVolumeFloor, microcycle,
        droppedContributorObjectives: multiEventResolution.droppedContributorObjectives,
        sequenceIntent: resolveSequenceIntent(periodization.phase),
    };
}
