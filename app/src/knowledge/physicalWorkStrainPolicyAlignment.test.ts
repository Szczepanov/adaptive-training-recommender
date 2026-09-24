import { describe, expect, it } from 'vitest';
import { mapContextFromGoalsAndTrainingSettings } from '../engine/adapters';
import { computeInternalResponseStrain } from '../engine/fatigue';
import { readinessKnowledgeRefs } from '../engine/knowledgeLineage';
import { resolveOccupationalLoadContext } from '../engine/occupationalLoad';
import { evaluateEnvelopes, evaluateReadinessAndSafetyEnvelope, evaluateTraining } from '../engine/rules';
import type {
    DailyReadiness,
    DailySubjectiveCheckin,
    DimensionalFatigue,
    EngineObjectiveInput,
    OccupationalLoadBaseline,
    PhysicalWorkCheckin,
    SubjectiveInput,
    TrainingSettings,
    UserContext,
} from '../engine/models';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

// Neutral biometrics and floor-level subjective scores zero every competing internal-response
// term, so each dimension below equals its physical-work term exactly.
const NEUTRAL_OBJECTIVE: EngineObjectiveInput = {
    total_steps: 7000,
    sleep_score: 85,
    sleep_duration_min: 480,
    rhr: 50,
    rhr_7d_avg: 50,
    rhr_delta: 0,
    hrv_weekly_avg: 55,
    hrv_last_night: 55,
    hrv_delta: 0,
    respiration: 14,
    body_battery_wake: 85,
    last_3_days_hard_sessions_count: 0,
    yesterday_training: null,
    today_training: null,
    sleep_score_delta_7d: 0,
    rhr_delta_28d: 0,
    hrv_delta_28d: 0,
    sleep_score_delta_28d: 0,
    hrv_stdev_28d: 8,
    rhr_stdev_28d: 3,
    sleep_score_stdev_28d: 7,
};

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 9, sleepQuality: 9, fatigue: 1, soreness: 1, stress: 3, motivation: 10,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        ...overrides,
    };
}

function strainFor(physicalWork: PhysicalWorkCheckin, overrides: Partial<SubjectiveInput> = {}): DimensionalFatigue {
    const readiness: DailyReadiness = { subjective: subjective({ physicalWork, ...overrides }), objective: NEUTRAL_OBJECTIVE };
    return computeInternalResponseStrain(readiness);
}

function expectDimensions(actual: DimensionalFatigue, expected: DimensionalFatigue): void {
    (Object.keys(expected) as (keyof DimensionalFatigue)[]).forEach(dimension => {
        expect(actual[dimension], dimension).toBeCloseTo(expected[dimension], 10);
    });
}

function rawStrain(work: PhysicalWorkCheckin): number {
    return resolveOccupationalLoadContext(work, undefined, null, null).rawStrain;
}

const READINESS_CONTEXT: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: false, restrictedModalities: [], maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
};

const WORK_SETTINGS: TrainingSettings = {
    userId: 'athlete', schemaVersion: 2,
    equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: false },
    guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
    defaults: { weekdayMaxMinutes: 45, weekendMaxMinutes: 120, environment: 'either' },
    preferences: { preferActiveRecovery: false },
    migration: { legacyReviewed: true, migratedAt: null },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function contextForWork(physicalWork?: PhysicalWorkCheckin): UserContext {
    const checkin = physicalWork === undefined ? null : { physicalWork } as DailySubjectiveCheckin;
    return mapContextFromGoalsAndTrainingSettings([], WORK_SETTINGS, null, '2026-08-08', checkin);
}

function modeFor(physicalWork: PhysicalWorkCheckin | undefined, overrides: Partial<SubjectiveInput> = {}): 'train' | 'modify' | 'recover' {
    return evaluateReadinessAndSafetyEnvelope(
        { subjective: subjective({ physicalWork, ...overrides }), objective: NEUTRAL_OBJECTIVE },
        READINESS_CONTEXT,
    ).mode;
}

function decisionSurface(recommendation: ReturnType<typeof evaluateTraining>) {
    const surface = { ...recommendation };
    delete surface.knowledgeRefs;
    return surface;
}

// Unsaturated reference magnitude: hard x medium = 0.70.
const HARD_MEDIUM = 0.70;

