import type { CoverageSetDescriptor, CoverageSetId, EventPlanCoverageKey, EventPlanRequirement, PlanCoverageKey, PlanPhase } from '../workouts/event-plan';
import { coverageSetFor, SEPTEMBER_CYCLING_EVENT_COVERAGE_SET } from '../workouts/event-plan';
import { workoutForTemplate } from '../workouts/prescription';
import type { GuardrailKey, ObjectivePriority, SessionTemplate } from './models';
import type { PlanDefinition } from './planSchedule';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { CoverageCreditFact, PerformedTrainingFactsSnapshot } from './performedTrainingFacts';
import type { CompletedExposure } from './trainingHistory';
import { aerobicVolumeFloorForWorkout, type AerobicVolumeFloor } from './aerobicVolumeFloor';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { grantsPowerExposureCredit } from '../workouts/powerExposure';

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
    /** Upper bound of a planned (candidate or projected) prescription. Completed exposures
     * omit it: their `durationMin` is the actual duration. Issue #757 judges a planned
     * session against the athlete floor by the range it prescribes. */
    durationMax?: number;
    /** True when the exposure uses a readiness-limited (`modify`-tier) easier dose rather
     * than its full prescription. Readiness-modified doses preserve aerobic maintenance
     * without claiming exact weekly `aerobic_volume` role coverage. */
    isReadinessModifiedDose?: boolean;
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
    minimumDurationMinutes?: number;
    exactWorkoutIds?: string[];
    completedSessions: number;
    projectedSessions: number;
    priority: ObjectivePriority;
    rollingWindowDays: number;
    windowStart?: string;
    windowEnd?: string;
    credits: CoverageCredit[];
    /** Issue #801: reserved only without displacing a primary required role. */
    reservationTier?: 'support';
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
    /** Issue #757: athlete-level `aerobic_volume` duration floor applied to both completed
     * history and candidate templates. Absent means the catalog minimum. */
    aerobicVolumeFloor?: AerobicVolumeFloor | null;
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
        occurrenceKey?: string;
        templateId?: string;
        workoutId?: string;
        durationMin?: number;
        durationMax?: number;
        isReadinessModifiedDose?: boolean;
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
    isReadinessModifiedDose?: boolean;
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
            ...('isReadinessModifiedDose' in fact && fact.isReadinessModifiedDose ? { isReadinessModifiedDose: true as const } : {}),
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

/** Convert completed or projected exposure history inputs into normalized coverage history entries. */
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
            ...('occurrenceKey' in entry && entry.occurrenceKey ? { occurrenceKey: entry.occurrenceKey } : {}),
            ...(entry.templateId ? { templateId: entry.templateId } : {}),
            ...(entry.workoutId ? { workoutId: entry.workoutId } : {}),
            ...(durationMin !== undefined ? { durationMin } : {}),
            ...('durationMax' in entry && typeof entry.durationMax === 'number' ? { durationMax: entry.durationMax } : {}),
            ...('isReadinessModifiedDose' in entry && entry.isReadinessModifiedDose ? { isReadinessModifiedDose: true } : {}),
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

/** Issue #802 / ADR-0044 D6: embedded capability keys are credited and reported but never
 * raise a candidate's coverage-need tier. An unmet power target must not promote a
 * standalone power or lower-body session as catch-up work; power rides only inside the
 * strength role that already earns its own tier. */
