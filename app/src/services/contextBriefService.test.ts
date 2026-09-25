import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { DailyRecoverySnapshot } from '../engine/models';

const services = vi.hoisted(() => ({
    getRecoverySnapshotState: vi.fn(),
    getRecoverySnapshotsInRangeState: vi.fn(),
    getCheckinsInRange: vi.fn(),
    getActivitiesInRange: vi.fn(),
    getRecommendationsInRange: vi.fn(),
    getTrainingSettingsState: vi.fn(),
    peekTrainingSettingsState: vi.fn(),
    getPreferencesState: vi.fn(),
    getProfileState: vi.fn(),
    getActiveGoalsState: vi.fn(),
    getFixedActivitiesInRangeState: vi.fn(),
    getPlanBlocksInRangeState: vi.fn(),
    getActivePlanState: vi.fn(),
    getEntriesInRange: vi.fn(),
}));

vi.mock('./recoverySnapshotService', () => ({ recoverySnapshotService: {
    getRecoverySnapshotState: services.getRecoverySnapshotState,
    getRecoverySnapshotsInRangeState: services.getRecoverySnapshotsInRangeState,
} }));
vi.mock('./checkinService', () => ({ checkinService: { getCheckinsInRange: services.getCheckinsInRange } }));
vi.mock('./activityService', () => ({ activityService: { getActivitiesInRange: services.getActivitiesInRange } }));
vi.mock('./recommendationService', () => ({ recommendationService: { getRecommendationsInRange: services.getRecommendationsInRange } }));
vi.mock('./trainingSettingsService', () => ({ trainingSettingsService: {
    getTrainingSettingsState: services.getTrainingSettingsState,
    peekTrainingSettingsState: services.peekTrainingSettingsState,
} }));
vi.mock('./preferencesService', () => ({ preferencesService: { getPreferencesState: services.getPreferencesState } }));
vi.mock('./trainingIntentProfileService', () => ({ trainingIntentProfileService: { getProfileState: services.getProfileState } }));
vi.mock('./goalService', () => ({ goalService: { getActiveGoalsState: services.getActiveGoalsState } }));
vi.mock('./fixedActivityService', () => ({ fixedActivityService: { getActivitiesInRangeState: services.getFixedActivitiesInRangeState } }));
vi.mock('./planBlockService', () => ({ planBlockService: { getBlocksInRangeState: services.getPlanBlocksInRangeState } }));
vi.mock('./activeExternalPlanService', () => ({
    activeExternalPlanService: { getActivePlanState: services.getActivePlanState },
    placedSessionForDate: (active: { placed: Array<{ date: string; status: string }> }, date: string) =>
        active.placed.find(item => item.date === date && (item.status === 'planned' || item.status === 'moved')) ?? null,
}));
vi.mock('./anthropometryService', () => ({ anthropometryService: { getEntriesInRange: services.getEntriesInRange } }));

import { ContextBriefService } from './contextBriefService';

const AS_OF = '2026-08-15';

function snapshotWithWeight(date: string, weightKg: number): DailyRecoverySnapshot {
    return {
        userId: 'u1',
        date,
        source: { garminSyncedAt: `${date}T06:15:00Z`, sourceSchemaVersion: 3, metricDates: { weight: date } },
        raw: {
            sleepScore: 78, sleepDurationSec: 27000, restingHr: 48, hrvOvernightAvg: 62,
            hrvStatus: 'balanced', respirationAvg: 13, bodyBatteryWake: 71, bodyBatteryChange: 40,
            totalSteps: 9000, last3DaysHardSessionsCount: 1, yesterdayTraining: null, weightKg,
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
            baseline7dReady: true, baseline28dReady: true,
        },
    };
}

