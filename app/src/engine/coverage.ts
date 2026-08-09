import type { EventPlanCoverageKey, EventPlanPhase, EventPlanRequirement } from '../workouts/event-plan';
import { SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE } from '../workouts/event-plan';
import { workoutForTemplate } from '../workouts/prescription';
import type { ObjectivePriority, SessionTemplate } from './models';
import type { PlanDefinition } from './planSchedule';
import { addDaysToLocalDateString } from '../utils/localDate';

/**
 * Phase 6.2c / ADR-0016: physiological stimulus credit and programming-role coverage
 * are intentionally independent ledgers. This module owns the latter. Coverage is
 * count-based and requires exact catalog identity; stimulus magnitude, title text,
 * modality and broad category never invent a weekly role.
 */

export interface ExposureIdentity {
    /** Stable occurrence identity, not a workout/template identity. The same physical or
     * projected exposure must carry the same key through completed/projected/fixed paths
     * so role counts are idempotent. */
    occurrenceKey?: string;
    templateId?: string;
    workoutId?: string;
    modality?: SessionTemplate['modality'];
    category?: SessionTemplate['category'];
}

export type CoverageCreditSource = 'completed' | 'projected' | 'fixed_activity';

export interface CoverageCredit {
    occurrenceKey: string;
    date: string;
    coverageKey: EventPlanCoverageKey;
    source: CoverageCreditSource;
    templateId?: string;
    workoutId?: string;
}

export interface WeeklyCoverageRequirement {
    id: string;
    key: EventPlanCoverageKey;
    label: string;
    requirement: EventPlanRequirement;
    minimumSessions: number;
    targetSessions: number;
    completedSessions: number;
    projectedSessions: number;
    priority: ObjectivePriority;
    rollingWindowDays: number;
    windowStart?: string;
    windowEnd?: string;
    credits: CoverageCredit[];
}

export interface CoverageState {
    asOfDate: string;
    phase: EventPlanPhase | null;
    activeBlockId: string | null;
    requirements: WeeklyCoverageRequirement[];
}

export interface CoverageHistoryEntry extends ExposureIdentity {
    date: string;
    source?: CoverageCreditSource;
}

const COVERAGE_BY_KEY = new Map(
    SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE.map(item => [item.key, item]),
);

const ANCHOR_TIMED_COVERAGE_KEYS = new Set<EventPlanCoverageKey>([
    'sustained_quality',
    'outdoor_event_specific',
]);

const DEFERRED_SUPPORT_COVERAGE_KEYS = new Set<EventPlanCoverageKey>([
    'recovery_or_rest',
]);

/** For a cycling A/B event the aerobic-volume floor is the prerequisite for repairing a
 * missed hard role. Primary strength remains a tier-1 required role, but it cannot veto
 * the next feasible cycling-quality repair. */
const HARD_ROLE_REPAIR_PREREQUISITES = new Set<EventPlanCoverageKey>([
    'easy_aerobic',
]);

export function workoutIdForTemplateId(templateId: string | undefined): string | undefined {
    if (!templateId) return undefined;
    return workoutForTemplate(templateId)?.id;
}

export function coverageKeysForExposure(
    identity: ExposureIdentity,
    phase: EventPlanPhase | null,
): EventPlanCoverageKey[] {
    if (!phase) return [];
    const workoutId = identity.workoutId ?? workoutIdForTemplateId(identity.templateId);
    if (!workoutId) return [];
    return SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE
        .filter(item => item.phases.includes(phase) && item.workoutIds.includes(workoutId))
        .map(item => item.key);
}

export function coverageKeysForTemplate(
    template: SessionTemplate,
    phase: EventPlanPhase | null,
): EventPlanCoverageKey[] {
    return coverageKeysForExposure({
        templateId: template.id,
        modality: template.modality,
        category: template.category,
    }, phase);
}

function laterDate(left: string, right: string): string {
    return left > right ? left : right;
}

function activePlanBlock(planDefinition: PlanDefinition | null | undefined, date: string) {
    return planDefinition?.blocks.find(block => block.startDate <= date && date <= block.endDate) ?? null;
}

