import { describe, expect, it } from 'vitest';
import type { CompletedExposure } from './trainingHistory';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy, type AthleteTrainingState } from './evergreenStrategy';
import { EVERGREEN_PACKING_COVERAGE, packWeeklyDose, type CoverageSetDescriptor } from './weeklyDosePacking';
import type { ResolvedTrainingCapacity } from './trainingCapacity';
import { buildEvergreenPlanDefinition } from './planSchedule';
import { buildCoverageState, coverageKeysForTemplate, getUnfulfilledTargetCoverage } from './coverage';
import { generateWeeklyObjectives } from './microcycle';
import { evaluatePeriodizationPhase } from './periodization';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import { deriveExposureLedger, type ExposureLedgerInput } from './contextBriefExposureLedger';
import type { PerformedExposureFact } from './performedTrainingFacts';
import type { TrainingSettings } from './models';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { WORKOUTS } from '../workouts/catalog';
import {
    grantsPowerExposureCredit,
    POWER_QUALIFYING_IDENTITIES,
    POWER_QUALIFYING_WORKOUT_IDS,
    validatePowerQualifyingIdentities,
} from '../workouts/powerExposure';

const DATE = '2026-08-31';
const BASE_PHASE = evaluatePeriodizationPhase([], DATE).phase;

const cyclingExposure = (index: number): CompletedExposure => ({
    occurrenceKey: `ride-${index}`, date: `2026-08-${String(3 + index * 2).padStart(2, '0')}`,
    modality: 'Cycling', category: 'Easy Endurance',
    costProfile: { systemic: 0.2, cardiovascular: 0.3, lowerBody: 0.2, upperBody: 0, impactTissue: 0, neuromuscular: 0.1 },
    trainingRecordLike: { type: 'Cycling aerobic endurance', duration_min: 60, training_effect: 2, intensity_tag: 'easy' },
});
const established: AthleteTrainingState = inferAthleteTrainingState(Array.from({ length: 12 }, (_, index) => cyclingExposure(index)), 28);
const hybrid = ['endurance', 'strength_muscle'] as const;

const capacity = (sessions: number, minutes = 75): ResolvedTrainingCapacity => ({
    minSessions: sessions, targetSessions: sessions, maxSessions: sessions,
    weekdayMinutes: minutes, weekendMinutes: minutes,
    usableWindows: Array.from({ length: sessions }, (_, index) => ({ date: `2026-09-${String(1 + index).padStart(2, '0')}`, availableMinutes: minutes })),
    estimatedTargetWeeklyMinutes: minutes * sessions, warnings: [],
});

const allRoles = (budget: ReturnType<typeof packWeeklyDose>) => [...budget.requiredRoles, ...budget.targetRoles, ...budget.optionalRoles];

describe('neuromuscular power identity mapping (#802)', () => {
    it('explicitly maps the compact, reactive, lower-body and full-body power-capable workouts against the catalog', () => {
        expect(validatePowerQualifyingIdentities(WORKOUTS)).toEqual([]);
        expect([...POWER_QUALIFYING_WORKOUT_IDS].sort()).toEqual([
            'strength_compact_power_01',
            'strength_full_body_maintenance_01',
            'strength_lower_body_01',
            'strength_reactive_power_01',
        ]);
        const impact = POWER_QUALIFYING_IDENTITIES.filter(identity => identity.impact).map(identity => identity.workoutId);
        expect(impact).toEqual(['strength_reactive_power_01']);
    });

    it('credits exact identities only, never generic strength, re-entry doses or readiness-modified doses', () => {
        expect(grantsPowerExposureCredit({ workoutId: 'strength_full_body_maintenance_01' })).toBe(true);
        expect(grantsPowerExposureCredit({ workoutId: 'strength_full_body_maintenance_01', variant: 'reduced' })).toBe(true);
        expect(grantsPowerExposureCredit({ workoutId: 'strength_full_body_maintenance_01', variant: 'return_to_training' })).toBe(false);
        expect(grantsPowerExposureCredit({ workoutId: 'strength_full_body_maintenance_01', isReadinessModifiedDose: true })).toBe(false);
        expect(grantsPowerExposureCredit({ workoutId: 'strength_bodyweight_full_body_01' })).toBe(false);
        expect(grantsPowerExposureCredit({ workoutId: 'cycling_controlled_threshold_4x8_01' })).toBe(false);
        expect(grantsPowerExposureCredit({})).toBe(false);
    });

    it('flags a mapped power step that a qualifying variant removes', () => {
        const broken = WORKOUTS.map(workout => workout.id !== 'strength_compact_power_01' ? workout : {
            ...workout,
            variants: workout.variants.map(variant => variant.id !== 'reduced' ? variant : {
                ...variant, stepOverrides: [...variant.stepOverrides, { stepId: 'slam', omit: true }],
            }),
        });
        expect(validatePowerQualifyingIdentities(broken)).toEqual([
            'power identity strength_compact_power_01: qualifying variant reduced omits every power step',
        ]);
    });
});