describe('physical-work strain aligns with policy.fatigue.physical_work_strain_mapping_v1', () => {
    it('registers the claim and a covered inventory item that owns it', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.physicalWorkStrainMappingPolicy);
        expect(claim).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable' });
        expect(claim.statement).toContain('moderate 0.45 / hard 0.70 / exhausting 0.88');
        expect(claim.statement).toContain('short 0.65 / medium 1.00 / extended 1.25');
        expect(claim.statement).toContain('baseline strain x baseline confidence x load-area overlap');
        expect(claim.statement).toContain('systemic x0.60');
        expect(claim.statement).toContain('upper-body x0.85');
        expect(claim.statement).toContain('lower-body x0.85');
        expect(claim.statement).toContain('neuromuscular x0.75');
        expect(claim.statement).toContain('else x0.40');
        expect(claim.statement).toContain('impact-tissue x0.40 only for legs_carrying at hard or exhausting intensity');

        const item = ENGINE_KNOWLEDGE_COVERAGE.find(entry => entry.id === 'fatigue.physical_work_strain_mapping');
        expect(item).toMatchObject({ coverage: 'covered', classification: 'product_heuristic', researchPriority: 'none' });
        expect(item?.knowledgeRefs).toContain(KNOWLEDGE_CLAIM_IDS.physicalWorkStrainMappingPolicy);
    });

    it('pins the intensity x duration magnitude table, its cap and the omitted-detail default', () => {
        expect(rawStrain({ performed: true, intensity: 'moderate', duration: 'short' })).toBeCloseTo(0.45 * 0.65, 10);
        expect(rawStrain({ performed: true, intensity: 'moderate', duration: 'medium' })).toBeCloseTo(0.45, 10);
        expect(rawStrain({ performed: true, intensity: 'moderate', duration: 'extended' })).toBeCloseTo(0.45 * 1.25, 10);
        expect(rawStrain({ performed: true, intensity: 'hard', duration: 'short' })).toBeCloseTo(0.70 * 0.65, 10);
        expect(rawStrain({ performed: true, intensity: 'hard', duration: 'medium' })).toBeCloseTo(0.70, 10);
        expect(rawStrain({ performed: true, intensity: 'hard', duration: 'extended' })).toBeCloseTo(0.70 * 1.25, 10);
        expect(rawStrain({ performed: true, intensity: 'exhausting', duration: 'short' })).toBeCloseTo(0.88 * 0.65, 10);
        expect(rawStrain({ performed: true, intensity: 'exhausting', duration: 'medium' })).toBeCloseTo(0.88, 10);
        // 0.88 x 1.25 = 1.10 saturates at the cap.
        expect(rawStrain({ performed: true, intensity: 'exhausting', duration: 'extended' })).toBe(1);

        expect(rawStrain({ performed: true })).toBeCloseTo(0.45, 10);
        expect(rawStrain({ performed: false, intensity: 'exhausting', duration: 'extended' })).toBe(0);
    });

    it('pins the soft occupational-baseline discount', () => {
        const baseline: OccupationalLoadBaseline = {
            typicalIntensity: 'moderate', typicalDuration: 'medium', typicalLoadAreas: ['upper_body'],
            source: 'user_authored', confidence: 0.8,
        };
        const work: PhysicalWorkCheckin = { performed: true, intensity: 'hard', duration: 'medium', loadAreas: ['upper_body', 'legs_carrying'] };

        // Half of today's areas are usual: discount = 0.45 x 0.8 x 0.5.
        const partialOverlap = resolveOccupationalLoadContext(work, baseline, null, null);
        expect(partialOverlap.loadAreaOverlap).toBe(0.5);
        expect(partialOverlap.baselineDiscount).toBeCloseTo(0.45 * 0.8 * 0.5, 10);
        expect(partialOverlap.acuteDeviation).toBeCloseTo(HARD_MEDIUM - 0.45 * 0.8 * 0.5, 10);

        // No reported areas: overlap defaults to 1.
        const noAreas = resolveOccupationalLoadContext({ ...work, loadAreas: undefined }, baseline, null, null);
        expect(noAreas.loadAreaOverlap).toBe(1);
        expect(noAreas.acuteDeviation).toBeCloseTo(HARD_MEDIUM - 0.45 * 0.8, 10);

        // The discount can never exceed today's raw strain.
        const heavyBaseline: OccupationalLoadBaseline = { ...baseline, typicalIntensity: 'exhausting', typicalDuration: 'extended', confidence: 1 };
        const lightDay = resolveOccupationalLoadContext({ performed: true, intensity: 'moderate', duration: 'short', loadAreas: ['upper_body'] }, heavyBaseline, null, null);
        expect(lightDay.baselineDiscount).toBeCloseTo(lightDay.rawStrain, 10);
        expect(lightDay.acuteDeviation).toBe(0);

        // The ambient-step co-occurrence flag is diagnostic and leaves strain unchanged.
        const surge = resolveOccupationalLoadContext(work, baseline, 20_000, 8_000);
        expect(surge.physicalWorkAndAmbientStepSurge).toBe(true);
        expect(surge.acuteDeviation).toBe(partialOverlap.acuteDeviation);

        const discounted = strainFor(work, { occupationalBaseline: baseline });
        expect(discounted.systemic).toBeCloseTo(partialOverlap.acuteDeviation * 0.60, 10);
        expect(discounted.upperBody).toBeCloseTo(partialOverlap.acuteDeviation * 0.85, 10);
    });

    it('pins every dimensional multiplier with unsaturated hard/medium work', () => {
        const work = (loadAreas?: PhysicalWorkCheckin['loadAreas']): PhysicalWorkCheckin =>
            ({ performed: true, intensity: 'hard', duration: 'medium', loadAreas });

        expectDimensions(strainFor(work()), {
            systemic: HARD_MEDIUM * 0.60, cardiovascular: 0, lowerBody: HARD_MEDIUM * 0.85,
            upperBody: HARD_MEDIUM * 0.85, impactTissue: 0, neuromuscular: HARD_MEDIUM * 0.75,
        });
        expectDimensions(strainFor(work(['upper_body'])), {
            systemic: HARD_MEDIUM * 0.60, cardiovascular: 0, lowerBody: 0,
            upperBody: HARD_MEDIUM * 0.85, impactTissue: 0, neuromuscular: HARD_MEDIUM * 0.40,
        });
        expectDimensions(strainFor(work(['grip_forearms'])), {
            systemic: HARD_MEDIUM * 0.60, cardiovascular: 0, lowerBody: 0,
            upperBody: HARD_MEDIUM * 0.85, impactTissue: 0, neuromuscular: HARD_MEDIUM * 0.75,
        });
        expectDimensions(strainFor(work(['lower_back_spine'])), {
            systemic: HARD_MEDIUM * 0.60, cardiovascular: 0, lowerBody: 0,
            upperBody: 0, impactTissue: 0, neuromuscular: HARD_MEDIUM * 0.75,
        });
        expectDimensions(strainFor(work(['legs_carrying'])), {
            systemic: HARD_MEDIUM * 0.60, cardiovascular: 0, lowerBody: HARD_MEDIUM * 0.85,
            upperBody: 0, impactTissue: HARD_MEDIUM * 0.40, neuromuscular: HARD_MEDIUM * 0.40,
        });
    });

    it('pins impact-tissue strain to legs_carrying at hard or exhausting intensity only', () => {
        const exhaustingShort = strainFor({ performed: true, intensity: 'exhausting', duration: 'short', loadAreas: ['legs_carrying'] });
        expect(exhaustingShort.impactTissue).toBeCloseTo(0.88 * 0.65 * 0.40, 10);

        const moderateExtended = strainFor({ performed: true, intensity: 'moderate', duration: 'extended', loadAreas: ['legs_carrying'] });
        expect(moderateExtended.lowerBody).toBeCloseTo(0.45 * 1.25 * 0.85, 10);
        expect(moderateExtended.impactTissue).toBe(0);

        // Omitted intensity resolves to moderate, so it earns no impact term either.
        const omittedIntensity = strainFor({ performed: true, duration: 'extended', loadAreas: ['legs_carrying'] });
        expect(omittedIntensity.lowerBody).toBeCloseTo(0.45 * 1.25 * 0.85, 10);
        expect(omittedIntensity.impactTissue).toBe(0);
    });

    it('max-combines work terms with the other internal-response terms instead of adding them', () => {
        // Soreness 8 sets the acute tissue floor to 0.88, above the 0.595 legs_carrying term.
        const sore = strainFor({ performed: true, intensity: 'hard', duration: 'medium', loadAreas: ['legs_carrying'] }, { soreness: 8 });
        expect(sore.lowerBody).toBeCloseTo(0.88, 10);
        expect(sore.impactTissue).toBeCloseTo(0.88, 10);
        expect(sore.upperBody).toBeCloseTo(0.88 * 0.7, 10);
    });
});

