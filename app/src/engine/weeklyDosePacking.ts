import type { AdaptationDoseRequirement, AdaptationKey, EvidenceBackedStrategy } from './evergreenStrategy';
import type { ResolvedTrainingCapacity } from './trainingCapacity';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { WORKOUTS } from '../workouts/catalog';
import { getDayDiff } from '../utils/localDate';

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

// ⚡ Bolt Performance Optimization:
// Created a Map for O(1) workout lookups instead of O(n) array scans.
// Expected Impact: Significantly speeds up minimum duration calculation and permitted workout filtering during weekly dose packing.
const WORKOUTS_BY_ID = new Map(WORKOUTS.map(w => [w.id, w]));

function minimumDuration(workoutIds: readonly string[]): number {
    return Math.min(...workoutIds.map(id => WORKOUTS_BY_ID.get(id)?.duration.minimumMin ?? Number.POSITIVE_INFINITY));
}

/** Exact adapter from the evergreen programming descriptor to the dose packer's
 * adaptation roles. Walk-run is intentionally excluded from aerobic-volume credit. */
export const EVERGREEN_PACKING_COVERAGE: CoverageSetDescriptor = {
    id: EVERGREEN_GENERAL_COVERAGE_SET.id,
    roles: [
        { id: 'aerobic_volume', adaptations: ['aerobic_endurance'], exactWorkoutIds: EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'aerobic_volume')!.workoutIds, durationMinutes: minimumDuration(EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'aerobic_volume')!.workoutIds) },
        { id: 'primary_strength', adaptations: ['strength'], exactWorkoutIds: EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'primary_strength')!.workoutIds, durationMinutes: minimumDuration(EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'primary_strength')!.workoutIds) },
        { id: 'sustained_quality', adaptations: ['high_intensity'], exactWorkoutIds: EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'sustained_quality')!.workoutIds, durationMinutes: minimumDuration(EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'sustained_quality')!.workoutIds) },
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

function doseFor(role: CoverageRoleDescriptor, requirement: AdaptationDoseRequirement): number {
    return requirement.target.unit === 'minutes' ? role.durationMinutes : 1;
}

function desiredDose(requirement: AdaptationDoseRequirement): number {
    return requirement.floor?.dose.value ?? requirement.target.target;
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

function warningFor(requirement: AdaptationDoseRequirement, delivered: number): PackingWarning | null {
    const floor = requirement.floor;
    if (floor && delivered < floor.dose.value) {
        const code = floor.semantics === 'guideline_recommended_minimum'
            ? 'below_guideline_range'
            : floor.semantics === 'goal_required_minimum'
                ? 'goal_requirement_shortfall'
                : 'minimum_dose_shortfall';
        return { code, adaptation: requirement.adaptation, message: `${requirement.adaptation} fits ${delivered} ${floor.dose.unit}; the stated floor is ${floor.dose.value} ${floor.dose.unit}.` };
    }
    if (delivered < requirement.target.target) {
        return { code: 'guideline_target_shortfall', adaptation: requirement.adaptation, message: `${requirement.adaptation} does not reach its ${requirement.target.target} ${requirement.target.unit} target.` };
    }
    return null;
}

/** Converts evidence-derived dose into exact authored roles. Every selected occurrence is
 * attached to one real availability date and one authored descriptor. A role may satisfy
 * more than one adaptation only when that descriptor explicitly grants each adaptation;
 * no modality/category similarity is used for bundling. */
export function packWeeklyDose(
    strategy: EvidenceBackedStrategy,
    capacity: ResolvedTrainingCapacity,
    coverage: CoverageSetDescriptor,
): WeeklyBudget {
    const slots = capacity.usableWindows.map(window => ({ ...window, used: false }));
    const packed: MutableOccurrence[] = [];
    const shortfalls: PackingWarning[] = [];
    const sessionLimit = (priority: AdaptationDoseRequirement['priority']) =>
        priority === 'required' ? capacity.minSessions : priority === 'target' ? capacity.targetSessions : capacity.maxSessions;

    const requirements = [...strategy.requirements].sort((left, right) => {
        const rank = { required: 0, target: 1, optional: 2 } as const;
        return rank[left.priority] - rank[right.priority];
    });

    for (const requirement of requirements) {
        const adaptationCandidates = coverage.roles.filter(role => role.adaptations.includes(requirement.adaptation));
        const candidates = adaptationCandidates.filter(role => permittedWorkoutIds(role, requirement).length > 0);
        if (candidates.length === 0) {
            const code = adaptationCandidates.length > 0 ? 'goal_constraint_conflict' : 'no_exact_eligible_role';
            shortfalls.push({ code, adaptation: requirement.adaptation, message: code === 'goal_constraint_conflict'
                ? `The available exact roles cannot satisfy ${requirement.adaptation} within its permitted modalities.`
                : `No exact authored role can satisfy ${requirement.adaptation}.` });
            continue;
        }
        let delivered = packed
            .filter(occurrence => occurrence.adaptations.includes(requirement.adaptation))
            .reduce((total, occurrence) => total + doseFor(occurrence.descriptor, requirement), 0);
        const requiredDose = desiredDose(requirement);
        const allowedSessions = sessionLimit(requirement.priority);

        while (delivered < requiredDose && packed.length < allowedSessions) {
            const assignment = candidates
                .flatMap(role => slots.filter(slot => !slot.used && slot.availableMinutes >= role.durationMinutes)
                    .map(slot => ({ role, slot })))
                .sort((left, right) =>
                    right.role.durationMinutes - left.role.durationMinutes
                    || placementTieBreakerPenalty(left.slot.date, packed, capacity.targetSessions)
                        - placementTieBreakerPenalty(right.slot.date, packed, capacity.targetSessions)
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
                exactWorkoutIds: permittedWorkoutIds(assignment.role, requirement),
                adaptations: assignment.role.adaptations,
                priority: requirement.priority,
                descriptor: assignment.role,
            };
            packed.push(occurrence);
            delivered += doseFor(assignment.role, requirement);
        }
        const warning = warningFor(requirement, delivered);
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
    return {
        capacity, requirements,
        requiredRoles: packed.filter(role => role.priority === 'required').map(withoutDescriptor),
        targetRoles: packed.filter(role => role.priority === 'target').map(withoutDescriptor),
        optionalRoles: packed.filter(role => role.priority === 'optional').map(withoutDescriptor),
        shortfalls,
    };
}
