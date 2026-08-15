import { describe, expect, it } from 'vitest';
import { buildContextBrief, briefWindowStart, type ContextBriefInput } from './contextBrief';
import { addDaysToLocalDateString } from '../utils/localDate';
import type {
    DailyRecommendation,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    NormalizedGarminActivity,
    TrainingSettings,
} from './models';

const AS_OF = '2026-08-15';

function snapshot(date: string, overrides: Partial<DailyRecoverySnapshot['raw']> = {}, baseline28dReady = true): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date,
        source: { garminSyncedAt: `${date}T06:15:00Z`, sourceSchemaVersion: 3 },
        raw: {
            sleepScore: 78, sleepDurationSec: 27000, restingHr: 48, hrvOvernightAvg: 62,
            hrvStatus: 'balanced', respirationAvg: 13, bodyBatteryWake: 71, bodyBatteryChange: 40,
            totalSteps: 9000, last3DaysHardSessionsCount: 1, yesterdayTraining: null, ...overrides,
        },
        derived: {
            baselineComputationVersion: 2,
            sleepScore7dAvg: 71, sleepScore28dAvg: 74,
            restingHr7dAvg: 50, restingHr28dAvg: 49,
            hrv7dAvg: 58, hrv28dAvg: 61,
            respiration7dAvg: 13, respiration28dAvg: 13,
            deltas: {
                sleepScoreVs7d: 7, sleepScoreVs28d: 4,
                restingHrVs7d: -2, restingHrVs28d: -1,
                hrvVs7d: 4, hrvVs28d: 1,
                respirationVs7d: 0, respirationVs28d: 0,
            },
        },
        dataQuality: {
            sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true,
            baseline7dReady: true, baseline28dReady,
        },
    };
}

