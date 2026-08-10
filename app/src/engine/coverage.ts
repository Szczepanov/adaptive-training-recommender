import type { CoverageSetDescriptor, EventPlanCoverageKey, EventPlanRequirement, PlanCoverageKey, PlanPhase } from '../workouts/event-plan';
import { coverageSetFor, SEPTEMBER_CYCLING_EVENT_COVERAGE_SET } from '../workouts/event-plan';
import { WORKOUTS } from '../workouts/catalog';
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
    /** Exact completed or projected duration. Coverage that requires a real aerobic dose
     * fails closed when this evidence is unavailable or below the catalog minimum. */
    durationMin?: number;
    modality?: SessionTemplate['modality'];
    category?: SessionTemplate['category'];
}

export type CoverageCreditSource = 'completed' | 'projected' | 'fixed_activity';

export interface CoverageCredit {
    occurrenceKey: string;
    date: string;
    coverageKey: PlanCoverageKey;
    source: CoverageCreditSource;
    templateId?: string;
    workoutId?: string;
}

export interface WeeklyCoverageRequirement {
    id: string;
    key: PlanCoverageKey;
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
    phase: PlanPhase | null;
    activeBlockId: string | null;
    /** Which authored coverage set these requirements came from. ADR-0018 D-MISS makes it
     * part of a role occurrence's canonical identity; ADR-0017 D-COVSET will turn it into
     * a registry lookup rather than today's single module constant. */
    coverageSetId: string | null;
    /** Descriptor authority used for exact identity lookup. */
    descriptor?: CoverageSetDescriptor | null;
    requirements: WeeklyCoverageRequirement[];
}

export interface CoverageHistoryEntry extends ExposureIdentity {
    date: string;
    source?: CoverageCreditSource;
}

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
    'aerobic_volume',
]);

/** Stable identity of one authored `EventPlanSessionCoverage` record. Coverage keys are
 * unique within a set, so the pair is the record's primary key; it is deliberately not a
 * chosen template, workout or candidate. */
export function authoredSessionIdentityFor(coverageSetId: string, key: EventPlanCoverageKey): string {
    return `${coverageSetId}:${key}`;
}

export function workoutIdForTemplateId(templateId: string | undefined): string | undefined {
    if (!templateId) return undefined;
    return workoutForTemplate(templateId)?.id;
}

export function coverageKeysForExposure(
    identity: ExposureIdentity,
    phase: PlanPhase | null,
    descriptor: CoverageSetDescriptor = SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
): PlanCoverageKey[] {
    if (!phase) return [];
    const workoutId = identity.workoutId ?? workoutIdForTemplateId(identity.templateId);
    if (!workoutId) return [];
    return descriptor.coverage
        .filter(item => item.phases.includes(phase) && item.workoutIds.includes(workoutId))
        .filter(item => {
            if (item.key !== 'aerobic_volume') return true;
            const minimumDuration = WORKOUTS.find(workout => workout.id === workoutId)?.duration.minimumMin;
            return typeof minimumDuration === 'number'
                && typeof identity.durationMin === 'number'
                && Number.isFinite(identity.durationMin)
                && identity.durationMin >= minimumDuration;
        })
        .map(item => item.key);
}

export function coverageKeysForTemplate(
    template: SessionTemplate,
    phase: PlanPhase | null,
    descriptor: CoverageSetDescriptor = SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
): PlanCoverageKey[] {
    return coverageKeysForExposure({
        templateId: template.id,
        modality: template.modality,
        category: template.category,
        durationMin: template.durationMin,
    }, phase, descriptor);
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
    descriptor: CoverageSetDescriptor;
    blockId: string;
    key: PlanCoverageKey;
    minimumSessions: number;
    targetSessions: number;
    priority: ObjectivePriority;
    rollingWindowDays: number;
    windowStart: string;
    windowEnd: string;
    index: number;
}): WeeklyCoverageRequirement | null {
    const coverage = args.descriptor.coverage.find(item => item.key === args.key);
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
    descriptor: CoverageSetDescriptor | null = planDefinition ? coverageSetFor(planDefinition.coverageSetId) : null,
): CoverageState {
    const block = activePlanBlock(planDefinition, asOfDate);
    if (!planDefinition || !block || !descriptor) {
        return { asOfDate, phase: null, activeBlockId: null, coverageSetId: null, descriptor: null, requirements: [] };
    }

    const rollingWindowDays = 7;
    // `asOfDate` is exclusive, so the preceding seven calendar dates start seven days
    // back (not six). This keeps a full seven completed/projected exposures eligible.
    const rollingStart = addDaysToLocalDateString(asOfDate, -rollingWindowDays);
    const windowStart = laterDate(block.startDate, rollingStart);
    const activeDefinitions = planDefinition.objectives.filter(definition => definition.blockId === block.id);
    const requirementsByKey = new Map<PlanCoverageKey, WeeklyCoverageRequirement>();

    activeDefinitions.forEach((definition, index) => {
        const coverage = descriptor.coverage.find(item => item.key === definition.coverageKey);
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
            descriptor,
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

    const recoveryCoverage = descriptor.coverage.find(item => item.key === 'recovery_or_rest');
    if (recoveryCoverage?.requirement === 'required'
        && recoveryCoverage.phases.includes(block.phase)
        && !requirementsByKey.has('recovery_or_rest')) {
        const recoveryRequirement = newRequirement({
            descriptor,
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

        const keys = coverageKeysForExposure(exposure, block.phase, descriptor);
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
        coverageSetId: descriptor.id,
        descriptor,
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
 * 0 = fulfils the role nominated for this date, or repairs an overdue hard role on an
 *     otherwise unclaimed date once the aerobic floor exists
 * 1 = advances an unmet immediately-fillable minimum, or an overdue hard role while a
 *     different hard role owns today's nominated anchor
 * 2 = advances an anchor-timed/deferred role before repair is due, or an unmet target
 * 3 = does not advance current explicit coverage
 */
export function coverageNeedTierForTemplate(
    state: CoverageState,
    template: SessionTemplate,
    anchorRole: 'event-specific' | 'quality' | null = null,
): 0 | 1 | 2 | 3 {
    const keys = state.descriptor ? coverageKeysForTemplate(template, state.phase, state.descriptor) : [];
    if (keys.length === 0) return 3;

    const anchorKey: PlanCoverageKey | null = anchorRole === 'event-specific'
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

    // Missed/expired hard coverage self-repairs aggressively on an otherwise unclaimed
    // day, but never ties and steals a different explicitly nominated hard anchor. The
    // normal fatigue/spacing/time/equipment gates still run before this ordering matters.
    if (advancesAnchorTimedMinimum && !repairPrerequisiteMissing) {
        return anchorRole === null ? 0 : 1;
    }
    if (advancesAnchorTimedMinimum || advancesDeferredSupportMinimum) return 2;

    for (const key of keys) {
        const requirement = state.requirements.find(item => item.key === key);
        if (requirement && fulfilledSessions(requirement) < requirement.targetSessions) return 2;
    }
    return 3;
}
