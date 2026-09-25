import type { AdaptationDoseRequirement, AdaptationKey, EvidenceBackedStrategy } from './evergreenStrategy';
import type { ResolvedTrainingCapacity } from './trainingCapacity';
import { EVERGREEN_GENERAL_COVERAGE_SET, EVERGREEN_COVERAGE_BY_KEY } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { getDayDiff } from '../utils/localDate';
import { progressionOverrideKey } from './progressionOverrideKey';

export interface CoverageRoleDescriptor {
    /** Stable authored identity; never a category/modality similarity match. */
    id: string;
    adaptations: readonly AdaptationKey[];
    exactWorkoutIds: readonly string[];
    durationMinutes: number;
}

export interface CoverageSetDescriptor {
    id: string;
    roles: readonly CoverageRoleDescriptor[];
}

/**
 * Legacy 2-to-6-session product policy. It is deliberately a placement preference,
 * not a dose rule: D-DOSE and actual usable capacity remain authoritative. The value is
 * consulted only after two candidate roles deliver the same dose in otherwise valid
 * windows, to prefer a less-clustered week. Counts above six use the six-session row.
 */
export const LEGACY_SESSION_COUNT_TIE_BREAKER = {
    2: { preferredSpacingDays: 3 },
    3: { preferredSpacingDays: 2 },
    4: { preferredSpacingDays: 1 },
    5: { preferredSpacingDays: 1 },
    6: { preferredSpacingDays: 1 },
} as const;

function minimumDuration(workoutIds: readonly string[]): number {
    return Math.min(...workoutIds.map(id => WORKOUTS_BY_ID.get(id)?.duration.minimumMin ?? Number.POSITIVE_INFINITY));
}

/** Exact adapter from the evergreen programming descriptor to the dose packer's
 * adaptation roles. Walk-run is intentionally excluded from aerobic-volume credit. */

export const EVERGREEN_PACKING_COVERAGE: CoverageSetDescriptor = {
    id: EVERGREEN_GENERAL_COVERAGE_SET.id,
    roles: [
        { id: 'aerobic_volume', adaptations: ['aerobic_endurance'], exactWorkoutIds: EVERGREEN_COVERAGE_BY_KEY.get('aerobic_volume')!.workoutIds, durationMinutes: minimumDuration(EVERGREEN_COVERAGE_BY_KEY.get('aerobic_volume')!.workoutIds) },
        { id: 'primary_strength', adaptations: ['strength'], exactWorkoutIds: EVERGREEN_COVERAGE_BY_KEY.get('primary_strength')!.workoutIds, durationMinutes: minimumDuration(EVERGREEN_COVERAGE_BY_KEY.get('primary_strength')!.workoutIds) },
        { id: 'sustained_quality', adaptations: ['high_intensity'], exactWorkoutIds: EVERGREEN_COVERAGE_BY_KEY.get('sustained_quality')!.workoutIds, durationMinutes: minimumDuration(EVERGREEN_COVERAGE_BY_KEY.get('sustained_quality')!.workoutIds) },
    ],
};

export interface PackedRoleOccurrence {
    id: string;
    coverageSetId: string;
    coverageRoleId: string;
    date: string;
    exactWorkoutIds: readonly string[];
    adaptations: readonly AdaptationKey[];
    priority: AdaptationDoseRequirement['priority'];
}

export interface PackingWarning {
    code: 'below_guideline_range' | 'guideline_target_shortfall' | 'goal_requirement_shortfall' | 'minimum_dose_shortfall' | 'no_exact_eligible_role' | 'goal_constraint_conflict';
    adaptation: AdaptationKey;
    message: string;
}

export interface WeeklyBudget {
    capacity: ResolvedTrainingCapacity;
    requirements: readonly AdaptationDoseRequirement[];
    requiredRoles: PackedRoleOccurrence[];
    targetRoles: PackedRoleOccurrence[];
    optionalRoles: PackedRoleOccurrence[];
    shortfalls: PackingWarning[];
}