function checkin(date: string, overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1', date,
        readiness: 7, sleepQuality: 7, fatigue: 4, soreness: 3, mentalStress: 4, motivation: 8,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 75, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: `${date}T06:30:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1, createdAt: `${date}T06:30:00Z`, updatedAt: `${date}T06:30:00Z`,
        ...overrides,
    };
}

function activity(date: string, overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: `a-${date}`, date, type: 'cycling', durationMin: 60,
        trainingEffectAerobic: 3.1, trainingEffectAnaerobic: 0.4, averageHr: 138,
        activityTrainingLoad: 120, intensityTag: 'moderate', ...overrides,
    };
}

function recommendation(date: string, adherence: Partial<DailyRecommendation['adherence']> = {}): DailyRecommendation {
    return {
        userId: 'u1', date, templateId: 't1', templateTitle: 'Threshold intervals',
        category: 'Hard Endurance', modality: 'Cycling', mode: 'train',
        rationale: 'readiness solid', schemaVersion: 3,
        createdAt: `${date}T07:00:00Z`, updatedAt: `${date}T07:00:00Z`,
        adherence: {
            respondedAt: null, followed: null, actualModality: null, actualDurationMin: null,
            skipped: false, notes: null, ...adherence,
        },
    };
}

const settings: TrainingSettings = {
    userId: 'u1', schemaVersion: 3,
    equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: true },
    guardrails: { avoid_high_impact: true, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
    injuries: [{ region: 'knee', severity: 'limit', restrictedModalities: ['Running'], reviewBy: '2026-09-01' }],
    defaults: { weekdayMaxMinutes: 75, weekendMaxMinutes: 150, environment: 'either' },
    preferences: { preferActiveRecovery: true },
    migration: { legacyReviewed: true, migratedAt: null },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
};

function input(overrides: Partial<ContextBriefInput> = {}): ContextBriefInput {
    return {
        asOfDate: AS_OF, windowDays: 14,
        snapshots: [], checkins: [], activities: [], recommendations: [],
        trainingSettings: settings, preferences: null, intentProfile: null,
        ...overrides,
    };
}

describe('buildContextBrief', () => {
    it('reports the inclusive window and its start date', () => {
        expect(briefWindowStart(AS_OF, 14)).toBe('2026-08-02');
        expect(buildContextBrief(input())).toContain('Window: 2026-08-02 → 2026-08-15 (14 days)');
    });

    it('excludes records outside the window', () => {
        const text = buildContextBrief(input({
            activities: [activity('2026-08-01', { type: 'too-old' }), activity('2026-08-10', { type: 'in-window' })],
        }));
        expect(text).not.toContain('too-old');
        expect(text).toContain('in-window');
    });

    it('states absent equipment explicitly rather than only what is owned', () => {
        const text = buildContextBrief(input());
        expect(text).toContain('Equipment available: free weights, indoor bike, pull-up bar');
        expect(text).toContain('Equipment NOT available: cable machine, treadmill');
    });

    it('surfaces safety limits and injury restrictions', () => {
        const text = buildContextBrief(input());
        expect(text).toContain('no high-impact work');
        expect(text).toContain('knee — limit');
        expect(text).toContain('restricts Running');
    });

    it('refuses to imply capability when training settings are unavailable', () => {
        const text = buildContextBrief(input({ trainingSettings: null }));
        expect(text).toContain('Do not assume any equipment or absence of injury');
        expect(text).not.toContain('Equipment available:');
    });

    it('renders metric baselines and deltas together', () => {
        const text = buildContextBrief(input({ snapshots: [snapshot('2026-08-15')] }));
        expect(text).toContain('HRV (overnight avg): 62 ms (7d 58, 28d 61) — +4 vs 7d, +1 vs 28d');
        expect(text).toContain('Resting HR: 48 bpm (7d 50, 28d 49) — -2 vs 7d, -1 vs 28d');
    });

    it('warns when the 28-day baseline is immature', () => {
        const mature = buildContextBrief(input({ snapshots: [snapshot('2026-08-15')] }));
        const immature = buildContextBrief(input({ snapshots: [snapshot('2026-08-15', {}, false)] }));
        expect(mature).not.toContain('28-day baseline is not yet mature');
        expect(immature).toContain('28-day baseline is not yet mature');
    });

    it('uses the most recent snapshot for current values regardless of input order', () => {
        const text = buildContextBrief(input({
            snapshots: [snapshot('2026-08-15', { hrvOvernightAvg: 70 }), snapshot('2026-08-10', { hrvOvernightAvg: 40 })],
        }));
        expect(text).toContain('Most recent reading — 2026-08-15');
        expect(text).toContain('HRV (overnight avg): 70 ms');
    });

    it('distinguishes missing values from zero', () => {
        const text = buildContextBrief(input({ snapshots: [snapshot('2026-08-15', { hrvOvernightAvg: null })] }));
        expect(text).toContain('HRV (overnight avg): — ms');
        expect(text).toContain('Blank values ("—") mean not measured, not zero');
    });

    it('totals completed training and buckets it into rolling seven-day windows', () => {
        const text = buildContextBrief(input({
            activities: [
                activity('2026-08-14', { intensityTag: 'hard', durationMin: 90 }),
                activity('2026-08-12', { durationMin: 60 }),
                activity('2026-08-05', { durationMin: 45 }),
            ],
        }));
        expect(text).toContain('Totals: 3 sessions · 195 min · 1 tagged hard.');
        expect(text).toContain('- 2026-08-09 → 2026-08-15: 2 sessions · 150 min · 1 hard');
        expect(text).toContain('- 2026-08-02 → 2026-08-08: 1 sessions · 45 min · 0 hard');
    });

    describe('subjective baseline', () => {
        // `days` consecutive check-ins ending on `endDate`, so coverage is exactly `days`.
        function run(endDate: string, days: number, overrides: (offset: number) => Partial<DailySubjectiveCheckin> = () => ({})) {
            return Array.from({ length: days }, (_, offset) => {
                const date = addDaysToLocalDateString(endDate, -offset);
                return checkin(date, overrides(offset));
            });
        }

        it('withholds the baseline below the minimum recorded-day count', () => {
            const text = buildContextBrief(input({ checkins: run(AS_OF, 9) }));
            expect(text).toContain('No 28-day subjective baseline: only 9 of 28 days recorded (minimum 10)');
            expect(text).toContain('sparse baseline reads optimistically');
            expect(text).not.toContain("trailing 28-day baseline");
        });

        it('shows the baseline once the minimum is met, with its coverage count', () => {
            const text = buildContextBrief(input({ checkins: run(AS_OF, 10) }));
            expect(text).toContain("trailing 28-day baseline (10 of 28 days recorded)");
            expect(text).not.toContain('No 28-day subjective baseline');
        });

        it('caveats a baseline that is present but sparse, and drops the caveat when dense', () => {
            const sparse = buildContextBrief(input({ checkins: run(AS_OF, 20) }));
            const dense = buildContextBrief(input({ checkins: run(AS_OF, 28) }));
            expect(sparse).toContain('rests on 20 of 28 days');
            expect(dense).not.toContain('rests on');
        });

        it('counts distinct days, so duplicate records cannot inflate coverage', () => {
            const duplicated = [...run(AS_OF, 9), ...run(AS_OF, 9)];
            expect(duplicated).toHaveLength(18);
            expect(buildContextBrief(input({ checkins: duplicated }))).toContain('only 9 of 28 days recorded');
        });

        it('reads a drop in readiness as worse and a drop in fatigue as better', () => {
            // Recent 14 days: readiness 5 / fatigue 6. Older 14: readiness 8 / fatigue 2.
            const checkins = run(AS_OF, 28, offset => offset < 14
                ? { readiness: 5, fatigue: 6 }
                : { readiness: 8, fatigue: 2 });
            const text = buildContextBrief(input({ checkins }));
            expect(text).toContain('Readiness: 5 vs 6.5 (-1.5, worse than baseline)');
            expect(text).toContain('Fatigue: 6 vs 4 (+2, worse than baseline)');
        });

        it('reports an unchanged metric as flat rather than as a direction', () => {
            const text = buildContextBrief(input({ checkins: run(AS_OF, 28) }));
            expect(text).toContain('Readiness: 7 vs 7 (0, flat)');
        });

        it('excludes check-ins older than the baseline window', () => {
            const checkins = [...run(AS_OF, 28), checkin('2026-07-01', { readiness: 1 })];
            const text = buildContextBrief(input({ checkins }));
            expect(text).toContain('(28 of 28 days recorded)');
            expect(text).toContain('Readiness: 7 vs 7');
        });

        it('states which direction is favourable so deltas cannot be misread', () => {
            expect(buildContextBrief(input({ checkins: run(AS_OF, 14) })))
                .toContain('Higher is better for readiness, sleep quality and motivation; higher is worse for fatigue, soreness and mental stress.');
        });
    });

    it('lists the dates on which pain or illness was flagged', () => {
        const text = buildContextBrief(input({
            checkins: [
                checkin('2026-08-10', { painOrInjury: true }),
                checkin('2026-08-11', { illnessSymptoms: true }),
                checkin('2026-08-12'),
            ],
        }));
        expect(text).toContain('Pain or injury flagged: 1 day(s) — 2026-08-10');
        expect(text).toContain('Illness symptoms flagged: 1 day(s) — 2026-08-11');
    });

    it('separates skipped sessions from sessions replaced by something else', () => {
        const text = buildContextBrief(input({
            recommendations: [
                recommendation('2026-08-10', { respondedAt: '2026-08-11T07:00:00Z', followed: true }),
                recommendation('2026-08-11', { respondedAt: '2026-08-12T07:00:00Z', followed: false, skipped: true, notes: 'work' }),
                recommendation('2026-08-12', { respondedAt: '2026-08-13T07:00:00Z', followed: false, actualModality: 'Running', actualDurationMin: 30 }),
                recommendation('2026-08-13'),
            ],
        }));
        expect(text).toContain('4 recommendations · 3 answered · 1 unanswered.');
        expect(text).toContain('- Followed as prescribed: 1');
        expect(text).toContain('- Did something different: 1');
        expect(text).toContain('- Skipped entirely: 1');
        expect(text).toContain('2026-08-11: prescribed Threshold intervals (train), skipped — "work"');
        expect(text).toContain('2026-08-12: prescribed Threshold intervals (train), did Running for 30 min');
    });

    it('says a section is empty rather than omitting it', () => {
        const text = buildContextBrief(input());
        expect(text).toContain('No wearable data in this window.');
        expect(text).toContain('No recorded sessions in this window.');
        expect(text).toContain('No check-ins in this window.');
        expect(text).toContain('No recommendations recorded in this window.');
    });

    it('carries no user identifier into the rendered brief', () => {
        const text = buildContextBrief(input({
            snapshots: [snapshot('2026-08-15')],
            checkins: [checkin('2026-08-15')],
            activities: [activity('2026-08-15')],
            recommendations: [recommendation('2026-08-15')],
        }));
        expect(text).not.toContain('u1');
        expect(text).not.toContain('userId');
    });

    it('tells the planner that daily readiness adjustment happens separately', () => {
        expect(buildContextBrief(input())).toContain('plan the intended block rather than pre-emptively reducing it');
    });
});
