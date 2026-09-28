import { describe, expect, it } from 'vitest';
import { buildEvergreenPlanDefinition } from './planSchedule';
import type { EvidenceBackedStrategy } from './evergreenStrategy';
import type { ResolvedTrainingCapacity } from './trainingCapacity';
import type { WeeklyBudget } from './weeklyDosePacking';
import { buildCoverageState, coverageNeedTierForTemplate } from './coverage';
import { ENRICHED_TEMPLATES, ENRICHED_TEMPLATES_BY_ID } from './templates';
import { attachExactEligibleIdentities, deriveRequiredRoleOccurrences } from './weeklyAllocation';

const strategy: EvidenceBackedStrategy = {
    requirements: [{
        adaptation: 'aerobic_endurance',
        priority: 'required',
        floor: { dose: { unit: 'minutes', value: 150 }, semantics: 'guideline_recommended_minimum' },
        target: { unit: 'minutes', minimum: 150, target: 150, maximum: 300 },
        substitutionPolicy: { equivalentModalitiesAllowed: true, permittedModalities: ['Cycling'] },
        knowledgeRefs: ['test.claim'],
        evidence: {
            knowledgeClaimId: 'test.claim',
            knowledgeClaimVersion: 1,
            sourceId: 'test',
            sourceIds: ['test'],
            population: 'test',
            outcome: 'test',
            confidence: 'high',
            evidenceCertainty: 'moderate',
            maturity: 'established',
            status: 'active',
            applicability: [],
            authority: 'guideline_target',
            policyVersion: 'test',
            reviewedOn: '2026-08-10',
        },
    }],
    warnings: [],
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
        const zone2 = ENRICHED_TEMPLATES_BY_ID.get('end_easy_01');
        if (!zone2) throw new Error('Zone 2 template fixture missing');
        expect(coverageNeedTierForTemplate(state, zone2)).not.toBe(3);
    });

    it('keeps a stage-gated mechanical target visible as subordinate support even without an embedded host', () => {
        const mechanicalRequirement = {
            ...strategy.requirements[0],
            adaptation: 'mechanical_exposure' as const,
            priority: 'target' as const,
            floor: null,
            target: { unit: 'sessions' as const, minimum: 0, target: 1, maximum: 2 },
            substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Running', 'Field', 'Strength'] },
        };
        const mechanicalStrategy: EvidenceBackedStrategy = { requirements: [mechanicalRequirement], warnings: [] };
        const mechanicalBudget: WeeklyBudget = {
            ...budget,
            requirements: [mechanicalRequirement],
            requiredRoles: [],
            targetRoles: [],
            optionalRoles: [],
        };

        const result = buildEvergreenPlanDefinition(
            mechanicalStrategy,
            capacity,
            mechanicalBudget,
            '2026-08-10',
            ['running_walk_run_01'],
        );
        expect(result.status).toBe('AVAILABLE');
        if (result.status !== 'AVAILABLE') return;

        expect(result.data.coverageRequirements).toEqual([
            expect.objectContaining({
                coverageKey: 'mechanical_exposure',
                minimumSessions: 1,
                targetSessions: 1,
                priority: 'should_have',
                reservationTier: 'support',
                eligibleWorkoutIds: ['running_walk_run_01'],
            }),
        ]);
        const state = buildCoverageState(result.data, '2026-08-10');
        const mechanicalState = state.requirements.find(item => item.key === 'mechanical_exposure');
        expect(mechanicalState).toMatchObject({
            minimumSessions: 1,
            targetSessions: 1,
            reservationTier: 'support',
            eligibleWorkoutIds: ['running_walk_run_01'],
        });

        const [occurrence] = attachExactEligibleIdentities(
            deriveRequiredRoleOccurrences(state).filter(item => item.coverageKey === 'mechanical_exposure'),
            ENRICHED_TEMPLATES,
        );
        expect(occurrence).toBeDefined();
        expect(occurrence.reservationTier).toBe('support');
        expect(occurrence.eligibleWorkoutIds).toEqual(['running_walk_run_01']);
    });

    it('keeps a blocked mechanical target visible with zero eligible candidates instead of widening stages', () => {
        const mechanicalRequirement = {
            ...strategy.requirements[0],
            adaptation: 'mechanical_exposure' as const,
            priority: 'target' as const,
            floor: null,
            target: { unit: 'sessions' as const, minimum: 0, target: 1, maximum: 2 },
            substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Running', 'Field', 'Strength'] },
        };
        const mechanicalStrategy: EvidenceBackedStrategy = { requirements: [mechanicalRequirement], warnings: [] };
        const mechanicalBudget: WeeklyBudget = {
            ...budget, requirements: [mechanicalRequirement],
            requiredRoles: [], targetRoles: [], optionalRoles: [],
        };
        const result = buildEvergreenPlanDefinition(mechanicalStrategy, capacity, mechanicalBudget, '2026-08-10', []);
        expect(result.status).toBe('AVAILABLE');
        if (result.status !== 'AVAILABLE') return;

        const state = buildCoverageState(result.data, '2026-08-10');
        const occurrences = deriveRequiredRoleOccurrences(state).filter(item => item.coverageKey === 'mechanical_exposure');
        expect(occurrences).toHaveLength(1);
        const [blocked] = attachExactEligibleIdentities(occurrences, ENRICHED_TEMPLATES);
        expect(blocked.candidateWorkoutAllowList).toEqual([]);
        expect(blocked.eligibleTemplateIds).toEqual([]);
        expect(blocked.eligibleWorkoutIds).toEqual([]);
    });

    it('uses strength_development only for a packed evergreen strength requirement', () => {
        const strengthRequirement = {
            ...strategy.requirements[0], adaptation: 'strength' as const, target: { unit: 'sessions' as const, minimum: 2, target: 2, maximum: 3 },
        };
        const strengthBudget: WeeklyBudget = {
            ...budget, requirements: [strengthRequirement],
            requiredRoles: [{ id: 'evergreen_general:primary_strength:0', coverageSetId: 'evergreen_general', coverageRoleId: 'primary_strength', date: '2026-08-10', exactWorkoutIds: ['strength_full_body_maintenance_01'], adaptations: ['strength'], priority: 'required' }],
        };
        const result = buildEvergreenPlanDefinition({ ...strategy, requirements: [strengthRequirement] }, capacity, strengthBudget, '2026-08-10');
        expect(result.status).toBe('AVAILABLE');
        if (result.status === 'AVAILABLE') expect(result.data.objectives.map(objective => objective.key)).toEqual(['strength_development']);
    });
});