describe('evergreen power requirement (#802)', () => {
    it('adds a separate embedded power requirement for an established hybrid athlete, distinct from high intensity', () => {
        const strategy = resolveEvidenceBackedStrategy({ priorities: [...hybrid] }, established);
        const power = strategy.requirements.find(requirement => requirement.adaptation === 'neuromuscular_power');
        expect(power).toMatchObject({
            priority: 'optional', delivery: 'embedded', floor: null,
            target: { unit: 'sessions', minimum: 0, target: 1, maximum: 2 },
            substitutionPolicy: { equivalentModalitiesAllowed: false, permittedModalities: ['Strength'] },
            knowledgeRefs: ['policy.evergreen.power_maintenance_exposure_v1', 'performance.power.low_frequency_maintenance'],
            evidence: { authority: 'product_heuristic', knowledgeClaimId: 'policy.evergreen.power_maintenance_exposure_v1' },
        });
        const highIntensity = strategy.requirements.find(requirement => requirement.adaptation === 'high_intensity');
        expect(highIntensity?.delivery).toBeUndefined();
        expect(highIntensity?.knowledgeRefs).not.toContain('policy.evergreen.power_maintenance_exposure_v1');
    });

    it('makes power a target for an explicit speed/power priority and omits it without a strength requirement', () => {
        const speed = resolveEvidenceBackedStrategy({ priorities: ['speed_power', 'strength_muscle'] }, established);
        expect(speed.requirements.find(requirement => requirement.adaptation === 'neuromuscular_power')?.priority).toBe('target');
        const enduranceOnly = resolveEvidenceBackedStrategy({ priorities: ['endurance'] }, established);
        expect(enduranceOnly.requirements.some(requirement => requirement.adaptation === 'neuromuscular_power')).toBe(false);
        const healthOnly = resolveEvidenceBackedStrategy({ priorities: ['health'] }, established);
        expect(healthOnly.requirements.some(requirement => requirement.adaptation === 'neuromuscular_power')).toBe(false);
        expect(healthOnly.warnings).toEqual([]);
    });

    it.each([
        ['adverse recovery', { isAdverseRecovery: true }, established],
        ['clinical symptoms', { hasCurrentClinicalSymptoms: true }, established],
        ['peak/taper', { phase: { ...BASE_PHASE, phaseName: 'Peak/Taper' as const } }, established],
        ['post-event recovery', { phase: { ...BASE_PHASE, phaseName: 'Post-Event Recovery' as const } }, established],
        ['insufficient history', {}, inferAthleteTrainingState([], 7)],
    ])('withholds power with a typed reason during %s', (_label, context, state) => {
        const strategy = resolveEvidenceBackedStrategy({ priorities: [...hybrid], ...context }, state);
        expect(strategy.requirements.some(requirement => requirement.adaptation === 'neuromuscular_power')).toBe(false);
        expect(strategy.warnings).toContainEqual({ code: 'power_exposure_withheld', message: expect.any(String) });
        expect(strategy.requirements.some(requirement => requirement.adaptation === 'strength')).toBe(true);
    });
});

