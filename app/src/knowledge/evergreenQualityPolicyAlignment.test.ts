import { describe, expect, it } from 'vitest';
import { resolveEvergreenPlan } from '../engine/evergreenPlanning';
import { resolvePlanningContext } from '../engine/planningMode';
import { evaluatePeriodizationPhase } from '../engine/periodization';
import type { TrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import type { CompletedExposure } from '../engine/trainingHistory';
import type { TrainingIntentProfile, UserContext, UserPreferences } from '../engine/models';
import { EVERGREEN_PACKING_COVERAGE, PACKED_QUALITY_AEROBIC_CREDIT_MINUTES } from '../engine/weeklyDosePacking';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

const DATE = '2026-08-31';
const profile: TrainingIntentProfile = {
    userId: 'athlete', planningMode: 'evergreen', priorities: ['endurance'],
    weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
};
const preferences: UserPreferences = {
    userId: 'athlete', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible', preferredModalities: ['Cycling'], deprioritizedModalities: ['Running'], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};
const context: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: false, hasFreeWeights: false, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: ['Running'], preferredModalities: ['Cycling'], conservativeBias: false },
};
const exposures: CompletedExposure[] = Array.from({ length: 12 }, (_, index) => ({
    occurrenceKey: `cycling-${index}`,
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

describe('evergreen quality set policy alignment (ADR-0033, issue #758)', () => {
    it('registers the exact optional role as a product-policy claim and coverage item', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.evergreenQualitySetComposition);
        expect(claim).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable', recommendationStrength: 'conditional', version: 3 });
        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'evergreen.quality_set_composition');
        expect(coverage).toMatchObject({ classification: 'product_heuristic', coverage: 'covered', knowledgeRefs: [claim.id] });
        const role = EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'sustained_quality');
        expect(role?.requirement).toBe('optional');
        expect(EVERGREEN_GENERAL_COVERAGE_SET.requiredKeys).not.toContain('sustained_quality');
        expect(role?.workoutIds).toEqual(['cycling_controlled_threshold_4x8_01', 'cycling_tempo_surges_01', 'running_tempo_01']);
        expect(EVERGREEN_PACKING_COVERAGE.roles.find(item => item.id === 'sustained_quality')?.exactWorkoutIds).toEqual(role?.workoutIds);
        expect(WORKOUTS_BY_ID.get('cycling_tempo_surges_01')?.duration.minimumMin).toBe(30);
    });

    it('records the claim only when an eligible quality role was packed', () => {
        const eligible = resolve();
        expect(eligible?.budget.optionalRoles.some(role => role.coverageRoleId === 'sustained_quality')).toBe(true);
        expect(eligible?.knowledgeRefs).toContain(KNOWLEDGE_CLAIM_IDS.evergreenQualitySetComposition);
        const withheld = resolve(true);
        expect(withheld?.budget.optionalRoles.some(role => role.coverageRoleId === 'sustained_quality')).toBe(false);
        expect(withheld?.knowledgeRefs).not.toContain(KNOWLEDGE_CLAIM_IDS.evergreenQualitySetComposition);
    });

    it('aligns conditionalHighIntensityPrior claim v2 with recovery gating and transactional aerobic credit', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.conditionalHighIntensityPrior);
        expect(claim.version).toBe(2);
        expect(claim.reviewedOn).toBe('2026-09-25');
        expect(claim.statement).toContain('up to two in the weekly plan');
        expect(claim.statement).toContain('withheld during acute adverse recovery and Post-Event Recovery');
        expect(claim.statement).toContain('Base/Build labels do not replace objective-owned mesocycle intent');
        expect(claim.statement).toContain('crediting 40 minutes toward the aerobic allocation');
        expect(PACKED_QUALITY_AEROBIC_CREDIT_MINUTES).toBe(40);
        expect(claim.limitations.some(l => l.includes('40-minute aerobic credit is a product allocation heuristic'))).toBe(true);
    });
});
