import { describe, expect, it } from 'vitest';
import { resolveEvergreenPlan } from '../engine/evergreenPlanning';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from '../engine/evergreenStrategy';
import { resolvePlanningContext } from '../engine/planningMode';
import { evaluatePeriodizationPhase } from '../engine/periodization';
import type { TrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import type { CompletedExposure } from '../engine/trainingHistory';
import type { TrainingIntentProfile, UserContext, UserPreferences } from '../engine/models';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { POWER_QUALIFYING_IDENTITIES, POWER_QUALIFYING_WORKOUT_IDS } from '../workouts/powerExposure';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

const DATE = '2026-08-31';
const profile: TrainingIntentProfile = {
    userId: 'athlete', planningMode: 'evergreen', priorities: ['endurance', 'strength_muscle'],
    weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
};
const preferences: UserPreferences = {
    userId: 'athlete', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 75, defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible', preferredModalities: ['Cycling', 'Strength'], deprioritizedModalities: [], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};
const context: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: ['Cycling', 'Strength'], conservativeBias: false },
};
const exposures: CompletedExposure[] = Array.from({ length: 12 }, (_, index) => ({
    occurrenceKey: `ride-${index}`,
    date: `2026-08-${String(4 + index * 2).padStart(2, '0')}`,
    modality: 'Cycling', category: 'Easy Endurance',
    costProfile: { systemic: 0.25, cardiovascular: 0.35, lowerBody: 0.2, upperBody: 0, impactTissue: 0, neuromuscular: 0.1 },
    trainingRecordLike: { type: 'Cycling aerobic endurance', duration_min: 60, training_effect: 2, intensity_tag: 'easy' },
}));
const snapshot: TrainingHistorySnapshot = {
    throughDateExclusive: DATE, windowDays: 7, completedEvents: [], exposures: [],
    sourceStates: {
        activities: { status: 'AVAILABLE', revision: 'synthetic' },
        recommendations: { status: 'AVAILABLE', revision: 'synthetic' },
        manualTraining: { status: 'MISSING' },
    },
    generatedAt: '2026-08-31T00:00:00.000Z', revision: 'synthetic',
    athleteStateEvidence: { observedWindowDays: 28, exposures },
};

function resolve(isAdverseRecovery = false) {
    const periodization = evaluatePeriodizationPhase([], DATE);
    return resolveEvergreenPlan(
        resolvePlanningContext(profile, periodization, DATE), periodization.phase, [], snapshot,
        preferences, context, DATE, [], 7, isAdverseRecovery,
    );
}

describe('power maintenance policy alignment (ADR-0033, issue #802)', () => {
    it('registers an evidence claim with explicit limitations and a separate product-policy claim', () => {
        const evidence = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.lowFrequencyStrengthPowerMaintenance);
        expect(evidence).toMatchObject({ claimType: 'intervention', evidenceCertainty: 'low', recommendationStrength: 'conditional' });
        expect(evidence.limitations.some(limitation => limitation.includes('indirect'))).toBe(true);
        const policy = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.powerMaintenanceExposurePolicy);
        expect(policy).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable', version: 1 });
        expect(policy.statement).toContain('one small power exposure per week, with at most two credited');
        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'evergreen.power_maintenance_exposure');
        expect(coverage).toMatchObject({ classification: 'product_heuristic', knowledgeRefs: [policy.id, evidence.id] });
    });

    it('keeps the implemented target, ceiling and delivery aligned with the policy claim', () => {
        const state = inferAthleteTrainingState(exposures, 28);
        const power = resolveEvidenceBackedStrategy({ priorities: profile.priorities }, state).requirements
            .find(requirement => requirement.adaptation === 'neuromuscular_power');
        expect(power).toMatchObject({
            floor: null, delivery: 'embedded',
            target: { unit: 'sessions', minimum: 0, target: 1, maximum: 2 },
            evidence: { knowledgeClaimId: KNOWLEDGE_CLAIM_IDS.powerMaintenanceExposurePolicy, knowledgeClaimVersion: 1 },
        });
    });

    it('keeps the exact identity mapping and coverage role aligned with the claim', () => {
        const role = EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'power_exposure');
        expect(role?.workoutIds).toEqual([...POWER_QUALIFYING_WORKOUT_IDS]);
        expect(role?.requirement).toBe('conditional');
        expect(EVERGREEN_GENERAL_COVERAGE_SET.requiredKeys).not.toContain('power_exposure');
        expect(POWER_QUALIFYING_IDENTITIES.every(identity => identity.qualifyingVariants.join() === 'full,reduced')).toBe(true);
        expect(new Set(POWER_QUALIFYING_IDENTITIES.map(identity => identity.mechanism))).toEqual(
            new Set(['olympic_derivative', 'ballistic_throw', 'reactive_plyometric']),
        );
        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'evergreen.power_maintenance_exposure');
        POWER_QUALIFYING_WORKOUT_IDS.forEach(workoutId => expect(coverage?.currentRule).toContain(workoutId));
    });

    it('records the claims and embeds power only when the plan actually carries it', () => {
        const eligible = resolve();
        expect(eligible?.planDefinition.coverageRequirements).toEqual([expect.objectContaining({ coverageKey: 'power_exposure', targetSessions: 1 })]);
        expect(eligible?.knowledgeRefs).toEqual(expect.arrayContaining([
            KNOWLEDGE_CLAIM_IDS.powerMaintenanceExposurePolicy,
            KNOWLEDGE_CLAIM_IDS.lowFrequencyStrengthPowerMaintenance,
        ]));
        const withheld = resolve(true);
        expect(withheld?.planDefinition.coverageRequirements).toBeUndefined();
        expect(withheld?.knowledgeRefs).not.toContain(KNOWLEDGE_CLAIM_IDS.powerMaintenanceExposurePolicy);
    });
});
