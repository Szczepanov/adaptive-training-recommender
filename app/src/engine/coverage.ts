import type { CoverageSetDescriptor, CoverageSetId, EventPlanCoverageKey, EventPlanRequirement, PlanCoverageKey, PlanPhase } from '../workouts/event-plan';
import { coverageSetFor, SEPTEMBER_CYCLING_EVENT_COVERAGE_SET } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { workoutForTemplate } from '../workouts/prescription';
import type { ObjectivePriority, SessionTemplate } from './models';
import type { PlanDefinition } from './planSchedule';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { CoverageCreditFact, PerformedTrainingFactsSnapshot } from './performedTrainingFacts';
import type { CompletedExposure } from './trainingHistory';

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
    coverageSetId: CoverageSetId | null;
    /** Descriptor authority used for exact identity lookup. */
    descriptor?: CoverageSetDescriptor | null;
    requirements: WeeklyCoverageRequirement[];
}

export interface CoverageHistoryEntry extends ExposureIdentity {
    date: string;
    source?: CoverageCreditSource;
    /**
     * Canonical semantic role decisions emitted by performedTrainingFacts.ts. Presence is
     * authoritative even when the array is empty: buildCoverageState must not re-infer a
     * role from workout/template identity after the canonical fact layer declined credit.
     * Legacy/projected entries leave this undefined and retain descriptor lookup below.
     */
    canonicalCoverageCredits?: readonly Pick<CoverageCreditFact, 'coverageSetId' | 'coverageKey' | 'creditKind'>[];
}

export type CoverageHistoryInput =
    | CompletedExposure
    | CoverageHistoryEntry
    | {
        date?: string;
        templateId?: string;
        workoutId?: string;
        durationMin?: number;
        modality?: SessionTemplate['modality'] | string;
        category?: SessionTemplate['category'] | string;
        source?: CoverageCreditSource;
        trainingRecordLike?: unknown;
    };

export interface CoverageExposureLike {
    performedOccurrenceId?: string;
    localDate?: string;
    workoutId?: string;
    templateId?: string;
    durationMin?: number;
    modality?: SessionTemplate['modality'] | string;
    category?: SessionTemplate['category'] | string;
}

export type CoverageCreditLike = Pick<CoverageCreditFact,
    'performedOccurrenceId' | 'coverageSetId' | 'coverageKey' | 'creditKind'>;

export type CoveragePerformedFacts =
    | PerformedTrainingFactsSnapshot
    | {
        exposures: readonly CoverageExposureLike[];
        /** Transitional compatibility: older injected fixtures may omit the semantic
         * ledger. Production PerformedTrainingFactsSnapshot always supplies it. */
        coverageCredits?: readonly CoverageCreditLike[];
    };

export function coverageHistoryFromFacts(performedFacts: CoveragePerformedFacts): CoverageHistoryEntry[] {
    const hasCanonicalCreditLedger = performedFacts.coverageCredits !== undefined;
    const creditsByOccurrence = new Map<string, CoverageHistoryEntry['canonicalCoverageCredits']>();

    if (hasCanonicalCreditLedger) {
        for (const credit of performedFacts.coverageCredits ?? []) {
            // PR 3 intentionally enables exact identity only. semantic_confident remains
            // disabled until a separately authored policy defines its threshold/semantics;
            // `none` is observability, never role fulfillment.
            if (credit.creditKind !== 'exact') continue;
            const current = creditsByOccurrence.get(credit.performedOccurrenceId) ?? [];
            if (!current.some(item => item.coverageSetId === credit.coverageSetId && item.coverageKey === credit.coverageKey)) {
                creditsByOccurrence.set(credit.performedOccurrenceId, [...current, {
                    coverageSetId: credit.coverageSetId,
                    coverageKey: credit.coverageKey,
                    creditKind: credit.creditKind,
                }]);
            }
        }
    }

    return performedFacts.exposures.flatMap(fact => {
        if (!fact.localDate) return [];
        return [{
            occurrenceKey: fact.performedOccurrenceId ?? `occ-${fact.localDate}-${fact.workoutId ?? fact.templateId ?? 'unknown'}`,
            date: fact.localDate,
            ...(fact.workoutId ? { workoutId: fact.workoutId } : {}),
            ...(fact.templateId ? { templateId: fact.templateId } : {}),
            ...(fact.durationMin !== undefined ? { durationMin: fact.durationMin } : {}),
            ...(fact.modality && fact.modality !== 'Unknown' ? { modality: fact.modality as SessionTemplate['modality'] } : {}),
            ...(fact.category ? { category: fact.category as SessionTemplate['category'] } : {}),
            ...(hasCanonicalCreditLedger ? {
                canonicalCoverageCredits: fact.performedOccurrenceId
                    ? (creditsByOccurrence.get(fact.performedOccurrenceId) ?? [])
                    : [],
            } : {}),
            source: 'completed' as const,
        }];
    });
}