describe('physical-work readiness mode aligns with policy.readiness.physical_work_mode_gates_v1', () => {
    it('registers a distinct active policy claim and covered readiness inventory item', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.physicalWorkReadinessModeGatesPolicy);
        expect(claim).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable' });
        expect(claim.statement).toContain('Raw strain >=0.65 forces modify');
        expect(claim.statement).toContain('raw strain >=0.85 forces recover');
        expect(claim.statement).toContain('fatigue >=6 or soreness >=6');
        expect(claim.statement).toContain('before any occupational-baseline discount');

        const item = ENGINE_KNOWLEDGE_COVERAGE.find(entry => entry.id === 'readiness.physical_work_mode_gates');
        expect(item).toMatchObject({ domain: 'readiness_recovery', coverage: 'covered', classification: 'product_heuristic' });
        expect(item?.knowledgeRefs).toEqual([KNOWLEDGE_CLAIM_IDS.physicalWorkReadinessModeGatesPolicy]);
        expect(item?.codeRefs).toContain('engine/rules.ts:evaluateReadinessAndSafetyEnvelope');
    });

    it('modifies above 0.65 raw strain but leaves omitted and below-threshold work in train', () => {
        expect(modeFor(undefined)).toBe('train');
        expect(modeFor({ performed: false, intensity: 'exhausting', duration: 'extended' })).toBe('train');
        expect(modeFor({ performed: true })).toBe('train'); // moderate x medium = 0.45
        expect(modeFor({ performed: true, intensity: 'exhausting', duration: 'short' })).toBe('train'); // 0.572
        expect(modeFor({ performed: true, intensity: 'hard', duration: 'medium' })).toBe('modify'); // 0.70
    });

    it('recovers above 0.85 only when fatigue or soreness reaches 6', () => {
        const below = { performed: true, intensity: 'hard', duration: 'medium' } as const; // 0.70
        const above = { performed: true, intensity: 'hard', duration: 'extended' } as const; // 0.875
        expect(modeFor(below, { fatigue: 6 })).toBe('modify');
        expect(modeFor(below, { soreness: 6 })).toBe('modify');
        expect(modeFor(above, { fatigue: 5, soreness: 5 })).toBe('modify');
        expect(modeFor(above, { fatigue: 6 })).toBe('recover');
        expect(modeFor(above, { soreness: 6 })).toBe('recover');
    });

    it('uses raw strain for mode even when the occupational baseline discounts acute strain to zero', () => {
        const work: PhysicalWorkCheckin = { performed: true, intensity: 'hard', duration: 'extended', loadAreas: ['upper_body'] };
        const baseline: OccupationalLoadBaseline = {
            typicalIntensity: 'hard', typicalDuration: 'extended', typicalLoadAreas: ['upper_body'],
            source: 'user_authored', confidence: 1,
        };
        expect(resolveOccupationalLoadContext(work, baseline, null, null).acuteDeviation).toBe(0);
        expect(modeFor(work, { fatigue: 6, occupationalBaseline: baseline })).toBe('recover');
    });
});