describe('ContextBriefService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        services.getRecoverySnapshotState.mockResolvedValue({ status: 'MISSING' });
        services.getCheckinsInRange.mockResolvedValue([]);
        services.getActivitiesInRange.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getRecommendationsInRange.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getTrainingSettingsState.mockResolvedValue({ status: 'MISSING' });
        services.peekTrainingSettingsState.mockResolvedValue({ status: 'MISSING' });
        services.getPreferencesState.mockResolvedValue({ status: 'MISSING' });
        services.getProfileState.mockResolvedValue({ status: 'MISSING' });
        services.getActiveGoalsState.mockResolvedValue({ status: 'MISSING' });
        services.getFixedActivitiesInRangeState.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getPlanBlocksInRangeState.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getActivePlanState.mockResolvedValue({ status: 'MISSING' });
        services.getEntriesInRange.mockResolvedValue([]);
        services.getRecoverySnapshotsInRangeState.mockResolvedValue({ status: 'MISSING' });
    });

    it('reads check-ins over a date range covering the full baseline, inclusive of asOfDate', async () => {
        await new ContextBriefService().build('u1', AS_OF, 14);
        // 28-day baseline ending 2026-08-15 starts on 2026-07-19; throughExclusive is 2026-08-16.
        expect(services.getCheckinsInRange).toHaveBeenCalledWith('u1', '2026-07-19', '2026-08-16');
    });

    it('keeps the baseline strictly longer than the window for a long window', async () => {
        await new ContextBriefService().build('u1', AS_OF, 28);
        // windowDays * 2 = 56 days ending 2026-08-15 (starts 2026-06-21; throughExclusive 2026-08-16).
        expect(services.getCheckinsInRange).toHaveBeenCalledWith('u1', '2026-06-21', '2026-08-16');
    });

    describe('short (daily) window', () => {
        it('widens the snapshot fetch to cover the fixed 7-day recovery timeline instead of only the 2-day window', async () => {
            await new ContextBriefService().build('u1', AS_OF, 2);
            expect(services.getRecoverySnapshotState).toHaveBeenCalledTimes(7);
            expect(services.getRecoverySnapshotState).toHaveBeenNthCalledWith(1, 'u1', '2026-08-09');
            expect(services.getRecoverySnapshotState).toHaveBeenNthCalledWith(7, 'u1', AS_OF);
        });

        it('widens the activity fetch the same way, but keeps recommendations scoped to the render window', async () => {
            await new ContextBriefService().build('u1', AS_OF, 2);
            // #816: activities reach back over the 28-day sensor-evidence horizon (2026-07-19).
            expect(services.getActivitiesInRange).toHaveBeenCalledWith('u1', '2026-07-19', '2026-08-16');
            expect(services.getRecommendationsInRange).toHaveBeenCalledWith('u1', '2026-08-14', '2026-08-16');
        });

        it('does not widen the fetch for the full 14-day window, since it already exceeds the timeline horizon', async () => {
            await new ContextBriefService().build('u1', AS_OF, 14);
            expect(services.getRecoverySnapshotState).toHaveBeenCalledTimes(14);
            expect(services.getActivitiesInRange).toHaveBeenCalledWith('u1', '2026-07-19', '2026-08-16');
        });

        it('pins the activity fetch to the 28-day sensor-evidence horizon and keeps a longer window (#816)', async () => {
            await new ContextBriefService().build('u1', AS_OF, 28);
            expect(services.getActivitiesInRange).toHaveBeenLastCalledWith('u1', '2026-07-19', '2026-08-16');
            await new ContextBriefService().build('u1', AS_OF, 42);
            expect(services.getActivitiesInRange).toHaveBeenLastCalledWith('u1', '2026-07-05', '2026-08-16');
        });

        it('keeps an activity outside the render window in the fixed recovery timeline, but excludes its detail telemetry from the retrospective appendix', async () => {
            // The recovery timeline only renders once *some* snapshot or check-in exists
            // in range (contextBriefPlanningHandoff.ts); a bare wearable reading on AS_OF
            // is enough to turn the section on so the activity-only row can be observed.
            services.getRecoverySnapshotState.mockImplementation(async (_userId: string, date: string) => {
                if (date !== AS_OF) return { status: 'MISSING' };
                return {
                    status: 'AVAILABLE',
                    data: {
                        userId: 'u1', date: AS_OF,
                        source: { garminSyncedAt: `${AS_OF}T06:00:00Z`, sourceSchemaVersion: 3 },
                        raw: {
                            sleepScore: 70, sleepDurationSec: 25000, restingHr: 50, hrvOvernightAvg: 60,
                            hrvStatus: null, respirationAvg: null, bodyBatteryWake: null, bodyBatteryChange: null,
                            totalSteps: null, last3DaysHardSessionsCount: 0, yesterdayTraining: null,
                        },
                        derived: {
                            baselineComputationVersion: 2,
                            sleepScore7dAvg: 70, sleepScore28dAvg: 70,
                            restingHr7dAvg: 50, restingHr28dAvg: 50,
                            hrv7dAvg: 60, hrv28dAvg: 60,
                            deltas: {
                                sleepScoreVs7d: 0, sleepScoreVs28d: 0,
                                restingHrVs7d: 0, restingHrVs28d: 0,
                                hrvVs7d: 0, hrvVs28d: 0,
                            },
                        },
                        dataQuality: {
                            sleepScoreAvailable: true, restingHrAvailable: true, hrvAvailable: true,
                            baseline7dReady: true, baseline28dReady: true,
                        },
                    },
                };
            });
            services.getActivitiesInRange.mockResolvedValue({
                status: 'AVAILABLE',
                data: [{
                    activityId: 'a1',
                    // 5 days before AS_OF: inside the widened 7-day fetch/timeline, outside the 2-day render window.
                    date: '2026-08-10',
                    type: 'cycling',
                    durationMin: 60,
                    trainingEffectAerobic: 3,
                    trainingEffectAnaerobic: 0.4,
                    averageHr: 140,
                    activityTrainingLoad: 100,
                    intensityTag: 'moderate',
                    laps: [{ lapIndex: 1, durationSeconds: 600, averagePowerWatts: 200, averageHrBpm: 140 }],
                }],
                revision: null,
            });

            const result = await new ContextBriefService().build('u1', AS_OF, 2);

            expect(result.text).toContain('2026-08-10 |'); // recovery timeline row
            expect(result.text).toContain('No recorded sessions in this window.'); // completed-training §3, render window only
            expect(result.text).not.toContain('Detailed activity telemetry');
        });

        it('reports the preset inferred from windowDays when the caller does not pass one explicitly', async () => {
            const daily = await new ContextBriefService().build('u1', AS_OF, 2);
            const full = await new ContextBriefService().build('u1', AS_OF, 14);
            expect(daily.preset).toBe('daily');
            expect(full.preset).toBe('full');
        });
    });

    describe('export purpose (#811)', () => {
        const telemetryRide = {
            activityId: 'a1', date: AS_OF, type: 'cycling', durationMin: 60,
            trainingEffectAerobic: 3, trainingEffectAnaerobic: 0.4, averageHr: 140,
            activityTrainingLoad: 100, intensityTag: 'moderate',
            laps: Array.from({ length: 50 }, (_, i) => ({ lapIndex: i + 1, durationSeconds: 60, averagePowerWatts: 200 + i })),
        };

        async function callsFor(preset: 'full' | 'diagnostic'): Promise<unknown[][][]> {
            vi.clearAllMocks();
            await new ContextBriefService().build('u1', AS_OF, 14, preset);
            return Object.values(services).map(mock => mock.mock.calls);
        }

        it('reports the purpose each compatible preset maps to', async () => {
            const service = new ContextBriefService();
            expect((await service.build('u1', AS_OF, 2, 'daily')).purpose).toBe('morning');
            expect((await service.build('u1', AS_OF, 14, 'full')).purpose).toBe('planning');
            expect((await service.build('u1', AS_OF, 14, 'diagnostic')).purpose).toBe('diagnostic');
        });

        it('diagnostic reads exactly the same sources and ranges as planning', async () => {
            expect(await callsFor('diagnostic')).toEqual(await callsFor('full'));
        });

        it('planning summarizes laps while diagnostic keeps the per-lap table', async () => {
            services.getActivitiesInRange.mockResolvedValue({ status: 'AVAILABLE', data: [telemetryRide], revision: null });
            const planning = await new ContextBriefService().build('u1', AS_OF, 14, 'full');
            const diagnostic = await new ContextBriefService().build('u1', AS_OF, 14, 'diagnostic');
            expect(planning.text).toContain('50 laps');
            expect(planning.text).not.toContain('| Lap | Duration |');
            expect(diagnostic.text).toContain('### Detailed activity telemetry');
            expect(diagnostic.text).toContain('| 50 |');
        });
    });

    it('reads padded fixed-activity occupancy and resolves active imported sessions across the next seven days', async () => {
        await new ContextBriefService().build('u1', AS_OF, 14);

        // Visible handoff is 2026-08-15..21. Six days of padding on both sides covers
        // every whole plan week that can affect a flexible placement in that horizon.
        expect(services.getFixedActivitiesInRangeState).toHaveBeenCalledWith('u1', '2026-08-09', '2026-08-27');
        expect(services.getActivePlanState).toHaveBeenCalledTimes(7);
        expect(services.getActivePlanState).toHaveBeenNthCalledWith(1, 'u1', '2026-08-15', []);
        expect(services.getActivePlanState).toHaveBeenNthCalledWith(7, 'u1', '2026-08-21', []);
    });

    it('reads authored plan blocks across the visible handoff and exports travel scaling', async () => {
        services.getPlanBlocksInRangeState.mockResolvedValue({
            status: 'AVAILABLE',
            revision: 'travel:r1',
            data: [{
                id: 'travel',
                userId: 'u1',
                phase: 'travel',
                startDate: '2026-08-18',
                endDate: '2026-08-20',
                volumeScale: 0.6,
                intensityScale: 0.8,
                createdAt: '2026-08-01T00:00:00Z',
                updatedAt: '2026-08-01T00:00:00Z',
            }],
        });

        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(services.getPlanBlocksInRangeState).toHaveBeenCalledWith('u1', '2026-08-15', '2026-08-21');
        expect(result.text).toContain('2026-08-18→2026-08-20 | Plan block | Travel | volume ×0.6 · intensity ×0.8 | authored overlay');
    });

    it('uses padded fixed activities for placement but only exports commitments inside the visible horizon', async () => {
        const priorWeekOccupancy = {
            id: 'fixed-prior',
            userId: 'u1',
            title: 'Prior fixed commitment',
            date: '2026-08-12',
            durationMin: 60,
            fixed: true,
            environment: 'either',
            equipment: [],
            isCompleted: false,
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
        };
        services.getFixedActivitiesInRangeState.mockResolvedValue({
            status: 'AVAILABLE', data: [priorWeekOccupancy], revision: 'r1',
        });

        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(services.getActivePlanState).toHaveBeenNthCalledWith(1, 'u1', '2026-08-15', [priorWeekOccupancy]);
        expect(result.text).not.toContain('Prior fixed commitment');
    });

    it('does not report missing snapshot days as a read failure', async () => {
        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.unavailableSources).not.toContain('recovery snapshots');
        expect(result.unavailableSources.join()).not.toContain('recovery snapshots');
    });

    it('reports unreadable snapshot days, which would otherwise render as absent data', async () => {
        services.getRecoverySnapshotState.mockResolvedValueOnce({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        services.getRecoverySnapshotState.mockResolvedValueOnce({ status: 'INVALID', issues: [] });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.unavailableSources).toContain('recovery snapshots (2 day(s) unreadable)');
        expect(result.text).toContain('DATA INCOMPLETE');
        expect(result.text).toContain('recovery snapshots (2 day(s) unreadable)');
    });

    it('omits malformed range-query check-ins instead of treating them as valid history', async () => {
        services.getCheckinsInRange.mockResolvedValue([{
            userId: 'u1',
            date: AS_OF,
            readiness: 'not-a-number',
        }]);

        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(result.unavailableSources).toContain('subjective check-ins (1 invalid record(s) omitted)');
        expect(result.text).toContain('No check-ins in this window.');
        expect(result.text).toContain('means "unknown", not "none"');
    });

    it('reports a failed preferences read, because it owns a hard modality exclusion', async () => {
        services.getPreferencesState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read preferences', retryable: true });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.unavailableSources).toContain('preferences (modality exclusions may be missing)');
    });

    it('treats an absent preferences document as configured-nothing, not as a failure', async () => {
        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.unavailableSources.join()).not.toContain('preferences');
    });

    it('reports unreadable goals instead of silently turning them into no goals', async () => {
        services.getActiveGoalsState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read goals', retryable: true });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(result.unavailableSources).toContain('active goals');
        expect(result.text).toContain('active goals');
    });

    it('reports unreadable travel overlays instead of treating them as no travel', async () => {
        services.getPlanBlocksInRangeState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read plan blocks', retryable: true });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(result.unavailableSources).toContain('plan blocks / travel overlays');
        expect(result.text).toContain('plan blocks / travel overlays');
    });

    it('fails closed on external placement when fixed-activity occupancy cannot be read', async () => {
        services.getFixedActivitiesInRangeState.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read fixed activities', retryable: true });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(services.getActivePlanState).not.toHaveBeenCalled();
        expect(result.unavailableSources).toContain('future fixed activities');
        expect(result.unavailableSources).toContain('external plan schedule (fixed-activity occupancy unavailable)');
        expect(result.text).toContain('fixed-activity occupancy unavailable');
    });

    it('marks external fallback as unconfirmed, not a confirmed absence, when only today\'s plan-state read fails', async () => {
        services.getProfileState.mockResolvedValue({
            status: 'AVAILABLE',
            data: {
                userId: 'u1',
                planningMode: 'externally_planned',
                priorities: [],
                weeklyCommitment: { minSessions: 3, targetSessions: 5, maxSessions: 6 },
                organizationPreference: 'auto',
                schemaVersion: 1,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
            },
        });
        services.getActivePlanState.mockImplementation(async (_userId: string, date: string) => {
            if (date === AS_OF) return { status: 'UNAVAILABLE', operation: 'read plan', retryable: true };
            return { status: 'MISSING' };
        });
        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        expect(result.unavailableSources).toContain('external plan schedule (1 day(s) unreadable)');
        expect(result.text).toContain('external-plan fallback today: UNCONFIRMED');
        expect(result.text).toContain('could not be read, so this may reflect an unreadable session rather than a confirmed absence');
        expect(result.text).not.toContain('external-plan fallback today: no imported session is placed on this date');
    });

    it('renders an imported future session and its authored prescription into the copied handoff', async () => {
        services.getActivePlanState.mockImplementation(async (_userId: string, date: string) => {
            if (date !== '2026-08-17') return { status: 'MISSING' };
            return {
                status: 'AVAILABLE',
                data: {
                    header: { planId: 'p1', title: 'Race prep', revision: 2 },
                    placed: [{
                        date,
                        status: 'planned',
                        moved: false,
                        session: {
                            id: 's1',
                            title: 'Threshold quality',
                            priority: 'key',
                            placement: { flexibility: 'preferred' },
                            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75 },
                            prescription: {
                                summary: '3 x 10 min threshold',
                                steps: [{ name: 'Threshold', sets: 3, durationMin: 10, target: 'RPE 7–8', recoverySec: 240 }],
                            },
                        },
                    }],
                },
            };
        });

        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.text).toContain('2026-08-17 | Imported plan: Race prep | Threshold quality | 60–75 min · hard | key · preferred');
        expect(result.text).toContain('2026-08-17 — Threshold quality:** 3 x 10 min threshold');
        expect(result.text).toContain('Threshold: 3 sets · 10 min · RPE 7–8 · 240s recovery');
    });

    it('still returns a brief when every source rejects', async () => {
        services.getRecoverySnapshotState.mockRejectedValue(new Error('offline'));
        services.getCheckinsInRange.mockRejectedValue(new Error('offline'));
        services.getActivitiesInRange.mockRejectedValue(new Error('offline'));
        services.getRecommendationsInRange.mockRejectedValue(new Error('offline'));
        services.getTrainingSettingsState.mockRejectedValue(new Error('offline'));
        services.peekTrainingSettingsState.mockRejectedValue(new Error('offline'));
        services.getPreferencesState.mockRejectedValue(new Error('offline'));
        services.getProfileState.mockRejectedValue(new Error('offline'));
        services.getActiveGoalsState.mockRejectedValue(new Error('offline'));
        services.getFixedActivitiesInRangeState.mockRejectedValue(new Error('offline'));
        services.getPlanBlocksInRangeState.mockRejectedValue(new Error('offline'));
        services.getEntriesInRange.mockRejectedValue(new Error('offline'));
        services.getRecoverySnapshotsInRangeState.mockRejectedValue(new Error('offline'));

        const result = await new ContextBriefService().build('u1', AS_OF, 14);
        expect(result.text).toContain('# Training context brief');
        expect(result.unavailableSources).toContain('recovery snapshots');
        expect(result.unavailableSources).toContain('training settings');
        expect(result.unavailableSources).toContain('plan blocks / travel overlays');
        expect(result.unavailableSources).toContain('body measurements');
        expect(result.text).toContain('Do not assume any equipment or absence of injury');
        expect(result.text).toContain('DATA INCOMPLETE');
    });

    it('marks recommendations as unreadable when the read fails, showing "unknown, not none"', async () => {
        services.getRecommendationsInRange.mockResolvedValue({ status: 'UNAVAILABLE', data: [] });

        const result = await new ContextBriefService().build('u1', AS_OF, 14);

        // Check planning & diagnostic briefs contain "unknown, not none"
        expect(result.text).toContain('Recommendation feedback unavailable (read failed)');
        expect(result.text).toContain('unknown, not none');
        expect(result.text).not.toContain('No app recommendations recorded in this window');

        // Check the unavailable sources list includes recommendations
        expect(result.unavailableSources).toContain('recommendations and feedback');
    });

    describe('body composition (anthropometry)', () => {
        it('reads anthropometry entries over a wider lookback than the subjective baseline', async () => {
            await new ContextBriefService().build('u1', AS_OF, 14);
            // 60-day lookback ending 2026-08-15 starts on 2026-06-17.
            expect(services.getEntriesInRange).toHaveBeenCalledWith('u1', '2026-06-17', AS_OF);
        });

        it('reports a failed anthropometry read as an unavailable source without failing the whole brief', async () => {
            services.getEntriesInRange.mockRejectedValue(new Error('offline'));
            const result = await new ContextBriefService().build('u1', AS_OF, 14);
            expect(result.unavailableSources).toContain('body measurements');
            expect(result.text).toContain('# Training context brief');
        });

        it('does not report anthropometry as unavailable when it simply has no entries', async () => {
            const result = await new ContextBriefService().build('u1', AS_OF, 14);
            expect(result.unavailableSources.join()).not.toContain('body measurements');
            expect(result.text).not.toContain('Body composition & fueling');
        });

        it('fetches provider body-composition snapshots over the full anthropometry lookback, not the shorter recovery-timeline window', async () => {
            await new ContextBriefService().build('u1', AS_OF, 14);
            // Same 60-day start as the anthropometry entries fetch, half-open through the day after asOfDate.
            expect(services.getRecoverySnapshotsInRangeState).toHaveBeenCalledWith('u1', '2026-06-17', '2026-08-16');
        });

        it('surfaces a provider weigh-in older than the recovery-timeline window instead of silently falling back to manual data', async () => {
            // 20 days back: outside contextDays (14 for this window) but inside the 60-day
            // anthropometry lookback. The day-by-day recovery-snapshot fetch (contextStart..)
            // never sees this date, so only the wider range fetch can surface it.
            const staleDate = addDaysToLocalDateString(AS_OF, -20);
            services.getRecoverySnapshotsInRangeState.mockResolvedValue({
                status: 'AVAILABLE',
                data: [snapshotWithWeight(staleDate, 81.4)],
                revision: 'r1',
            });

            const result = await new ContextBriefService().build('u1', AS_OF, 14);
            expect(result.text).toContain(`Body mass (device-estimated): latest 81.4 kg (${staleDate})`);
        });
    });

    it('never writes a training settings profile as a side effect of being read', async () => {
        await new ContextBriefService().build('u1', AS_OF, 14);
        // getTrainingSettingsState migrates a missing profile into existence with setDoc.
        // The brief is presented to the athlete as read-only, so it must peek instead --
        // opening a tab must not create data.
        expect(services.peekTrainingSettingsState).toHaveBeenCalledWith('u1');
        expect(services.getTrainingSettingsState).not.toHaveBeenCalled();
    });
});
