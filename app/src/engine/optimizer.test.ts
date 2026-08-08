import { describe, expect, it } from 'vitest';
import { buildOptimizationContext, rankCandidates, rankCandidatesByUtility, type RecentHistoryEntry } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import type { FatigueState, UserContext, UserPreferences, WeeklyObjective } from './models';
import type { ResolvedAvailability } from './schedule';

const DEFAULT_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-03-01',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const DEFAULT_AVAILABILITY: ResolvedAvailability = {
    date: '2026-03-01',
    maxTimeMinutes: 120,
    availableEquipment: ['free_weights', 'indoor_bike', 'treadmill', 'cable_machine'],
    fixedActivities: [],
    reservedCapacityCost: 0,
};

const DEFAULT_PREFERENCES: UserPreferences = {
    userId: 'user_default',
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

describe('optimizer â€” dated, role-aware recovery constraints (F3 / 3.1)', () => {
    it('allows three cycling sessions across 7 days with >= 48h spacing without repetition penalty', () => {
        const thresholdRide = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-01', modality: 'Cycling', category: 'Hard Endurance', role: 'anchor', systemicCost: 0.8, lowerBodyCost: 0.5, type: 'Cycling' },
            { date: '2026-03-02', modality: 'Rest', category: 'Rest', role: 'recovery', systemicCost: 0, lowerBodyCost: 0, type: 'Rest' },
            { date: '2026-03-03', modality: 'Cycling', category: 'Moderate Endurance', role: 'supporting', systemicCost: 0.5, lowerBodyCost: 0.3, type: 'Cycling' },
        ];

        // Target date 2026-03-05 (48h after 2026-03-03)
        const result = rankCandidates(
            [thresholdRide],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: '2026-03-05', recentHistory: history }
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].excludedReasons).toEqual([]);
        expect(result.accepted[0].utilityScore).toBeGreaterThan(0);
    });

    it('rejects two hard lower-body sessions on consecutive days with HARD_LOWER_BODY_SPACING_VIOLATION', () => {
        const heavySquat = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength') ?? ENRICHED_TEMPLATES.find(t => t.modality === 'Strength')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-04', modality: 'Strength', category: 'Lower-body Strength', role: 'anchor', systemicCost: 0.7, lowerBodyCost: 0.8, type: 'Lower-body Strength' }
        ];

        // Target date 2026-03-05 (consecutive day, dayDiff = 1)
        const result = rankCandidates(
            [heavySquat],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: '2026-03-05', recentHistory: history }
        );

        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
    });
});

describe('optimizer â€” lexicographic ordering (3.2)', () => {
    it('ensures preference multiplier cannot promote a zero-objective candidate over an objective-satisfying candidate', () => {
        const thresholdObj: WeeklyObjective = {
            id: 'obj_1',
            key: 'threshold_quality',
            title: 'Threshold Development',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { thresholdPower: 0.8 },
        };

        const thresholdCandidate = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const dislikedObjCandidate = {
            ...thresholdCandidate,
            id: 'obj_candidate_disliked',
            modality: 'Running' as const, // marked as avoided -> soft 0.2 penalty
        };

        const preferredNoObjCandidate = {
            ...ENRICHED_TEMPLATES.find(t => t.category === 'Mobility/Recovery')!,
            id: 'no_obj_candidate_preferred',
            modality: 'Mobility' as const, // preferred -> soft 1.3 boost
        };

        const prefs: UserPreferences = {
            ...DEFAULT_PREFERENCES,
            avoidedModalities: ['Running'],
            preferredModalities: ['Mobility'],
        };

        const result = rankCandidatesByUtility(
            [dislikedObjCandidate, preferredNoObjCandidate],
            [thresholdObj],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            prefs,
            { date: '2026-03-05' }
        );

        // Lexicographic ordering guarantees Level 4 (Objective benefit) beats Level 6 (Preference)
        expect(result[0].template.id).toBe('obj_candidate_disliked');
    });

    it('populates excludedReasons for every filtered candidate', () => {
        const shortTimeAvailability: ResolvedAvailability = {
            ...DEFAULT_AVAILABILITY,
            maxTimeMinutes: 15,
        };

        const longWorkout = ENRICHED_TEMPLATES.find(t => t.durationMin > 30)!;

        const result = rankCandidates(
            [longWorkout],
            [],
            DEFAULT_FATIGUE,
            shortTimeAvailability,
            [],
            DEFAULT_PREFERENCES,
            { date: '2026-03-05' }
        );

        expect(result.accepted).toHaveLength(0);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('TIME_BUDGET_EXCEEDED');
    });
});

describe('optimizer â€” one optimizer invocation context (F4 / 3.3)', () => {
    it('buildOptimizationContext produces equivalent context from intent and context inputs', () => {
        const intent = {
            unresolvedObjectives: [],
            fatigue: DEFAULT_FATIGUE,
            periodization: { focusEvent: null },
            history: [{ date: '2026-03-01', modality: 'Cycling', category: 'Hard Endurance' as const, systemicCost: 0.8, lowerBodyCost: 0.5 }],
        };
        const testContext = {
            trainingSettings: { userId: 'user_1', defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90 } },
            constraints: { restrictedModalities: ['Running'] },
            preferences: DEFAULT_PREFERENCES,
        } as unknown as UserContext;

        const optContext = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');

        expect(optContext.injuryConstraints).toEqual(['Running']);
        expect(optContext.preferences.userId).toBe('user_1');
        expect(optContext.options.date).toBe('2026-03-05');
        expect(optContext.options.recentHistory).toHaveLength(1);
    });

    it('returns identical ranking when given identical OptimizationContext', () => {
        const template = ENRICHED_TEMPLATES.find(t => (t.requiredEquipment ?? []).length === 0)!;
        const intent = {
            unresolvedObjectives: [],
            fatigue: DEFAULT_FATIGUE,
            periodization: { focusEvent: null },
            history: [],
        };
        const testContext = {
            trainingSettings: { userId: 'user_1', defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90 } },
            constraints: { restrictedModalities: [] },
            preferences: DEFAULT_PREFERENCES,
        } as unknown as UserContext;

        const optCtx1 = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');
        const optCtx2 = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');

        const res1 = rankCandidates([template], optCtx1.unresolvedObjectives, optCtx1.fatigueState, optCtx1.availability, optCtx1.injuryConstraints, optCtx1.preferences, optCtx1.options);
        const res2 = rankCandidates([template], optCtx2.unresolvedObjectives, optCtx2.fatigueState, optCtx2.availability, optCtx2.injuryConstraints, optCtx2.preferences, optCtx2.options);

        expect(res1.accepted[0].utilityScore).toEqual(res2.accepted[0].utilityScore);
    });
});

describe('PlannedDose intensity eligibility (4.5)', () => {
    it('keeps hard candidates eligible for a volume-reduced taper when intensity is held, but excludes them below baseline intensity', () => {
        const hardRide = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const taper = rankCandidates(
            [hardRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', plannedDose: { volume: 0.5, intensity: 1 } },
        );
        const reducedIntensity = rankCandidates(
            [hardRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', plannedDose: { volume: 0.8, intensity: 0.7 } },
        );

        expect(taper.accepted).toHaveLength(1);
        expect(reducedIntensity.rejected[0].excludedReasons).toContain('INTENSITY_SCALE_INADMISSIBLE');
    });
});
