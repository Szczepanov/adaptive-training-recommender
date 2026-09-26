import { describe, expect, it } from 'vitest';
import { resolveDemandProfile } from './eventPresets';
import type { DailyReadiness, FatigueState, FixedActivity, SessionTemplate, UserContext, UserEvent, UserPreferences } from './models';
import { KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';
import { createEmptyFatigue } from './fatigue';
import { generateWeeklyObjectives } from './microcycle';
import { rankCandidates, type RecentHistoryEntry } from './optimizer';
import { effectiveTemplateForProjection, evaluateProjectedDate, NEUTRAL_PREFERENCES, trailingHistoryFromCompletedExposures, type ProjectedDatePlanningContext, type ProjectedDateState } from './planner';
import { evaluatePeriodizationPhase } from './periodization';
import { ROLLING_LOAD_BUDGET_POLICY_VERSION } from './rollingLoadBudget';
import { evaluateTrainingWithIntent } from './rules';
import type { ResolvedAvailability } from './schedule';
import type { CompletedExposure } from './trainingHistory';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import {
    isPriorityAOlympicTriathlon,
    OLYMPIC_TRIATHLON_TAPER_MAX_FREQUENCY_RATIO,
    OLYMPIC_TRIATHLON_TAPER_MAX_VOLUME_RATIO,
    olympicTriathlonTaperBenefitBoost,
    olympicTriathlonTaperCandidateCap,
    olympicTriathlonTaperExclusion,
    resolveOlympicTriathlonTaperBudget,
    resolvePriorityAOlympicTriathlonTaper,
    taperHistoryFromFixedActivities,
} from './taperPlanBudget';

const event: UserEvent = {
    id: 'olympic-a', title: 'Local triathlon', date: '2026-09-14', priority: 'A',
    lifecycle: 'scheduled', category: 'triathlon', demandProfile: resolveDemandProfile('triathlon', 'olympic'),
};
const baseline: RecentHistoryEntry[] = [
    ['2026-08-17', 'Swimming', 50], ['2026-08-19', 'Cycling', 60], ['2026-08-22', 'Running', 50],
    ['2026-08-24', 'Swimming', 60], ['2026-08-27', 'Cycling', 50], ['2026-08-29', 'Running', 60],
].map(([date, modality, durationMin]) => ({
    date: date as string, modality: modality as SessionTemplate['modality'],
    category: 'Easy Endurance', durationMin: durationMin as number, systemicCost: 0.25,
}));
const easyRun: SessionTemplate = {
    id: 'easy_run', category: 'Easy Endurance', modality: 'Running', durationMin: 30,
    durationMax: 40, title: 'Easy run', description: 'Synthetic taper exposure.',
    requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.25,
};
const rest: SessionTemplate = {
    ...easyRun, id: 'rest', category: 'Rest', modality: 'None', durationMin: 0,
    durationMax: 0, title: 'Rest', systemicCost: 0,
};
const projected = (date: string, modality: SessionTemplate['modality'], durationMax: number): RecentHistoryEntry => ({
    date, category: 'Easy Endurance', modality, durationMin: 20, durationMax,
    systemicCost: 0.2, source: 'projected',
});
const booked = (id: string, date: string, durationMin: number, templateId?: string): FixedActivity => ({
    id, userId: 'athlete', title: 'Booked session', date, durationMin,
    ...(templateId ? { templateId } : {}),
    expectedCost: { systemic: 0.1 }, fixed: true, isCompleted: false,
    environment: 'either', equipment: [], createdAt: '', updatedAt: '',
});

describe('A Olympic triathlon plan-level taper budget', () => {
    it('resolves Olympic distance from the preset vector and stays scoped to A priority', () => {
        expect(isPriorityAOlympicTriathlon(event)).toBe(true);
        expect(isPriorityAOlympicTriathlon({ ...event, priority: 'B' })).toBe(false);
        expect(isPriorityAOlympicTriathlon({ ...event, demandProfile: resolveDemandProfile('triathlon', 'sprint') })).toBe(false);
        expect(isPriorityAOlympicTriathlon({ ...event, category: 'running_race' })).toBe(false);
    });

    it('keeps athlete-authored non-14-day tapers outside this policy and its D-1 Rest gate', () => {
        const shortTaperEvent: UserEvent = {
            ...event,
            taper: { startDate: '2026-09-09' },
        };
        expect(resolvePriorityAOlympicTriathlonTaper(shortTaperEvent, '2026-09-13')).toBeNull();
        expect(resolveOlympicTriathlonTaperBudget(shortTaperEvent, '2026-09-13', baseline)).toBeNull();

        const fatigue: FatigueState = {
            lastUpdatedDate: '2026-09-13',
            externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        };
        const availability: ResolvedAvailability = {
            date: '2026-09-13', maxTimeMinutes: 60, availableEquipment: [], fixedActivities: [],
            reservedCapacityCost: 0,
            reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            environmentOverride: null,
        };
        const preferences: UserPreferences = {
            userId: 'athlete', preferredRecoveryStyle: 'mixed', preferredModalities: [],
            deprioritizedModalities: [], avoidedModalities: [], conservativeBias: false,
            defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 90, preferredTimeOfDay: 'flexible',
            explanationVerbosity: 'detailed', preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
            schemaVersion: 1, createdAt: '', updatedAt: '',
        };
        const result = rankCandidates([easyRun, rest], [], fatigue, availability, [], preferences, {
            date: '2026-09-13', focusEvent: shortTaperEvent, recentHistory: [],
        });
        expect(result.all.find(candidate => candidate.template.id === easyRun.id)?.excludedReasons)
            .not.toContain('OLYMPIC_TRIATHLON_RACE_EVE_REST');
    });

    it('derives the 14-day minutes and session ceiling from completed pre-taper exposure', () => {
        const budget = resolveOlympicTriathlonTaperBudget(event, '2026-09-01', [...baseline].reverse());
        expect(OLYMPIC_TRIATHLON_TAPER_MAX_VOLUME_RATIO).toBe(0.59);
        expect(OLYMPIC_TRIATHLON_TAPER_MAX_FREQUENCY_RATIO).toBe(0.85);
        expect(budget).toMatchObject({
            startDate: '2026-08-31', referenceTrainingSessions: 6,
            referenceTrainingMinutes: 330, maxTrainingSessions: 6,
            maxTrainingMinutes: 194.7, usedTrainingSessions: 0, usedTrainingMinutes: 0,
        });
    });

    it('counts projected upper prescription minutes but completed delivered minutes', () => {
        const history = [...baseline,
            projected('2026-08-31', 'Swimming', 45),
            { date: '2026-09-01', category: 'Easy Endurance' as const, modality: 'Cycling' as const, durationMin: 30, systemicCost: 0.2 },
        ];
        const budget = resolveOlympicTriathlonTaperBudget(event, '2026-09-02', history);
        expect(budget).toMatchObject({ usedTrainingSessions: 2, usedTrainingMinutes: 75 });
        expect(olympicTriathlonTaperExclusion(easyRun, budget, easyRun.durationMax)).toBe('OLYMPIC_TRIATHLON_TAPER_PLAN_BUDGET');
    });

    it('uses separate wide completed evidence without double-counting operational overlap', () => {
        const todayProjection = { ...projected('2026-08-31', 'Swimming', 45), occurrenceKey: 'recommendation:2026-08-31' };
        const narrowOperational = [...baseline.slice(-2), todayProjection];
        const budget = resolveOlympicTriathlonTaperBudget(event, '2026-09-01', narrowOperational,
            [...baseline, todayProjection]);
        expect(budget).toMatchObject({
            referenceTrainingSessions: 6, referenceTrainingMinutes: 330,
            usedTrainingSessions: 1, usedTrainingMinutes: 45,
        });
    });

    it('excludes an unperformed D-15 projection from the D-14 reference, even with wider history', () => {
        const dayBeforeTaper = {
            ...projected('2026-08-30', 'Cycling', 120),
            occurrenceKey: 'recommendation:2026-08-30',
        };
        const expected = {
            referenceTrainingSessions: 6, referenceTrainingMinutes: 330,
            maxTrainingSessions: 6, maxTrainingMinutes: 194.7,
            usedTrainingSessions: 0,
        };
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-08-31',
            [dayBeforeTaper], baseline)).toMatchObject(expected);
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-08-31',
            [dayBeforeTaper], [...baseline, dayBeforeTaper])).toMatchObject(expected);
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-08-31',
            [...baseline, dayBeforeTaper])).toMatchObject(expected);
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-08-31',
            [...baseline.slice(0, 2), dayBeforeTaper])).toBeNull();
    });

    it('pre-charges same-day and future booked training once, without counting unlinked appointments', () => {
        const sameDaySwim = booked('swim', '2026-08-31', 30, 'swim_easy_01');
        const futureRide = booked('ride', '2026-09-11', 30, 'end_easy_04');
        const unlinked = booked('appointment', '2026-09-10', 60);
        const reservations = taperHistoryFromFixedActivities([futureRide, sameDaySwim, futureRide, unlinked]);
        expect(reservations.map(entry => entry.occurrenceKey)).toEqual(['fixed:ride', 'fixed:swim']);
        const budget = resolveOlympicTriathlonTaperBudget(event, '2026-08-31', baseline, undefined, reservations);
        expect(budget).toMatchObject({
            usedTrainingSessions: 2, usedTrainingMinutes: 60,
            usedBlockSessions: 1, usedBlockMinutes: 30,
        });
        expect(budget?.usedBlockModalities.has('Swimming')).toBe(true);
        expect(budget?.usedLateModalities.has('Cycling')).toBe(true);
        const represented = { ...projected('2026-08-31', 'Swimming', 30), occurrenceKey: 'fixed:swim' };
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-09-01', [...baseline, represented], undefined, reservations))
            .toMatchObject({ usedTrainingSessions: 2, usedTrainingMinutes: 60 });
    });

    it('carries a next-day unperformed prescription at its maximum through the wide-history adapter', () => {
        const projection: CompletedExposure & { source: 'projected'; durationMax: number } = {
            occurrenceKey: 'recommendation:2026-08-31', date: '2026-08-31',
            modality: 'Swimming', category: 'Easy Endurance', templateId: 'swim_easy_01',
            costProfile: { systemic: 0.2, cardiovascular: 0.2, lowerBody: 0.1, upperBody: 0.1, impactTissue: 0, neuromuscular: 0 },
            trainingRecordLike: { type: 'Swimming Easy Endurance', duration_min: 25, training_effect: 0, intensity_tag: '' },
            source: 'projected', durationMax: 45,
        };
        const adapted = trailingHistoryFromCompletedExposures([projection], '2026-09-01');
        expect(adapted[0]).toMatchObject({ source: 'projected', durationMin: 25, durationMax: 45 });
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-09-01', [], [...baseline, ...adapted]))
            .toMatchObject({ usedTrainingMinutes: 45 });
    });

    it('limits both taper halves and reserves one touch of each baseline discipline per block', () => {
        const firstWeek = [...baseline,
            projected('2026-08-31', 'Swimming', 42), projected('2026-09-01', 'Cycling', 30),
        ];
        const firstBudget = resolveOlympicTriathlonTaperBudget(event, '2026-09-02', firstWeek);
        expect(firstBudget?.preserveTwoPerDiscipline).toBe(true);
        expect(olympicTriathlonTaperCandidateCap(easyRun, firstBudget)).toBe(25);
        expect(olympicTriathlonTaperExclusion({ ...easyRun, modality: 'Cycling' }, firstBudget, 30))
            .toBe('OLYMPIC_TRIATHLON_TAPER_PLAN_BUDGET');
        expect(olympicTriathlonTaperExclusion(easyRun, firstBudget, 25)).toBeNull();

        const later = [...firstWeek, projected('2026-09-02', 'Running', 25)];
        const laterBudget = resolveOlympicTriathlonTaperBudget(event, '2026-09-07', later);
        expect(laterBudget?.usedTrainingSessions).toBe(3);
        expect(olympicTriathlonTaperCandidateCap({ ...easyRun, modality: 'Swimming' }, laterBudget)).toBe(42);
        expect(olympicTriathlonTaperCandidateCap({ ...easyRun, modality: 'Strength' }, laterBudget)).toBe(0);

        const secondWeek = [...later, projected('2026-09-07', 'Swimming', 42)];
        const beforeLate = resolveOlympicTriathlonTaperBudget(event, '2026-09-09', secondWeek);
        expect(olympicTriathlonTaperCandidateCap(easyRun, beforeLate)).toBe(0);
        expect(olympicTriathlonTaperCandidateCap({ ...easyRun, modality: 'Swimming' }, beforeLate)).toBe(0);
    });

    it('does not impose a twice-per-discipline pattern on an unbalanced reference block', () => {
        const unbalanced = baseline.map((entry, index) => index === 5
            ? { ...entry, modality: 'Swimming' as const } : entry);
        const budget = resolveOlympicTriathlonTaperBudget(event, '2026-08-31', unbalanced);
        expect(budget).toMatchObject({ maxTrainingSessions: 6, preserveTwoPerDiscipline: false });
        expect(olympicTriathlonTaperCandidateCap({ ...easyRun, modality: 'Swimming' }, budget)).toBeGreaterThan(0);

        const secondBlock = resolveOlympicTriathlonTaperBudget(event, '2026-09-12', [
            ...unbalanced,
            projected('2026-09-07', 'Swimming', 30),
            projected('2026-09-09', 'Running', 25),
            projected('2026-09-11', 'Cycling', 30),
        ]);
        expect(secondBlock).toMatchObject({ usedTrainingSessions: 3, usedBlockSessions: 3 });
        expect(olympicTriathlonTaperCandidateCap(easyRun, secondBlock)).toBe(0);
    });

    it('reserves two late bike/run touches and bounds race-week swimming to 45 minutes', () => {
        const firstWeek = [...baseline, projected('2026-08-31', 'Swimming', 42),
            projected('2026-09-01', 'Cycling', 30), projected('2026-09-02', 'Running', 25)];
        const raceWeek = resolveOlympicTriathlonTaperBudget(event, '2026-09-07', firstWeek);
        expect(olympicTriathlonTaperCandidateCap({ ...easyRun, modality: 'Swimming' }, raceWeek)).toBe(42);
        expect(olympicTriathlonTaperBenefitBoost({ ...easyRun, modality: 'Swimming' }, raceWeek)).toBe(1);
        const afterSwim = [...firstWeek, projected('2026-09-07', 'Swimming', 42)];
        const beforeLate = resolveOlympicTriathlonTaperBudget(event, '2026-09-08', afterSwim);
        expect(olympicTriathlonTaperCandidateCap(easyRun, beforeLate)).toBe(0);
        expect(olympicTriathlonTaperBenefitBoost({ ...easyRun, modality: 'Swimming' }, beforeLate)).toBe(0);

        const late = resolveOlympicTriathlonTaperBudget(event, '2026-09-10', afterSwim);
        expect(olympicTriathlonTaperCandidateCap({ ...easyRun, modality: 'Cycling' }, late)).toBe(30);
        expect(olympicTriathlonTaperCandidateCap(easyRun, late)).toBe(25);
        expect(olympicTriathlonTaperBenefitBoost(easyRun, late)).toBe(0.6);
        const afterRun = [...afterSwim, projected('2026-09-10', 'Running', 25)];
        const opener = ENRICHED_TEMPLATES_BY_ID.get('end_pre_race_openers_01')!;
        const openerDay = resolveOlympicTriathlonTaperBudget(event, '2026-09-11', afterRun);
        expect(olympicTriathlonTaperCandidateCap(opener, openerDay)).toBe(30);
        expect(olympicTriathlonTaperBenefitBoost(opener, openerDay)).toBe(1);
    });

    it('replans against delivered first-week minutes plus current projected upper bounds', () => {
        const completedWeekOne: RecentHistoryEntry[] = [
            { date: '2026-08-31', modality: 'Swimming', category: 'Easy Endurance', durationMin: 30, systemicCost: 0.2 },
            { date: '2026-09-01', modality: 'Cycling', category: 'Easy Endurance', durationMin: 20, systemicCost: 0.2 },
        ];
        const projectedWeekTwo = [projected('2026-09-07', 'Running', 40),
            projected('2026-09-10', 'Cycling', 30), projected('2026-09-11', 'Running', 25)];
        const budget = resolveOlympicTriathlonTaperBudget(event, '2026-09-12', projectedWeekTwo,
            [...baseline, ...completedWeekOne]);
        expect(budget).toMatchObject({
            referenceTrainingMinutes: 330, maxTrainingMinutes: 194.7,
            usedTrainingSessions: 5, usedTrainingMinutes: 145,
        });
        expect(budget!.usedTrainingMinutes).toBeLessThanOrEqual(budget!.maxTrainingMinutes);
    });

    it('does not invent a budget from sparse or unmeasured history', () => {
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-09-02', baseline.slice(0, 2))).toBeNull();
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-09-02', baseline.map(entry => ({ ...entry, durationMin: undefined })))).toBeNull();
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-09-02', [...baseline, { ...projected('2026-09-01', 'Running', 40), durationMax: undefined, durationMin: undefined }])).toBeNull();
        expect(resolveOlympicTriathlonTaperBudget(event, '2026-09-02', [...baseline, { ...projected('2026-09-01', 'Running', 40), durationMax: undefined }])).toBeNull();
    });

    it('passes the bounded swim dose through ranking and makes race eve Rest-only', () => {
        const fatigue: FatigueState = {
            lastUpdatedDate: '2026-09-13',
            externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        };
        const availability: ResolvedAvailability = {
            date: '2026-09-13', maxTimeMinutes: 60, availableEquipment: [], fixedActivities: [],
            reservedCapacityCost: 0,
            reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            environmentOverride: null,
        };
        const preferences: UserPreferences = {
            userId: 'athlete', preferredRecoveryStyle: 'mixed', preferredModalities: [],
            deprioritizedModalities: [], avoidedModalities: [], conservativeBias: false,
            defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 90, preferredTimeOfDay: 'flexible',
            explanationVerbosity: 'detailed', preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
            schemaVersion: 1, createdAt: '', updatedAt: '',
        };
        const swim = ENRICHED_TEMPLATES_BY_ID.get('swim_easy_01')!;
        const firstWeek = [...baseline, projected('2026-08-31', 'Swimming', 42),
            projected('2026-09-01', 'Cycling', 30), projected('2026-09-02', 'Running', 25)];
        const raceWeek = rankCandidates([swim], [], fatigue,
            { ...availability, date: '2026-09-07', maxTimeMinutes: 75, availableEquipment: ['swim_access'] },
            [], preferences, { date: '2026-09-07', focusEvent: event, recentHistory: firstWeek, taperBudgetHistory: baseline });
        expect(raceWeek.accepted[0].taperDoseAdjustment?.activeDose).toMatchObject({ durationMin: 30, durationMax: 42 });
        const openerHistory = [...firstWeek, projected('2026-09-07', 'Swimming', 42), projected('2026-09-10', 'Running', 25)];
        const opener = ENRICHED_TEMPLATES_BY_ID.get('end_pre_race_openers_01')!;
        const openerRanking = rankCandidates([opener], [], fatigue,
            { ...availability, date: '2026-09-11', availableEquipment: ['outdoor_bike'] },
            [], preferences, { date: '2026-09-11', focusEvent: event, recentHistory: openerHistory, taperBudgetHistory: baseline });
        expect(openerRanking.accepted[0].taperDoseAdjustment?.activeDose).toMatchObject({ durationMin: 20, durationMax: 30 });
        const result = rankCandidates([easyRun, rest], [], fatigue, availability, [], preferences,
            { date: '2026-09-13', focusEvent: event, recentHistory: [] });
        expect(result.accepted.map(candidate => candidate.template.id)).toEqual(['rest']);
        expect(result.rejected[0].excludedReasons).toContain('OLYMPIC_TRIATHLON_RACE_EVE_REST');
    });

    it('attributes D-1 Rest only to the exact 14-day Olympic taper policy scope', async () => {
        const readiness: DailyReadiness = {
            subjective: {
                readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2,
                motivation: 8, timeAvailable: 60, painFlag: false,
                alreadyTrainedToday: false, preferredModalityToday: null,
            },
            objective: {
                total_steps: 8000, sleep_score: 85, sleep_duration_min: 480,
                rhr: 50, rhr_7d_avg: 50, rhr_delta: 0, hrv_weekly_avg: 50,
                hrv_last_night: 50, hrv_delta: 0, respiration: 14,
                body_battery_wake: 90, last_3_days_hard_sessions_count: 0,
                yesterday_training: null, today_training: null,
                sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0,
                sleep_score_delta_28d: 0, hrv_stdev_28d: 8,
                rhr_stdev_28d: 3, sleep_score_stdev_28d: 7,
            },
        };
        const context: UserContext = {
            goals: { shortTerm: '', midTerm: '', longTerm: '' },
            constraints: {
                hasCableMachine: false, hasFreeWeights: false, hasTreadmill: false,
                hasIndoorBike: false, restrictedModalities: [], maxTimeMinutes: 60,
            },
            preferences: {
                avoidedModalities: [], deprioritizedModalities: [],
                preferredModalities: [], conservativeBias: false,
            },
        };
        const recommendation = await evaluateTrainingWithIntent(
            'athlete', readiness, context, [event], '2026-09-13', undefined,
            { reconstruct: async () => [] },
        );
        expect(recommendation.template.category).toBe('Rest');
        expect(recommendation.knowledgeRefs).toContain(KNOWLEDGE_CLAIM_IDS.olympicTriathlonPlanBudgetPolicy);

        const authoredShortTaperRecommendation = await evaluateTrainingWithIntent(
            'athlete', readiness, context, [{ ...event, taper: { startDate: '2026-09-09' } }],
            '2026-09-13', undefined, { reconstruct: async () => [] },
        );
        expect(authoredShortTaperRecommendation.knowledgeRefs)
            .not.toContain(KNOWLEDGE_CLAIM_IDS.olympicTriathlonPlanBudgetPolicy);
    });

    it('admits a swim to the rolling load budget using its taper dose cost', () => {
        const context: UserContext = {
            goals: { shortTerm: '', midTerm: '', longTerm: '' },
            preferences: {
                avoidedModalities: [], deprioritizedModalities: [],
                preferredModalities: [], conservativeBias: false,
            },
            constraints: {
                hasCableMachine: false, hasFreeWeights: false, hasTreadmill: false,
                hasIndoorBike: false, restrictedModalities: [], maxTimeMinutes: 90,
            },
            trainingSettings: {
                userId: 'athlete', schemaVersion: 3,
                equipment: {
                    free_weights: false, cable_machine: false, treadmill: false,
                    indoor_bike: false, pullup_bar: false, outdoor_bike: false, swim_access: true,
                },
                guardrails: {
                    avoid_high_impact: false, avoid_heavy_lower_body: false,
                    avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false,
                },
                defaults: { weekdayMaxMinutes: 90, weekendMaxMinutes: 90, environment: 'either' },
                preferences: { preferActiveRecovery: false },
                migration: { legacyReviewed: true, migratedAt: null },
                createdAt: '', updatedAt: '',
            },
        };
        const date = '2026-09-07';
        const phase = evaluatePeriodizationPhase([event], date, '2026-09-06').phase;
        const projectedHistory = [
            projected('2026-08-31', 'Swimming', 42),
            projected('2026-09-01', 'Cycling', 30),
            projected('2026-09-02', 'Running', 25),
        ];
        const state: ProjectedDateState = {
            microcycle: generateWeeklyObjectives(phase, date, event),
            externalFatigue: createEmptyFatigue('2026-09-06'),
            projectedHistory,
        };
        const shared: ProjectedDatePlanningContext = {
            context, preferences: NEUTRAL_PREFERENCES,
            events: [event], fixedActivities: [], authoredPlanBlocks: [], scheduleOverlays: [],
            anchors: { eventSpecificAnchorDate: null, qualityAnchorDate: null },
            internalStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            internalStrainAsOf: '2026-09-06', todayDate: '2026-09-06',
            taperBudgetHistory: baseline,
            rollingLoadBudgetProfile: {
                policyVersion: ROLLING_LOAD_BUDGET_POLICY_VERSION,
                confidence: 'established', baselineSessionCount: 6,
                baselineWindowStartDate: '2026-07-20', baselineWindowEndDate: '2026-08-30',
                limits: { systemic: 0.27, cardiovascular: 10, lowerBody: 10, upperBody: 10, impactTissue: 10, neuromuscular: 10 },
            },
            rollingLoadBudgetHorizonStartDate: date,
            rollingLoadBudgetHorizonEndDate: '2026-09-13',
        };
        const evaluation = evaluateProjectedDate(date, state, shared);
        const swim = ENRICHED_TEMPLATES_BY_ID.get('swim_easy_01')!;
        expect(effectiveTemplateForProjection(swim).costProfile!.systemic).toBeGreaterThan(0.27);
        expect(evaluation.eligible.map(template => template.id)).toContain(swim.id);
        expect(evaluation.loadBudgetExcludedTemplateIds).not.toContain(swim.id);
        expect(evaluation.rank([swim]).accepted[0]?.taperDoseAdjustment?.activeDose.durationMax).toBe(42);

        const withBookedTraining = evaluateProjectedDate(date, state, {
            ...shared,
            fixedActivities: [
                booked('swim-today', date, 30, 'swim_easy_01'),
                booked('ride-later', '2026-09-11', 30, 'end_easy_04'),
                booked('nontraining', '2026-09-09', 45),
            ],
            rollingLoadBudgetProfile: { ...shared.rollingLoadBudgetProfile!, confidence: 'provisional' },
        });
        expect(withBookedTraining.optimizationContext.options.taperFixedReservations).toHaveLength(2);
        expect(withBookedTraining.rank([swim]).rejected[0]?.excludedReasons)
            .toContain('OLYMPIC_TRIATHLON_TAPER_PLAN_BUDGET');
    });
});
