import { describe, expect, it } from 'vitest';
import {
    briefWindowDaysFor,
    briefWindowStart,
    buildContextBrief,
    DAILY_BRIEF_WINDOW_DAYS,
    defaultBriefWindowDays,
    type ContextBriefInput,
} from './contextBrief';
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

    it('omits an injury whose review date has passed, matching injuryPolicy', () => {
        const expired: TrainingSettings = {
            ...settings,
            injuries: [{ region: 'knee', severity: 'limit', restrictedModalities: ['Running'], reviewBy: '2026-08-14' }],
        };
        const text = buildContextBrief(input({ trainingSettings: expired }));
        expect(text).not.toContain('knee — limit');
        expect(text).not.toContain('Injuries:');
    });

    it('keeps an injury whose review date is today or later, and one with no review date', () => {
        const dueToday: TrainingSettings = { ...settings, injuries: [{ region: 'knee', severity: 'limit', reviewBy: AS_OF }] };
        const indefinite: TrainingSettings = { ...settings, injuries: [{ region: 'lower_back', severity: 'monitor' }] };
        expect(buildContextBrief(input({ trainingSettings: dueToday }))).toContain('knee — limit');
        expect(buildContextBrief(input({ trainingSettings: indefinite }))).toContain('lower_back — monitor');
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

    it('clamps the final load bucket to the window instead of reporting unmeasured days as empty', () => {
        // A 10-day window: the second bucket covers only 3 days, not a full 7.
        const text = buildContextBrief(input({ windowDays: 10, activities: [activity('2026-08-07')] }));
        expect(text).toContain('- 2026-08-09 → 2026-08-15: 0 sessions');
        expect(text).toContain('- 2026-08-06 → 2026-08-08 (3 days): 1 sessions');
        expect(text).not.toContain('2026-08-02 → 2026-08-08');
    });

    it('labels a two-day bucket span rather than presenting it as a full week', () => {
        const text = buildContextBrief(input({ windowDays: 2, activities: [activity('2026-08-15')] }));
        expect(text).toContain('- 2026-08-14 → 2026-08-15 (2 days): 1 sessions');
    });

    describe('window presets', () => {
        it('names a 2-day daily preset and a 14-day full preset', () => {
            expect(DAILY_BRIEF_WINDOW_DAYS).toBe(2);
            expect(briefWindowDaysFor('daily')).toBe(2);
            expect(briefWindowDaysFor('full')).toBe(defaultBriefWindowDays());
        });
    });

    describe('short-window scope note', () => {
        it('states that retrospective detail is scoped to a short window, so an empty section does not read as untrained', () => {
            const text = buildContextBrief(input({ windowDays: 2, activities: [] }));
            expect(text).toContain('Retrospective detail (completed training, per-check-in flags) is scoped to the last 2 day(s)');
            expect(text).toContain('No recorded sessions in this window.');
        });

        it('omits the scope note for the full two-week window', () => {
            expect(buildContextBrief(input())).not.toContain('is scoped to the last');
        });
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

        it('refuses a baseline that is not longer than the window rather than printing all-flat deltas', () => {
            const text = buildContextBrief(input({
                windowDays: 28, subjectiveBaselineDays: 28, checkins: run(AS_OF, 28),
            }));
            expect(text).toContain('No subjective baseline: the 28-day window is not shorter than the 28-day baseline period');
            expect(text).not.toContain('flat)');
        });

        it('warns that the overlapping baseline halves the apparent size of a change', () => {
            expect(buildContextBrief(input({ checkins: run(AS_OF, 28) })))
                .toContain('read the direction, not the magnitude');
        });

        it('scales the coverage thresholds with the baseline period', () => {
            // 21 recorded days is 75% of a 28-day baseline but only 38% of a 56-day one.
            const shortBaseline = buildContextBrief(input({ checkins: run(AS_OF, 21) }));
            expect(shortBaseline).not.toContain('rests on');

            const longBaseline = buildContextBrief(input({
                windowDays: 14, subjectiveBaselineDays: 56, checkins: run(AS_OF, 21),
            }));
            expect(longBaseline).toContain('rests on 21 of 56 days');
        });

        it('raises the minimum recorded-day count for a longer baseline', () => {
            const text = buildContextBrief(input({
                windowDays: 14, subjectiveBaselineDays: 56, checkins: run(AS_OF, 19),
            }));
            expect(text).toContain('only 19 of 56 days recorded (minimum 20)');
        });

        it('never prints the comparison heading with no metric lines beneath it', () => {
            // Enough recorded days to clear the gate, but every score is null, so every
            // metric line is skipped.
            const unscored = Array.from({ length: 14 }, (_, offset) => checkin(
                addDaysToLocalDateString(AS_OF, -offset),
                { readiness: null, sleepQuality: null, motivation: null, fatigue: null, soreness: null, mentalStress: null },
            ));
            const text = buildContextBrief(input({ checkins: unscored }));
            expect(text).toContain('no metric is scored on both sides of the comparison');
            expect(text).not.toContain('read the direction, not the magnitude');
        });

        it('states which direction is favourable so deltas cannot be misread', () => {
            expect(buildContextBrief(input({ checkins: run(AS_OF, 14) })))
                .toContain('Higher is better for readiness, sleep quality and motivation; higher is worse for fatigue, soreness and mental stress.');
        });

        it('frames a short window as a point reading, not a trend, so one bad night is not read as a sustained shift', () => {
            const text = buildContextBrief(input({ windowDays: 2, checkins: run(AS_OF, 28) }));
            expect(text).toContain("Most recent check-in (2026-08-15) vs this athlete's own trailing 28-day baseline");
            expect(text).toContain('This is a single reading, not a trend');
            expect(text).not.toContain('read the direction, not the magnitude');
        });

        it('keeps the trend framing for the full two-week window', () => {
            const text = buildContextBrief(input({ checkins: run(AS_OF, 28) }));
            expect(text).toContain("Window average vs this athlete's own trailing 28-day baseline");
            expect(text).not.toContain('single reading, not a trend');
        });
    });

    it('renders the most recent check-in separately in subjective reports', () => {
        const text = buildContextBrief(input({
            checkins: [
                checkin('2026-08-10', { readiness: 5, fatigue: 6, soreness: 5, sleepQuality: 6, motivation: 5, mentalStress: 6 }),
                checkin('2026-08-15', {
                    readiness: 8, fatigue: 3, soreness: 2, sleepQuality: 9, motivation: 9, mentalStress: 2,
                    alreadyTrainedToday: true,
                    availability: { timeAvailableMin: 45, preferredModalityToday: 'Cycling', indoorOnly: true },
                }),
            ],
        }));
        expect(text).toContain('Most recent check-in — 2026-08-15:');
        expect(text).toContain('- Readiness 8 · fatigue 3 · soreness 2');
        expect(text).toContain('- Sleep quality 9 · motivation 9 · mental stress 2');
        expect(text).toContain('- Flags / availability: already trained today · 45 min available · preferred modality: Cycling · indoor only');
    });

    it('renders tissue responses when pain is flagged on the most recent check-in', () => {
        const text = buildContextBrief(input({
            checkins: [
                checkin('2026-08-15', {
                    painOrInjury: true,
                    tissueResponses: {
                        knee: {
                            region: 'knee',
                            morningState: 'mild',
                            painDuringTraining: 'normal',
                        },
                    },
                }),
            ],
        }));
        expect(text).toContain('- Flags / availability: pain/injury flagged');
        expect(text).toContain('- Tissue response: knee: morning mild, during normal');
    });

    it('lists the dates on which pain, illness, or prior training was flagged', () => {
        const text = buildContextBrief(input({
            checkins: [
                checkin('2026-08-10', { painOrInjury: true }),
                checkin('2026-08-11', { illnessSymptoms: true }),
                checkin('2026-08-12', { alreadyTrainedToday: true }),
            ],
        }));
        expect(text).toContain('Pain or injury flagged: 1 day(s) — 2026-08-10');
        expect(text).toContain('Illness symptoms flagged: 1 day(s) — 2026-08-11');
        expect(text).toContain('Already trained today: 1 day(s) — 2026-08-12');
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

    it('formats activity names cleanly and reports discipline volume breakdown', () => {
        const text = buildContextBrief(input({
            activities: [
                activity('2026-08-14', { type: 'road_biking', durationMin: 90, intensityTag: 'hard' }),
                activity('2026-08-12', { type: 'strength_training', durationMin: 45, intensityTag: 'easy' }),
            ],
        }));
        expect(text).toContain('| Road cycling |');
        expect(text).toContain('| Strength |');
        expect(text).toContain('Discipline volume: Road cycling: 1 session (90 min) · Strength: 1 session (45 min)');
    });

    it('renders active target events with countdowns and priority', () => {
        const text = buildContextBrief(input({
            goals: [
                {
                    userId: 'u1',
                    title: '13 September Road Race',
                    targetDate: '2026-09-13',
                    domain: 'endurance',
                    category: 'short-term',
                    priority: 5,
                    status: 'active',
                    eventCategory: 'cycling_event',
                    schemaVersion: 1,
                    createdAt: '2026-08-01T00:00:00Z',
                    updatedAt: '2026-08-01T00:00:00Z',
                },
            ],
        }));
        expect(text).toContain('Target events & goals:');
        expect(text).toContain('**13 September Road Race**: Priority A · 29 days away (2026-09-13) · Type: cycling event · Phase: short-term');
    });

    it('includes import-compatible markdown schema in requested output', () => {
        const text = buildContextBrief(input());
        expect(text).toContain('### Preferred output schema (compatible with 1-click plan import):');
        expect(text).toContain('### Day YYYY-MM-DD: <Session Name>');
        expect(text).toContain('- Modality: <Cycling | Running | Strength | Mobility | Field | Cross Training>');
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
