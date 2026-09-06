import { describe, expect, it } from 'vitest';
import { resolveAvailability } from './schedule';
import { applyPlanningOverlays } from './planningOverlays';
import { resolveWeeklyAnchors } from './planner';
import { evaluateTrainingWithIntent } from './rules';
import type {
    DailyReadiness,
    ScheduleOverlay,
    UserContext,
} from './models';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';

function testContext(overrides: Partial<UserContext['constraints']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: true,
            restrictedModalities: [],
            maxTimeMinutes: 60,
            ...overrides,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: ['Running', 'Strength', 'Cycling'],
            conservativeBias: false,
        },
    };
}

const EMPTY_HISTORY: TrainingHistorySnapshot = {
    throughDateExclusive: '2026-11-20',
    windowDays: 7,
    completedEvents: [],
    exposures: [],
    sourceStates: {
        activities: { status: 'AVAILABLE', revision: 'fixture' },
        recommendations: { status: 'AVAILABLE', revision: 'fixture' },
        manualTraining: { status: 'MISSING' },
    },
    generatedAt: '2026-11-20T05:00:00.000Z',
    revision: 'history-fixture-empty',
    performedTrainingFacts: {
        asOfDate: '2026-11-20',
        windowDays: 7,
        revision: 'performed-facts-fixture-empty',
        exposures: [],
        coverageCredits: [],
    },
};