describe('physical-work guardrails align with policy.safety.physical_work_guardrails_v1', () => {
    it('registers a separate covered product-policy claim', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.physicalWorkGuardrailsPolicy);
        expect(claim).toMatchObject({ claimType: 'heuristic', maturity: 'heuristic', evidenceCertainty: 'not_applicable' });
        expect(claim.statement).toContain('hard or exhausting intensity involving lower_back_spine adds avoid_heavy_spinal_loading');
        expect(claim.statement).toContain('exhausting intensity involving upper_body or grip_forearms adds avoid_overhead_pressing');

        const item = ENGINE_KNOWLEDGE_COVERAGE.find(entry => entry.id === 'safety.physical_work_guardrails');
        expect(item).toMatchObject({ domain: 'injury_safety', coverage: 'covered', classification: 'product_heuristic' });
        expect(item?.knowledgeRefs).toEqual([KNOWLEDGE_CLAIM_IDS.physicalWorkGuardrailsPolicy]);
    });

    it('pins the area and intensity boundaries and records only work-added guardrails', () => {
        const guardrails = (work?: PhysicalWorkCheckin) => contextForWork(work).physicalWorkGuardrailsApplied;
        expect(guardrails()).toEqual([]);
        expect(guardrails({ performed: false, intensity: 'exhausting', loadAreas: ['lower_back_spine', 'upper_body'] })).toEqual([]);
        expect(guardrails({ performed: true, intensity: 'moderate', loadAreas: ['lower_back_spine', 'upper_body'] })).toEqual([]);
        expect(guardrails({ performed: true, loadAreas: ['lower_back_spine', 'upper_body'] })).toEqual([]);
        expect(guardrails({ performed: true, intensity: 'hard', loadAreas: ['lower_back_spine'] })).toEqual(['avoid_heavy_spinal_loading']);
        expect(guardrails({ performed: true, intensity: 'hard', loadAreas: ['upper_body', 'grip_forearms'] })).toEqual([]);
        expect(guardrails({ performed: true, intensity: 'exhausting', loadAreas: ['upper_body'] })).toEqual(['avoid_overhead_pressing']);
        expect(guardrails({ performed: true, intensity: 'exhausting', loadAreas: ['grip_forearms'] })).toEqual(['avoid_overhead_pressing']);
        expect(guardrails({ performed: true, intensity: 'exhausting', loadAreas: ['lower_back_spine', 'upper_body'] }))
            .toEqual(['avoid_heavy_spinal_loading', 'avoid_overhead_pressing']);
    });

    it('emits the guardrail claim only when the context adapter applies the work policy', () => {
        const hardBackWork: PhysicalWorkCheckin = { performed: true, intensity: 'hard', loadAreas: ['lower_back_spine'] };
        const readiness: DailyReadiness = { subjective: subjective({ physicalWork: hardBackWork }), objective: NEUTRAL_OBJECTIVE };
        const applied = contextForWork(hardBackWork);
        expect(applied.constraints.impliedGuardrails).toContain('avoid_heavy_spinal_loading');
        expect(readinessKnowledgeRefs(readiness, applied)).toContain(KNOWLEDGE_CLAIM_IDS.physicalWorkGuardrailsPolicy);

        const noArea = contextForWork({ performed: true, intensity: 'hard' });
        expect(readinessKnowledgeRefs(readiness, noArea)).not.toContain(KNOWLEDGE_CLAIM_IDS.physicalWorkGuardrailsPolicy);
    });

    it('keeps the physical-work guardrail provenance trace decision-inert', () => {
        const hardBackWork: PhysicalWorkCheckin = { performed: true, intensity: 'hard', loadAreas: ['lower_back_spine'] };
        const readiness: DailyReadiness = { subjective: subjective({ physicalWork: hardBackWork }), objective: NEUTRAL_OBJECTIVE };
        const tracedContext = contextForWork(hardBackWork);
        const untracedContext = { ...tracedContext, physicalWorkGuardrailsApplied: undefined };

        expect(evaluateEnvelopes(readiness, tracedContext)).toEqual(evaluateEnvelopes(readiness, untracedContext));

        const tracedRecommendation = evaluateTraining(readiness, tracedContext, '2026-08-08');
        const untracedRecommendation = evaluateTraining(readiness, untracedContext, '2026-08-08');
        expect(decisionSurface(tracedRecommendation)).toEqual(decisionSurface(untracedRecommendation));
        expect(tracedRecommendation.knowledgeRefs).toContain(KNOWLEDGE_CLAIM_IDS.physicalWorkGuardrailsPolicy);
        expect(untracedRecommendation.knowledgeRefs).not.toContain(KNOWLEDGE_CLAIM_IDS.physicalWorkGuardrailsPolicy);
    });
});
