import { describe, expect, it } from 'vitest';
import { rankCandidates, type OptimizationOptions } from './optimizer';
import { resolveRecoveryPlacementState, type RecoveryPlacementState } from './recoveryPlacement';
import type { SessionTemplate, UserPreferences, WeeklyObjective } from './models';
import type { ResolvedAvailability } from './schedule';
import { createEmptyFatigue } from './fatigue';
import { SEPTEMBER_CYCLING_EVENT_COVERAGE_SET } from '../workouts/event-plan';
import type { CoverageState } from './coverage';

function baseAvailability(): ResolvedAvailability {
    return {
        date: '2026-09-08',
        maxTimeMinutes: 90,
        availableEquipment: ['dumbbells', 'indoor_bike'],
        fixedActivities: [],
        reservedCapacityCost: 0,
        environmentOverride: null,
        reservedCapacityCostProfile: {
            systemic: 0,
            cardiovascular: 0,
            lowerBody: 0,
            upperBody: 0,
            impactTissue: 0,
            neuromuscular: 0,
        },
    };
}

const restCandidate: SessionTemplate = {
    id: 'rest_01',
    category: 'Rest',
    modality: 'None',
    durationMin: 0,
    durationMax: 0,
    title: 'Rest Day',
    description: 'Full rest and recovery.',
    requiredEquipment: [],
    environment: 'either',
    safetyTags: [],
    systemicCost: 0,
};

const mobilityCandidate: SessionTemplate = {
    id: 'mob_01',
    category: 'Mobility/Recovery',
    modality: 'Mobility',
    durationMin: 20,
    durationMax: 30,
    title: 'Mobility Flow',
    description: 'Gentle tissue mobilization.',
    requiredEquipment: [],
    environment: 'either',
    safetyTags: [],
    systemicCost: 0.1,
};

const hardEnduranceCandidate: SessionTemplate = {
    id: 'end_hard_01',
    category: 'Hard Endurance',
    modality: 'Cycling',
    durationMin: 60,
    durationMax: 75,
    title: 'VO2 Max Intervals',
    description: 'High intensity aerobic power.',
    requiredEquipment: ['indoor_bike'],
    environment: 'either',
    safetyTags: [],
    systemicCost: 0.85,
};