interface MutableOccurrence extends PackedRoleOccurrence {
    descriptor: CoverageRoleDescriptor;
}

interface EligibleCandidate {
    role: CoverageRoleDescriptor;
    permitted: string[];
    /** True when `role.durationMinutes` was narrowed by an active exact/direct override
     * for the slot's effective date, rather than the authored baseline descriptor. */
    isActiveOverride: boolean;
}

const NO_DURATION_OVERRIDES: ReadonlyMap<string, number> = new Map();

/** Product-policy substitution reserves one aerobic-volume occurrence for an eligible
 * quality occurrence. The credited minutes are therefore derived from the exact aerobic
 * role currently being packed (including an athlete-relative floor), not from a fixed
 * physiological-equivalence constant. If quality cannot be packed, the packer reruns
 * without any substitution. */
function doseFor(role: CoverageRoleDescriptor, requirement: AdaptationDoseRequirement): number {
    return requirement.target.unit === 'minutes' ? role.durationMinutes : 1;
}

function desiredDose(
    requirement: AdaptationDoseRequirement,
    reservedQualityAerobicCreditMinutes: number,
): number {
    const base = requirement.floor?.dose.value ?? requirement.target.target;
    if (requirement.adaptation === 'aerobic_endurance' && requirement.target.unit === 'minutes') {
        return Math.max(0, base - reservedQualityAerobicCreditMinutes);
    }
    return base;
}

function permittedWorkoutIds(role: CoverageRoleDescriptor, requirement: AdaptationDoseRequirement): string[] {
    const permitted = new Set(requirement.substitutionPolicy.permittedModalities.map(modality => modality.toLowerCase()));
    return role.exactWorkoutIds.filter(workoutId => {
        const modality = WORKOUTS_BY_ID.get(workoutId)?.modality;
        if (!modality) return false;
        const canonical = modality === 'cross_training' ? 'other' : modality;
        return permitted.has(canonical);
    });
}

/**
 * Resolve an authored progression at the same identity granularity it was confirmed at.
 * A role can span several sports, but an exact `role::workout` key authorizes only those
 * exact workouts. Once at least one exact key matches the requirement, non-authorized
 * substitutes are deliberately removed from this occurrence instead of inheriting the
 * progressed duration or silently defeating the progression by winning as a shorter
 * baseline alternative. Production derivation emits one value per claimed role; if an
 * injected caller supplies conflicting exact values we fail closed to baseline role
 * semantics rather than guessing which confirmed value owns the role.
 *
 * The plain role-id key remains an explicit unconditional legacy/test override.
 */
function eligibleCandidateForRole(
    role: CoverageRoleDescriptor,
    requirement: AdaptationDoseRequirement,
    overrides: ReadonlyMap<string, number>,
): EligibleCandidate | null {
    const permitted = permittedWorkoutIds(role, requirement);
    if (permitted.length === 0) return null;
    if (overrides.size === 0) return { role, permitted, isActiveOverride: false };

    const direct = overrides.get(role.id);
    if (direct !== undefined) return { role: { ...role, durationMinutes: direct }, permitted, isActiveOverride: true };

    const exact = permitted.flatMap(workoutId => {
        const duration = overrides.get(progressionOverrideKey(role.id, workoutId));
        return duration === undefined ? [] : [{ workoutId, duration }];
    });
    if (exact.length === 0) return { role, permitted, isActiveOverride: false };

    const values = new Set(exact.map(entry => entry.duration));
    if (values.size !== 1) return { role, permitted, isActiveOverride: false };

    return {
        role: { ...role, durationMinutes: exact[0].duration },
        permitted: exact.map(entry => entry.workoutId),
        isActiveOverride: true,
    };
}

