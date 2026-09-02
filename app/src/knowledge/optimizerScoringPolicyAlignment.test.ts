import { describe, expect, it } from 'vitest';
import type { FatigueState, SessionTemplate, WeeklyObjective } from '../engine/models';
import {
    calculateFatigueCostPenalty,
    calculateStimulusBenefit,
} from '../engine/optimizer';
import {
    getActiveKnowledgeClaim,
    KNOWLEDGE_CLAIM_IDS,
    validateCanonicalSportsKnowledgeRegistry,
} from './sportsKnowledgeRegistry';

function mockFatigueState(overrides: Partial<FatigueState['combinedFatigue']> = {}): FatigueState {
    const fatigue = {
        systemic: 0,
        cardiovascular: 0,
        lowerBody: 0,
        upperBody: 0,
        impactTissue: 0,
        neuromuscular: 0,
        ...overrides,
    };
    return {
        lastUpdatedDate: '2026-09-01',
        externalLoadFatigue: fatigue,
        internalResponseStrain: fatigue,
        combinedFatigue: fatigue,
    };
}

function mockTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
    return {
        id: 'mock-template',
        title: 'Mock Template',
        description: 'Mock',
        category: 'Easy Endurance',
        modality: 'Cycling',
        durationMin: 45,
        durationMax: 60,
        requiredEquipment: [],
        environment: 'either',
        safetyTags: [],
        systemicCost: 0.3,
        objectiveTransferable: true,
        costProfile: {
            systemic: 0.3,
            cardiovascular: 0.3,
            lowerBody: 0.3,
            upperBody: 0,
            impactTissue: 0,
            neuromuscular: 0.2,
        },
        stimulusProfile: {
            aerobicEndurance: 0.5,
            thresholdPower: 0,
            vo2MaxPower: 0,
            repeatedSurges: 0,
            sprintPower: 0,
            fatigueResistance: 0.3,
            maxStrength: 0,
            hypertrophy: 0,
            neuromuscular: 0.1,
        },
        ...overrides,
    } as SessionTemplate;
}

describe('optimizer scoring product-claim alignment (SKR3 W2a)', () => {
    it('passes canonical sports knowledge registry validation with optimizer scoring claims included', () => {
        const result = validateCanonicalSportsKnowledgeRegistry();
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('pins the fatigue-cost penalty weights claim to production calculateFatigueCostPenalty', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.fatigueCostWeightsPolicy);
        expect(claim.status).toBe('active');
        expect(claim.evidenceCertainty).toBe('not_applicable');
        expect(claim.statement).toContain('systemic 2.0, cardiovascular 1.5, lower-body 2.5, upper-body 1.5, impact-tissue 2.0 and neuromuscular 1.8');

        // Test each dimension's unit multiplier independently
        const costProfile = {
            systemic: 1,
            cardiovascular: 1,
            lowerBody: 1,
            upperBody: 1,
            impactTissue: 1,
            neuromuscular: 1,
        };

        expect(calculateFatigueCostPenalty(costProfile, mockFatigueState({ systemic: 1 }))).toBeCloseTo(2.0, 5);
        expect(calculateFatigueCostPenalty(costProfile, mockFatigueState({ cardiovascular: 1 }))).toBeCloseTo(1.5, 5);
        expect(calculateFatigueCostPenalty(costProfile, mockFatigueState({ lowerBody: 1 }))).toBeCloseTo(2.5, 5);
        expect(calculateFatigueCostPenalty(costProfile, mockFatigueState({ upperBody: 1 }))).toBeCloseTo(1.5, 5);
        expect(calculateFatigueCostPenalty(costProfile, mockFatigueState({ impactTissue: 1 }))).toBeCloseTo(2.0, 5);
        expect(calculateFatigueCostPenalty(costProfile, mockFatigueState({ neuromuscular: 1 }))).toBeCloseTo(1.8, 5);

        // All dimensions combined
        const total = 2.0 + 1.5 + 2.5 + 1.5 + 2.0 + 1.8;
        expect(calculateFatigueCostPenalty(costProfile, mockFatigueState({
            systemic: 1,
            cardiovascular: 1,
            lowerBody: 1,
            upperBody: 1,
            impactTissue: 1,
            neuromuscular: 1,
        }))).toBeCloseTo(total, 5);
    });

    it('pins the stimulus-benefit weights claim to production calculateStimulusBenefit', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.stimulusBenefitWeightsPolicy);
        expect(claim.status).toBe('active');
        expect(claim.statement).toContain('1.5 for thresholdPower, repeatedSurges and vo2MaxPower');
        expect(claim.statement).toContain('1.2 for aerobicEndurance and fatigueResistance');
        expect(claim.statement).toContain('1.6 for maxStrength or hypertrophy');

        // Rest template returns 0.1
        const restTemplate = mockTemplate({ category: 'Rest', stimulusProfile: undefined });
        expect(calculateStimulusBenefit(restTemplate, [])).toBe(0.1);

        // Mobility/Recovery with no unresolved objectives returns 0.2
        const mobilityTemplate = mockTemplate({ category: 'Mobility/Recovery', stimulusProfile: undefined });
        expect(calculateStimulusBenefit(mobilityTemplate, [])).toBe(0.2);

        // Threshold objective benefit test (target 0.8 * stimulus 0.8 * 1.5 multiplier + 0.5 baseline = 1.46)
        const thresholdObj: WeeklyObjective = {
            id: 'obj-threshold',
            key: 'threshold_quality',
            title: 'Threshold Dev',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { thresholdPower: 0.8 },
            qualification: { allowedModalities: ['Cycling'] },
        };
        const thresholdTemplate = mockTemplate({
            category: 'Hard Endurance',
            stimulusProfile: {
                aerobicEndurance: 0.2,
                thresholdPower: 0.8,
                vo2MaxPower: 0,
                repeatedSurges: 0,
                sprintPower: 0,
                fatigueResistance: 0,
                maxStrength: 0,
                hypertrophy: 0,
            },
        });
        const benefit = calculateStimulusBenefit(thresholdTemplate, [thresholdObj]);
        expect(benefit).toBeCloseTo(0.8 * 0.8 * 1.5 + 0.5, 5);
    });

    it('pins the event priority and streak heuristics constants to production values', () => {
        const priorityClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.eventPriorityMultipliersPolicy);
        expect(priorityClaim.status).toBe('active');
        expect(priorityClaim.statement).toContain('1.40 for A-priority events and 1.25 for B-priority events');
        expect(priorityClaim.statement).toContain('0.35');
        expect(priorityClaim.statement).toContain('0.50');
        expect(priorityClaim.statement).toContain('0.20');

        const streakClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.recoveryStreakHeuristicsPolicy);
        expect(streakClaim.status).toBe('active');
        expect(streakClaim.statement).toContain('consecutive non-recovery training streaks (systemicCost >= 0.40)');
        expect(streakClaim.statement).toContain('Rest/Mobility is boosted by 2.0x while aerobic defaults are multiplied by 0.3 (or 0.1 at streak >= 4)');
        expect(streakClaim.statement).toContain('0.35x penalty multiplier');
    });
});
