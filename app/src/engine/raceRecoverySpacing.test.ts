import { describe, expect, it } from 'vitest';
import type { FatigueState, UserPreferences } from './models';
import { rankCandidates, type RecentHistoryEntry } from './optimizer';
import { resolveMinimumDaysAfterHardLowerBody } from './planningCandidate';
import type { ResolvedAvailability } from './schedule';
import { ENRICHED_TEMPLATES } from './templates';

const ZERO_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-08-23',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const AVAILABILITY: ResolvedAvailability = {
    date: '2026-08-25',
    maxTimeMinutes: 120,
    availableEquipment: ['free_weights', 'indoor_bike', 'treadmill', 'cable_machine'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

const PREFERENCES: UserPreferences = {
    userId: 'recovery-spacing-test',
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

const HARD_CYCLING_HISTORY: RecentHistoryEntry[] = [
    {
        date: '2026-08-23',
        templateId: 'end_hard_02',
        modality: 'Cycling',
        category: 'Hard Endurance',
        role: 'anchor',
        systemicCost: 1,
        lowerBodyCost: 0.8,
        durationMin: 75,
    },
];

describe('race simulation recovery spacing', () => {
    const raceSimulation = ENRICHED_TEMPLATES.find(template => template.id === 'end_race_sim_01');
    if (!raceSimulation) throw new Error('Missing end_race_sim_01 fixture');

    it('publishes a three-day minimum after hard lower-body work', () => {
        expect(resolveMinimumDaysAfterHardLowerBody(raceSimulation.id)).toBe(3);
    });

    it('rejects the race simulation two calendar days after a hard cycling anchor', () => {
        const result = rankCandidates(
            [raceSimulation],
            [],
            ZERO_FATIGUE,
            AVAILABILITY,
            [],
            PREFERENCES,
            {
                date: '2026-08-25',
                recentHistory: HARD_CYCLING_HISTORY,
                resolveMinimumDaysAfterHardLowerBody,
            },
        );

        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
    });

    it('allows the race simulation three calendar days after a hard cycling anchor', () => {
        const result = rankCandidates(
            [raceSimulation],
            [],
            ZERO_FATIGUE,
            { ...AVAILABILITY, date: '2026-08-26' },
            [],
            PREFERENCES,
            {
                date: '2026-08-26',
                recentHistory: HARD_CYCLING_HISTORY,
                resolveMinimumDaysAfterHardLowerBody,
            },
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].excludedReasons).not.toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
    });
});