export function coverageHistoryFromCompletedExposures(history: readonly CoverageHistoryInput[]): CoverageHistoryEntry[] {
    return history.flatMap(entry => {
        if (!entry.date) return [];
        const durationMin = ('durationMin' in entry && typeof entry.durationMin === 'number')
            ? entry.durationMin
            : ('trainingRecordLike' in entry && entry.trainingRecordLike && typeof entry.trainingRecordLike === 'object' && 'duration_min' in entry.trainingRecordLike && typeof (entry.trainingRecordLike as { duration_min?: unknown }).duration_min === 'number')
                ? (entry.trainingRecordLike as { duration_min: number }).duration_min
                : undefined;
        return [{
            date: entry.date,
            ...(entry.templateId ? { templateId: entry.templateId } : {}),
            ...(entry.workoutId ? { workoutId: entry.workoutId } : {}),
            ...(durationMin !== undefined ? { durationMin } : {}),
            ...(entry.modality && entry.modality !== 'Unknown' ? { modality: entry.modality as SessionTemplate['modality'] } : {}),
            ...(entry.category ? { category: entry.category as SessionTemplate['category'] } : {}),
            source: ('source' in entry && entry.source) ? entry.source : 'completed' as const,
        }];
    });
}

/**
 * Resolves coverage history entries prioritizing ADR-0034 canonical performed facts over
 * legacy reconstructed history.
 *
 * If canonical facts are supplied (even if empty, representing zero performed sessions),
 * they are authoritative. Only when canonical facts are null/undefined does it fall back
 * to legacy reconstructed history.
 */
export function resolveCoverageHistory(
    performedFacts?: CoveragePerformedFacts | null,
    legacyHistory?: readonly CoverageHistoryInput[],
): CoverageHistoryEntry[] {
    if (performedFacts && performedFacts.exposures) {
        return coverageHistoryFromFacts(performedFacts);
    }
    if (legacyHistory) {
        return coverageHistoryFromCompletedExposures(legacyHistory);
    }
    return [];
}

/** Descriptor-scoped lookup keeps the registry generic without reintroducing the old
 * module-level September-only map. The planner calls this in its inner allocation loop. */
const COVERAGE_BY_DESCRIPTOR = new WeakMap<CoverageSetDescriptor, Map<PlanCoverageKey, CoverageSetDescriptor['coverage'][number]>>();

function coverageFor(descriptor: CoverageSetDescriptor, key: PlanCoverageKey) {
    let byKey = COVERAGE_BY_DESCRIPTOR.get(descriptor);
    if (!byKey) {
        byKey = new Map(descriptor.coverage.map(item => [item.key, item]));
        COVERAGE_BY_DESCRIPTOR.set(descriptor, byKey);
    }
    return byKey.get(key);
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

function hasRequiredAerobicDose(identity: ExposureIdentity, workoutId: string): boolean {
    const minimumDuration = WORKOUTS_BY_ID.get(workoutId)?.duration.minimumMin;
    return typeof minimumDuration === 'number'
        && typeof identity.durationMin === 'number'
        && Number.isFinite(identity.durationMin)
        && identity.durationMin >= minimumDuration;
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
        .filter(item => item.key !== 'aerobic_volume' || hasRequiredAerobicDose(identity, workoutId))
        .map(item => item.key);
}

function canonicalCoverageKeysForExposure(
    exposure: CoverageHistoryEntry,
    phase: PlanPhase,
    descriptor: CoverageSetDescriptor,
    workoutId: string | undefined,
): PlanCoverageKey[] | null {
    if (exposure.canonicalCoverageCredits === undefined) return null;

    const keys = exposure.canonicalCoverageCredits
        .filter(credit => credit.creditKind === 'exact' && credit.coverageSetId === descriptor.id)
        .map(credit => credit.coverageKey)
        .filter((key, index, all) => all.indexOf(key) === index)
        .filter(key => {
            const definition = coverageFor(descriptor, key);
            if (!definition || !definition.phases.includes(phase)) return false;
            // Identity comes from the canonical semantic ledger; dose eligibility remains a
            // coverage-state concern so a short exact Z2 execution cannot satisfy the
            // authored aerobic-volume floor merely because its catalog id is known.
            if (key !== 'aerobic_volume') return true;
            return workoutId !== undefined && hasRequiredAerobicDose(exposure, workoutId);
        });

    return keys;
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
    const coverage = coverageFor(args.descriptor, args.key);
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
        const coverage = coverageFor(descriptor, definition.coverageKey);
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

    const recoveryCoverage = coverageFor(descriptor, 'recovery_or_rest');
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

        const canonicalKeys = canonicalCoverageKeysForExposure(exposure, block.phase, descriptor, workoutId);
        const keys = canonicalKeys ?? coverageKeysForExposure(exposure, block.phase, descriptor);
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