describe('ADR-0038 Candidate Ranking with Recovery Placement (RP3)', () => {
    const fatigue = createEmptyFatigue('2026-09-08');
    const availability = baseAvailability();
    const preferences: UserPreferences = {
        userId: 'user_1',
        preferredRecoveryStyle: 'mixed',
        defaultWeekdayTimeMin: 60,
        defaultWeekendTimeMin: 90,
        preferredTimeOfDay: 'flexible',
        avoidedModalities: [],
        preferredModalities: [],
        deprioritizedModalities: [],
        explanationVerbosity: 'brief',
        conservativeBias: false,
        preferredUnits: {
            distance: 'km',
            weight: 'kg',
            temperature: 'celsius',
        },
        schemaVersion: 1,
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
    };
    const unresolvedObjectives: WeeklyObjective[] = [];

    it('ranks recovery candidate #1 when recovery is due today (Tier 1)', () => {
        const recoveryPlacementState: RecoveryPlacementState = resolveRecoveryPlacementState({
            asOfDate: '2026-09-08',
            latestQualifyingRecoveryDate: '2026-09-01',
        });
        expect(recoveryPlacementState.isDueToday).toBe(true);
        expect(recoveryPlacementState.dueByDate).toBe('2026-09-08');

        const options: OptimizationOptions = {
            date: '2026-09-08',
            recoveryPlacementState,
        };

        const result = rankCandidates(
            [restCandidate, hardEnduranceCandidate],
            unresolvedObjectives,
            fatigue,
            availability,
            [],
            preferences,
            options
        );

        expect(result.accepted.length).toBeGreaterThan(0);
        const topCandidate = result.accepted[0];
        expect(topCandidate.template.id).toBe('rest_01');
        expect(topCandidate.recoveryPlacementTier).toBe(1);
        expect(topCandidate.rationale).toContain('Advances mandatory weekly recovery placement.');
    });

    it('ranks recovery candidate at Tier 2 when eligible but not strictly due today', () => {
        const recoveryPlacementState: RecoveryPlacementState = resolveRecoveryPlacementState({
            asOfDate: '2026-09-08',
            latestQualifyingRecoveryDate: '2026-09-04',
        });
        expect(recoveryPlacementState.isDueToday).toBe(false);
        expect(recoveryPlacementState.isOverdue).toBe(false);

        const options: OptimizationOptions = {
            date: '2026-09-08',
            recoveryPlacementState,
        };

        const result = rankCandidates(
            [restCandidate, hardEnduranceCandidate],
            unresolvedObjectives,
            fatigue,
            availability,
            [],
            preferences,
            options
        );

        const restRanked = result.accepted.find(c => c.template.id === 'rest_01')!;
        expect(restRanked.recoveryPlacementTier).toBe(2);
        expect(restRanked.coverageNeedTier).toBe(2);
        expect(restRanked.rationale).toContain('Eligible for proactive weekly recovery placement.');
    });

    it('preserves Tier 0 programming authority when an authored anchor is nominated', () => {
        const recoveryPlacementState: RecoveryPlacementState = resolveRecoveryPlacementState({
            asOfDate: '2026-09-08',
            latestQualifyingRecoveryDate: '2026-09-01',
        });
        expect(recoveryPlacementState.isDueToday).toBe(true);

        const anchorCandidate: SessionTemplate = {
            ...hardEnduranceCandidate,
            id: 'end_race_specific_01',
            category: 'Race-Specific Endurance',
        };

        const coverageState: CoverageState = {
            asOfDate: '2026-09-08',
            phase: 'build',
            activeBlockId: 'block_1',
            coverageSetId: 'september_cycling_event',
            descriptor: SEPTEMBER_CYCLING_EVENT_COVERAGE_SET,
            requirements: [
                {
                    id: 'req_anchor',
                    key: 'outdoor_event_specific',
                    label: 'Outdoor event specific',
                    requirement: 'required',
                    minimumSessions: 1,
                    targetSessions: 1,
                    completedSessions: 0,
                    projectedSessions: 0,
                    priority: 'must_have',
                    rollingWindowDays: 7,
                    windowStart: '2026-09-01',
                    windowEnd: '2026-09-14',
                    credits: [],
                },
            ],
        };

        const options: OptimizationOptions = {
            date: '2026-09-08',
            anchorRole: 'event-specific',
            coverageState,
            recoveryPlacementState,
        };

        const result = rankCandidates(
            [restCandidate, anchorCandidate],
            unresolvedObjectives,
            fatigue,
            availability,
            [],
            preferences,
            options,
        );

        const anchorRanked = result.accepted.find(c => c.template.id === 'end_race_specific_01')!;
        const restRanked = result.accepted.find(c => c.template.id === 'rest_01')!;
        expect(anchorRanked.coverageNeedTier).toBe(0);
        expect(restRanked.coverageNeedTier).toBe(1);
        expect(result.accepted[0].template.id).toBe('end_race_specific_01');
    });

    it('honors recovery preference style (active mobility vs complete rest)', () => {
        const recoveryPlacementState: RecoveryPlacementState = resolveRecoveryPlacementState({
            asOfDate: '2026-09-08',
            latestQualifyingRecoveryDate: '2026-09-01',
        });

        const activePrefs: UserPreferences = {
            ...preferences,
            preferredRecoveryStyle: 'active',
        };

        const result = rankCandidates(
            [restCandidate, mobilityCandidate],
            unresolvedObjectives,
            fatigue,
            availability,
            [],
            activePrefs,
            { date: '2026-09-08', recoveryPlacementState, fatigueTier: 'recover' },
        );

        expect(result.accepted[0].template.id).toBe('mob_01');
    });

    it('excludes recovery candidate if rejected by hard constraint before ranking', () => {
        const recoveryPlacementState: RecoveryPlacementState = resolveRecoveryPlacementState({
            asOfDate: '2026-09-08',
            latestQualifyingRecoveryDate: '2026-09-01',
        });

        const timeRestrictedAvailability: ResolvedAvailability = {
            ...availability,
            maxTimeMinutes: 10,
        };

        const result = rankCandidates(
            [mobilityCandidate, restCandidate],
            unresolvedObjectives,
            fatigue,
            timeRestrictedAvailability,
            [],
            preferences,
            { date: '2026-09-08', recoveryPlacementState },
        );

        const mobilityRejected = result.rejected.find(c => c.template.id === 'mob_01')!;
        expect(mobilityRejected.excludedReasons).toContain('TIME_BUDGET_EXCEEDED');
        expect(result.accepted[0].template.id).toBe('rest_01');
    });
});
