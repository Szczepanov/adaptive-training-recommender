import { describe, expect, it } from 'vitest';
import type {
    AuthoredPlanBlock,
    DailyRecommendation,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    FixedActivity,
    TrainingSettings,
    UserGoal,
    UserPreferences,
} from './models';
import {
    enhanceContextBriefForPlanning,
    type ContextBriefPlanningHandoffInput,
} from './contextBriefPlanningHandoff';

const AS_OF = '2026-08-20';
const BASE = `# Training context brief

Window: 2026-08-07 → 2026-08-20 (14 days).

## 1. Constraints

- Equipment available: indoor bike

## 2. Objective recovery (wearable)

- HRV: 60

## 3. Completed training (recorded by the wearable)

No recorded sessions in this window.

## 4. Subjective reports (self-scored each morning, 1–10)

No check-ins in this window.

## 5. Plan adherence

No recommendations recorded in this window.

## 6. Goals & training intent

- Priorities, in order: endurance

## Requested output

Design the next training block using the above.`;

function snapshot(date = AS_OF): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date,
        source: {
            garminSyncedAt: `${date}T05:20:00Z`,
            sourceSchemaVersion: 3,
            metricDates: {
                sleep: date,
                hrv: date,
                restingHr: date,
                stress: date,
                steps: '2026-08-19',
                activitiesThrough: date,
            },
        },
        raw: {
            sleepScore: 88,
            sleepDurationSec: 28_000,
            restingHr: 44,
            hrvOvernightAvg: 70,
            hrvStatus: 'balanced',
            respirationAvg: 13,
            bodyBatteryWake: 82,
            bodyBatteryChange: 40,
            totalSteps: 9_000,
            last3DaysHardSessionsCount: 1,
            yesterdayTraining: null,
            stress: { avg: 22, max: 48 },
        },
        derived: {
            baselineComputationVersion: 5,
            sleepScore7dAvg: 82,
            sleepScore28dAvg: 80,
            restingHr7dAvg: 45,
            restingHr28dAvg: 46,
            hrv7dAvg: 66,
            hrv28dAvg: 64,
            respiration7dAvg: 13,
            respiration28dAvg: 13,
            deltas: {
                sleepScoreVs7d: 6,
                sleepScoreVs28d: 8,
                restingHrVs7d: -1,
                restingHrVs28d: -2,
                hrvVs7d: 4,
                hrvVs28d: 6,
                respirationVs7d: 0,
                respirationVs28d: 0,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true,
            restingHrAvailable: true,
            hrvAvailable: true,
            baseline7dReady: true,
            baseline28dReady: true,
        },
    };
}

