import { describe, expect, it } from 'vitest';
import type { FatigueState, UserPreferences } from './models';
import { rankCandidates, type RecentHistoryEntry } from './optimizer';
import { resolveMinimumDaysAfterHardLowerBody, resolveRecoveryHoursForTemplate } from './planningCandidate';
import type { ResolvedAvailability } from './schedule';
import { ENRICHED_TEMPLATES } from './templates';

const ZERO_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-08-23',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const AVAILABILITY: ResolvedAvailability = {
    date: '2026-08-24',
    maxTimeMinutes: 120,
    // outdoor_bike: this fixture's history and candidates center on an outdoor race-simulation
    // ride (end_race_sim_01), which now hard-requires declared outdoor bicycle access.
    availableEquipment: ['free_weights', 'indoor_bike', 'treadmill', 'cable_machine', 'outdoor_bike'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

const PREFERENCES: UserPreferences = {
    userId: 'recovery-propagation-test',
    avoidedModalities: [],
    deprioritizedModalities: [],
    preferredModalities: [],
    conservativeBias: false,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible',
    explanationVerbosity: 'detailed',
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
};

describe('declared recovery window propagation (Issue #212)', () => {
    const hardCycling = ENRICHED_TEMPLATES.find(t => t.id === 'end_hard_02');
    const raceSimulation = ENRICHED_TEMPLATES.find(t => t.id === 'end_race_sim_01');
    const easySpin = ENRICHED_TEMPLATES.find(t => t.id === 'end_easy_01');
    const easyRun = ENRICHED_TEMPLATES.find(t => t.id === 'end_easy_02');
    const mobility = ENRICHED_TEMPLATES.find(t => t.id === 'mob_01');
    const rest = ENRICHED_TEMPLATES.find(t => t.id === 'rest_01');

    if (!hardCycling || !raceSimulation || !easySpin || !easyRun || !mobility || !rest) {
        throw new Error('Missing test template fixtures');
    }

    describe('48-hour threshold recovery window', () => {
        const thresholdHistory48h: RecentHistoryEntry[] = [
            {
                date: '2026-08-23',
                templateId: 'end_hard_02',
                modality: 'Cycling',
                category: 'Hard Endurance',
                role: 'anchor',
                systemicCost: 1.0,
                lowerBodyCost: 0.5,
                durationMin: 60,
                recoveryHours: 48,
            },
        ];

        it('rejects hard quality candidate on day +1 with RECOVERY_WINDOW_UNELAPSED', () => {
            const result = rankCandidates(
                [hardCycling],
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-24' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-24',
                    recentHistory: thresholdHistory48h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );

            expect(result.rejected).toHaveLength(1);
            expect(result.rejected[0].excludedReasons).toContain('RECOVERY_WINDOW_UNELAPSED');
        });

        it('allows hard quality candidate on day +2 after 48h has elapsed', () => {
            const result = rankCandidates(
                [hardCycling],
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-25' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-25',
                    recentHistory: thresholdHistory48h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );

            expect(result.accepted).toHaveLength(1);
            expect(result.accepted[0].excludedReasons).not.toContain('RECOVERY_WINDOW_UNELAPSED');
        });
    });

    describe('54-hour over-under recovery window', () => {
        const overUnderHistory54h: RecentHistoryEntry[] = [
            {
                date: '2026-08-23',
                templateId: 'end_hard_02',
                modality: 'Cycling',
                category: 'Hard Endurance',
                role: 'anchor',
                systemicCost: 1.0,
                lowerBodyCost: 0.5,
                durationMin: 75,
                recoveryHours: 54,
            },
        ];

        it('rejects hard quality candidate on day +1', () => {
            const result = rankCandidates(
                [hardCycling],
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-24' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-24',
                    recentHistory: overUnderHistory54h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );

            expect(result.rejected).toHaveLength(1);
            expect(result.rejected[0].excludedReasons).toContain('RECOVERY_WINDOW_UNELAPSED');
        });

        it('rejects hard quality candidate on day +2 (54h requires 3 calendar days in discrete daily planning)', () => {
            const result = rankCandidates(
                [hardCycling],
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-25' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-25',
                    recentHistory: overUnderHistory54h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );

            expect(result.rejected).toHaveLength(1);
            expect(result.rejected[0].excludedReasons).toContain('RECOVERY_WINDOW_UNELAPSED');
        });

        it('allows hard quality candidate on day +3 after 54h has elapsed', () => {
            const result = rankCandidates(
                [hardCycling],
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-26' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-26',
                    recentHistory: overUnderHistory54h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );

            expect(result.accepted).toHaveLength(1);
            expect(result.accepted[0].excludedReasons).not.toContain('RECOVERY_WINDOW_UNELAPSED');
        });
    });

    describe('72-hour race simulation recovery window', () => {
        const raceSimHistory72h: RecentHistoryEntry[] = [
            {
                date: '2026-08-23',
                templateId: 'end_race_sim_01',
                modality: 'Cycling',
                category: 'Race-Specific Endurance',
                role: 'anchor',
                systemicCost: 0.95,
                lowerBodyCost: 0.6,
                durationMin: 75,
                recoveryHours: 72,
            },
        ];

        it('rejects hard candidate on day +1 and day +2', () => {
            const day1Result = rankCandidates(
                [raceSimulation],
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-24' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-24',
                    recentHistory: raceSimHistory72h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );
            expect(day1Result.rejected).toHaveLength(1);
            expect(day1Result.rejected[0].excludedReasons).toContain('RECOVERY_WINDOW_UNELAPSED');

            const day2Result = rankCandidates(
                [raceSimulation],
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-25' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-25',
                    recentHistory: raceSimHistory72h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );
            expect(day2Result.rejected).toHaveLength(1);
            expect(day2Result.rejected[0].excludedReasons).toContain('RECOVERY_WINDOW_UNELAPSED');
        });

        it('allows hard candidate on day +3 after 72h window elapses', () => {
            const day3Result = rankCandidates(
                [raceSimulation],
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-26' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-26',
                    recentHistory: raceSimHistory72h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );
            expect(day3Result.accepted).toHaveLength(1);
            expect(day3Result.accepted[0].excludedReasons).not.toContain('RECOVERY_WINDOW_UNELAPSED');
        });
    });

    describe('admissibility of easy and recovery work inside active recovery window', () => {
        const heavyPriorHistory: RecentHistoryEntry[] = [
            {
                date: '2026-08-23',
                templateId: 'end_race_sim_01',
                modality: 'Cycling',
                category: 'Race-Specific Endurance',
                role: 'anchor',
                systemicCost: 0.95,
                lowerBodyCost: 0.6,
                durationMin: 75,
                recoveryHours: 72,
            },
        ];

        it('keeps easy endurance, mobility, and rest admissible on day +1', () => {
            const easyCandidates = [easySpin, easyRun, mobility, rest];
            const result = rankCandidates(
                easyCandidates,
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-24' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-24',
                    recentHistory: heavyPriorHistory,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );

            expect(result.accepted).toHaveLength(easyCandidates.length);
            for (const candidate of result.accepted) {
                expect(candidate.excludedReasons).not.toContain('RECOVERY_WINDOW_UNELAPSED');
            }
        });
    });

    describe('greedy forecast and weekly allocator parity', () => {
        it('rejects hard candidates inside recovery window identically in projected-date outcomes and direct ranking', () => {
            const historyWith72h: RecentHistoryEntry[] = [
                {
                    date: '2026-08-23',
                    templateId: 'end_race_sim_01',
                    modality: 'Cycling',
                    category: 'Race-Specific Endurance',
                    role: 'anchor',
                    systemicCost: 0.95,
                    lowerBodyCost: 0.6,
                    durationMin: 75,
                    recoveryHours: 72,
                },
            ];

            const rankingDay1 = rankCandidates(
                ENRICHED_TEMPLATES,
                [],
                ZERO_FATIGUE,
                { ...AVAILABILITY, date: '2026-08-24' },
                [],
                PREFERENCES,
                {
                    date: '2026-08-24',
                    recentHistory: historyWith72h,
                    resolveMinimumDaysAfterHardLowerBody,
                    resolveRecoveryHours: resolveRecoveryHoursForTemplate,
                },
            );

            // Hard/anchor candidates are rejected with RECOVERY_WINDOW_UNELAPSED
            const hardCyclingCandidate = rankingDay1.rejected.find(c => c.template.id === 'end_hard_02');
            expect(hardCyclingCandidate?.excludedReasons).toContain('RECOVERY_WINDOW_UNELAPSED');

            const raceSimCandidate = rankingDay1.rejected.find(c => c.template.id === 'end_race_sim_01');
            expect(raceSimCandidate?.excludedReasons).toContain('RECOVERY_WINDOW_UNELAPSED');

            // Easy candidates are accepted
            const easySpinCandidate = rankingDay1.accepted.find(c => c.template.id === 'end_easy_01');
            expect(easySpinCandidate).toBeDefined();
            expect(easySpinCandidate?.excludedReasons).toHaveLength(0);
        });
    });
});