function eligibleCandidates(
    roles: readonly CoverageRoleDescriptor[],
    requirement: AdaptationDoseRequirement,
    overrides: ReadonlyMap<string, number>,
): EligibleCandidate[] {
    return roles
        .filter(role => role.adaptations.includes(requirement.adaptation))
        .map(role => eligibleCandidateForRole(role, requirement, overrides))
        .filter((entry): entry is EligibleCandidate => entry !== null);
}

function overridesForSlot(
    overrides: ReadonlyMap<string, number>,
    effectiveDate: string | undefined,
    slotDate: string,
): ReadonlyMap<string, number> {
    return effectiveDate === undefined || effectiveDate === slotDate ? overrides : NO_DURATION_OVERRIDES;
}

function placementTieBreakerPenalty(
    date: string,
    packed: readonly MutableOccurrence[],
    targetSessions: number,
): number {
    if (packed.length === 0) return 0;
    const row = LEGACY_SESSION_COUNT_TIE_BREAKER[Math.min(6, Math.max(2, targetSessions)) as 2 | 3 | 4 | 5 | 6];
    const nearestSessionDays = Math.min(...packed.map(occurrence => Math.abs(getDayDiff(date, occurrence.date))));
    return Math.max(0, row.preferredSpacingDays - nearestSessionDays);
}

function warningFor(
    requirement: AdaptationDoseRequirement,
    delivered: number,
    packedQualityCreditMinutes: number,
): PackingWarning | null {
    const floor = requirement.floor;
    const qualityCredit = requirement.adaptation === 'aerobic_endurance'
        && requirement.target.unit === 'minutes'
        ? packedQualityCreditMinutes
        : 0;
    const creditedDelivered = delivered + qualityCredit;

    if (floor && creditedDelivered < floor.dose.value) {
        const code = floor.semantics === 'guideline_recommended_minimum'
            ? 'below_guideline_range'
            : floor.semantics === 'goal_required_minimum'
                ? 'goal_requirement_shortfall'
                : 'minimum_dose_shortfall';
        const creditNote = qualityCredit > 0 ? ` plus ${qualityCredit} minutes of packed-quality allocation credit` : '';
        return {
            code,
            adaptation: requirement.adaptation,
            message: `${requirement.adaptation} fits ${delivered} ${floor.dose.unit}${creditNote}; the stated floor remains ${floor.dose.value} ${floor.dose.unit}.`,
        };
    }
    if (creditedDelivered < requirement.target.target) {
        return {
            code: 'guideline_target_shortfall',
            adaptation: requirement.adaptation,
            message: `${requirement.adaptation} does not reach its ${requirement.target.target} ${requirement.target.unit} target after any packed-quality allocation credit.`,
        };
    }
    return null;
}

/** Converts evidence-derived dose into exact authored roles. Every selected occurrence is
 * attached to one real availability date and one authored descriptor. A role may satisfy
 * more than one adaptation only when that descriptor explicitly grants each adaptation;
 * no modality/category similarity is used for bundling.
 *
 * `durationOverridesByRoleId` (ADR-0037 D-DOSE) accepts either a plain role id
 * (legacy/test: unconditional role override) or production exact keys from
 * `progressionOverrideKey(roleId, workoutId)`. Exact keys narrow the occurrence to the
 * confirmed workout identities and never transfer duration credit onto a sibling sport.
 * `overrideEffectiveDate` scopes those overrides to one calendar date inside a multi-day
 * packing horizon; production callers must supply it when their map was derived for one
 * active date. Omitting it preserves the legacy injected whole-horizon behavior used by
 * deterministic unit tests. Requirement floors/targets are never changed. */