describe('embedded power packing (#802)', () => {
    const strategy = resolveEvidenceBackedStrategy({ priorities: [...hybrid] }, established);
    const withoutPower = { ...strategy, requirements: strategy.requirements.filter(requirement => requirement.adaptation !== 'neuromuscular_power') };

    it('embeds power in a packed strength occurrence without consuming a session slot', () => {
        const budget = packWeeklyDose(strategy, capacity(5), EVERGREEN_PACKING_COVERAGE);
        const baseline = packWeeklyDose(withoutPower, capacity(5), EVERGREEN_PACKING_COVERAGE);
        const roles = allRoles(budget);
        expect(roles.map(role => [role.date, role.coverageRoleId])).toEqual(allRoles(baseline).map(role => [role.date, role.coverageRoleId]));
        const hosts = roles.filter(role => role.adaptations.includes('neuromuscular_power'));
        expect(hosts).toHaveLength(1);
        expect(hosts[0]).toMatchObject({
            coverageRoleId: 'primary_strength',
            embeddedAdaptations: ['neuromuscular_power'],
            embeddedWorkoutIds: ['strength_full_body_maintenance_01'],
        });
        expect(hosts[0].adaptations).toEqual(['strength', 'neuromuscular_power']);
        expect(budget.shortfalls.filter(warning => warning.adaptation === 'neuromuscular_power')).toEqual([]);
        expect(roles.filter(role => role.coverageRoleId === 'sustained_quality').every(role => !role.adaptations.includes('neuromuscular_power'))).toBe(true);
    });

    it('reports a typed shortfall instead of creating a session when no strength host carries power', () => {
        const noPowerHost: CoverageSetDescriptor = {
            ...EVERGREEN_PACKING_COVERAGE,
            roles: EVERGREEN_PACKING_COVERAGE.roles.map(role => role.id !== 'primary_strength' ? role : { ...role, exactWorkoutIds: ['strength_bodyweight_full_body_01'] }),
        };
        const budget = packWeeklyDose(strategy, capacity(5), noPowerHost);
        const baseline = packWeeklyDose(withoutPower, capacity(5), noPowerHost);
        expect(allRoles(budget)).toHaveLength(allRoles(baseline).length);
        expect(allRoles(budget).some(role => role.adaptations.includes('neuromuscular_power'))).toBe(false);
        expect(budget.shortfalls).toContainEqual(expect.objectContaining({ code: 'embedded_host_unavailable', adaptation: 'neuromuscular_power' }));
    });

    it('turns packed power into a coverage-only requirement without a stimulus objective', () => {
        const budget = packWeeklyDose(strategy, capacity(5), EVERGREEN_PACKING_COVERAGE);
        const plan = buildEvergreenPlanDefinition(strategy, capacity(5), budget, DATE);
        if (plan.status !== 'AVAILABLE') throw new Error('plan should be available');
        expect(plan.data.coverageRequirements).toEqual([{
            coverageKey: 'power_exposure', blockId: 'block_general', minimumSessions: 0, targetSessions: 1,
            priority: 'nice_to_have',
            knowledgeRefs: ['policy.evergreen.power_maintenance_exposure_v1', 'performance.power.low_frequency_maintenance'],
        }]);
        expect(plan.data.objectives.map(objective => objective.coverageKey)).not.toContain('power_exposure');
        const microcycle = generateWeeklyObjectives(BASE_PHASE, DATE, null, plan.data, DATE);
        expect(microcycle.objectives).toHaveLength(plan.data.objectives.length);
    });
});