const EMBEDDED_ONLY_COVERAGE_KEYS = new Set<PlanCoverageKey>([
    'power_exposure',
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

/** Resolve the catalog workout id associated with a session template id. */
export function workoutIdForTemplateId(templateId: string | undefined): string | undefined {
    if (!templateId) return undefined;
    return workoutForTemplate(templateId)?.id;
}

/** Resolve the uncapped standard-template duration ceiling for planned or projected
 * exposures (`source` is `'projected'` or `'fixed_activity'`, or `durationMax` is
 * present), while returning `undefined` for completed exposures so completed sessions
 * remain governed by their actual duration against the athlete floor. */
function standardTemplateCeilingFor(
    identity: ExposureIdentity & { source?: CoverageCreditSource },
    workoutId: string,
): number | undefined {
    const isCompletedExposure = identity.source === 'completed'
        || (identity.source === undefined && identity.durationMax === undefined);
    if (isCompletedExposure) return undefined;

    if (identity.templateId) {
        const directCeiling = ENRICHED_TEMPLATES_BY_ID.get(identity.templateId)?.durationMax;
        if (directCeiling !== undefined) return directCeiling;
    }

    const engineTemplateIds = WORKOUTS_BY_ID.get(workoutId)?.engineTemplateIds ?? [];
    let maxTemplateCeiling: number | undefined;
    for (const templateId of engineTemplateIds) {
        const templateMax = ENRICHED_TEMPLATES_BY_ID.get(templateId)?.durationMax;
        if (templateMax !== undefined && (maxTemplateCeiling === undefined || templateMax > maxTemplateCeiling)) {
            maxTemplateCeiling = templateMax;
        }
    }
    return maxTemplateCeiling;
}

/** The lower bound must reach the catalog minimum, as before #757. Issue #757 adds the
 * athlete-level floor: a completed session meets it with its actual duration, a planned
 * one with the upper bound of its prescribed range (a capped day truncates that bound).
 * When evaluating a planned SessionTemplate or projected exposure, the required floor is
 * also bounded by the template's own uncapped standard durationMax so a workout's
 * harderDose catalog ceiling never disqualifies the standard prescription. */
function hasRequiredAerobicDose(
    identity: ExposureIdentity & { source?: CoverageCreditSource },
    workoutId: string,
    floor?: AerobicVolumeFloor | null,
    templateCeilingMin?: number,
): boolean {
    if (identity.isReadinessModifiedDose) return false;
    const catalogMinimum = aerobicVolumeFloorForWorkout(workoutId, null);
    const rawAthleteFloor = aerobicVolumeFloorForWorkout(workoutId, floor);
    const lower = identity.durationMin;
    if (catalogMinimum === undefined || rawAthleteFloor === undefined
        || typeof lower !== 'number' || !Number.isFinite(lower) || lower < catalogMinimum) return false;
    const effectiveCeiling = templateCeilingMin ?? standardTemplateCeilingFor(identity, workoutId);
    const athleteFloor = effectiveCeiling !== undefined
        ? Math.max(catalogMinimum, Math.min(rawAthleteFloor, effectiveCeiling))
        : rawAthleteFloor;
    const reach = typeof identity.durationMax === 'number' && Number.isFinite(identity.durationMax)
        ? Math.max(lower, identity.durationMax)
        : lower;
    return reach >= athleteFloor;
}

/** Return all authored plan coverage keys satisfied by an exposure in the given phase. */
export function coverageKeysForExposure(
    identity: ExposureIdentity & { source?: CoverageCreditSource },
    phase: PlanPhase | null,
    descriptor: CoverageSetDescriptor = SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
    floor?: AerobicVolumeFloor | null,
    templateCeilingMin?: number,
): PlanCoverageKey[] {
    if (!phase) return [];
    const workoutId = identity.workoutId ?? workoutIdForTemplateId(identity.templateId);
    if (!workoutId) return [];
    return descriptor.coverage
        .filter(item => item.phases.includes(phase) && item.workoutIds.includes(workoutId))
        .filter(item => item.key !== 'aerobic_volume' || hasRequiredAerobicDose(identity, workoutId, floor, templateCeilingMin))
        .filter(item => item.minimumDurationMinutes === undefined
            || Math.max(identity.durationMin ?? 0, identity.durationMax ?? 0) >= item.minimumDurationMinutes)
        .filter(item => item.key !== 'power_exposure' || grantsPowerExposureCredit({ workoutId, isReadinessModifiedDose: identity.isReadinessModifiedDose }))
        .map(item => item.key);
}

/** Resolve coverage keys from an exposure's canonical coverage-credit ledger when present,
 * enforcing phase and dose-floor eligibility for `aerobic_volume`. */
function canonicalCoverageKeysForExposure(
    exposure: CoverageHistoryEntry,
    phase: PlanPhase,
    descriptor: CoverageSetDescriptor,
    workoutId: string | undefined,
    floor?: AerobicVolumeFloor | null,
): PlanCoverageKey[] | null {
    if (exposure.canonicalCoverageCredits === undefined) return null;

    const keys = exposure.canonicalCoverageCredits
        .filter(credit => credit.creditKind === 'exact' && credit.coverageSetId === descriptor.id)
        .map(credit => credit.coverageKey)
        .filter((key, index, all) => all.indexOf(key) === index)
        .filter(key => {
            const definition = coverageFor(descriptor, key);
            if (!definition || !definition.phases.includes(phase)) return false;
            if (workoutId === undefined || !definition.workoutIds.includes(workoutId)) return false;
            // Identity comes from the canonical semantic ledger; dose eligibility remains a
            // coverage-state concern so a short exact Z2 execution cannot satisfy the
            // authored aerobic-volume floor merely because its catalog id is known.
            // Power exposure is likewise withheld from a readiness-modified dose (#802).
            if (key === 'power_exposure') {
                return grantsPowerExposureCredit({ workoutId, isReadinessModifiedDose: exposure.isReadinessModifiedDose });
            }
            if (definition.minimumDurationMinutes !== undefined
                && Math.max(exposure.durationMin ?? 0, exposure.durationMax ?? 0) < definition.minimumDurationMinutes) return false;
            if (key !== 'aerobic_volume') return true;
            return workoutId !== undefined && hasRequiredAerobicDose(exposure, workoutId, floor);
        });

    return keys;
}

/** Return all authored plan coverage keys satisfied by a candidate session template. */
export function coverageKeysForTemplate(
    template: SessionTemplate & { isReadinessModifiedDose?: boolean },
    phase: PlanPhase | null,
    descriptor: CoverageSetDescriptor = SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
    floor?: AerobicVolumeFloor | null,
): PlanCoverageKey[] {
    const uncappedTemplateCeiling = ENRICHED_TEMPLATES_BY_ID.get(template.id)?.durationMax ?? template.durationMax;
    return coverageKeysForExposure({
        templateId: template.id,
        modality: template.modality,
        category: template.category,
        durationMin: template.durationMin,
        durationMax: template.durationMax,
        ...(template.isReadinessModifiedDose ? { isReadinessModifiedDose: true } : {}),
    }, phase, descriptor, floor, uncappedTemplateCeiling);
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
    aerobicVolumeFloor?: AerobicVolumeFloor | null,
): CoverageState {
    const block = activePlanBlock(planDefinition, asOfDate);
    if (!planDefinition || !block || !descriptor) {
        return { asOfDate, phase: null, activeBlockId: null, coverageSetId: null, descriptor: null, requirements: [], aerobicVolumeFloor };
    }

    const anchorRequirement = planDefinition.coverageRequirements?.find(requirement =>
        requirement.coverageKey === 'long_aerobic_anchor' && requirement.blockId === block.id)?.minimumDurationMinutes;
    const anchorPlanRequirement = planDefinition.coverageRequirements?.find(requirement =>
        requirement.coverageKey === 'long_aerobic_anchor' && requirement.blockId === block.id);
    const activeDescriptor: CoverageSetDescriptor = anchorPlanRequirement === undefined ? descriptor : {
        ...descriptor,
        coverage: descriptor.coverage.map(item => item.key === 'long_aerobic_anchor'
            ? {
                ...item,
                ...(anchorRequirement !== undefined ? { minimumDurationMinutes: anchorRequirement } : {}),
                ...(anchorPlanRequirement.exactWorkoutIds?.length ? { workoutIds: anchorPlanRequirement.exactWorkoutIds } : {}),
            }
            : item),
    };

    const rollingWindowDays = 7;
    // `asOfDate` is exclusive, so the preceding seven calendar dates start seven days
    // back (not six). This keeps a full seven completed/projected exposures eligible.
    const rollingStart = addDaysToLocalDateString(asOfDate, -rollingWindowDays);
    const windowStart = laterDate(block.startDate, rollingStart);
    const activeDefinitions = planDefinition.objectives.filter(definition => definition.blockId === block.id);
    const requirementsByKey = new Map<PlanCoverageKey, WeeklyCoverageRequirement>();

    activeDefinitions.forEach((definition, index) => {
        const coverage = coverageFor(activeDescriptor, definition.coverageKey);
        if (!coverage || !coverage.phases.includes(block.phase)) return;
        const minimumSessions = Math.max(0, definition.coverageMinimumSessions
            ?? (definition.priority === 'must_have' ? Math.min(1, definition.requiredCredit) : 0));
        const targetSessions = Math.max(
            minimumSessions,
            definition.coverageTargetSessions ?? Math.ceil(definition.requiredCredit),
        );
        const existing = requirementsByKey.get(definition.coverageKey);
        if (existing) {
            // A primary definition for the same key always wins over a support tier.
            if (definition.reservationTier !== 'support' && existing.reservationTier === 'support') {
                requirementsByKey.set(definition.coverageKey, {
                    ...existing,
                    reservationTier: undefined,
                    minimumSessions: Math.max(existing.minimumSessions, minimumSessions),
                    targetSessions: Math.max(existing.targetSessions, targetSessions),
                    priority: definition.priority === 'must_have' ? 'must_have' : existing.priority,
                });
                return;
            }
            existing.minimumSessions = Math.max(existing.minimumSessions, minimumSessions);
            existing.targetSessions = Math.max(existing.targetSessions, targetSessions);
            if (definition.priority === 'must_have') existing.priority = 'must_have';
            else if (definition.priority === 'should_have' && existing.priority === 'nice_to_have') existing.priority = 'should_have';
            return;
        }
        const requirement = newRequirement({
            descriptor: activeDescriptor,
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
        if (requirement) {
            requirementsByKey.set(definition.coverageKey, definition.reservationTier === 'support'
                ? { ...requirement, reservationTier: 'support' }
                : requirement);
        }
    });

    // Issue #802: coverage-only capability requirements (no stimulus objective) share the
    // same exact-identity ledger, so one session may credit several keys at once.
    (planDefinition.coverageRequirements ?? [])
        .filter(definition => definition.blockId === block.id && !requirementsByKey.has(definition.coverageKey))
        .forEach((definition, index) => {
            const coverage = coverageFor(activeDescriptor, definition.coverageKey);
            if (!coverage || !coverage.phases.includes(block.phase)) return;
            const minimumSessions = Math.max(0, definition.minimumSessions);
            const requirement = newRequirement({
                descriptor: activeDescriptor,
                blockId: block.id,
                key: definition.coverageKey,
                minimumSessions,
                targetSessions: Math.max(minimumSessions, definition.targetSessions),
                priority: definition.priority,
                rollingWindowDays,
                windowStart,
                windowEnd: block.endDate,
                index: activeDefinitions.length + index,
            });
            if (requirement) requirementsByKey.set(definition.coverageKey, {
                ...requirement,
                ...(definition.minimumDurationMinutes !== undefined ? { minimumDurationMinutes: definition.minimumDurationMinutes } : {}),
                ...(definition.exactWorkoutIds?.length ? { exactWorkoutIds: definition.exactWorkoutIds } : {}),
            });
        });

    const recoveryCoverage = coverageFor(activeDescriptor, 'recovery_or_rest');
    if (recoveryCoverage?.requirement === 'required'
        && recoveryCoverage.phases.includes(block.phase)
        && !requirementsByKey.has('recovery_or_rest')) {
        const recoveryRequirement = newRequirement({
            descriptor: activeDescriptor,
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

        const canonicalKeys = canonicalCoverageKeysForExposure(exposure, block.phase, activeDescriptor, workoutId, aerobicVolumeFloor);
        const keys = canonicalKeys ?? coverageKeysForExposure(exposure, block.phase, activeDescriptor, aerobicVolumeFloor);
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
        coverageSetId: activeDescriptor.id,
        descriptor: activeDescriptor,
        requirements: Array.from(requirementsByKey.values()),
        aerobicVolumeFloor,
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

const SYMPTOM_COMPATIBLE_STRENGTH_GUARDRAILS = new Set<GuardrailKey>([
    'avoid_overhead_pressing',
    'avoid_heavy_spinal_loading',
]);

/**
 * A guardrail-safe strength fallback may preserve useful resistance exposure while the
 * exact authored primary-strength role is temporarily unavailable. This is ranking support
 * only: it deliberately does not return a coverage key, mutate the ledger, or claim that a
 * reduced symptom-compatible session fulfilled the primary-strength requirement.
 */
export function supportsUnmetPrimaryStrengthAsSymptomCompatibleFallback(
    state: CoverageState,
    template: SessionTemplate,
    guardrails: readonly GuardrailKey[],
): boolean {
    if (template.guardrailFallbackRole !== 'shoulder_spinal_strength') return false;
    if (!guardrails.some(guardrail => SYMPTOM_COMPATIBLE_STRENGTH_GUARDRAILS.has(guardrail))) return false;
    const primaryStrength = state.requirements.find(requirement => requirement.key === 'primary_strength');
    return Boolean(primaryStrength && isMinimumUnmet(primaryStrength));
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
    template: SessionTemplate & { isReadinessModifiedDose?: boolean },
    anchorRole: 'event-specific' | 'quality' | null = null,
    deferAnchorAdjacentHeavyStrength: boolean = false,
): 0 | 1 | 2 | 3 {
    const keys = (state.descriptor ? coverageKeysForTemplate(template, state.phase, state.descriptor, state.aerobicVolumeFloor) : [])
        .filter(key => !EMBEDDED_ONLY_COVERAGE_KEYS.has(key));
    if (keys.length === 0) return 3;

    const anchorKey: PlanCoverageKey | null = anchorRole === 'event-specific'
        ? 'outdoor_event_specific'
        : anchorRole === 'quality' ? 'sustained_quality' : null;

    // A nominated anchor is date-level programming authority, not merely a repair for an
    // unmet weekly minimum. Once an admissible candidate matches today's authored role,
    // keep it tier 0 even when an earlier exposure already satisfied that role's minimum;
    // otherwise a different unmet role can steal the authored anchor date. Hard safety,
    // recovery, time and equipment gates run before this ordering participates in ranking.
    if (anchorKey && keys.includes(anchorKey)) {
        const requirement = state.requirements.find(item => item.key === anchorKey);
        if (requirement) return 0;
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
        // Issue #801: a support-tier minimum is deferred support, never as urgent as a
        // primary role -- today's pick has no allocator guard against it outranking one.
        if (DEFERRED_SUPPORT_COVERAGE_KEYS.has(key) || requirement.reservationTier === 'support') {
            advancesDeferredSupportMinimum = true;
            continue;
        }
        // The optimizer computes this from both category and systemic cost. Keeping the
        // boolean candidate-specific avoids demoting light full-body/primer work merely
        // because it shares a broad strength category with genuinely heavy lower-body work.
        if (deferAnchorAdjacentHeavyStrength) {
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
