import type { AdaptationDoseRequirement, AdaptationKey, EvidenceBackedStrategy } from './evergreenStrategy';
import type { ResolvedTrainingCapacity } from './trainingCapacity';

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
    code: 'below_guideline_range' | 'guideline_target_shortfall' | 'goal_requirement_shortfall' | 'minimum_dose_shortfall' | 'no_exact_eligible_role';
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
        const candidates = coverage.roles.filter(role => role.adaptations.includes(requirement.adaptation));
        if (candidates.length === 0) {
            shortfalls.push({ code: 'no_exact_eligible_role', adaptation: requirement.adaptation, message: `No exact authored role can satisfy ${requirement.adaptation}.` });
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
                .sort((left, right) => right.role.durationMinutes - left.role.durationMinutes || left.role.id.localeCompare(right.role.id))[0];
            if (!assignment) break;
            assignment.slot.used = true;
            const occurrence: MutableOccurrence = {
                id: `${coverage.id}:${assignment.role.id}:${packed.length}`,
                coverageSetId: coverage.id,
                coverageRoleId: assignment.role.id,
                date: assignment.slot.date,
                exactWorkoutIds: assignment.role.exactWorkoutIds,
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
