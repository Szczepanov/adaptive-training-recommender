import { describe, expect, it } from 'vitest';
import type { DailyReadiness, FatigueState, SessionTemplate, UserPreferences } from './models';
import type { ResolvedAvailability } from './schedule';
import type { CompletedExposure } from './trainingHistory';
import { rankCandidates, type RecentHistoryEntry } from './optimizer';
import { prepareWeekAheadPlanSeed, projectFatigueForRankingDate, realizedSessionRole } from './planner';
import { ENRICHED_TEMPLATES } from './templates';

const ZERO_DIMS = {
    systemic: 0,
    cardiovascular: 0,
    lowerBody: 0,
    upperBody: 0,
    impactTissue: 0,
    neuromuscular: 0,
};

const ZERO_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-03-01',
    externalLoadFatigue: { ...ZERO_DIMS },
    internalResponseStrain: { ...ZERO_DIMS },
    combinedFatigue: { ...ZERO_DIMS },
};

const AVAILABILITY: ResolvedAvailability = {
    date: '2026-03-02',
    maxTimeMinutes: 180,
    availableEquipment: ['free_weights', 'indoor_bike', 'treadmill', 'cable_machine', 'pullup_bar'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { ...ZERO_DIMS },
    environmentOverride: null,
};

const PREFERENCES: UserPreferences = {
    userId: 'review-test',
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 120,
    preferredTimeOfDay: 'flexible',
    preferredModalities: [],
    deprioritizedModalities: [],
    avoidedModalities: [],
    explanationVerbosity: 'detailed',
    conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
};

const FRESH_READINESS: DailyReadiness = {
    subjective: {
        readiness: 9,
        sleepQuality: 9,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 9,
        timeAvailable: 90,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
    },
    objective: {
        total_steps: 8000,
        sleep_score: 90,
        sleep_duration_min: 480,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 50,
        hrv_last_night: 50,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 90,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: null,
        today_training: null,
        sleep_score_delta_7d: 0,
        rhr_delta_28d: 0,
        hrv_delta_28d: 0,
        sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5,
        rhr_stdev_28d: 3.5,
        sleep_score_stdev_28d: 7.8,
    },
};

describe('Phase 3 review regressions', () => {
    it('does not make every candidate an anchor just because the date is a nominated quality day', () => {
        const rest = ENRICHED_TEMPLATES.find(template => template.category === 'Rest')!;
        const history: RecentHistoryEntry[] = [{
            date: '2026-03-01',
            templateId: 'prior-key-session',
            modality: 'Cycling',
            category: 'Hard Endurance',
            role: 'anchor',
            systemicCost: 0.8,
            lowerBodyCost: 0.5,
        }];

        const result = rankCandidates(
            [rest], [], ZERO_FATIGUE, AVAILABILITY, [], PREFERENCES,
            { date: '2026-03-02', anchorRole: 'quality', recentHistory: history },
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].template.category).toBe('Rest');
        expect(result.accepted[0].excludedReasons).not.toContain('QUALITY_SPACING_VIOLATION');
    });

    it('only applies the consecutive-day repetition penalty to the exact same template', () => {
        const base = ENRICHED_TEMPLATES.find(template => template.category === 'Easy Endurance')!;
        const sibling: SessionTemplate = { ...base, id: 'review-sibling-template', title: 'Review sibling template' };
        const yesterdayDifferentTemplate: RecentHistoryEntry[] = [{
            date: '2026-03-01',
            templateId: 'another-template-in-same-category',
            category: sibling.category,
            modality: sibling.modality,
            systemicCost: 0.2,
            lowerBodyCost: 0.1,
        }];
        const yesterdayExactTemplate: RecentHistoryEntry[] = [{
            ...yesterdayDifferentTemplate[0],
            templateId: sibling.id,
        }];

        const unseeded = rankCandidates(
            [sibling], [], ZERO_FATIGUE, AVAILABILITY, [], PREFERENCES,
            { date: '2026-03-02' },
        ).accepted[0].utilityScore;
        const sameCategory = rankCandidates(
            [sibling], [], ZERO_FATIGUE, AVAILABILITY, [], PREFERENCES,
            { date: '2026-03-02', recentHistory: yesterdayDifferentTemplate },
        ).accepted[0].utilityScore;
        const exactRepeat = rankCandidates(
            [sibling], [], ZERO_FATIGUE, AVAILABILITY, [], PREFERENCES,
            { date: '2026-03-02', recentHistory: yesterdayExactTemplate },
        ).accepted[0].utilityScore;

        expect(sameCategory).toBeCloseTo(unseeded, 8);
        expect(exactRepeat).toBeLessThan(unseeded);
    });

    it('decays external load to the target date before a projected session is ranked', () => {
        const loaded: FatigueState = {
            lastUpdatedDate: '2026-03-01',
            externalLoadFatigue: {
                systemic: 1,
                cardiovascular: 1,
                lowerBody: 1,
                upperBody: 1,
                impactTissue: 1,
                neuromuscular: 1,
            },
            internalResponseStrain: { ...ZERO_DIMS },
            combinedFatigue: {
                systemic: 1,
                cardiovascular: 1,
                lowerBody: 1,
                upperBody: 1,
                impactTissue: 1,
                neuromuscular: 1,
            },
        };

        const sameDay = projectFatigueForRankingDate(loaded, ZERO_DIMS, '2026-03-01', '2026-03-01');
        const nextDay = projectFatigueForRankingDate(loaded, ZERO_DIMS, '2026-03-01', '2026-03-02');

        expect(sameDay.externalLoadFatigue.systemic).toBeCloseTo(1, 8);
        expect(nextDay.externalLoadFatigue.systemic).toBeLessThan(sameDay.externalLoadFatigue.systemic);
        expect(nextDay.externalLoadFatigue.systemic).toBeGreaterThan(0);
        expect(nextDay.combinedFatigue.systemic).toBe(nextDay.externalLoadFatigue.systemic);
    });

    it('records a nominated date as an anchor only when the realized pick fulfils the role', () => {
        const anchors = {
            eventSpecificAnchorDate: '2026-03-05',
            qualityAnchorDate: '2026-03-03',
        };
        const rest = ENRICHED_TEMPLATES.find(template => template.category === 'Rest')!;
        const raceSpecific = ENRICHED_TEMPLATES.find(template =>
            template.modality === 'Cycling' && template.category === 'Race-Specific Endurance'
        )!;
        const quality = ENRICHED_TEMPLATES.find(template =>
            template.modality === 'Cycling'
            && (template.category === 'Hard Endurance' || template.category === 'Moderate Endurance')
        )!;

        expect(realizedSessionRole('2026-03-05', rest, anchors)).toBe('supporting');
        expect(realizedSessionRole('2026-03-05', raceSpecific, anchors)).toBe('anchor');
        expect(realizedSessionRole('2026-03-03', quality, anchors)).toBe('anchor');
    });

    it('preserves completed external load and exact objective credit when history is mixed', () => {
        const completedStrength: CompletedExposure = {
            date: '2026-03-01',
            modality: 'Strength',
            category: 'Full-body Strength',
            costProfile: {
                systemic: 0.8,
                cardiovascular: 0.2,
                lowerBody: 0.8,
                upperBody: 0.7,
                impactTissue: 0.1,
                neuromuscular: 0.8,
            },
            stimulusProfile: {
                aerobicEndurance: 0,
                thresholdPower: 0,
                vo2MaxPower: 0,
                repeatedSurges: 0,
                sprintPower: 0,
                fatigueResistance: 0,
                maxStrength: 1,
                hypertrophy: 0.8,
            },
            trainingRecordLike: {
                type: 'Strength Full-body Strength',
                duration_min: 60,
                training_effect: 3,
                intensity_tag: 'hard',
            },
        };
        const lightweightCycling: RecentHistoryEntry = {
            date: '2026-02-28',
            modality: 'Cycling',
            category: 'Hard Endurance',
            systemicCost: 0.7,
            lowerBodyCost: 0.5,
        };

        const seed = prepareWeekAheadPlanSeed(
            FRESH_READINESS,
            [],
            '2026-03-02',
            [completedStrength, lightweightCycling],
        );
        const strengthObjective = seed.microcycle.objectives.find(objective => objective.key === 'strength_maintenance');

        expect(seed.trailingHistory).toHaveLength(2);
        expect(seed.fatigue.externalLoadFatigue.systemic).toBeGreaterThan(0);
        expect(seed.fatigue.externalLoadFatigue.lowerBody).toBeGreaterThan(0);
        expect(strengthObjective).toBeDefined();
        expect(strengthObjective!.completedExposures).toBeGreaterThanOrEqual(strengthObjective!.targetExposures);
    });
});