function checkin(date = AS_OF): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date,
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 3,
        mentalStress: 2,
        motivation: 9,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 90, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: `${date}T05:40:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: `${date}T05:40:00Z`,
        updatedAt: `${date}T05:40:00Z`,
    };
}

function recommendation(): DailyRecommendation {
    return {
        userId: 'u1',
        date: AS_OF,
        templateId: 'z2',
        templateTitle: 'Zone 2 ride',
        category: 'Easy Endurance',
        modality: 'Cycling',
        mode: 'train',
        rationale: 'ready',
        schemaVersion: 3,
        createdAt: `${AS_OF}T06:00:00Z`,
        updatedAt: `${AS_OF}T06:00:00Z`,
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
    };
}

function fixedActivity(): FixedActivity {
    return {
        id: 'match-1',
        userId: 'u1',
        title: '6v6 football',
        date: '2026-08-22',
        startTime: '19:00',
        durationMin: 90,
        fixed: true,
        environment: 'outdoor',
        equipment: [],
        isCompleted: false,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
    };
}

function travelBlock(): AuthoredPlanBlock {
    return {
        id: 'travel-1',
        userId: 'u1',
        phase: 'travel',
        startDate: '2026-08-23',
        endDate: '2026-08-25',
        volumeScale: 0.65,
        intensityScale: 0.8,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
    };
}

function handoffInput(overrides: Partial<ContextBriefPlanningHandoffInput> = {}): ContextBriefPlanningHandoffInput {
    return {
        asOfDate: AS_OF,
        snapshots: [snapshot()],
        checkins: [checkin()],
        activities: [],
        recommendations: [recommendation()],
        trainingSettings: null,
        preferences: null,
        planningMode: 'externally_planned',
        externalFallback: false,
        eventStrategy: null,
        goals: [],
        upcomingFixedActivities: [fixedActivity()],
        upcomingPlanBlocks: [],
        upcomingExternalSessions: [{
            date: '2026-08-21',
            planId: 'p1',
            planTitle: 'Race prep',
            revision: 2,
            sessionId: 's1',
            title: 'Threshold quality',
            priority: 'key',
            modality: 'cycling',
            intensity: 'hard',
            durationMin: 60,
            durationMax: 75,
            flexibility: 'preferred',
            status: 'planned',
            moved: false,
            isEvent: false,
            prescription: {
                summary: '3 x 10 min threshold with controlled recovery',
                steps: [
                    { name: 'Warm-up', durationMin: 15, target: 'easy' },
                    { name: 'Threshold', sets: 3, durationMin: 10, target: 'RPE 7–8', recoverySec: 240 },
                    { name: 'Cool-down', durationMin: 10, target: 'easy' },
                ],
            },
        }],
        unavailableSources: [],
        ...overrides,
    };
}

describe('enhanceContextBriefForPlanning', () => {
    it('turns the copied brief into context rather than an unconditional plan command', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput());

        expect(text).toContain('Use this as context for the conversation, not as a standalone command');
        expect(text).toContain('Answer the user\'s actual question');
        expect(text).not.toContain('## Requested output');
        expect(text).toContain('### If the user asks for an importable schedule');
        expect(text).toContain('### Day YYYY-MM-DD: <Session Name>');
    });

    it('puts source failures inside the copied text and says absence means unknown', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            unavailableSources: ['recorded activities', 'future fixed activities'],
        }));

        expect(text).toContain('DATA INCOMPLETE');
        expect(text).toContain('recorded activities; future fixed activities');
        expect(text).toContain('means "unknown", not "none"');
    });

    it('exports data freshness, resolved planning mode and the app recommendation without making it authoritative', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput());

        expect(text).toContain('Effective planning mode today: externally_planned');
        expect(text).toContain('Garmin sync timestamp 2026-08-20T05:20:00Z');
        expect(text).toContain('activities through 2026-08-20');
        expect(text).toContain('App recommendation for 2026-08-20: train — Zone 2 ride (Cycling)');
        expect(text).toContain('not as authority over current symptoms or tissue response');
    });

    it('explains an authority-resolved external fallback instead of pretending the persisted mode is effective', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            planningMode: 'evergreen',
            externalFallback: true,
        }));

        expect(text).toContain('Effective planning mode today: evergreen (external-plan fallback today: no imported session is placed on this date)');
        expect(text).toContain('imported sessions later in this horizon remain authoritative');
    });

    it('exports sensor capability and planning preferences so prescriptions are executable', () => {
        const trainingSettings = {
            capabilities: { powerMeter: true, heartRateMonitor: true, cadenceData: false },
        } as TrainingSettings;
        const preferences = {
            preferredRecoveryStyle: 'active',
            preferredTimeOfDay: 'morning',
            conservativeBias: true,
            extraRecoveryMargin: false,
        } as UserPreferences;
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({ trainingSettings, preferences }));

        expect(text).toContain('Sensor capabilities: power meter yes · heart-rate monitor yes · cadence data no');
        expect(text).toContain('Planning preferences: recovery style active · preferred time morning · conservative bias on · extra recovery margin off');
        expect(text).toContain('If a sensor is unknown or unavailable');
    });

    it('adds a seven-day cross-signal timeline rather than only window averages', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput());

        expect(text).toContain('### Recent 7-day recovery timeline');
        expect(text).toContain('| 2026-08-20 | 88 | 70 | 44 | 13 | 82 | 22 | 9000 | 8 | 2 | 3 |');
        expect(text).toContain('| 2026-08-14 | — | — | — | — | — | — | — | — | — | — |');
        expect(text).toContain('Steps are the completed D-1 total');
    });

    it('exports fixed commitments, imported sessions and their authored prescriptions', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput());

        expect(text).toContain('## 7. Existing commitments / imported plan');
        expect(text).toContain('2026-08-21 | Imported plan: Race prep | Threshold quality | 60–75 min · hard | key · preferred');
        expect(text).toContain('2026-08-22 | Fixed activity | 6v6 football | 90 min | fixed | start 19:00 · outdoor');
        expect(text).toContain('Preserve these when proposing days unless the user explicitly asks');
        expect(text).toContain('Imported-session prescription detail:');
        expect(text).toContain('2026-08-21 — Threshold quality:** 3 x 10 min threshold with controlled recovery');
        expect(text).toContain('Threshold: 3 sets · 10 min · RPE 7–8 · 240s recovery');
    });

    it('exports travel scaling overlays as constraints rather than workouts', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({ upcomingPlanBlocks: [travelBlock()] }));

        expect(text).toContain('2026-08-23→2026-08-25 | Plan block | Travel | volume ×0.65 · intensity ×0.8 | authored overlay');
        expect(text).toContain('Authored travel blocks scale the surrounding plan rather than representing an extra workout');
    });

    it('adds specific goal outcomes, resolved event demands and uncertain timing', () => {
        const goal = {
            title: 'September road race',
            status: 'active',
            targetOutcome: 'Be competitive over ~50 minutes with repeated surges',
            targetMetric: 'finish_time',
            targetValue: 50,
            targetUnit: 'min',
            eventCategory: 'cycling_event',
            eventPreset: 'road_race',
            timing: {
                earliestDate: '2026-09-12',
                latestDate: '2026-09-20',
                planningDate: '2026-09-12',
            },
            description: 'Repeated accelerations; preserve football readiness.',
        } as UserGoal;
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({ goals: [goal] }));

        expect(text).toContain('### Goal specifics relevant to planning');
        expect(text).toContain('success: Be competitive over ~50 minutes with repeated surges');
        expect(text).toContain('target: finish_time 50 min');
        expect(text).toContain('event: Road race (cycling_event, preset road_race)');
        expect(text).toContain('demand 0–1: endurance 0.8 · threshold 0.75 · VO2 0.4 · repeated surges 0.6 · sprint 0.3 · fatigue resistance 0.8 · neuromuscular 0.3');
        expect(text).toContain('window 2026-09-12–2026-09-20, planning date 2026-09-12');
    });

    it('warns instead of inventing a replacement when external fallback has no visible imported session', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            planningMode: 'evergreen',
            externalFallback: true,
            upcomingFixedActivities: [],
            upcomingPlanBlocks: [],
            upcomingExternalSessions: [],
        }));

        expect(text).toContain('External-plan fallback is active today and no imported session is visible in this 7-day horizon');
        expect(text).toContain('Do not silently invent a replacement block');
    });

    it('warns when current-day subjective data is stale', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            checkins: [checkin('2026-08-19')],
        }));

        expect(text).toContain('no check-in for 2026-08-20; latest available is 2026-08-19');
        expect(text).toContain('Do not assume subjective readiness, pain or availability are current');
    });
});
