import { isValidLocalDateString, SUPPORTED_ADAPTATION_SCOPES, validateDoseEnvelope, validateIntentBlock, type BlockObjectiveDefinition, type IntentBlock } from './blockIntent';
import type { UserEvent, SessionTemplate } from './models';
import { inferAthleteTrainingState, type AdaptationKey, type EvidenceBackedStrategy } from './evergreenStrategy';
import type { CoverageSetDescriptor } from './weeklyDosePacking';
import type { PlanDefinition } from './planSchedule';
import { EVERGREEN_GENERAL_COVERAGE_SET, SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';
import { canonicalise } from './externalPlanHash';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import { workoutIdForTemplateId } from './coverage';
import type { CompletedExposure } from './trainingHistory';
import type { PlanningContext } from './planningMode';

export const DEVELOPMENT_VO2_WORKOUT_IDS = ['cycling_vo2_6x3_01'] as const;
export interface DevelopmentAuthority {
    block: IntentBlock | null;
    diagnostics: string[];
    executableEndDate?: string;
}
export interface DevelopmentTrace {
    eventId: string;
    eventDate: string;
    eventDemand: UserEvent['demandProfile'];
    blockId: string | null;
    blockRevision: number | null;
    executableDates: IntentBlock['dateRange'] | null;
    nextReviewDate: string | null;
    objectives: Array<Pick<BlockObjectiveDefinition, 'id' | 'adaptationScope' | 'intent' | 'doseEnvelope'> & {
        coverageKey?: BlockObjectiveDefinition['coverageKey'];
        demandRationale?: string;
    }>;
    recentCompletedExposures: number;
    evidenceLimitations: string;
    diagnostics: string[];
}
export function isValidDevelopmentTrace(value: unknown): value is DevelopmentTrace {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const trace = value as DevelopmentTrace;
    const keys = ['eventId', 'eventDate', 'eventDemand', 'blockId', 'blockRevision', 'executableDates', 'nextReviewDate',
        'objectives', 'recentCompletedExposures', 'evidenceLimitations', 'diagnostics'];
    if (Object.keys(trace).length !== keys.length || !keys.every(key => Object.hasOwn(trace, key))) return false;
    const demandKeys = ['aerobicEndurance', 'thresholdPower', 'vo2MaxPower', 'repeatedSurges', 'sprintPower', 'fatigueResistance', 'neuromuscular'];
    if (typeof trace.eventId !== 'string' || !trace.eventId || !isValidLocalDateString(trace.eventDate)
        || !trace.eventDemand || typeof trace.eventDemand !== 'object' || Array.isArray(trace.eventDemand)
        || Object.keys(trace.eventDemand).length !== demandKeys.length || !demandKeys.every(key => Object.hasOwn(trace.eventDemand, key))
        || !Object.values(trace.eventDemand).every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1)
        || !Number.isInteger(trace.recentCompletedExposures) || trace.recentCompletedExposures < 0
        || typeof trace.evidenceLimitations !== 'string' || !Array.isArray(trace.diagnostics)
        || trace.diagnostics.length > 64 || !trace.diagnostics.every(item => typeof item === 'string')
        || !Array.isArray(trace.objectives) || trace.objectives.length > 64) return false;
    if (trace.blockId === null) return trace.blockRevision === null && trace.executableDates === null
        && trace.nextReviewDate === null && trace.objectives.length === 0;
    if (typeof trace.blockId !== 'string' || !Number.isInteger(trace.blockRevision) || (trace.blockRevision ?? 0) < 1
        || !trace.executableDates || Object.keys(trace.executableDates).length !== 2
        || !isValidLocalDateString(trace.executableDates.startDate) || !isValidLocalDateString(trace.executableDates.endDate)
        || trace.executableDates.startDate > trace.executableDates.endDate || !isValidLocalDateString(trace.nextReviewDate)) return false;
    return trace.objectives.every(objective => objective && typeof objective.id === 'string' && objective.id.length > 0
        && Object.keys(objective).every(key => ['id', 'adaptationScope', 'intent', 'doseEnvelope', 'coverageKey', 'demandRationale'].includes(key))
        && (objective.coverageKey === undefined || typeof objective.coverageKey === 'string')
        && (objective.demandRationale === undefined || typeof objective.demandRationale === 'string')
        && ['develop', 'maintain'].includes(objective.intent) && SUPPORTED_ADAPTATION_SCOPES.includes(objective.adaptationScope)
        && objective.doseEnvelope && ['minutes', 'sessions'].includes(objective.doseEnvelope.unit)
        && Object.keys(objective.doseEnvelope).length === 5 && validateDoseEnvelope(objective.doseEnvelope, 'doseEnvelope').length === 0);
}
export function developmentTrace(context: PlanningContext, exposures: readonly CompletedExposure[]): DevelopmentTrace | undefined {
    if (!context.development || !context.focusEvent) return undefined;
    const block = context.development.block;
    return { eventId: context.focusEvent.id, eventDate: context.focusEvent.date, eventDemand: context.focusEvent.demandProfile,
        blockId: block?.id ?? null, blockRevision: block?.revision ?? null, executableDates: block
            ? { ...block.dateRange, endDate: context.development.executableEndDate ?? block.dateRange.endDate } : null,
        nextReviewDate: block?.reviewSchedule.nextReviewDate ?? null,
        objectives: block?.objectives.map(({ id, adaptationScope, coverageKey, intent, doseEnvelope, successCriteria }) => {
            const demandAxis = adaptationScope === 'vo2_max' ? 'vo2MaxPower' : adaptationScope === 'threshold_quality'
                ? 'thresholdPower' : adaptationScope === 'zone2_aerobic' ? 'aerobicEndurance' : 'neuromuscular';
            const comparison = successCriteria.evaluationRef;
            return { id, adaptationScope, coverageKey, intent, doseEnvelope,
                demandRationale: `Authored ${intent} intent addresses event ${demandAxis} demand ${context.focusEvent!.demandProfile[demandAxis]}; ${comparison
                    ? `prospective comparison pinned to ${comparison.id}@${comparison.revision}/${comparison.metricId}, current gap unverified`
                    : 'process-only intent; no comparable measured gap supplied'}.` };
        }) ?? [],
        recentCompletedExposures: exposures.length, evidenceLimitations: 'Completed exposure establishes process only; adaptation gaps and follow-up tolerance remain unverified without comparable assessments and response evidence.',
        diagnostics: [...context.development.diagnostics] };
}
export function revalidateDevelopmentEvidence(context: PlanningContext, exposures: readonly CompletedExposure[], observedWindowDays: number,
    activeRestriction: boolean): PlanningContext {
    const block = context.development?.block;
    if (!block) return context;
    const diagnostics: string[] = [];
    const athleteState = inferAthleteTrainingState(exposures, observedWindowDays);
    for (const objective of block.objectives) {
        if (developmentAdaptation(objective) === 'high_intensity'
            && (athleteState.inference.dataQuality !== 'high' || athleteState.trainingAgeProxy !== 'established')) {
            diagnostics.push(`quality_establishment_withheld:${objective.id}`);
        }
        const prerequisites = objective.entryPrerequisites;
        if (!prerequisites) continue;
        const ids = exactIds(objective);
        if (prerequisites.minBaselineDays !== undefined && observedWindowDays < prerequisites.minBaselineDays) diagnostics.push(`insufficient_baseline:${objective.id}`);
        const completed = exposures.filter(exposure => ids.includes(exposure.workoutId ?? workoutIdForTemplateId(exposure.templateId) ?? '')).length;
        if (prerequisites.requiredPriorExposures !== undefined && completed < prerequisites.requiredPriorExposures) diagnostics.push(`insufficient_prior_exposure:${objective.id}`);
        if (activeRestriction && (prerequisites.prohibitedTissueSeverities?.length ?? 0) > 0) diagnostics.push(`active_restriction:${objective.id}`);
    }
    return diagnostics.length ? { ...context, eventStrategy: 'evergreen_fallback', development: { block: null,
        diagnostics: [...context.development!.diagnostics, ...diagnostics] } } : context;
}
export function developmentAdaptation(objective: BlockObjectiveDefinition): AdaptationKey | null {
    if (objective.coverageKey === 'power_exposure' && objective.adaptationScope === 'strength_maintenance') return 'neuromuscular_power';
    if (objective.coverageKey === 'mechanical_exposure' && objective.adaptationScope === 'strength_maintenance') return 'mechanical_exposure';
    if (objective.coverageKey === 'aerobic_volume' && objective.adaptationScope === 'zone2_aerobic'
        && ['cycling', 'cross_training', 'multisport'].includes(objective.sport)) return 'aerobic_endurance';
    if (objective.coverageKey === 'primary_strength' && ['strength_development', 'strength_maintenance'].includes(objective.adaptationScope)
        && ['strength', 'cross_training', 'multisport'].includes(objective.sport)) return 'strength';
    if (objective.coverageKey === 'sustained_quality' && ['vo2_max', 'threshold_quality'].includes(objective.adaptationScope)
        && objective.sport === 'cycling') return 'high_intensity';
    return null;
}
function exactIds(objective: BlockObjectiveDefinition): readonly string[] {
    if (objective.adaptationScope === 'vo2_max') return DEVELOPMENT_VO2_WORKOUT_IDS;
    if (objective.adaptationScope === 'threshold_quality') return SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE
        .find(role => role.key === 'sustained_quality')!.workoutIds.filter(id => id === 'cycling_controlled_threshold_4x8_01' || id === 'cycling_over_under_3x12_01');
    const ids = EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(role => role.key === objective.coverageKey)?.workoutIds ?? [];
    return objective.sport === 'cycling' ? ids.filter(id => WORKOUTS_BY_ID.get(id)?.modality === 'cycling') : ids;
}
export function resolveDevelopmentAuthority(event: UserEvent, date: string, blocks: readonly IntentBlock[]): DevelopmentAuthority {
    const candidates = blocks.filter(block => block.eventBinding?.eventId === event.id
        && block.dateRange.startDate <= date && date <= block.dateRange.endDate);
    if (candidates.length !== 1) return { block: null, diagnostics: [candidates.length ? 'conflicting_active_blocks' : 'no_active_event_bound_block'] };
    const block = candidates[0];
    const binding = block.eventBinding!;
    const diagnostics: string[] = [];
    if (!validateIntentBlock(block).valid) return { block: null, diagnostics: ['invalid_block'] };
    if (binding.eventDate !== event.date || JSON.stringify(canonicalise(binding.demandProfile)) !== JSON.stringify(canonicalise(event.demandProfile))
        || JSON.stringify(canonicalise(binding.phaseHorizons ?? null)) !== JSON.stringify(canonicalise(event.phaseHorizons ?? null))) diagnostics.push('event_context_changed');
    if (date > block.reviewSchedule.nextReviewDate) diagnostics.push('block_review_due');
    const adaptations = new Set<AdaptationKey>();
    for (const objective of block.objectives) {
        const adaptation = developmentAdaptation(objective);
        if (!adaptation || adaptations.has(adaptation) || !['minutes', 'sessions'].includes(objective.doseEnvelope.unit)
            || (adaptation === 'aerobic_endurance' && objective.doseEnvelope.unit !== 'minutes')
            || (adaptation === 'strength' && objective.doseEnvelope.unit !== 'sessions')
            || ((adaptation === 'neuromuscular_power' || adaptation === 'mechanical_exposure') && objective.doseEnvelope.unit !== 'sessions')
            || exactIds(objective).length === 0
            || objective.protectedRoles?.some(role => role.kind !== 'coverage_role' || role.coverageKey !== objective.coverageKey)
            || (objective.allowedSubstitutions?.length ?? 0) > 0) diagnostics.push(`unsupported_objective:${objective.id}`);
        if (adaptation) adaptations.add(adaptation);
        if (!objective.knowledgeLineage.every(id => {
            try { return getActiveKnowledgeClaim(id).status === 'active'; } catch { return false; }
        })) diagnostics.push(`unregistered_knowledge:${objective.id}`);
        const elapsedWeeks = getDayDiff(date, block.dateRange.startDate) / 7;
        if ((objective.exitCriteria?.maxWeeksInBlock !== undefined && elapsedWeeks >= objective.exitCriteria.maxWeeksInBlock)
            || (objective.exitCriteria?.stagnationReviewAfterWeeks !== undefined && elapsedWeeks >= objective.exitCriteria.stagnationReviewAfterWeeks)) diagnostics.push(`objective_review_due:${objective.id}`);
    }
    return { block: diagnostics.length ? null : block, diagnostics };
}

