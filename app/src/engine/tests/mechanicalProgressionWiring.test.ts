import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEvergreenMechanicalProgression, resolveEvergreenPlan, type EvergreenMechanicalInputs } from '../evergreenPlanning';
import { evaluateNextDayPlanWithIntent, evaluateTrainingWithIntent } from '../rules';
import { generateWeekAheadPlanWithIntent } from '../planner';
import { resolveTrainingIntent } from '../trainingIntent';
import { runScenario } from '../simulation/analyze';
import { firestoreMechanicalCheckinHistoryProvider } from '../firestoreMechanicalCheckinHistory';
import { firestoreTrainingHistoryProvider } from '../firestoreTrainingHistory';
import type { AthleteScenario } from '../simulation/scenarios';
import { addDaysToLocalDateString } from '../../utils/localDate';
import type { CheckinRecord } from '../mechanicalProgression';
import type { CompletedExposure, TrainingHistoryProvider } from '../trainingHistory';
import type { TrainingHistorySnapshot } from '../trainingHistorySnapshot';
import type {
    DailyReadiness,
    DailySubjectiveCheckin,
    TrainingIntentProfile,
    UserContext,
    UserPreferences,
} from '../models';

/**
 * Issue #804 follow-up: the mechanical progression authority must receive (1) structured
 * tissue check-ins from every live planning entry point, (2) exposure evidence spanning the
 * 14-day continuity window rather than the 7-day operational window, and (3) the evergreen
 * target-stage policy. These tests pin the orchestration wiring, not the evaluator itself.
 */

vi.mock('../evergreenPlanning', async importOriginal => {
    const actual = await importOriginal<typeof import('../evergreenPlanning')>();
    return { ...actual, resolveEvergreenPlan: vi.fn(actual.resolveEvergreenPlan) };
});