function packWeeklyDoseAttempt(
    strategy: EvidenceBackedStrategy,
    capacity: ResolvedTrainingCapacity,
    coverage: CoverageSetDescriptor,
    durationOverridesByRoleId: ReadonlyMap<string, number>,
    overrideEffectiveDate: string | undefined,
    reservePackedQualitySlot: boolean,
): WeeklyBudget {
    const slots = capacity.usableWindows.map(window => ({ ...window, used: false }));
    const packed: MutableOccurrence[] = [];
    const shortfalls: PackingWarning[] = [];
    const structuralShortfallAdaptations = new Set<AdaptationKey>();
    const sessionLimit = (priority: AdaptationDoseRequirement['priority']) =>
        priority === 'required' ? capacity.minSessions : priority === 'target' ? capacity.targetSessions : capacity.maxSessions;

    const requirements = [...strategy.requirements].sort((left, right) => {
        const rank = { required: 0, target: 1, optional: 2 } as const;
        return rank[left.priority] - rank[right.priority];
    });
    const aerobicRequirementForCredit = requirements.find(requirement =>
        requirement.adaptation === 'aerobic_endurance' && requirement.target.unit === 'minutes');
    const aerobicCandidateDoses = reservePackedQualitySlot && aerobicRequirementForCredit
        ? eligibleCandidates(coverage.roles, aerobicRequirementForCredit, NO_DURATION_OVERRIDES)
            .map(candidate => doseFor(candidate.role, aerobicRequirementForCredit))
            .filter(dose => Number.isFinite(dose) && dose > 0)
        : [];
    const reservedQualityAerobicCreditMinutes = aerobicCandidateDoses.length > 0
        ? Math.min(...aerobicCandidateDoses)
        : 0;

    /** Estimate how many of the *remaining feasible windows* a requirement can still use.
     * This feeds only fair-share reservation; it must not reserve capacity for a later peer
     * whose role cannot fit any remaining window. Candidates are resolved per slot because
     * a confirmed progression may be active on exactly one date inside the weekly horizon. */
    const sessionsNeededFor = (requirement: AdaptationDoseRequirement): number => {
        const hasBaselineCandidate = eligibleCandidates(coverage.roles, requirement, NO_DURATION_OVERRIDES).length > 0;
        if (!hasBaselineCandidate) return 0;
        const delivered = packed
            .filter(occurrence => occurrence.adaptations.includes(requirement.adaptation))
            .reduce((total, occurrence) => total + doseFor(occurrence.descriptor, requirement), 0);
        const remainingDose = Math.max(0, desiredDose(requirement, reservedQualityAerobicCreditMinutes) - delivered);
        if (remainingDose <= 0) return 0;

        const feasibleDoseBySlot = slots
            .filter(slot => !slot.used)
            .map(slot => {
                const candidates = eligibleCandidates(
                    coverage.roles,
                    requirement,
                    overridesForSlot(durationOverridesByRoleId, overrideEffectiveDate, slot.date),
                ).map(entry => entry.role);
                return candidates
                    .filter(role => slot.availableMinutes >= role.durationMinutes)
                    .reduce((bestDose, role) => Math.max(bestDose, doseFor(role, requirement)), 0);
            })
            .filter(dose => dose > 0)
            .sort((left, right) => right - left);

        let accumulatedDose = 0;
        let sessions = 0;
        for (const dose of feasibleDoseBySlot) {
            accumulatedDose += dose;
            sessions += 1;
            if (accumulatedDose >= remainingDose) break;
        }
        return sessions;
    };

    for (const requirement of requirements) {
        const adaptationCandidates = coverage.roles.filter(role => role.adaptations.includes(requirement.adaptation));
        const baselineEligible = eligibleCandidates(coverage.roles, requirement, NO_DURATION_OVERRIDES);
        if (baselineEligible.length === 0) {
            const code = adaptationCandidates.length > 0 ? 'goal_constraint_conflict' : 'no_exact_eligible_role';
            shortfalls.push({ code, adaptation: requirement.adaptation, message: code === 'goal_constraint_conflict'
                ? `The available exact roles cannot satisfy ${requirement.adaptation} within its permitted modalities.`
                : `No exact authored role can satisfy ${requirement.adaptation}.` });
            structuralShortfallAdaptations.add(requirement.adaptation);
            continue;
        }
        let delivered = packed
            .filter(occurrence => occurrence.adaptations.includes(requirement.adaptation))
            .reduce((total, occurrence) => total + doseFor(occurrence.descriptor, requirement), 0);
        const requiredDose = desiredDose(requirement, reservedQualityAerobicCreditMinutes);
        // A priority tier's ceiling is shared. Allocate scarce room in proportion to the
        // remaining *feasible* session demand, while reserving one occurrence for every
        // later peer that can still use a window. Unlike a fixed even split, this also lets
        // a heavy requirement reclaim slots a light or currently infeasible peer does not
        // need, so capacity is not stranded while the current tier has a satisfiable gap.
        const requirementIndex = requirements.indexOf(requirement);
        const tierPeersRemaining = requirements
            .slice(requirementIndex)
            .filter(item => item.priority === requirement.priority);
        const demandByPeer = tierPeersRemaining.map(peer => sessionsNeededFor(peer));
        const currentDemand = demandByPeer[0] ?? 0;
        const totalDemand = demandByPeer.reduce((total, demand) => total + demand, 0);
        const laterPeersNeedingCoverage = demandByPeer.slice(1).filter(demand => demand > 0).length;
        const roomRemainingInTier = Math.max(0, sessionLimit(requirement.priority) - packed.length);
        const proportionalShare = totalDemand > 0
            ? Math.ceil(roomRemainingInTier * currentDemand / totalDemand)
            : 0;
        const reserveForLaterPeers = Math.min(laterPeersNeedingCoverage, Math.max(0, roomRemainingInTier - 1));
        const maxWithoutStarvingLaterPeers = Math.max(0, roomRemainingInTier - reserveForLaterPeers);
        const requirementSessionBudget = Math.min(currentDemand, proportionalShare, maxWithoutStarvingLaterPeers);
        const allowedSessions = packed.length + requirementSessionBudget;

        while (delivered < requiredDose && packed.length < allowedSessions) {
            const unusedSlots = slots.filter(slot => !slot.used);
            const penaltyByDate = new Map<string, number>();
            for (const slot of unusedSlots) {
                if (!penaltyByDate.has(slot.date)) {
                    penaltyByDate.set(slot.date, placementTieBreakerPenalty(slot.date, packed, capacity.targetSessions));
                }
            }

            const assignment = unusedSlots
                .flatMap(slot => eligibleCandidates(
                    coverage.roles,
                    requirement,
                    overridesForSlot(durationOverridesByRoleId, overrideEffectiveDate, slot.date),
                ).filter(candidate => slot.availableMinutes >= candidate.role.durationMinutes)
                    .map(candidate => ({ ...candidate, slot })))
                .sort((left, right) =>
                    // An active exact effective-date override represents a confirmed
                    // progression bound to this occurrence; it must win placement even when
                    // a shorter-window baseline candidate would otherwise best-fit first,
                    // or the override's date-scoped session is silently dropped in favor of
                    // an interchangeable baseline one, reporting a false shortfall.
                    (right.isActiveOverride ? 1 : 0) - (left.isActiveOverride ? 1 : 0)
                    // Best-fit placement is the primary constraint: consume the shortest
                    // window that can host the current requirement before preferring a
                    // larger-dose role. This preserves scarce long windows for later roles
                    // that have no short-window alternative.
                    || left.slot.availableMinutes - right.slot.availableMinutes
                    || right.role.durationMinutes - left.role.durationMinutes
                    || (penaltyByDate.get(left.slot.date) ?? 0)
                        - (penaltyByDate.get(right.slot.date) ?? 0)
                    || left.role.id.localeCompare(right.role.id)
                    || left.slot.date.localeCompare(right.slot.date),
                )[0];
            if (!assignment) break;
            assignment.slot.used = true;
            const occurrence: MutableOccurrence = {
                id: `${coverage.id}:${assignment.role.id}:${packed.length}`,
                coverageSetId: coverage.id,
                coverageRoleId: assignment.role.id,
                date: assignment.slot.date,
                exactWorkoutIds: assignment.permitted,
                adaptations: assignment.role.adaptations,
                priority: requirement.priority,
                descriptor: assignment.role,
            };
            packed.push(occurrence);
            delivered += doseFor(assignment.role, requirement);
        }
    }

    const packedQuality = packed.some(occurrence => occurrence.adaptations.includes('high_intensity'));
    const packedQualityAerobicCreditMinutes = packedQuality ? reservedQualityAerobicCreditMinutes : 0;
    for (const requirement of requirements) {
        if (structuralShortfallAdaptations.has(requirement.adaptation)) continue;
        const delivered = packed
            .filter(occurrence => occurrence.adaptations.includes(requirement.adaptation))
            .reduce((total, occurrence) => total + doseFor(occurrence.descriptor, requirement), 0);
        const warning = warningFor(requirement, delivered, packedQualityAerobicCreditMinutes);
        if (warning) shortfalls.push(warning);
    }

    const withoutDescriptor = (occurrence: MutableOccurrence): PackedRoleOccurrence => ({
        id: occurrence.id,
        coverageSetId: occurrence.coverageSetId,
        coverageRoleId: occurrence.coverageRoleId,
        date: occurrence.date,
        exactWorkoutIds: occurrence.exactWorkoutIds,
        adaptations: occurrence.adaptations,
        priority: occurrence.priority,
    });

    const requiredRoles: PackedRoleOccurrence[] = [];
    const targetRoles: PackedRoleOccurrence[] = [];
    const optionalRoles: PackedRoleOccurrence[] = [];
    for (const role of packed) {
        const occurrence = withoutDescriptor(role);
        if (role.priority === 'required') {
            requiredRoles.push(occurrence);
        } else if (role.priority === 'target') {
            targetRoles.push(occurrence);
        } else if (role.priority === 'optional') {
            optionalRoles.push(occurrence);
        }
    }

    return {
        capacity, requirements,
        requiredRoles,
        targetRoles,
        optionalRoles,
        shortfalls,
    };
}