function occurrenceKeyFor(exposure: CoverageHistoryEntry, resolvedWorkoutId: string | undefined): string {
    if (exposure.occurrenceKey) return exposure.occurrenceKey;
    const source = exposure.source ?? 'completed';
    return `${source}:${exposure.date}:${resolvedWorkoutId ?? exposure.templateId ?? 'unknown'}`;
}

function newRequirement(args: {
    blockId: string;
    key: EventPlanCoverageKey;
    minimumSessions: number;
    targetSessions: number;
    priority: ObjectivePriority;
    rollingWindowDays: number;
    windowStart: string;
    windowEnd: string;
    index: number;
}): WeeklyCoverageRequirement | null {
    const coverage = COVERAGE_BY_KEY.get(args.key);
    if (!coverage) return null;
    return {
        id: `coverage_${args.blockId}_${args.key}_${args.index}`,
        key: args.key,
        label: coverage.label,
        requirement: coverage.requirement,
        minimumSessions: args.minimumSessions,
        targetSessions: args.targetSessions,
        completedSessions: 0,
        projectedSessions: 0,
        priority: args.priority,
        rollingWindowDays: args.rollingWindowDays,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
        credits: [],
    };
}

export function buildCoverageState(
    planDefinition: PlanDefinition | null | undefined,
    asOfDate: string,
    history: readonly CoverageHistoryEntry[] = [],
): CoverageState {
    const block = activePlanBlock(planDefinition, asOfDate);
    if (!planDefinition || !block) {
        return { asOfDate, phase: null, activeBlockId: null, requirements: [] };
    }

    const rollingWindowDays = 7;
    const rollingStart = addDaysToLocalDateString(asOfDate, -(rollingWindowDays - 1));
    const windowStart = laterDate(block.startDate, rollingStart);
    const activeDefinitions = planDefinition.objectives.filter(definition => definition.blockId === block.id);
    const requirementsByKey = new Map<EventPlanCoverageKey, WeeklyCoverageRequirement>();

    activeDefinitions.forEach((definition, index) => {
        const coverage = COVERAGE_BY_KEY.get(definition.coverageKey);
        if (!coverage || !coverage.phases.includes(block.phase)) return;
        const minimumSessions = Math.max(0, definition.coverageMinimumSessions
            ?? (definition.priority === 'must_have' ? Math.min(1, definition.requiredCredit) : 0));
        const targetSessions = Math.max(
            minimumSessions,
            definition.coverageTargetSessions ?? Math.ceil(definition.requiredCredit),
        );
        const existing = requirementsByKey.get(definition.coverageKey);
        if (existing) {
            existing.minimumSessions = Math.max(existing.minimumSessions, minimumSessions);
            existing.targetSessions = Math.max(existing.targetSessions, targetSessions);
            if (definition.priority === 'must_have') existing.priority = 'must_have';
            else if (definition.priority === 'should_have' && existing.priority === 'nice_to_have') existing.priority = 'should_have';
            return;
        }
        const requirement = newRequirement({
            blockId: block.id,
            key: definition.coverageKey,
            minimumSessions,
            targetSessions,
            priority: definition.priority,
            rollingWindowDays,
            windowStart,
            windowEnd: block.endDate,
            index,
        });
        if (requirement) requirementsByKey.set(definition.coverageKey, requirement);
    });

    const recoveryCoverage = COVERAGE_BY_KEY.get('recovery_or_rest');
    if (recoveryCoverage?.requirement === 'required'
        && recoveryCoverage.phases.includes(block.phase)
        && !requirementsByKey.has('recovery_or_rest')) {
        const recoveryRequirement = newRequirement({
            blockId: block.id,
            key: 'recovery_or_rest',
            minimumSessions: 1,
            targetSessions: 1,
            priority: 'must_have',
            rollingWindowDays,
            windowStart,
            windowEnd: block.endDate,
            index: activeDefinitions.length,
        });
        if (recoveryRequirement) requirementsByKey.set('recovery_or_rest', recoveryRequirement);
    }

    const seenOccurrences = new Set<string>();
    for (const exposure of history) {
        if (exposure.date < windowStart || exposure.date >= asOfDate || exposure.date > block.endDate) continue;
        const workoutId = exposure.workoutId ?? workoutIdForTemplateId(exposure.templateId);
        const occurrenceKey = occurrenceKeyFor(exposure, workoutId);
        if (seenOccurrences.has(occurrenceKey)) continue;
        seenOccurrences.add(occurrenceKey);

        const keys = coverageKeysForExposure(exposure, block.phase);
        for (const key of keys) {
            const requirement = requirementsByKey.get(key);
            if (!requirement) continue;
            const source = exposure.source ?? 'completed';
            requirement.credits.push({
                occurrenceKey,
                date: exposure.date,
                coverageKey: key,
                source,
                ...(exposure.templateId ? { templateId: exposure.templateId } : {}),
                ...(workoutId ? { workoutId } : {}),
            });
            if (source === 'completed') requirement.completedSessions += 1;
            else requirement.projectedSessions += 1;
        }
    }

    return {
        asOfDate,
        phase: block.phase,
        activeBlockId: block.id,
        requirements: Array.from(requirementsByKey.values()),
    };
}