vi.mock('../firestoreMechanicalCheckinHistory', () => ({
    firestoreMechanicalCheckinHistoryProvider: { getCheckins: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../firestoreTrainingHistory', () => ({
    firestoreTrainingHistoryProvider: {
        reconstruct: vi.fn().mockResolvedValue([]),
        getSnapshot: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../training-occurrence/performedTrainingFactsService', () => ({
    getPerformedTrainingFactsInRange: vi.fn().mockResolvedValue(null),
}));

const DATE = '2026-09-20';
const MECHANICAL_ARGUMENT_INDEX = 14;

const profile: TrainingIntentProfile = {
    userId: 'u1', planningMode: 'evergreen', priorities: ['sport_readiness'],
    weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
};
const preferences: UserPreferences = {
    userId: 'u1', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};
const context: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: true, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
};

function readiness(): DailyReadiness {
    return {
        subjective: {
            readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 3, motivation: 8,
            timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        },
        objective: {
            total_steps: 8000, sleep_score: 85, sleep_duration_min: 450, rhr: 48, rhr_7d_avg: 49, rhr_delta: -1,
            hrv_weekly_avg: 55, hrv_last_night: 57, hrv_delta: 2, respiration: 13, body_battery_wake: 85,
            last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
            sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 8,
        },
    };
}

function exposure(date: string, workoutId: string): CompletedExposure {
    return {
        occurrenceKey: `${workoutId}:${date}`,
        date,
        workoutId,
        modality: 'Running',
        category: 'Easy Endurance',
        stimulusConfidence: 'exact',
        costProfile: { systemic: 0.25, cardiovascular: 0.35, lowerBody: 0.2, upperBody: 0, impactTissue: 0.3, neuromuscular: 0.1 },
        trainingRecordLike: { type: 'Running aerobic endurance', duration_min: 40, training_effect: 2, intensity_tag: 'easy' },
    };
}

function normalFollowUp(date: string): CheckinRecord {
    const checkin = {
        userId: 'u1', date, readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, mentalStress: 2, motivation: 8,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: `${date}T07:00:00.000Z`,
        tissueResponses: { knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' } },
    } as DailySubjectiveCheckin;
    return { date, checkin };
}

function windowed(exposures: readonly CompletedExposure[], throughDateExclusive: string, windowDays: number): CompletedExposure[] {
    const startDate = addDaysToLocalDateString(throughDateExclusive, -windowDays);
    return exposures.filter(item => item.date >= startDate && item.date < throughDateExclusive);
}

function snapshot(exposures: readonly CompletedExposure[], throughDateExclusive: string, windowDays: number): TrainingHistorySnapshot {
    return {
        throughDateExclusive,
        windowDays,
        completedEvents: [],
        exposures: windowed(exposures, throughDateExclusive, windowDays),
        sourceStates: {
            activities: { status: 'AVAILABLE', revision: 'a' },
            recommendations: { status: 'AVAILABLE', revision: 'r' },
            manualTraining: { status: 'MISSING' },
        },
        generatedAt: '2026-09-20T05:00:00Z',
        revision: `test-${throughDateExclusive}-${windowDays}`,
    };
}

function provider(exposures: readonly CompletedExposure[], withSnapshot: boolean): TrainingHistoryProvider {
    return {
        reconstruct: vi.fn(async (_userId: string, through: string, windowDays: number) => windowed(exposures, through, windowDays)),
        ...(withSnapshot
            ? { getSnapshot: vi.fn(async (_userId: string, through: string, windowDays: number) => snapshot(exposures, through, windowDays)) }
            : {}),
    };
}

function mechanicalInputsOfEveryCall(): EvergreenMechanicalInputs[] {
    return vi.mocked(resolveEvergreenPlan).mock.calls.map(call => call[MECHANICAL_ARGUMENT_INDEX] as EvergreenMechanicalInputs);
}

const GUARDRAILS = new Set<never>();
// Stage 2 (linear running) performed 10 days before DATE: inside the 14-day continuity
// window, outside the 7-day operational window.
const TEN_DAYS_AGO = exposure('2026-09-10', 'running_easy_continuous_01');

beforeEach(() => {
    vi.mocked(resolveEvergreenPlan).mockClear();
    vi.mocked(firestoreMechanicalCheckinHistoryProvider.getCheckins).mockReset().mockResolvedValue([]);
    vi.mocked(firestoreTrainingHistoryProvider.reconstruct).mockClear();
});

describe('mechanical exposure evidence spans the 14-day continuity window', () => {
    it('keeps an exposure 10 days ago instead of treating it as a >=14-day re-entry gap', async () => {
        const intent = await resolveTrainingIntent(
            'u1', [], DATE, readiness(), 7, provider([TEN_DAYS_AGO], true), undefined, [], profile,
        );

        expect(intent.history).toEqual([]);
        expect(intent.mechanicalExposureHistory.map(item => item.date)).toEqual(['2026-09-10']);

        // The wider evidence must not leak into operational fatigue or objective bookkeeping.
        const withoutOlderExposure = await resolveTrainingIntent(
            'u1', [], DATE, readiness(), 7, provider([], true), undefined, [], profile,
        );
        expect(intent.fatigue).toEqual(withoutOlderExposure.fatigue);
        expect(intent.microcycle).toEqual(withoutOlderExposure.microcycle);
        expect(intent.unresolvedObjectives).toEqual(withoutOlderExposure.unresolvedObjectives);

        const fixed = resolveEvergreenMechanicalProgression(DATE, intent.mechanicalExposureHistory, [], GUARDRAILS);
        expect(fixed).toMatchObject({ stage: 2, lastExposureDate: '2026-09-10', recentExposureCount: 1 });

        // The pre-fix input (7-day operational history) reset this athlete to Stage 1.
        const defective = resolveEvergreenMechanicalProgression(DATE, intent.history, [], GUARDRAILS);
        expect(defective).toMatchObject({ stage: 1, recentExposureCount: 0 });
    });

    it('reconstructs the window from a snapshot-less provider', async () => {
        const history = provider([TEN_DAYS_AGO], false);

        const intent = await resolveTrainingIntent('u1', [], DATE, readiness(), 7, history, undefined, [], profile);

        expect(history.reconstruct).toHaveBeenCalledWith('u1', DATE, 28);
        expect(intent.mechanicalExposureHistory.map(item => item.date)).toEqual(['2026-09-10']);
    });

    it('spends no wider read for an evergreen intent that cannot emit a mechanical requirement', async () => {
        const history = provider([TEN_DAYS_AGO], false);
        const healthProfile: TrainingIntentProfile = { ...profile, priorities: ['health'] };

        const intent = await resolveTrainingIntent('u1', [], DATE, readiness(), 7, history, undefined, [], healthProfile);

        expect(history.reconstruct).not.toHaveBeenCalledWith('u1', DATE, 28);
        expect(intent.mechanicalExposureHistory).toEqual(intent.history);
    });
});

describe('live planning entry points supply check-ins and wide exposure evidence', () => {
    const checkins = [normalFollowUp('2026-09-11')];

    it('evaluateTrainingWithIntent forwards explicit check-ins and a mechanical evidence window spanning continuity', async () => {
        await evaluateTrainingWithIntent(
            'u1', readiness(), context, [], DATE, undefined, provider([TEN_DAYS_AGO], true), null, [], [], profile, preferences,
            'max', null, 'off', undefined, null, false, [], new Map(), undefined, checkins,
        );

        const [mechanical] = mechanicalInputsOfEveryCall();
        expect(mechanical.checkinHistory).toEqual(checkins);
        expect(mechanical.exposureHistory?.map(item => item.date)).toEqual(['2026-09-10']);
        expect(firestoreMechanicalCheckinHistoryProvider.getCheckins).not.toHaveBeenCalled();
    });

    it('evaluateTrainingWithIntent reads the default provider when no history provider is injected', async () => {
        vi.mocked(firestoreMechanicalCheckinHistoryProvider.getCheckins).mockResolvedValueOnce(checkins.map(record => record.checkin));

        await evaluateTrainingWithIntent(
            'u1', readiness(), context, [], DATE, undefined, undefined, snapshot([], DATE, 7), [], [], profile, preferences,
        );

        expect(firestoreMechanicalCheckinHistoryProvider.getCheckins).toHaveBeenCalledWith('u1', '2026-09-06', '2026-09-21');
        expect(mechanicalInputsOfEveryCall()[0].checkinHistory).toEqual(checkins);
    });

    it('an injected history provider keeps the call self-contained', async () => {
        await evaluateTrainingWithIntent(
            'u1', readiness(), context, [], DATE, undefined, provider([], true), null, [], [], profile, preferences,
        );

        expect(firestoreMechanicalCheckinHistoryProvider.getCheckins).not.toHaveBeenCalled();
        expect(mechanicalInputsOfEveryCall()[0].checkinHistory).toEqual([]);
    });

    it('generateWeekAheadPlanWithIntent reads the default provider and honours an explicit option', async () => {
        const todayRec = await evaluateTrainingWithIntent(
            'u1', readiness(), context, [], DATE, undefined, provider([], true), null, [], [], profile, preferences,
        );
        vi.mocked(resolveEvergreenPlan).mockClear();
        vi.mocked(firestoreMechanicalCheckinHistoryProvider.getCheckins).mockResolvedValueOnce(checkins.map(record => record.checkin));

        await generateWeekAheadPlanWithIntent(
            'u1', readiness(), context, preferences, [], DATE, todayRec, null, { days: 7 }, undefined, snapshot([], DATE, 7), profile,
        );
        expect(firestoreMechanicalCheckinHistoryProvider.getCheckins).toHaveBeenCalledWith('u1', '2026-09-06', '2026-09-21');
        expect(mechanicalInputsOfEveryCall()[0].checkinHistory).toEqual(checkins);

        vi.mocked(resolveEvergreenPlan).mockClear();
        const explicit = [normalFollowUp('2026-09-12')];
        await generateWeekAheadPlanWithIntent(
            'u1', readiness(), context, preferences, [], DATE, todayRec, null,
            { days: 7, mechanicalCheckinHistory: explicit }, provider([TEN_DAYS_AGO], true), null, profile,
        );
        const [mechanical] = mechanicalInputsOfEveryCall();
        expect(mechanical.checkinHistory).toEqual(explicit);
        expect(mechanical.exposureHistory?.map(item => item.date)).toEqual(['2026-09-10']);
    });

    it('evaluateNextDayPlanWithIntent widens the projected history and forwards check-ins to every branch', async () => {
        const history = provider([exposure('2026-09-11', 'running_easy_continuous_01')], false);
        const todayRec = await evaluateTrainingWithIntent(
            'u1', readiness(), context, [], DATE, undefined, history, null, [], [], profile, preferences,
        );
        vi.mocked(resolveEvergreenPlan).mockClear();

        await evaluateNextDayPlanWithIntent(
            'u1', [], readiness(), context, DATE, todayRec, history, null, [], [], profile, preferences,
            'max', 'off', undefined, [], checkins,
        );

        const calls = mechanicalInputsOfEveryCall();
        expect(calls).toHaveLength(3);
        for (const mechanical of calls) {
            expect(mechanical.checkinHistory).toEqual(checkins);
            // 2026-09-11 is 10 days before tomorrow (2026-09-21): only a widened projection sees it.
            expect(mechanical.exposureHistory?.some(item => item.date === '2026-09-11')).toBe(true);
        }
    });
});

describe('projected next-day mechanical evidence', () => {
    it('represents today only by projections, never by a reconstructed actual as well', async () => {
        const todayActual = { ...exposure(DATE, 'running_walk_run_01'), occurrenceKey: 'actual-today' };
        const history = provider([exposure('2026-09-11', 'running_easy_continuous_01'), todayActual], false);
        const todayRec = await evaluateTrainingWithIntent(
            'u1', readiness(), context, [], DATE, undefined, history, null, [], [], profile, preferences,
        );
        vi.mocked(resolveEvergreenPlan).mockClear();

        await evaluateNextDayPlanWithIntent(
            'u1', [], readiness(), context, DATE, todayRec, history, null, [], [], profile, preferences,
            'max', 'off', undefined, [], [],
        );

        for (const mechanical of mechanicalInputsOfEveryCall()) {
            expect(mechanical.exposureHistory?.some(item => item.occurrenceKey === 'actual-today')).toBe(false);
            expect(mechanical.exposureHistory?.some(item => item.date === '2026-09-11')).toBe(true);
        }
    });

    it('falls back to the operational window when the wider read fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const older = exposure('2026-09-11', 'running_easy_continuous_01');
        const history: TrainingHistoryProvider = {
            reconstruct: vi.fn(async (_userId: string, through: string, windowDays: number) => {
                if (windowDays > 7) throw new Error('offline');
                return windowed([older], through, windowDays);
            }),
        };
        const todayRec = await evaluateTrainingWithIntent(
            'u1', readiness(), context, [], DATE, undefined, provider([older], false), null, [], [], profile, preferences,
        );
        vi.mocked(resolveEvergreenPlan).mockClear();

        const plan = await evaluateNextDayPlanWithIntent(
            'u1', [], readiness(), context, DATE, todayRec, history, null, [], [], profile, preferences,
            'max', 'off', undefined, [], [],
        );

        expect(plan.branches.green.recommendation).toBeDefined();
        for (const mechanical of mechanicalInputsOfEveryCall()) {
            expect(mechanical.exposureHistory?.some(item => item.date === '2026-09-11')).toBe(false);
        }
        warn.mockRestore();
    });
});

describe('simulation scenarios can supply check-in history', () => {
    it('threads scenario check-ins to every decision and reaches Stage 2 from two tolerated Stage-1 exposures', async () => {
        const initialHistory = [
            exposure('2026-09-15', 'running_walk_run_01'),
            exposure('2026-09-17', 'running_walk_run_01'),
        ];
        const mechanicalCheckinHistory = [normalFollowUp('2026-09-16'), normalFollowUp('2026-09-18')];
        const scenario: AthleteScenario = {
            id: 'mechanical_progression_probe',
            label: 'Mechanical progression probe',
            description: 'Two tolerated walk-run exposures with explicit normal follow-up.',
            context,
            trainingIntentProfile: profile,
            preferences,
            startDate: DATE,
            initialHistory,
            mechanicalCheckinHistory,
            weeks: 1,
            readinessForWeek: readiness,
        };

        await runScenario(scenario);

        const calls = mechanicalInputsOfEveryCall();
        expect(calls.length).toBeGreaterThanOrEqual(5);
        for (const mechanical of calls) expect(mechanical.checkinHistory).toEqual(mechanicalCheckinHistory);

        const firstDecision = calls[0];
        const verdict = resolveEvergreenMechanicalProgression(
            DATE, firstDecision.exposureHistory ?? [], firstDecision.checkinHistory ?? [], GUARDRAILS,
        );
        expect(verdict).toMatchObject({ stage: 2, status: 'eligible' });
        expect(verdict.eligibleWorkoutIds).toContain('strength_reactive_power_01');
        expect(verdict.eligibleWorkoutIds).not.toContain('field_acceleration_braking_01');
    });

    it('holds Stage 1 when the scenario supplies no follow-up evidence', async () => {
        const scenario: AthleteScenario = {
            id: 'mechanical_progression_missing_probe',
            label: 'Mechanical progression without check-ins',
            description: 'Same exposures, no follow-up evidence.',
            context,
            trainingIntentProfile: profile,
            preferences,
            startDate: DATE,
            initialHistory: [exposure('2026-09-15', 'running_walk_run_01'), exposure('2026-09-17', 'running_walk_run_01')],
            weeks: 1,
            readinessForWeek: readiness,
        };

        await runScenario(scenario);

        const firstDecision = mechanicalInputsOfEveryCall()[0];
        expect(firstDecision.checkinHistory).toEqual([]);
        const verdict = resolveEvergreenMechanicalProgression(DATE, firstDecision.exposureHistory ?? [], [], GUARDRAILS);
        expect(verdict).toMatchObject({ stage: 1 });
        expect(verdict.tissueResponse.verdict).toBe('missing');
        expect(vi.mocked(firestoreTrainingHistoryProvider.reconstruct)).not.toHaveBeenCalled();
    });
});