function highReadiness(): DailyReadiness {
    return {
        subjective: {
            readiness: 9,
            sleepQuality: 9,
            fatigue: 1,
            soreness: 1,
            stress: 1,
            motivation: 9,
            timeAvailable: 90,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null,
        },
        objective: {
            total_steps: 8000,
            sleep_score: 88,
            sleep_duration_min: 480,
            rhr: 48,
            rhr_7d_avg: 48,
            rhr_delta: 0,
            hrv_weekly_avg: 65,
            hrv_last_night: 68,
            hrv_delta: 3,
            respiration: 14,
            body_battery_wake: 85,
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
}

describe('Schedule Overlays (Planned Absences / Sport Blocks)', () => {
    describe('resolveAvailability', () => {
        it('preserves normal availability when no overlays are active', () => {
            const ctx = testContext();
            const avail = resolveAvailability('2026-11-20', null, [], ctx, []);
            expect(avail.maxTimeMinutes).toBe(60);
            expect(avail.availableEquipment).toContain('indoor_bike');
            expect(avail.environmentOverride).toBeNull();
            expect(avail.reservedCapacityCostProfile.lowerBody).toBe(0);
        });

        it('zeroes availability minutes when overlay specifies 0 min', () => {
            const ctx = testContext();
            const overlay: ScheduleOverlay = {
                id: 'ov-skiing',
                userId: 'u1',
                title: 'Alps Ski Trip',
                category: 'active_sport',
                sport: 'skiing',
                startDate: '2026-11-20',
                endDate: '2026-11-25',
                dailyAvailabilityMinutes: 0,
                volumeScale: 0,
                intensityScale: 0,
                expectedCost: {
                    systemic: 0.7,
                    cardiovascular: 0.5,
                    lowerBody: 0.85,
                    upperBody: 0.15,
                    impactTissue: 0.4,
                    neuromuscular: 0.5,
                },
                createdAt: '2026-09-01T00:00:00Z',
                updatedAt: '2026-09-01T00:00:00Z',
            };

            const avail = resolveAvailability('2026-11-22', null, [], ctx, [overlay]);
            expect(avail.maxTimeMinutes).toBe(0);
            expect(avail.reservedCapacityCostProfile.lowerBody).toBe(0.85);
            expect(avail.reservedCapacityCostProfile.systemic).toBe(0.7);
        });

        it('narrows equipment and sets environment override from overlay', () => {
            const ctx = testContext();
            const overlay: ScheduleOverlay = {
                id: 'ov-travel',
                userId: 'u1',
                title: 'Hotel Stay',
                category: 'limited_availability',
                startDate: '2026-11-20',
                endDate: '2026-11-22',
                dailyAvailabilityMinutes: 30,
                volumeScale: 0.5,
                intensityScale: 0.5,
                expectedCost: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
                environment: 'indoor',
                equipment: ['indoor_bike'],
                createdAt: '2026-09-01T00:00:00Z',
                updatedAt: '2026-09-01T00:00:00Z',
            };

            const avail = resolveAvailability('2026-11-21', null, [], ctx, [overlay]);
            expect(avail.maxTimeMinutes).toBe(30);
            expect(avail.environmentOverride).toBe('indoor');
            expect(avail.availableEquipment).toEqual(['indoor_bike']);
        });

        it('ignores overlays outside of the requested date', () => {
            const ctx = testContext();
            const overlay: ScheduleOverlay = {
                id: 'ov-future',
                userId: 'u1',
                title: 'December Trip',
                category: 'sedentary_rest',
                startDate: '2026-12-24',
                endDate: '2026-12-26',
                dailyAvailabilityMinutes: 0,
                volumeScale: 0,
                intensityScale: 0,
                expectedCost: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
                createdAt: '2026-09-01T00:00:00Z',
                updatedAt: '2026-09-01T00:00:00Z',
            };

            const avail = resolveAvailability('2026-11-20', null, [], ctx, [overlay]);
            expect(avail.maxTimeMinutes).toBe(60);
        });
    });

    describe('applyPlanningOverlays', () => {
        it('scales planned dose by active overlay volume and intensity scales', () => {
            const overlay: ScheduleOverlay = {
                id: 'ov-reduced',
                userId: 'u1',
                title: 'Easy Week',
                category: 'limited_availability',
                startDate: '2026-11-10',
                endDate: '2026-11-15',
                dailyAvailabilityMinutes: 45,
                volumeScale: 0.6,
                intensityScale: 0.8,
                expectedCost: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
                createdAt: '2026-09-01T00:00:00Z',
                updatedAt: '2026-09-01T00:00:00Z',
            };

            const dose = applyPlanningOverlays(
                { volume: 100, intensity: 100 },
                '2026-11-12',
                [],
                null,
                [overlay],
            );

            expect(dose.volume).toBeCloseTo(60);
            expect(dose.intensity).toBeCloseTo(80);
        });
    });

    describe('Category 1: Active Sport (Skiing trip)', () => {
        it('diverts recommendation to Rest/Mobility when 0 minutes are available', async () => {
            const ctx = testContext();
            const skiingOverlay: ScheduleOverlay = {
                id: 'ov-skiing',
                userId: 'u1',
                title: 'Alps Ski Trip',
                category: 'active_sport',
                sport: 'skiing',
                startDate: '2026-11-20',
                endDate: '2026-11-25',
                dailyAvailabilityMinutes: 0,
                volumeScale: 0,
                intensityScale: 0,
                expectedCost: {
                    systemic: 0.7,
                    cardiovascular: 0.5,
                    lowerBody: 0.85,
                    upperBody: 0.15,
                    impactTissue: 0.4,
                    neuromuscular: 0.5,
                },
                createdAt: '2026-09-01T00:00:00Z',
                updatedAt: '2026-09-01T00:00:00Z',
            };

            const rec = await evaluateTrainingWithIntent(
                'u1',
                highReadiness(),
                ctx,
                [],
                '2026-11-20',
                undefined,
                undefined,
                EMPTY_HISTORY,
                [],
                [],
                null,
                null,
                'max',
                null,
                'off',
                undefined,
                null,
                false,
                [skiingOverlay],
            );

            // Because dailyAvailabilityMinutes is 0, only Rest or 0-min templates are eligible
            expect(rec.template.category === 'Rest' || rec.template.durationMin === 0).toBe(true);
        });
    });

    describe('Category 2: Sedentary Rest (Christmas holiday)', () => {
        it('prevents weekly anchors from being scheduled on Christmas day', () => {
            const ctx = testContext();
            const christmasOverlay: ScheduleOverlay = {
                id: 'ov-xmas',
                userId: 'u1',
                title: 'Christmas Rest',
                category: 'sedentary_rest',
                startDate: '2026-12-25',
                endDate: '2026-12-26',
                dailyAvailabilityMinutes: 0,
                volumeScale: 0,
                intensityScale: 0,
                expectedCost: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
                createdAt: '2026-09-01T00:00:00Z',
                updatedAt: '2026-09-01T00:00:00Z',
            };

            // 2026-12-25 is Friday
            const anchors = resolveWeeklyAnchors('2026-12-21', 7, [], [], ctx, undefined, undefined, [christmasOverlay]);
            // Christmas day (2026-12-25) should not be the quality or event-specific anchor date because availability is 0 min
            expect(anchors.qualityAnchorDate).not.toBe('2026-12-25');
            expect(anchors.eventSpecificAnchorDate).not.toBe('2026-12-25');
        });
    });

    describe('Category 3: High-Step Walking (City break)', () => {
        it('injects impact tissue fatigue into reserved capacity profile', () => {
            const ctx = testContext();
            const cityBreak: ScheduleOverlay = {
                id: 'ov-rome',
                userId: 'u1',
                title: 'Rome Sightseeing',
                category: 'high_step_walking',
                startDate: '2026-10-15',
                endDate: '2026-10-18',
                dailyAvailabilityMinutes: 30,
                volumeScale: 0.5,
                intensityScale: 0.5,
                expectedCost: {
                    systemic: 0.4,
                    cardiovascular: 0.3,
                    lowerBody: 0.3,
                    upperBody: 0.0,
                    impactTissue: 0.55,
                    neuromuscular: 0.1,
                },
                createdAt: '2026-09-01T00:00:00Z',
                updatedAt: '2026-09-01T00:00:00Z',
            };

            const avail = resolveAvailability('2026-10-16', null, [], ctx, [cityBreak]);
            expect(avail.reservedCapacityCostProfile.impactTissue).toBe(0.55);
            expect(avail.maxTimeMinutes).toBe(30);
        });
    });
});