/** Convert strategy requirements into exact weekly roles. The first pass may provisionally
 * substitute one exact aerobic-volume occurrence with the optional quality role. The
 * substitution's minute credit equals that aerobic role's current packed dose, which makes
 * athlete-relative floors participate in the same slot arithmetic. The credit becomes
 * effective only when high intensity is actually packed; otherwise the whole pack is
 * recomputed against the unmodified aerobic requirement. */
export function packWeeklyDose(
    strategy: EvidenceBackedStrategy,
    capacity: ResolvedTrainingCapacity,
    coverage: CoverageSetDescriptor,
    durationOverridesByRoleId: ReadonlyMap<string, number> = new Map(),
    overrideEffectiveDate?: string,
): WeeklyBudget {
    const qualityPriorActive = strategy.requirements.some(requirement =>
        requirement.adaptation === 'high_intensity'
        && (requirement.target.target > 0 || requirement.target.maximum > 0),
    );
    const provisional = packWeeklyDoseAttempt(
        strategy,
        capacity,
        coverage,
        durationOverridesByRoleId,
        overrideEffectiveDate,
        qualityPriorActive,
    );
    const qualityPacked = [...provisional.requiredRoles, ...provisional.targetRoles, ...provisional.optionalRoles]
        .some(role => role.adaptations.includes('high_intensity'));
    if (!qualityPriorActive || qualityPacked) return provisional;

    return packWeeklyDoseAttempt(
        strategy,
        capacity,
        coverage,
        durationOverridesByRoleId,
        overrideEffectiveDate,
        false,
    );
}