function fulfilledSessions(requirement: WeeklyCoverageRequirement): number {
    return requirement.completedSessions + requirement.projectedSessions;
}

function isMinimumUnmet(requirement: WeeklyCoverageRequirement): boolean {
    return requirement.minimumSessions > 0 && fulfilledSessions(requirement) < requirement.minimumSessions;
}

export function getUnfulfilledRequiredCoverage(state: CoverageState): WeeklyCoverageRequirement[] {
    return state.requirements.filter(isMinimumUnmet);
}

export function getUnfulfilledTargetCoverage(state: CoverageState): WeeklyCoverageRequirement[] {
    return state.requirements.filter(requirement => fulfilledSessions(requirement) < requirement.targetSessions);
}

/**
 * Ordinal Level-4 planning signal, deliberately not another tuning coefficient.
 * Hard feasibility/readiness gates still run before this tier participates in sorting.
 *
 * 0 = fulfils the role nominated for this date
 * 1 = advances an unmet immediately-fillable minimum or repairs an overdue hard role
 * 2 = advances an anchor-timed/deferred role before repair is due, or an unmet target
 * 3 = does not advance current explicit coverage
 */
export function coverageNeedTierForTemplate(
    state: CoverageState,
    template: SessionTemplate,
    anchorRole: 'event-specific' | 'quality' | null = null,
): 0 | 1 | 2 | 3 {
    const keys = coverageKeysForTemplate(template, state.phase);
    if (keys.length === 0) return 3;

    const anchorKey: EventPlanCoverageKey | null = anchorRole === 'event-specific'
        ? 'outdoor_event_specific'
        : anchorRole === 'quality' ? 'sustained_quality' : null;

    if (anchorKey && keys.includes(anchorKey)) {
        const requirement = state.requirements.find(item => item.key === anchorKey);
        if (requirement && isMinimumUnmet(requirement)) return 0;
    }

    const repairPrerequisiteMissing = state.requirements.some(requirement =>
        HARD_ROLE_REPAIR_PREREQUISITES.has(requirement.key) && isMinimumUnmet(requirement)
    );

    let advancesAnchorTimedMinimum = false;
    let advancesDeferredSupportMinimum = false;
    for (const key of keys) {
        const requirement = state.requirements.find(item => item.key === key);
        if (!requirement || !isMinimumUnmet(requirement)) continue;
        if (ANCHOR_TIMED_COVERAGE_KEYS.has(key)) {
            advancesAnchorTimedMinimum = true;
            continue;
        }
        if (DEFERRED_SUPPORT_COVERAGE_KEYS.has(key)) {
            advancesDeferredSupportMinimum = true;
            continue;
        }
        return 1;
    }

    // A missed/expired hard role becomes urgent once the aerobic floor exists, but it must
    // not tie a specifically nominated quality/event anchor and steal that date. Existing
    // safety/fatigue/spacing gates still outrank both tiers.
    if (advancesAnchorTimedMinimum && !repairPrerequisiteMissing) return 1;
    if (advancesAnchorTimedMinimum || advancesDeferredSupportMinimum) return 2;

    for (const key of keys) {
        const requirement = state.requirements.find(item => item.key === key);
        if (requirement && fulfilledSessions(requirement) < requirement.targetSessions) return 2;
    }
    return 3;
}
