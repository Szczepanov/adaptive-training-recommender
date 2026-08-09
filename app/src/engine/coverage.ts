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
    templateId?: string;
    workoutId?: string;
    modality?: SessionTemplate['modality'];
    category?: SessionTemplate['category'];
}

export type CoverageCreditSource = 'completed' | 'projected' | 'fixed_activity';

export interface CoverageCredit {
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

/** Hard developmental roles are deliberately anchor-timed. Treating every unmet role as
 * equally urgent on every healthy day makes the greedy planner front-load threshold +
 * race-specific work, then spend several days recovering. The weekly contract still
 * requires these roles; this set only controls *when* they receive Level-4 urgency. */
const ANCHOR_TIMED_COVERAGE_KEYS = new Set<EventPlanCoverageKey>([
    'sustained_quality',
    'outdoor_event_specific',
]);

/** Recovery is a required weekly shape, but it should normally emerge on a fatigue,
 * adjacency or low-opportunity-cost day rather than outrank developmental work on the
 * first green day of a fresh rolling window. It therefore advances at target tier unless
 * safety/readiness has already restricted the candidate set to recovery. */
const DEFERRED_SUPPORT_COVERAGE_KEYS = new Set<EventPlanCoverageKey>([
    'recovery_or_rest',
]);

/**
 * The detailed-workout resolver used for coverage is exactly the same resolver used to
 * produce the athlete-facing prescription. This is important because some older session
 * families are linked through prescription.ts's explicit fallback table rather than a
 * WorkoutDefinition.engineTemplateIds field. Coverage must describe the workout the user
 * would actually receive, not a parallel approximation of template identity.
 */
export function workoutIdForTemplateId(templateId: string | undefined): string | undefined {
    if (!templateId) return undefined;
    return workoutForTemplate(templateId)?.id;
}

/** Exact authored mapping only. An exposure may fulfil more than one role when the event
 * plan explicitly maps the same workout to multiple coverage keys (e.g. an event-specific
 * workout can also cover short surges). */
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

/**
 * Builds the rolling seven-day programming-role ledger for the currently active authored
 * block. The rolling window is clipped to the block boundary; work from a prior phase does
 * not satisfy the new phase's role contract merely because it is six days old.
 */
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

    for (const exposure of history) {
        if (exposure.date < windowStart || exposure.date >= asOfDate || exposure.date > block.endDate) continue;
        const keys = coverageKeysForExposure(exposure, block.phase);
        const workoutId = exposure.workoutId ?? workoutIdForTemplateId(exposure.templateId);
        for (const key of keys) {
            const requirement = requirementsByKey.get(key);
            if (!requirement) continue;
            const source = exposure.source ?? 'completed';
            requirement.credits.push({
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

export function getUnfulfilledRequiredCoverage(state: CoverageState): WeeklyCoverageRequirement[] {
    return state.requirements.filter(requirement =>
        requirement.minimumSessions > 0 && fulfilledSessions(requirement) < requirement.minimumSessions
    );
}

export function getUnfulfilledTargetCoverage(state: CoverageState): WeeklyCoverageRequirement[] {
    return state.requirements.filter(requirement => fulfilledSessions(requirement) < requirement.targetSessions);
}

/**
 * Ordinal Level-4 planning signal, deliberately not another tuning coefficient.
 * Hard feasibility/readiness gates still run before this tier participates in sorting.
 *
 * 0 = fulfils the nominated hard-developmental anchor role now
 * 1 = advances an unmet immediately-fillable required minimum
 * 2 = advances an anchor-timed/deferred required role off its intended day, or an unmet target
 * 3 = does not advance current explicit coverage
 *
 * The crucial distinction is weekly requirement vs daily urgency. `sustained_quality` and
 * `outdoor_event_specific` remain minimum requirements, but they only become tier 0 on the
 * date the planner nominated for that role. This stops greedy day-0/day-1 front-loading
 * without weakening the seven-day contract.
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
        if (requirement && fulfilledSessions(requirement) < requirement.minimumSessions) return 0;
    }

    let advancesDeferredRequired = false;
    for (const key of keys) {
        const requirement = state.requirements.find(item => item.key === key);
        if (!requirement || fulfilledSessions(requirement) >= requirement.minimumSessions) continue;
        if (ANCHOR_TIMED_COVERAGE_KEYS.has(key) || DEFERRED_SUPPORT_COVERAGE_KEYS.has(key)) {
            advancesDeferredRequired = true;
            continue;
        }
        return 1;
    }

    if (advancesDeferredRequired) return 2;

    for (const key of keys) {
        const requirement = state.requirements.find(item => item.key === key);
        if (requirement && fulfilledSessions(requirement) < requirement.targetSessions) return 2;
    }
    return 3;
}
