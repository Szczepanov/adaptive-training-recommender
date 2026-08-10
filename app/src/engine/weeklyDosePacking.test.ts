import { describe, expect, it } from 'vitest';
import type { EvidenceBackedStrategy } from './evergreenStrategy';
import { packWeeklyDose, type CoverageSetDescriptor } from './weeklyDosePacking';
import type { ResolvedTrainingCapacity } from './trainingCapacity';

const healthStrategy: EvidenceBackedStrategy = {
    requirements: [{
        adaptation: 'aerobic_endurance', priority: 'required',
        floor: { dose: { unit: 'minutes', value: 150 }, semantics: 'guideline_recommended_minimum' },
        target: { unit: 'minutes', minimum: 150, target: 150, maximum: 300 },
        substitutionPolicy: { equivalentModalitiesAllowed: true, permittedModalities: ['Cycling'] },
        evidence: { sourceId: 'test', population: 'test', outcome: 'test', confidence: 'high', applicability: [], authority: 'guideline_target', policyVersion: 'test', reviewedOn: '2026-08-10' },
    }], warnings: [],
};
const coverage: CoverageSetDescriptor = {
    id: 'evergreen-test',
    roles: [{ id: 'aerobic-ride', adaptations: ['aerobic_endurance'], exactWorkoutIds: ['cycling_zone2_standard_01'], durationMinutes: 60 }],
};
const capacity = (minutes: number, sessions: number): ResolvedTrainingCapacity => ({
    minSessions: sessions, targetSessions: sessions, maxSessions: sessions,
    weekdayMinutes: minutes, weekendMinutes: minutes,
    usableWindows: Array.from({ length: sessions }, (_, index) => ({ date: `2026-08-${String(10 + index).padStart(2, '0')}`, availableMinutes: minutes })),
    estimatedTargetWeeklyMinutes: minutes * sessions, warnings: [],
});

describe('weekly dose packing', () => {
    it('prescribes the best safe partial guideline dose rather than calling it a minimum-dose failure', () => {
        const budget = packWeeklyDose(healthStrategy, capacity(60, 2), coverage);
        expect(budget.requiredRoles).toHaveLength(2);
        expect(budget.requiredRoles.every(role => role.exactWorkoutIds[0] === 'cycling_zone2_standard_01')).toBe(true);
        expect(budget.shortfalls.map(warning => warning.code)).toEqual(['below_guideline_range']);
    });

    it('uses duration windows, not only session cardinality, when deciding feasibility', () => {
        const tooShort = packWeeklyDose(healthStrategy, capacity(45, 3), coverage);
        const enoughTime = packWeeklyDose(healthStrategy, capacity(60, 3), coverage);
        expect(tooShort.requiredRoles).toHaveLength(0);
        expect(enoughTime.requiredRoles).toHaveLength(3);
    });

    it('does not fabricate cross-modality credit when the exact role conflicts with the requirement', () => {
        const runningOnly = {
            ...healthStrategy,
            requirements: [{ ...healthStrategy.requirements[0], substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Running'] } }],
        };
        const budget = packWeeklyDose(runningOnly, capacity(60, 2), coverage);
        expect(budget.requiredRoles).toEqual([]);
        expect(budget.shortfalls).toEqual([expect.objectContaining({ code: 'goal_constraint_conflict', adaptation: 'aerobic_endurance' })]);
    });
});
