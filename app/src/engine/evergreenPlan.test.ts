import { describe, expect, it } from 'vitest';
import { buildEvergreenPlanDefinition } from './planSchedule';
import type { EvidenceBackedStrategy } from './evergreenStrategy';
import type { ResolvedTrainingCapacity } from './trainingCapacity';
import type { WeeklyBudget } from './weeklyDosePacking';
import { buildCoverageState } from './coverage';

const strategy: EvidenceBackedStrategy = {
    requirements: [{ adaptation: 'aerobic_endurance', priority: 'required', floor: { dose: { unit: 'minutes', value: 150 }, semantics: 'guideline_recommended_minimum' }, target: { unit: 'minutes', minimum: 150, target: 150, maximum: 300 }, substitutionPolicy: { equivalentModalitiesAllowed: true, permittedModalities: ['Cycling'] }, evidence: { sourceId: 'test', population: 'test', outcome: 'test', confidence: 'high', applicability: [], authority: 'guideline_target', policyVersion: 'test', reviewedOn: '2026-08-10' } }], warnings: [],
};
const capacity: ResolvedTrainingCapacity = { minSessions: 2, targetSessions: 3, maxSessions: 4, weekdayMinutes: 60, weekendMinutes: 60, usableWindows: [], estimatedTargetWeeklyMinutes: 120, warnings: [] };
const budget: WeeklyBudget = {
    capacity, requirements: strategy.requirements,
    requiredRoles: [
        { id: 'evergreen_general:aerobic_volume:0', coverageSetId: 'evergreen_general', coverageRoleId: 'aerobic_volume', date: '2026-08-10', exactWorkoutIds: ['cycling_zone2_standard_01'], adaptations: ['aerobic_endurance'], priority: 'required' },
        { id: 'evergreen_general:aerobic_volume:1', coverageSetId: 'evergreen_general', coverageRoleId: 'aerobic_volume', date: '2026-08-11', exactWorkoutIds: ['cycling_zone2_standard_01'], adaptations: ['aerobic_endurance'], priority: 'required' },
    ], targetRoles: [], optionalRoles: [], shortfalls: [],
};

describe('evergreen plan definition', () => {
    it('turns packed roles into a non-event general coverage state', () => {
        const result = buildEvergreenPlanDefinition(strategy, capacity, budget, '2026-08-10');
        expect(result.status).toBe('AVAILABLE');
        if (result.status !== 'AVAILABLE') return;
        expect(result.data.coverageSetId).toBe('evergreen_general');
        expect(result.data.blocks[0].phase).toBe('general');
        const state = buildCoverageState(result.data, '2026-08-12');
        expect(state).toMatchObject({ phase: 'general', coverageSetId: 'evergreen_general' });
        expect(state.requirements.map(requirement => requirement.key)).toContain('aerobic_volume');
    });
});
