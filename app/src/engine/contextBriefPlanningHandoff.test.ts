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

function checkin(date = AS_OF, overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
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
        ...overrides,
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
        effectivePlanningMode: 'externally_planned',
        externalFallback: false,
        externalFallbackUncertain: false,
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
            effectivePlanningMode: 'evergreen',
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

    it('includes physical work in recent recovery timeline flags on D-1', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            checkins: [
                checkin(AS_OF, {
                    physicalWork: {
                        performed: true,
                        duration: 'medium',
                        intensity: 'hard',
                        loadAreas: ['upper_body'],
                    },
                }),
            ],
        }));

        expect(text).toContain('hard physical work');
        // AS_OF is 2026-08-20, so D-1 is 2026-08-19
        const timelineRow19 = text.split('\n').find(line => line.startsWith('| 2026-08-19 |'));
        expect(timelineRow19).toContain('hard physical work');
        const timelineRow20 = text.split('\n').find(line => line.startsWith('| 2026-08-20 |'));
        expect(timelineRow20).not.toContain('hard physical work');
    });

    it('emits a wearable staleness caution in morning coach brief when snapshot is older than target date', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            preset: 'daily',
            asOfDate: '2026-08-20',
            snapshots: [snapshot('2026-08-18')],
        }));

        expect(text).toContain('> Wearable caution: no snapshot for 2026-08-20; the newest wearable state is 2026-08-18. Do not treat it as current-day readiness.');
    });

    it('falls back to weekend max minutes when availability is unrecorded on a weekend', () => {
        // 2026-08-22 is a Saturday
        const weekendDate = '2026-08-22';
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            preset: 'daily',
            asOfDate: weekendDate,
            checkins: [checkin(weekendDate, { availability: { timeAvailableMin: null, indoorOnly: false, preferredModalityToday: null } })],
            trainingSettings: {
                userId: 'u1',
                defaults: { weekdayMaxMinutes: 45, weekendMaxMinutes: 120, environment: 'either' },
                equipment: { indoor_bike: true, outdoor_bike: true, treadmill: false, free_weights: true, pullup_bar: false },
                guardrails: { hardSessionCap: true, backToBackHardAllowed: false, minRecoveryHoursBetweenHard: true },
                preferences: { preferActiveRecovery: false },
                migration: { legacyReviewed: true, migratedAt: null },
                schemaVersion: 3,
                createdAt: '2026-08-01T00:00:00Z',
                updatedAt: '2026-08-01T00:00:00Z',
            } as unknown as TrainingSettings,
        }));

        expect(text).toContain('- Time & environment: 120 min available');
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

    it('includes minute-denominated recovery doses instead of dropping them from the copied handoff', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            upcomingExternalSessions: [{
                date: '2026-08-21',
                planId: 'p1',
                planTitle: 'Race prep',
                revision: 2,
                sessionId: 's2',
                title: 'Tempo block',
                priority: 'key',
                modality: 'cycling',
                intensity: 'moderate',
                durationMin: 45,
                durationMax: 45,
                flexibility: 'preferred',
                status: 'planned',
                moved: false,
                isEvent: false,
                prescription: {
                    summary: '2 x 20 min tempo',
                    steps: [
                        { name: 'Tempo', sets: 2, durationMin: 20, target: '85% FTP', recoveryMin: 5 },
                        { name: 'VO2 rep', durationSec: 30, recoverySec: 15, repeat: 10, sets: 3, setRecoveryMin: 4 },
                    ],
                },
            }],
        }));

        expect(text).toContain('Tempo: 2 sets · 20 min · 85% FTP · 5 min recovery');
        expect(text).toContain('VO2 rep: 3 sets · 10 reps · 30 s · 15s recovery · 4 min set recovery');
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
            effectivePlanningMode: 'evergreen',
            externalFallback: true,
            upcomingFixedActivities: [],
            upcomingPlanBlocks: [],
            upcomingExternalSessions: [],
        }));

        expect(text).toContain('External-plan fallback is active today and no imported session is visible in this 7-day horizon');
        expect(text).toContain('Do not silently invent a replacement block');
    });

    it('marks external fallback as unconfirmed instead of a confirmed absence when today\'s plan read failed', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            effectivePlanningMode: 'evergreen',
            externalFallback: true,
            externalFallbackUncertain: true,
            upcomingFixedActivities: [],
            upcomingPlanBlocks: [],
            upcomingExternalSessions: [],
        }));

        expect(text).toContain('external-plan fallback today: UNCONFIRMED');
        expect(text).toContain('could not be read, so this may reflect an unreadable session rather than a confirmed absence');
        expect(text).not.toContain('external-plan fallback today: no imported session is placed on this date');
        expect(text).toContain('this is unconfirmed — treat it as unreadable, not as a confirmed absence');
    });

    it('warns when current-day subjective data is stale', () => {
        const text = enhanceContextBriefForPlanning(BASE, handoffInput({
            checkins: [checkin('2026-08-19')],
        }));

        expect(text).toContain('no check-in for 2026-08-20; latest available is 2026-08-19');
        expect(text).toContain('Do not assume subjective readiness, pain or availability are current');
    });

    describe('daily morning coach brief', () => {
        it('renders the dedicated closed-loop morning briefing for daily chat', () => {
            const yesterdayDate = '2026-08-19';
            const text = enhanceContextBriefForPlanning(BASE, handoffInput({
                preset: 'daily',
                checkins: [
                    checkin(AS_OF, {
                        readiness: 7,
                        fatigue: 4,
                        soreness: 5,
                        physicalWork: {
                            performed: true,
                            duration: 'medium',
                            intensity: 'hard',
                            loadAreas: ['lower_back_spine', 'grip_forearms'],
                            notes: 'heavy yard work and soil moving',
                        },
                        notes: 'feeling slightly tight in the lower back',
                    }),
                ],
                activities: [{
                    activityId: 'act-yesterday',
                    date: yesterdayDate,
                    type: 'road_biking',
                    durationMin: 65,
                    activityTrainingLoad: 85,
                    trainingEffectAerobic: 2.9,
                    trainingEffectAnaerobic: 0.2,
                    averageHr: 135,
                    intensityTag: 'moderate',
                    normalizedPower: 195,
                    intensityFactor: 0.75,
                }],
                recommendations: [
                    {
                        userId: 'u1',
                        date: yesterdayDate,
                        templateId: 'z2',
                        templateTitle: 'Zone 2 Foundation',
                        category: 'Easy Endurance',
                        modality: 'Cycling',
                        mode: 'train',
                        rationale: 'aerobic maintenance',
                        schemaVersion: 3,
                        createdAt: `${yesterdayDate}T06:00:00Z`,
                        updatedAt: `${yesterdayDate}T06:00:00Z`,
                        adherence: {
                            respondedAt: `${AS_OF}T05:40:00Z`,
                            followed: true,
                            actualModality: null,
                            actualDurationMin: null,
                            skipped: false,
                            notes: 'Good steady rhythm on the road',
                        },
                    },
                    {
                        userId: 'u1',
                        date: AS_OF,
                        templateId: 'rec-today',
                        templateTitle: 'Aerobic Maintenance Capped',
                        category: 'Easy Endurance',
                        modality: 'Cycling',
                        mode: 'modify',
                        rationale: 'Moderate readiness with lumbar strain; capping duration and avoiding heavy climbing',
                        schemaVersion: 3,
                        createdAt: `${AS_OF}T06:00:00Z`,
                        updatedAt: `${AS_OF}T06:00:00Z`,
                        adjustment: {
                            direction: 'easier',
                            tier: 1,
                            originalTemplateId: 'rec-today-full',
                            originalTemplateTitle: 'Aerobic Maintenance',
                            adjustedDoseLabel: 'Reduced duration',
                            athleteReason: 'soreness',
                            rationale: 'Lumbar strain from physical work',
                        },
                        prescription: {
                            id: 'p-today',
                            userId: 'u1',
                            date: AS_OF,
                            workoutId: 'w1',
                            workoutVersion: 1,
                            variantId: 'reduced',
                            targetDurationMin: 45,
                            adjustedBlocks: [],
                            displayBlocks: [{
                                id: 'b1',
                                name: 'Warm-up',
                                role: 'warmup',
                                steps: [{ id: 's1', name: 'Spin', dose: '10 min easy', targets: ['Zone 1 HR (<120 bpm)'], cues: ['High cadence 90+ rpm'] }],
                            }, {
                                id: 'b2',
                                name: 'Main Set',
                                role: 'main',
                                steps: [{ id: 's2', name: 'Steady endurance', dose: '30 min', targets: ['65-72% FTP (145-160W)'], cues: ['Stay seated, no heavy torque'] }],
                            }],
                            rationale: ['Preserving aerobic volume while protecting lower back'],
                            adjustmentReasons: ['Lower back soreness'],
                            source: { recommendationEngineVersion: '3.0.0' },
                            status: 'recommended',
                        },
                        adherence: {
                            respondedAt: null,
                            followed: null,
                            actualModality: null,
                            actualDurationMin: null,
                            skipped: false,
                            notes: null,
                        },
                    },
                ],
            }));

            // Structure assertions
            expect(text).toContain('# Morning Training & Readiness Brief');
            expect(text).toContain('## 1. Today\'s Status & Check-in');
            expect(text).toContain('## 2. Overnight Recovery (Wearable)');
            expect(text).toContain('## 3. Yesterday\'s Closed-Loop Debrief (2026-08-19)');
            expect(text).toContain('## 4. Today\'s App Recommendation & Engine Stance');
            expect(text).toContain('## 5. Short-Term Horizon (Next 48–72h)');
            expect(text).toContain('## 6. Morning Coach Instructions');

            // Today's Status & Check-in
            expect(text).toContain('Readiness 7 · Fatigue 4 · Soreness 5');
            expect(text).toContain('Unlogged physical work (yesterday D-1): 1–3 hrs · hard effort · strain: lower back/spine, grip/forearms — "heavy yard work and soil moving"');
            expect(text).toContain('feeling slightly tight in the lower back');

            // Overnight recovery
            expect(text).toContain('HRV (overnight avg): 70 ms');
            expect(text).toContain('Recent 7-day recovery timeline');

            // Yesterday's Closed-Loop Debrief
            expect(text).toContain('Prescribed: Zone 2 Foundation (Cycling · train)');
            expect(text).toContain('Recorded training: Road cycling · 65 min · Load 85 · Aerobic TE 2.9 · Avg HR 135 bpm · moderate');
            expect(text).toContain('Power summary: normalized power 195 W · IF 0.75');
            expect(text).toContain('Manual physical work: 1–3 hrs · hard effort · strain: lower back/spine, grip/forearms — "heavy yard work and soil moving"');
            expect(text).toContain('Adherence: Followed as prescribed — "Good steady rhythm on the road"');

            // Today's Recommendation & Engine Stance
            expect(text).toContain('Mode: MODIFY');
            expect(text).toContain('Recommended workout: Aerobic Maintenance Capped (Cycling · Easy Endurance)');
            expect(text).toContain('Engine rationale: "Moderate readiness with lumbar strain; capping duration and avoiding heavy climbing"');
            expect(text).toContain('Session adjustment: easier (tier 1) · Reduced duration · reason: soreness · "Lumbar strain from physical work"');
            expect(text).toContain('Prescription steps:');
            expect(text).toContain('Spin: 10 min easy · targets: Zone 1 HR (<120 bpm) · cues: High cadence 90+ rpm');
            expect(text).toContain('Steady endurance: 30 min · targets: 65-72% FTP (145-160W) · cues: Stay seated, no heavy torque');

            // Morning Coach Instructions
            expect(text).toContain('Treat this brief as state/context for your ongoing morning conversation');
            expect(text).toContain('Do NOT output a multi-day schedule table or redesign the training block');

            // Omissions (ensuring no block-planning bloat in morning mode)
            expect(text).not.toContain('### Preferred output schema');
            expect(text).not.toContain('### Day YYYY-MM-DD: <Session Name>');
            expect(text).not.toContain('Detailed activity telemetry');
        });
    });
});