/** Authored intent replaces generic performance priors; safety withholding and health floors remain owned by Evergreen. */
export function applyDevelopmentDose(block: IntentBlock, strategy: EvidenceBackedStrategy, descriptor: CoverageSetDescriptor,
    isAdverseRecovery: boolean, hasClinicalSymptoms: boolean): { strategy: EvidenceBackedStrategy; descriptor: CoverageSetDescriptor } {
    const requirements = strategy.requirements.filter(requirement => requirement.adaptation !== 'high_intensity');
    const roles = [...descriptor.roles];
    for (const objective of block.objectives) {
        const adaptation = developmentAdaptation(objective)!;
        const base = strategy.requirements.find(requirement => requirement.adaptation === adaptation);
        // Existing evidence gates are tighten-only, including embedded capability gates.
        if ((adaptation === 'high_intensity' && (!base || isAdverseRecovery || hasClinicalSymptoms))
            || ((adaptation === 'neuromuscular_power' || adaptation === 'mechanical_exposure') && !base)) continue;
        const envelope = objective.doseEnvelope;
        const healthFloor = base?.floor?.semantics === 'guideline_recommended_minimum' ? base.floor : null;
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.developmentAuthorityPolicy);
        const unit = envelope.unit as 'sessions' | 'minutes';
        const requirement = {
            ...(base ?? {}), adaptation,
            floor: healthFloor?.dose.unit === unit && healthFloor.dose.value > envelope.min ? healthFloor
                : envelope.min > 0 && envelope.floorSemantics === 'hard_floor'
                    ? { dose: { unit, value: envelope.min }, semantics: 'goal_required_minimum' as const } : healthFloor,
            target: { unit, minimum: envelope.min, target: envelope.target, maximum: envelope.max },
            priority: healthFloor && base?.priority === 'required' ? base.priority
                : objective.priority === 'must_have' ? 'required' as const : objective.priority === 'should_have' ? 'target' as const : 'optional' as const,
            substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: [...new Set(exactIds(objective).map(id => WORKOUTS_BY_ID.get(id)!.modality))] },
            knowledgeRefs: [...new Set([...(base?.knowledgeRefs ?? []), ...objective.knowledgeLineage, claim.id])],
            evidence: base?.evidence ?? { knowledgeClaimId: claim.id, knowledgeClaimVersion: claim.version,
                sourceId: claim.evidence[0].sourceId, sourceIds: claim.evidence.map(item => item.sourceId), population: claim.applicability.populations.join('; '),
                outcome: claim.applicability.outcomes.join('; '), confidence: 'low' as const, evidenceCertainty: claim.evidenceCertainty,
                maturity: claim.maturity, status: claim.status, applicability: [...claim.applicability.contexts], authority: 'product_heuristic' as const,
                policyVersion: 'development-authority-v1', reviewedOn: claim.reviewedOn },
        };
        const index = requirements.findIndex(item => item.adaptation === adaptation);
        if (index < 0) requirements.push(requirement); else requirements[index] = requirement;
        const ids = exactIds(objective);
        const role = { id: objective.coverageKey, adaptations: [adaptation], exactWorkoutIds: ids,
            durationMinutes: Math.min(...ids.map(id => WORKOUTS_BY_ID.get(id)!.duration.minimumMin)) };
        const roleIndex = roles.findIndex(item => item.id === role.id);
        if (roleIndex < 0) roles.push(role); else roles[roleIndex] = role;
    }
    return { strategy: { ...strategy, requirements }, descriptor: { ...descriptor, roles } };
}

