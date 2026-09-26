import { describe, expect, it } from 'vitest';
import { resolveDemandProfile } from './eventPresets';
import type { FatigueState, SessionTemplate, UserEvent, UserPreferences } from './models';
import { rankCandidates, type RecentHistoryEntry } from './optimizer';
import { trailingHistoryFromCompletedExposures } from './planner';
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

describe('A Olympic triathlon plan-level taper budget', () => {
    it('resolves Olympic distance from the preset vector and stays scoped to A priority', () => {
        expect(isPriorityAOlympicTriathlon(event)).toBe(true);
        expect(isPriorityAOlympicTriathlon({ ...event, priority: 'B' })).toBe(false);
        expect(isPriorityAOlympicTriathlon({ ...event, demandProfile: resolveDemandProfile('triathlon', 'sprint') })).toBe(false);
        expect(isPriorityAOlympicTriathlon({ ...event, category: 'running_race' })).toBe(false);
    });

    it('derives the 14-day minutes and session ceiling from completed pre-taper exposure', () => {
        const budget = resolveOlympicTriathlonTaperBudget(event, '2026-09-01', [...baseline].reverse());
        expect(OLYMPIC_TRIATHLON_TAPER_MAX_VOLUME_RATIO).toBe(0.59);
        expect(OLYMPIC_TRIATHLON_TAPER_MAX_FREQUENCY_RATIO).toBe(0.85);
        expect(budget).toMatchObject({
            startDate: '2026-08-31', referenceTrainingSessions: 6,
            referenceTrainingMinutes: 330, maxTrainingSessions: 5,
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

    it('limits both taper halves and reserves final slots for missing swim, bike, or run', () => {
        const firstWeek = [...baseline,
            projected('2026-08-31', 'Swimming', 40), projected('2026-09-02', 'Cycling', 40),
        ];
        const firstBudget = resolveOlympicTriathlonTaperBudget(event, '2026-09-04', firstWeek);
        expect(olympicTriathlonTaperExclusion(easyRun, firstBudget, 30)).toBe('OLYMPIC_TRIATHLON_TAPER_PLAN_BUDGET');

        const later = [...firstWeek,
            projected('2026-09-07', 'Running', 30), projected('2026-09-09', 'Swimming', 30),
        ];
        const laterBudget = resolveOlympicTriathlonTaperBudget(event, '2026-09-11', later);
        expect(laterBudget?.usedTrainingSessions).toBe(4);
        expect(olympicTriathlonTaperCandidateCap(easyRun, laterBudget)).toBeLessThan(30);
        expect(olympicTriathlonTaperExclusion(easyRun, laterBudget, 30))
            .toBe('OLYMPIC_TRIATHLON_TAPER_PLAN_BUDGET');

        const missingRun = [...baseline, projected('2026-08-31', 'Swimming', 35),
            projected('2026-09-02', 'Cycling', 35), projected('2026-09-05', 'Swimming', 25),
            projected('2026-09-08', 'Cycling', 25)];
        const reservedBudget = resolveOlympicTriathlonTaperBudget(event, '2026-09-10', missingRun);
        expect(olympicTriathlonTaperExclusion({ ...easyRun, modality: 'Cycling' }, reservedBudget, 30))
            .toBe('OLYMPIC_TRIATHLON_TAPER_MODALITY_RESERVATION');
        expect(olympicTriathlonTaperExclusion(easyRun, reservedBudget, 25)).toBeNull();
    });

    it('reserves two late bike/run touches and bounds race-week swimming to 45 minutes', () => {
        const firstWeek = [...baseline, projected('2026-08-31', 'Swimming', 60), projected('2026-09-01', 'Cycling', 30)];
        const raceWeek = resolveOlympicTriathlonTaperBudget(event, '2026-09-07', firstWeek);
        expect(olympicTriathlonTaperCandidateCap({ ...easyRun, modality: 'Swimming' }, raceWeek)).toBe(45);
        expect(olympicTriathlonTaperBenefitBoost({ ...easyRun, modality: 'Swimming' }, raceWeek)).toBe(1);
        const afterSwim = [...firstWeek, projected('2026-09-07', 'Swimming', 45)];
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
        const firstWeek = [...baseline, projected('2026-08-31', 'Swimming', 60), projected('2026-09-01', 'Cycling', 30)];
        const raceWeek = rankCandidates([swim], [], fatigue,
            { ...availability, date: '2026-09-07', maxTimeMinutes: 75, availableEquipment: ['swim_access'] },
            [], preferences, { date: '2026-09-07', focusEvent: event, recentHistory: firstWeek, taperBudgetHistory: baseline });
        expect(raceWeek.accepted[0].taperDoseAdjustment?.activeDose).toMatchObject({ durationMin: 30, durationMax: 45 });
        const openerHistory = [...firstWeek, projected('2026-09-07', 'Swimming', 45), projected('2026-09-10', 'Running', 25)];
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
});
