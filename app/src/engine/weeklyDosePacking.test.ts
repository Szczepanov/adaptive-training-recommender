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
        expect(tooShort.shortfalls.map(warning => warning.code)).toEqual(['below_guideline_range']);
        expect(enoughTime.requiredRoles).toHaveLength(3);
        expect(enoughTime.shortfalls).toEqual([]);
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

    it('keeps only permitted exact workout identities when a role has valid substitutions', () => {
        const runningOnly = {
            ...healthStrategy,
            requirements: [{ ...healthStrategy.requirements[0], substitutionPolicy: { equivalentModalitiesAllowed: true, permittedModalities: ['Running'] } }],
        };
        const mixedCoverage: CoverageSetDescriptor = {
            id: 'mixed-modalities',
            roles: [{ id: 'aerobic', adaptations: ['aerobic_endurance'], exactWorkoutIds: ['cycling_zone2_standard_01', 'running_easy_continuous_01'], durationMinutes: 60 }],
        };
        const budget = packWeeklyDose(runningOnly, capacity(60, 2), mixedCoverage);
        expect(budget.requiredRoles.map(role => role.exactWorkoutIds)).toEqual([
            ['running_easy_continuous_01'],
            ['running_easy_continuous_01'],
        ]);
    });

    it('keeps required, target, and optional roles inside their respective session ceilings', () => {
        const strategy: EvidenceBackedStrategy = {
            requirements: [
                { ...healthStrategy.requirements[0], target: { unit: 'minutes', minimum: 120, target: 120, maximum: 120 } },
                { ...healthStrategy.requirements[0], adaptation: 'strength', priority: 'target', floor: null, target: { unit: 'sessions', minimum: 1, target: 1, maximum: 1 }, substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] } },
                { ...healthStrategy.requirements[0], adaptation: 'high_intensity', priority: 'optional', floor: null, target: { unit: 'sessions', minimum: 0, target: 1, maximum: 1 }, substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Cycling'] } },
            ], warnings: [],
        };
        const roles: CoverageSetDescriptor = {
            id: 'cardinality-test',
            roles: [
                { id: 'aerobic', adaptations: ['aerobic_endurance'], exactWorkoutIds: ['cycling_zone2_standard_01'], durationMinutes: 60 },
                { id: 'strength', adaptations: ['strength'], exactWorkoutIds: ['strength_full_body_maintenance_01'], durationMinutes: 45 },
                { id: 'quality', adaptations: ['high_intensity'], exactWorkoutIds: ['cycling_controlled_threshold_4x8_01'], durationMinutes: 45 },
            ],
        };
        const fourSessionCapacity = { ...capacity(60, 4), minSessions: 2, targetSessions: 3, maxSessions: 4 };
        const budget = packWeeklyDose(strategy, fourSessionCapacity, roles);
        expect(budget.requiredRoles).toHaveLength(2);
        expect(budget.targetRoles).toHaveLength(1);
        expect(budget.optionalRoles).toHaveLength(1);
        expect(new Set([...budget.requiredRoles, ...budget.targetRoles, ...budget.optionalRoles].map(role => role.date)).size).toBe(4);
    });

    it('splits a shared required-tier ceiling fairly across peers instead of letting the first one exhaust it', () => {
        // Regression for the former-elite-return persona: 'endurance' and 'strength_muscle'
        // both resolve to 'required' priority (see evergreenStrategy.ts), and previously the
        // first requirement processed (aerobic) claimed the whole minSessions ceiling,
        // leaving strength — a second 'required' requirement — with zero packed sessions.
        const strategy: EvidenceBackedStrategy = {
            requirements: [
                { ...healthStrategy.requirements[0], target: { unit: 'minutes', minimum: 150, target: 150, maximum: 300 } },
                { ...healthStrategy.requirements[0], adaptation: 'strength', priority: 'required', floor: { dose: { unit: 'sessions', value: 2 }, semantics: 'guideline_recommended_minimum' }, target: { unit: 'sessions', minimum: 2, target: 2, maximum: 3 }, substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] } },
            ], warnings: [],
        };
        const roles: CoverageSetDescriptor = {
            id: 'fair-share-test',
            roles: [
                { id: 'aerobic', adaptations: ['aerobic_endurance'], exactWorkoutIds: ['cycling_zone2_standard_01'], durationMinutes: 30 },
                { id: 'strength', adaptations: ['strength'], exactWorkoutIds: ['strength_full_body_maintenance_01'], durationMinutes: 45 },
            ],
        };
        const tightCapacity = { ...capacity(60, 3), minSessions: 3, targetSessions: 3, maxSessions: 3 };
        const budget = packWeeklyDose(strategy, tightCapacity, roles);
        const adaptationsPacked = new Set(budget.requiredRoles.flatMap(role => role.adaptations));
        expect(adaptationsPacked.has('aerobic_endurance')).toBe(true);
        expect(adaptationsPacked.has('strength')).toBe(true);
        expect(budget.requiredRoles).toHaveLength(3);
    });

    it('reclaims unused fair-share capacity when a later required peer needs fewer sessions', () => {
        const strategy: EvidenceBackedStrategy = {
            requirements: [
                {
                    ...healthStrategy.requirements[0],
                    floor: { dose: { unit: 'minutes', value: 240 }, semantics: 'goal_required_minimum' },
                    target: { unit: 'minutes', minimum: 240, target: 240, maximum: 240 },
                },
                {
                    ...healthStrategy.requirements[0],
                    adaptation: 'strength',
                    priority: 'required',
                    floor: { dose: { unit: 'sessions', value: 1 }, semantics: 'goal_required_minimum' },
                    target: { unit: 'sessions', minimum: 1, target: 1, maximum: 1 },
                    substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] },
                },
            ], warnings: [],
        };
        const roles: CoverageSetDescriptor = {
            id: 'uneven-demand-test',
            roles: [
                { id: 'aerobic', adaptations: ['aerobic_endurance'], exactWorkoutIds: ['cycling_zone2_standard_01'], durationMinutes: 60 },
                { id: 'strength', adaptations: ['strength'], exactWorkoutIds: ['strength_full_body_maintenance_01'], durationMinutes: 45 },
            ],
        };
        const budget = packWeeklyDose(strategy, capacity(60, 5), roles);
        expect(budget.requiredRoles.filter(role => role.coverageRoleId === 'aerobic')).toHaveLength(4);
        expect(budget.requiredRoles.filter(role => role.coverageRoleId === 'strength')).toHaveLength(1);
        expect(budget.requiredRoles).toHaveLength(5);
        expect(budget.shortfalls).toEqual([]);
    });

    it('does not reserve scarce tier capacity for a later peer that cannot fit any remaining window', () => {
        const strategy: EvidenceBackedStrategy = {
            requirements: [
                {
                    ...healthStrategy.requirements[0],
                    floor: { dose: { unit: 'minutes', value: 60 }, semantics: 'goal_required_minimum' },
                    target: { unit: 'minutes', minimum: 60, target: 60, maximum: 60 },
                },
                {
                    ...healthStrategy.requirements[0],
                    adaptation: 'strength',
                    priority: 'required',
                    floor: { dose: { unit: 'sessions', value: 1 }, semantics: 'goal_required_minimum' },
                    target: { unit: 'sessions', minimum: 1, target: 1, maximum: 1 },
                    substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] },
                },
            ], warnings: [],
        };
        const roles: CoverageSetDescriptor = {
            id: 'infeasible-peer-test',
            roles: [
                { id: 'aerobic', adaptations: ['aerobic_endurance'], exactWorkoutIds: ['cycling_zone2_standard_01'], durationMinutes: 30 },
                { id: 'strength', adaptations: ['strength'], exactWorkoutIds: ['strength_full_body_maintenance_01'], durationMinutes: 45 },
            ],
        };
        const shortWindows = capacity(30, 2);
        const budget = packWeeklyDose(strategy, shortWindows, roles);

        expect(budget.requiredRoles.filter(role => role.coverageRoleId === 'aerobic')).toHaveLength(2);
        expect(budget.requiredRoles.filter(role => role.coverageRoleId === 'strength')).toHaveLength(0);
        expect(budget.shortfalls).toContainEqual(expect.objectContaining({ adaptation: 'strength', code: 'goal_requirement_shortfall' }));
    });

    it('uses the shortest fitting window before preferring a larger aerobic role, preserving the only strength-capable window', () => {
        const strategy: EvidenceBackedStrategy = {
            requirements: [
                {
                    ...healthStrategy.requirements[0],
                    floor: { dose: { unit: 'minutes', value: 30 }, semantics: 'goal_required_minimum' },
                    target: { unit: 'minutes', minimum: 30, target: 30, maximum: 30 },
                },
                {
                    ...healthStrategy.requirements[0],
                    adaptation: 'strength',
                    priority: 'required',
                    floor: { dose: { unit: 'sessions', value: 1 }, semantics: 'goal_required_minimum' },
                    target: { unit: 'sessions', minimum: 1, target: 1, maximum: 1 },
                    substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] },
                },
            ], warnings: [],
        };
        const roles: CoverageSetDescriptor = {
            id: 'best-fit-window-test',
            roles: [
                { id: 'aerobic-short', adaptations: ['aerobic_endurance'], exactWorkoutIds: ['cycling_zone2_standard_01'], durationMinutes: 30 },
                { id: 'aerobic-long', adaptations: ['aerobic_endurance'], exactWorkoutIds: ['cycling_zone2_standard_01'], durationMinutes: 45 },
                { id: 'strength', adaptations: ['strength'], exactWorkoutIds: ['strength_full_body_maintenance_01'], durationMinutes: 45 },
            ],
        };
        const mixedWindows: ResolvedTrainingCapacity = {
            ...capacity(45, 2),
            usableWindows: [
                { date: '2026-08-10', availableMinutes: 45 },
                { date: '2026-08-11', availableMinutes: 30 },
            ],
        };
        const budget = packWeeklyDose(strategy, mixedWindows, roles);

        expect(budget.requiredRoles.find(role => role.coverageRoleId === 'aerobic-short')?.date).toBe('2026-08-11');
        expect(budget.requiredRoles.find(role => role.coverageRoleId === 'aerobic-long')).toBeUndefined();
        expect(budget.requiredRoles.find(role => role.coverageRoleId === 'strength')?.date).toBe('2026-08-10');
        expect(budget.requiredRoles).toHaveLength(2);
        expect(budget.shortfalls).toEqual([]);
    });

    it('uses the 2-to-6-session policy only to break equal-dose placement ties', () => {
        const evenlyViable = {
            ...capacity(60, 2),
            usableWindows: [
                { date: '2026-08-10', availableMinutes: 60 },
                { date: '2026-08-12', availableMinutes: 60 },
                { date: '2026-08-13', availableMinutes: 60 },
            ],
        };
        const budget = packWeeklyDose({
            ...healthStrategy,
            requirements: [{ ...healthStrategy.requirements[0], floor: null, target: { unit: 'minutes', minimum: 120, target: 120, maximum: 120 } }],
        }, evenlyViable, coverage);

        expect(budget.requiredRoles.map(role => role.date)).toEqual(['2026-08-10', '2026-08-13']);
        expect(budget.shortfalls).toEqual([]);
    });
});