/** An explicit exact role may bypass generic Base eligibility; all clinical/cost gates still run. */
export function developmentTemplateEligible(template: SessionTemplate, plan: PlanDefinition | null | undefined, phaseEligible: boolean,
    evaluationDate: string, exposures: readonly CompletedExposure[] = []): boolean {
    if (!plan?.developmentBlock) return phaseEligible;
    const qualityIds = plan.coverageOverrides?.find(role => role.key === 'sustained_quality')?.workoutIds ?? [];
    const workoutId = workoutIdForTemplateId(template.id) ?? '';
    const authored = plan.coverageOverrides?.some(role => role.workoutIds.includes(workoutId)) ?? false;
    const genericQuality = [...SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE, ...EVERGREEN_GENERAL_COVERAGE_SET.coverage]
        .some(role => role.key === 'sustained_quality' && role.workoutIds.includes(workoutId));
    if ((genericQuality || ['Hard Endurance', 'Race-Specific Endurance'].includes(template.category)) && !qualityIds.includes(workoutId)) return false;
    const qualityObjective = plan.developmentBlock.objectives.find(objective => objective.coverageKey === 'sustained_quality');
    if (qualityObjective && qualityIds.includes(workoutId)) {
        const rollingStart = addDaysToLocalDateString(evaluationDate, -7);
        const windowStart = plan.developmentBlock.dateRange.startDate > rollingStart ? plan.developmentBlock.dateRange.startDate : rollingStart;
        const completed = exposures.filter(exposure => exposure.date >= windowStart && exposure.date < evaluationDate
            && qualityIds.includes(exposure.workoutId ?? workoutIdForTemplateId(exposure.templateId) ?? ''));
        const dose = qualityObjective.doseEnvelope.unit === 'sessions' ? completed.length
            : completed.reduce((sum, exposure) => sum + (exposure.trainingRecordLike.duration_min ?? 0), 0);
        if (dose >= qualityObjective.doseEnvelope.max) return false;
    }
    return authored || phaseEligible;
}
