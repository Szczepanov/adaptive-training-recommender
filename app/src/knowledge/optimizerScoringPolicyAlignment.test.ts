import { describe, expect, it } from 'vitest';
import type { FatigueState, SessionTemplate, UserEvent, UserPreferences, WeeklyObjective } from '../engine/models';
import type { ResolvedAvailability } from '../engine/schedule';
import {
    calculateFatigueCostPenalty,
    calculateStimulusBenefit,
    rankCandidates,
    type OptimizationOptions,
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
        },
        ...overrides,
    } as SessionTemplate;
}

const AVAILABILITY = {
    date: '2026-09-10',
    maxTimeMinutes: 60,
    availableEquipment: [],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: {
        systemic: 0,
        cardiovascular: 0,
        lowerBody: 0,
        upperBody: 0,
        impactTissue: 0,
        neuromuscular: 0,
    },
    environmentOverride: null,
} as ResolvedAvailability;

const PREFERENCES = {
    userId: 'alignment-test',
    avoidedModalities: [],
    deprioritizedModalities: [],
    preferredModalities: [],
    conservativeBias: false,
    preferredRecoveryStyle: 'active',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible',
    explanationVerbosity: 'detailed',
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
} as UserPreferences;

function cyclingEvent(priority: 'A' | 'B'): UserEvent {
    return {
        id: `event-${priority}`,
        title: `${priority} cycling event`,
        date: '2026-09-20',
        priority,
        lifecycle: 'scheduled',
        category: 'cycling_event',
        demandProfile: {
            aerobicEndurance: 0.7,
            thresholdPower: 0.5,
            vo2MaxPower: 0.3,
            repeatedSurges: 0.4,
            sprintPower: 0.2,
            fatigueResistance: 0.6,
            neuromuscular: 0.2,
        },
    } as UserEvent;
}

