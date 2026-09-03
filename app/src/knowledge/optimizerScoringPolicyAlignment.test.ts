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

function cyclingEvent(priority: 'A' | 'B', date = '2026-09-20'): UserEvent {
    return {
        id: `event-${priority}-${date}`,
        title: `${priority} cycling event`,
        date,
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

function strengthEvent(priority: 'A' | 'B', date = '2026-09-20'): UserEvent {
    return {
        id: `strength-event-${priority}-${date}`,
        title: `${priority} strength event`,
        date,
        priority,
        lifecycle: 'scheduled',
        category: 'strength_meet',
        demandProfile: {
            aerobicEndurance: 0.1,
            thresholdPower: 0.1,
            vo2MaxPower: 0.1,
            repeatedSurges: 0.1,
            sprintPower: 0.3,
            fatigueResistance: 0.3,
            neuromuscular: 0.9,
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

function objective(
    key: WeeklyObjective['key'],
    targetStimulus: WeeklyObjective['targetStimulus'],
    allowedModality: SessionTemplate['modality'],
): WeeklyObjective {
    return {
        id: `obj-${key}`,
        key,
        title: `Objective ${key}`,
        targetExposures: 1,
        completedExposures: 0,
        targetStimulus,
        qualification: { allowedModalities: [allowedModality] },
    };
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

    it('pins extra-recovery and conservative-bias cost penalties to production rankCandidates behavior', () => {
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
        const extraMargin = rankCandidates(
            [template], [], mockFatigueState(), AVAILABILITY, [],
            { ...PREFERENCES, extraRecoveryMargin: true },
            { date: '2026-09-10' },
        );
        const conservative = rankCandidates(
            [template], [], mockFatigueState(), AVAILABILITY, [],
            { ...PREFERENCES, conservativeBias: true },
            { date: '2026-09-10' },
        );
        const conservativeWithMarginDisabled = rankCandidates(
            [template], [], mockFatigueState(), AVAILABILITY, [],
            { ...PREFERENCES, conservativeBias: true, extraRecoveryMargin: false },
            { date: '2026-09-10' },
        );

        expect(baseline.accepted[0].costPenalty).toBe(0);
        expect(extraMargin.accepted[0].costPenalty).toBeCloseTo(0.3, 5);
        expect(conservative.accepted[0].costPenalty).toBeCloseTo(0.65, 5);
        expect(conservativeWithMarginDisabled.accepted[0].costPenalty).toBeCloseTo(0.35, 5);
    });

    it('pins objective multipliers and both stimulus-benefit fallback branches to production', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.stimulusBenefitWeightsPolicy);
        expect(claim.status).toBe('active');
        expect(claim.statement).toContain('1.5 for thresholdPower, repeatedSurges and vo2MaxPower');
        expect(claim.statement).toContain('1.2 for aerobicEndurance and fatigueResistance');
        expect(claim.statement).toContain('1.6 * max(target.maxStrength, target.hypertrophy) * max(stimulus.maxStrength, stimulus.hypertrophy)');
        expect(claim.statement).toContain('sprintPower has no dedicated objective-benefit term');
        expect(claim.statement).toContain('Technical Skill returns 0.3');
        expect(claim.statement).toContain('min(0.75, 0.45 + 0.2*(aerobicEndurance + thresholdPower))');

        expect(calculateStimulusBenefit(mockTemplate({ category: 'Rest', stimulusProfile: undefined }), [])).toBe(0.1);
        expect(calculateStimulusBenefit(mockTemplate({ category: 'Mobility/Recovery', stimulusProfile: undefined }), [])).toBe(0.2);
        expect(calculateStimulusBenefit(mockTemplate({ category: 'Technical Skill', stimulusProfile: undefined }), [])).toBe(0.3);
        expect(calculateStimulusBenefit(mockTemplate({ category: 'Easy Endurance', stimulusProfile: undefined }), [])).toBe(0.45);
        expect(calculateStimulusBenefit(mockTemplate({
            stimulusProfile: {
                aerobicEndurance: 0.5,
                thresholdPower: 0.5,
                vo2MaxPower: 0,
                repeatedSurges: 0,
                sprintPower: 0,
                fatigueResistance: 0,
                maxStrength: 0,
                hypertrophy: 0,
            },
        }), [])).toBeCloseTo(0.65, 5);
        expect(calculateStimulusBenefit(mockTemplate({
            stimulusProfile: {
                aerobicEndurance: 1,
                thresholdPower: 1,
                vo2MaxPower: 0,
                repeatedSurges: 0,
                sprintPower: 0,
                fatigueResistance: 0,
                maxStrength: 0,
                hypertrophy: 0,
            },
        }), [])).toBe(0.75);

        const profile = (axis: 'thresholdPower' | 'repeatedSurges' | 'vo2MaxPower' | 'aerobicEndurance' | 'fatigueResistance' | 'maxStrength' | 'hypertrophy' | 'sprintPower') => ({
            aerobicEndurance: axis === 'aerobicEndurance' ? 0.8 : 0,
            thresholdPower: axis === 'thresholdPower' ? 0.8 : 0,
            vo2MaxPower: axis === 'vo2MaxPower' ? 0.8 : 0,
            repeatedSurges: axis === 'repeatedSurges' ? 0.8 : 0,
            sprintPower: axis === 'sprintPower' ? 0.8 : 0,
            fatigueResistance: axis === 'fatigueResistance' ? 0.8 : 0,
            maxStrength: axis === 'maxStrength' ? 0.8 : 0,
            hypertrophy: axis === 'hypertrophy' ? 0.8 : 0,
        });

        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Hard Endurance', stimulusProfile: profile('thresholdPower') }),
            [objective('threshold_quality', { thresholdPower: 0.8 }, 'Cycling')],
        )).toBeCloseTo(0.8 * 0.8 * 1.5 + 0.5, 5);
        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Hard Endurance', stimulusProfile: profile('repeatedSurges') }),
            [objective('surge_repeatability', { repeatedSurges: 0.8 }, 'Cycling')],
        )).toBeCloseTo(0.8 * 0.8 * 1.5 + 0.5, 5);
        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Hard Endurance', stimulusProfile: profile('vo2MaxPower') }),
            [objective('vo2_max', { vo2MaxPower: 0.8 }, 'Cycling')],
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
        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Full-body Strength', modality: 'Strength', stimulusProfile: profile('hypertrophy') }),
            [objective('strength_development', { maxStrength: 0.8 }, 'Strength')],
        )).toBeCloseTo(0.8 * 0.8 * 1.6 + 0.5, 5);
        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Hard Endurance', stimulusProfile: profile('sprintPower') }),
            [objective('surge_repeatability', { sprintPower: 0.8 }, 'Cycling')],
        )).toBe(0.5);
        expect(calculateStimulusBenefit(
            mockTemplate({ category: 'Easy Endurance', modality: 'Cycling', stimulusProfile: profile('aerobicEndurance') }),
            [objective('threshold_quality', { thresholdPower: 0.8 }, 'Running')],
        )).toBe(0.5);
    });

    it('pins all event-priority and horizon multipliers to production rankCandidates behavior', () => {
        const easy = mockTemplate({ stimulusProfile: undefined });
        const baseline = rankCandidates([easy], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, { date: '2026-09-10' });
        const aEvent = rankCandidates([easy], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', focusEvent: cyclingEvent('A'),
        });
        const bEvent = rankCandidates([easy], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', focusEvent: cyclingEvent('B'),
        });
        expect(aEvent.accepted[0].benefitScore).toBeCloseTo(baseline.accepted[0].benefitScore * 1.40, 5);
        expect(bEvent.accepted[0].benefitScore).toBeCloseTo(baseline.accepted[0].benefitScore * 1.25, 5);

        const raceSpecific = mockTemplate({
            id: 'race-specific-test',
            category: 'Race-Specific Endurance',
            systemicCost: 0.3,
            stimulusProfile: undefined,
        });
        const bSecondRaceSpecific = rankCandidates([raceSpecific], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10',
            focusEvent: cyclingEvent('B'),
            recentHistory: [{
                date: '2026-09-06',
                category: 'Race-Specific Endurance',
                modality: 'Cycling',
                systemicCost: 0.3,
                type: 'Cycling',
            }],
        });
        expect(bSecondRaceSpecific.accepted[0].benefitScore).toBeCloseTo(0.45 * 1.25 * 0.35, 5);

        const longHorizon = rankCandidates([raceSpecific], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', focusEvent: cyclingEvent('A', '2026-10-10'),
        });
        expect(longHorizon.accepted[0].benefitScore).toBeCloseTo(0.45 * 1.40 * 0.50, 5);

        const running = mockTemplate({ modality: 'Running', stimulusProfile: undefined });
        const nonMatching = rankCandidates(
            [running],
            [objective('threshold_quality', { thresholdPower: 0.8 }, 'Cycling')],
            mockFatigueState(),
            AVAILABILITY,
            [],
            PREFERENCES,
            { date: '2026-09-10', focusEvent: cyclingEvent('A') },
        );
        expect(nonMatching.accepted[0].benefitScore).toBeCloseTo(0.45 * 0.20, 5);

        const strength = mockTemplate({
            id: 'strength-event-test',
            category: 'Full-body Strength',
            modality: 'Strength',
            stimulusProfile: {
                aerobicEndurance: 0,
                thresholdPower: 0,
                vo2MaxPower: 0,
                repeatedSurges: 0,
                sprintPower: 0,
                fatigueResistance: 0,
                maxStrength: 0.8,
                hypertrophy: 0,
            },
        });
        const strengthNoObjective = rankCandidates([strength], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', focusEvent: strengthEvent('A'),
        });
        expect(strengthNoObjective.accepted[0].benefitScore).toBeCloseTo(0.45, 5);

        const strengthObjective = [objective('strength_development', { maxStrength: 0.8 }, 'Strength')];
        const strengthBaseline = rankCandidates([strength], strengthObjective, mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10',
        });
        const strengthWithAEvent = rankCandidates([strength], strengthObjective, mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', focusEvent: strengthEvent('A'),
        });
        expect(strengthWithAEvent.accepted[0].benefitScore).toBeCloseTo(strengthBaseline.accepted[0].benefitScore * 1.40, 5);

        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.eventPriorityMultipliersPolicy);
        expect(claim.statement).toContain('1.40 for an A-priority event and 1.25 for a B-priority event');
        expect(claim.statement).toContain('for strength_meet, that priority boost applies only when the candidate satisfies an unresolved objective');
        expect(claim.statement).toContain('multiplied by 0.35');
        expect(claim.statement).toContain('multiplied by 0.50');
        expect(claim.statement).toContain('multiplied by 0.20');
    });

    it('pins recovery alternation, recovery-streak, and prior-high-intensity multipliers to production ranking', () => {
        const easy = mockTemplate({ stimulusProfile: undefined });
        const rest = mockTemplate({ id: 'rest-test', category: 'Rest', modality: 'None', systemicCost: 0, costProfile: undefined, stimulusProfile: undefined });
        const mobility = mockTemplate({ id: 'mobility-test', category: 'Mobility/Recovery', modality: 'Mobility', systemicCost: 0, costProfile: undefined, stimulusProfile: undefined });
        const streak3 = hardStreakHistory(3);
        const streak4 = hardStreakHistory(4);

        const easyNoStreak = rankCandidates([easy], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', recentHistory: [],
        });
        const easyAt3 = rankCandidates([easy], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', recentHistory: streak3,
        });
        const easyAt4 = rankCandidates([easy], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', recentHistory: streak4,
        });
        const restAt3 = rankCandidates([rest], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', recentHistory: streak3,
        });

        expect(easyNoStreak.accepted[0].utilityScore).toBeCloseTo(0.45 * 1.25, 5);
        expect(easyAt3.accepted[0].utilityScore).toBeCloseTo(0.45 * 0.3, 5);
        expect(easyAt4.accepted[0].utilityScore).toBeCloseTo(0.45 * 0.1, 5);
        expect(restAt3.accepted[0].utilityScore).toBeCloseTo(0.1 * 2.0, 5);

        const mixedPreferences = { ...PREFERENCES, preferredRecoveryStyle: 'mixed' as const };
        const mobilityAfterNoRecovery = rankCandidates([mobility], [], mockFatigueState(), AVAILABILITY, [], mixedPreferences, {
            date: '2026-09-10', recentHistory: [],
        });
        expect(mobilityAfterNoRecovery.accepted[0].utilityScore).toBeCloseTo(0.2 * 1.4, 5);

        const restAfterMobility = rankCandidates([rest], [], mockFatigueState(), AVAILABILITY, [], mixedPreferences, {
            date: '2026-09-10',
            recentHistory: [{
                date: '2026-09-09',
                category: 'Mobility/Recovery',
                modality: 'Mobility',
                systemicCost: 0,
                lowerBodyCost: 0,
                type: 'Mobility',
            }],
        });
        expect(restAfterMobility.accepted[0].utilityScore).toBeCloseTo(0.1 * 1.4, 5);

        const highIntensity = mockTemplate({
            systemicCost: 0.5,
            stimulusProfile: undefined,
            costProfile: {
                systemic: 0,
                cardiovascular: 0,
                lowerBody: 0,
                upperBody: 0,
                impactTissue: 0,
                neuromuscular: 0,
            },
        });
        const noPriorHigh = rankCandidates([highIntensity], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10', recentHistory: [],
        });
        const afterHigh = rankCandidates([highIntensity], [], mockFatigueState(), AVAILABILITY, [], PREFERENCES, {
            date: '2026-09-10',
            recentHistory: [{
                date: '2026-09-09',
                modality: 'Cycling',
                category: 'Moderate Endurance',
                systemicCost: 0.5,
                lowerBodyCost: 0.2,
                type: 'Cycling',
            }],
        });
        expect(noPriorHigh.accepted[0].utilityScore).toBeCloseTo(0.45 * 1.25, 5);
        expect(afterHigh.accepted[0].utilityScore).toBeCloseTo(noPriorHigh.accepted[0].utilityScore * 0.35, 5);

        const streakClaim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.recoveryStreakHeuristicsPolicy);
        expect(streakClaim.statement).toContain('mixed recovery style');
        expect(streakClaim.statement).toContain('multiplied by 1.40');
        expect(streakClaim.statement).toContain('aerobic defaults are multiplied by 1.25');
        expect(streakClaim.statement).toContain('Rest/Mobility is multiplied by 2.0');
        expect(streakClaim.statement).toContain('0.35x multiplier');
    });
});