describe('power exposure coverage (#802)', () => {
    const strategy = resolveEvidenceBackedStrategy({ priorities: [...hybrid] }, established);
    const budget = packWeeklyDose(strategy, capacity(5), EVERGREEN_PACKING_COVERAGE);
    const plan = buildEvergreenPlanDefinition(strategy, capacity(5), budget, DATE);
    if (plan.status !== 'AVAILABLE') throw new Error('plan should be available');
    const asOf = '2026-09-06';
    const power = (history: Parameters<typeof buildCoverageState>[2]) =>
        buildCoverageState(plan.data, asOf, history, EVERGREEN_GENERAL_COVERAGE_SET).requirements.find(item => item.key === 'power_exposure')!;

    it('keeps power unmet after a threshold/VO2 week with no true power exposure', () => {
        const state = buildCoverageState(plan.data, asOf, [
            { date: '2026-09-02', templateId: 'end_hard_02', durationMin: 60 },
            { date: '2026-09-04', workoutId: 'cycling_controlled_threshold_4x8_01', durationMin: 70 },
        ], EVERGREEN_GENERAL_COVERAGE_SET);
        expect(state.requirements.find(item => item.key === 'power_exposure')?.completedSessions).toBe(0);
        expect(getUnfulfilledTargetCoverage(state).map(item => item.key)).toContain('power_exposure');
    });

    it('credits one power-clean strength session to both primary strength and power without a second session or extra HIIT', () => {
        const state = buildCoverageState(plan.data, asOf, [{ date: '2026-09-02', templateId: 'str_full_01', durationMin: 60 }], EVERGREEN_GENERAL_COVERAGE_SET);
        const strength = state.requirements.find(item => item.key === 'primary_strength')!;
        const powerRequirement = state.requirements.find(item => item.key === 'power_exposure')!;
        expect(strength.completedSessions).toBe(1);
        expect(powerRequirement.completedSessions).toBe(1);
        expect(powerRequirement.credits[0].occurrenceKey).toBe(strength.credits[0].occurrenceKey);
        expect(getUnfulfilledTargetCoverage(state).map(item => item.key)).not.toContain('power_exposure');
        expect(state.requirements.find(item => item.key === 'sustained_quality')?.completedSessions ?? 0).toBe(0);
    });

    it('denies power to bodyweight strength and to a readiness-modified dose of a power identity', () => {
        expect(power([{ date: '2026-09-02', templateId: 'str_full_02', durationMin: 35 }]).completedSessions).toBe(0);
        expect(power([{ date: '2026-09-02', templateId: 'str_full_01', durationMin: 18, isReadinessModifiedDose: true }]).completedSessions).toBe(0);
        const fullBody = ENRICHED_TEMPLATES_BY_ID.get('str_full_01')!;
        expect(coverageKeysForTemplate(fullBody, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toEqual(['primary_strength', 'power_exposure']);
        expect(coverageKeysForTemplate({ ...fullBody, isReadinessModifiedDose: true }, 'general', EVERGREEN_GENERAL_COVERAGE_SET)).toEqual(['primary_strength']);
    });
});

describe('power in the exposure ledger (#802)', () => {
    const settings = (avoidHighImpact: boolean) => ({
        userId: 'athlete', schemaVersion: 3,
        equipment: { free_weights: true } as unknown as TrainingSettings['equipment'],
        guardrails: { avoid_high_impact: avoidHighImpact, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 90, weekendMaxMinutes: 240, environment: 'either' },
        preferences: { preferActiveRecovery: false }, migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '', updatedAt: '',
    }) as TrainingSettings;
    const fact = (workoutId: string, overrides: Partial<PerformedExposureFact> = {}) => ({
        performedOccurrenceId: `occ-${workoutId}`, localDate: '2026-09-20', modality: 'Strength', confidence: 'exact',
        sourceKinds: ['structured_execution'], evidenceTier: 'completedStructuredWorkout', workoutId, ...overrides,
    }) as PerformedExposureFact;
    const ledger = (facts: PerformedExposureFact[], avoidHighImpact = false) => deriveExposureLedger({
        asOfDate: '2026-09-24', lookbackStart: '2026-09-11', activities: [], recommendations: [],
        activitiesReadable: true, recommendationsReadable: true, activityOverrides: {}, performedFacts: facts,
        plannedSessions: [], trainingSettings: settings(avoidHighImpact), preferences: null,
    } satisfies ExposureLedgerInput).capabilities.find(entry => entry.key === 'neuromuscular_power')!;

    it('confirms power only from an exact power identity, never from generic strength', () => {
        expect(ledger([fact('strength_full_body_maintenance_01')])).toMatchObject({ status: 'confirmed', lastConfirmed: '2026-09-20' });
        expect(ledger([fact('strength_bodyweight_full_body_01')]).status).toBe('unknown');
        expect(ledger([fact('strength_full_body_maintenance_01', { isReadinessModifiedDose: true })]).status).toBe('unknown');
    });

    it('keeps non-impact power eligible while an impact guardrail suspends plyometrics', () => {
        const entry = ledger([], true);
        expect(entry.status).toBe('unknown');
        expect(entry.note).toContain('non-impact power identities remain eligible');
    });
});