function hardStreakHistory(length: number): NonNullable<OptimizationOptions['recentHistory']> {
    return Array.from({ length }, (_, index) => ({
        date: `2026-09-${String(9 - index).padStart(2, '0')}`,
        modality: 'Cycling',
        category: 'Moderate Endurance' as const,
        systemicCost: 0.4,
        lowerBodyCost: 0.2,
        type: 'Cycling',
    }));
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

    it('pins the extra-recovery margin penalty to production rankCandidates behavior', () => {
        const template = mockTemplate({
            systemicCost: 0.6,
            costProfile: {
                systemic: 0,
                cardiovascular: 0,
                lowerBody: 0,
                upperBody: 0,
                impactTissue: 0,
                neuromuscular: 0,
            },
        });
        const baseline = rankCandidates([template], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, { date: '2026-09-10' });
        const conservative = rankCandidates(
            [template], [], mockFatigueState(), AVAILABILITY, [],
            { ...PREFERENCES, extraRecoveryMargin: true },
            { date: '2026-09-10' },
        );
        expect(baseline.accepted[0].costPenalty).toBe(0);
        expect(conservative.accepted[0].costPenalty).toBeCloseTo(0.3, 5);
    });

    it('pins all objective stimulus-benefit multipliers and exact baselines to production calculateStimulusBenefit', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.stimulusBenefitWeightsPolicy);
        expect(claim.status).toBe('active');
        expect(claim.statement).toContain('1.5 for thresholdPower, repeatedSurges and vo2MaxPower');
        expect(claim.statement).toContain('1.2 for aerobicEndurance and fatigueResistance');
        expect(claim.statement).toContain('1.6 for maxStrength or hypertrophy');

        expect(calculateStimulusBenefit(mockTemplate({ category: 'Rest', stimulusProfile: undefined }), [])).toBe(0.1);
        expect(calculateStimulusBenefit(mockTemplate({ category: 'Mobility/Recovery', stimulusProfile: undefined }), [])).toBe(0.2);
        expect(calculateStimulusBenefit(mockTemplate({ category: 'Easy Endurance', stimulusProfile: undefined }), [])).toBe(0.5);

        const objective = (key: WeeklyObjective['key'], targetStimulus: WeeklyObjective['targetStimulus'], allowedModality: SessionTemplate['modality']): WeeklyObjective => ({
            id: `obj-${key}`,
            key,
            title: `Objective ${key}`,
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus,
            qualification: { allowedModalities: [allowedModality] },
        });
        const profile = (axis: 'thresholdPower' | 'aerobicEndurance' | 'fatigueResistance' | 'maxStrength' | 'hypertrophy') => ({
            aerobicEndurance: axis === 'aerobicEndurance' ? 0.8 : 0,
            thresholdPower: axis === 'thresholdPower' ? 0.8 : 0,
            vo2MaxPower: 0,
            repeatedSurges: 0,
            sprintPower: 0,
            fatigueResistance: axis === 'fatigueResistance' ? 0.8 : 0,
            maxStrength: axis === 'maxStrength' ? 0.8 : 0,
            hypertrophy: axis === 'hypertrophy' ? 0.8 : 0,
        });

        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Hard Endurance', stimulusProfile: profile('thresholdPower') }),
            [objective('threshold_quality', { thresholdPower: 0.8 }, 'Cycling')],
        )).toBeCloseTo(0.8 * 0.8 * 1.5 + 0.5, 5);
        expect(calculateStimulusBenefit(
            mockTemplate({ stimulusProfile: profile('aerobicEndurance') }),
            [objective('zone2_aerobic', { aerobicEndurance: 0.8 }, 'Cycling')],
        )).toBeCloseTo(0.8 * 0.8 * 1.2 + 0.5, 5);
        expect(calculateStimulusBenefit(
            mockTemplate({ stimulusProfile: profile('fatigueResistance') }),
            [objective('race_specific_endurance', { fatigueResistance: 0.8 }, 'Cycling')],
        )).toBeCloseTo(0.8 * 0.8 * 1.2 + 0.5, 5);
        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Full-body Strength', modality: 'Strength', stimulusProfile: profile('maxStrength') }),
            [objective('strength_development', { maxStrength: 0.8 }, 'Strength')],
        )).toBeCloseTo(0.8 * 0.8 * 1.6 + 0.5, 5);
        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Full-body Strength', modality: 'Strength', stimulusProfile: profile('hypertrophy') }),
            [objective('strength_development', { hypertrophy: 0.8 }, 'Strength')],
        )).toBeCloseTo(0.8 * 0.8 * 1.6 + 0.5, 5);
    });

    it('pins A/B event-priority multipliers to production rankCandidates behavior', () => {
        const template = mockTemplate({ stimulusProfile: undefined });
        const baseline = rankCandidates([template], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, { date: '2026-09-10' });
        const aEvent = rankCandidates([template], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', focusEvent: cyclingEvent('A'),
        });
        const bEvent = rankCandidates([template], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', focusEvent: cyclingEvent('B'),
        });

        expect(aEvent.accepted[0].benefitScore).toBeCloseTo(baseline.accepted[0].benefitScore * 1.40, 5);
        expect(bEvent.accepted[0].benefitScore).toBeCloseTo(baseline.accepted[0].benefitScore * 1.25, 5);
    });

    it('pins recovery-streak 0.3/0.1 suppression and 2.0 recovery boost to production ranking', () => {
        const easy = mockTemplate({ stimulusProfile: undefined });
        const rest = mockTemplate({ id: 'rest-test', category: 'Rest', modality: 'None', systemicCost: 0, costProfile: undefined, stimulusProfile: undefined });
        const streak3 = hardStreakHistory(3);
        const streak4 = hardStreakHistory(4);

        const easyAt3 = rankCandidates([easy], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', recentHistory: streak3,
        });
        const easyAt4 = rankCandidates([easy], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', recentHistory: streak4,
        });
        const restAt3 = rankCandidates([rest], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', recentHistory: streak3,
        });

        expect(easyAt3.accepted[0].utilityScore).toBeCloseTo(0.5 * 0.3, 5);
        expect(easyAt4.accepted[0].utilityScore).toBeCloseTo(0.5 * 0.1, 5);
        expect(restAt3.accepted[0].utilityScore).toBeCloseTo(0.1 * 2.0, 5);

        const priorityClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.eventPriorityMultipliersPolicy);
        expect(priorityClaim.statement).toContain('1.40 for A-priority events and 1.25 for B-priority events');
        const streakClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.recoveryStreakHeuristicsPolicy);
        expect(streakClaim.statement).toContain('Rest/Mobility is boosted by 2.0x while aerobic defaults are multiplied by 0.3 (or 0.1 at streak >= 4)');
        expect(streakClaim.statement).toContain('0.35x penalty multiplier');
    });
});
