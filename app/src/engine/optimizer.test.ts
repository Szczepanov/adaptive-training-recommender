import { describe, expect, it } from 'vitest';
import { buildOptimizationContext, calculateStimulusBenefit, rankCandidates, rankCandidatesByUtility, type RecentHistoryEntry } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import type { FatigueState, SessionTemplate, UserContext, UserPreferences, WeeklyObjective } from './models';
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

const ZERO_CANONICAL_STIMULUS = {
    aerobicEndurance: 0,
    thresholdPower: 0,
    vo2MaxPower: 0,
    repeatedSurges: 0,
    sprintPower: 0,
    fatigueResistance: 0,
    maxStrength: 0,
    hypertrophy: 0,
};

describe('optimizer — dated, role-aware recovery constraints (F3 / 3.1)', () => {
    it('allows three cycling sessions across 7 days with >= 48h spacing without repetition penalty', () => {
        const thresholdRide = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-01', modality: 'Cycling', category: 'Hard Endurance', role: 'anchor', systemicCost: 0.8, lowerBodyCost: 0.5, type: 'Cycling' },
            { date: '2026-03-02', modality: 'Rest', category: 'Rest', role: 'recovery', systemicCost: 0, lowerBodyCost: 0, type: 'Rest' },
            { date: '2026-03-03', modality: 'Cycling', category: 'Moderate Endurance', role: 'supporting', systemicCost: 0.5, lowerBodyCost: 0.3, type: 'Cycling' },
        ];

        const result = rankCandidates(
            [thresholdRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', recentHistory: history }
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].excludedReasons).toEqual([]);
        expect(result.accepted[0].utilityScore).toBeGreaterThan(0);
    });

    it('rejects a hard candidate when planned intensity is below the 0.8 admissibility boundary', () => {
        const hardRide = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const result = rankCandidates(
            [hardRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', plannedDose: { volume: 1, intensity: 0.79 } }
        );

        expect(result.accepted).toHaveLength(0);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('INTENSITY_SCALE_INADMISSIBLE');
    });

    it('rejects two hard lower-body sessions on consecutive days with HARD_LOWER_BODY_SPACING_VIOLATION', () => {
        const heavySquat = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength') ?? ENRICHED_TEMPLATES.find(t => t.modality === 'Strength')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-04', modality: 'Strength', category: 'Lower-body Strength', role: 'anchor', systemicCost: 0.7, lowerBodyCost: 0.8, type: 'Lower-body Strength' }
        ];

        const result = rankCandidates(
            [heavySquat], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05', recentHistory: history }
        );

        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
    });

    // Phase 5.2: a detailed workout's own minimumDaysAfterHardLowerBody can require a
    // longer (or shorter) gap than the flat default -- resolveMinimumDaysAfterHardLowerBody
    // is the injection point (planningCandidate.ts is the real, catalog-backed resolver;
    // these tests exercise the mechanism directly with a synthetic one).
    describe('per-workout hard-lower-body spacing override (Phase 5.2)', () => {
        // No fallback to "any Strength template" -- a fallback that isn't heavy lower-body
        // would silently defeat evaluateRecoveryConstraints' hard-lower-body spacing rule
        // these tests exist to exercise, so a missing fixture template must fail loudly.
        const heavySquat = () => {
            const template = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength');
            if (!template) throw new Error('No Lower-body Strength template in ENRICHED_TEMPLATES');
            return template;
        };
        const oneDayPriorHistory: RecentHistoryEntry[] = [
            { date: '2026-03-04', modality: 'Strength', category: 'Lower-body Strength', role: 'anchor', systemicCost: 0.7, lowerBodyCost: 0.8, type: 'Lower-body Strength' },
        ];

        it('a stricter (3-day) workout-level requirement rejects at a day-2 gap that the flat 2-day default accepts', () => {
            const template = heavySquat();
            const twoDaysPriorHistory: RecentHistoryEntry[] = [
                { date: '2026-03-03', modality: 'Strength', category: 'Lower-body Strength', role: 'anchor', systemicCost: 0.7, lowerBodyCost: 0.8, type: 'Lower-body Strength' },
            ];
            // Default (no resolver): day-2 gap already clears the flat 2-day rule.
            const defaultResult = rankCandidates(
                [template], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                { date: '2026-03-05', recentHistory: twoDaysPriorHistory },
            );
            expect(defaultResult.accepted).toHaveLength(1);

            // A workout that declares it needs 3 full days still rejects at day 2.
            const strictResult = rankCandidates(
                [template], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                { date: '2026-03-05', recentHistory: twoDaysPriorHistory, resolveMinimumDaysAfterHardLowerBody: () => 3 },
            );
            expect(strictResult.rejected).toHaveLength(1);
            expect(strictResult.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
        });

        it('a more lenient (1-day) workout-level requirement accepts a candidate the flat 2-day default would reject', () => {
            const template = heavySquat();
            const result = rankCandidates(
                [template], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                { date: '2026-03-05', recentHistory: oneDayPriorHistory, resolveMinimumDaysAfterHardLowerBody: () => 1 },
            );
            expect(result.accepted).toHaveLength(1);
            expect(result.accepted[0].excludedReasons).not.toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
        });

        it('a resolver that returns undefined for this template falls back to the flat 2-day default, unchanged', () => {
            const template = heavySquat();
            const result = rankCandidates(
                [template], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
                { date: '2026-03-05', recentHistory: oneDayPriorHistory, resolveMinimumDaysAfterHardLowerBody: () => undefined },
            );
            expect(result.rejected).toHaveLength(1);
            expect(result.rejected[0].excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');
        });
    });

    it('rejects a hard session with ROLLING_HARD_CAP_EXCEEDED once 3 hard sessions already sit in the rolling 7-day window', () => {
        const moderateRide = ENRICHED_TEMPLATES.find(t => t.category === 'Moderate Endurance' && t.modality === 'Cycling')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-09', modality: 'Cycling', category: 'Easy Endurance', systemicCost: 0.6, lowerBodyCost: 0.3 },
            { date: '2026-03-07', modality: 'Strength', category: 'Upper-body Strength', systemicCost: 0.55, lowerBodyCost: 0 },
            { date: '2026-03-05', modality: 'Cycling', category: 'Easy Endurance', systemicCost: 0.6, lowerBodyCost: 0.3 },
        ];

        const result = rankCandidates(
            [moderateRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-10', recentHistory: history }
        );

        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('ROLLING_HARD_CAP_EXCEEDED');
    });

    it('does not count a hard session exactly 7 days back toward the rolling cap (outside the dayDiff <= 6 window)', () => {
        const moderateRide = ENRICHED_TEMPLATES.find(t => t.category === 'Moderate Endurance' && t.modality === 'Cycling')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-09', modality: 'Cycling', category: 'Easy Endurance', systemicCost: 0.6, lowerBodyCost: 0.3 },
            { date: '2026-03-07', modality: 'Strength', category: 'Upper-body Strength', systemicCost: 0.55, lowerBodyCost: 0 },
            { date: '2026-03-03', modality: 'Cycling', category: 'Easy Endurance', systemicCost: 0.6, lowerBodyCost: 0.3 },
        ];

        const result = rankCandidates(
            [moderateRide], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-10', recentHistory: history }
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].excludedReasons).not.toContain('ROLLING_HARD_CAP_EXCEEDED');
    });

    it('rejects heavy lower-body strength with ANCHOR_PROTECTION_VIOLATION when a key Cycling session sits within 1 day', () => {
        const heavySquat = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength') ?? ENRICHED_TEMPLATES.find(t => t.modality === 'Strength')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-09', modality: 'Cycling', category: 'Hard Endurance', role: 'anchor', systemicCost: 0.8, lowerBodyCost: 0.5 },
        ];

        const result = rankCandidates(
            [heavySquat], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-10', recentHistory: history }
        );

        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('ANCHOR_PROTECTION_VIOLATION');
    });

    it('does not raise ANCHOR_PROTECTION_VIOLATION when the key Cycling session sits 2 days away (outside the 0-1 day window)', () => {
        const heavySquat = ENRICHED_TEMPLATES.find(t => t.category === 'Lower-body Strength') ?? ENRICHED_TEMPLATES.find(t => t.modality === 'Strength')!;
        const history: RecentHistoryEntry[] = [
            { date: '2026-03-08', modality: 'Cycling', category: 'Hard Endurance', role: 'anchor', systemicCost: 0.8, lowerBodyCost: 0.5 },
        ];

        const result = rankCandidates(
            [heavySquat], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-10', recentHistory: history }
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].excludedReasons).not.toContain('ANCHOR_PROTECTION_VIOLATION');
    });

    it('keeps every accepted candidate exactly once after near-equivalent variety rotation (no drop or duplicate)', () => {
        const sharedProfile = {
            requiredEquipment: [] as SessionTemplate['requiredEquipment'],
            environment: 'either' as const,
            safetyTags: [] as SessionTemplate['safetyTags'],
            systemicCost: 0.4,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance: 0.6 },
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        };
        const templateA: SessionTemplate = {
            id: 'rotation_a', category: 'Easy Endurance', modality: 'Running',
            durationMin: 30, durationMax: 45, title: 'Rotation Test A', description: '', ...sharedProfile,
        };
        const templateB: SessionTemplate = {
            id: 'rotation_b', category: 'Easy Endurance', modality: 'Running',
            durationMin: 30, durationMax: 45, title: 'Rotation Test B', description: '', ...sharedProfile,
        };
        const templateC: SessionTemplate = {
            id: 'rotation_c', category: 'Easy Endurance', modality: 'Cycling',
            durationMin: 30, durationMax: 45, title: 'Rotation Test C', description: '', ...sharedProfile,
        };

        const result = rankCandidates(
            [templateA, templateC, templateB], [], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES,
            { date: '2026-03-05' }
        );

        expect(result.accepted).toHaveLength(3);
        expect(result.accepted.map(c => c.template.id).sort()).toEqual(['rotation_a', 'rotation_b', 'rotation_c']);
    });
});

describe('optimizer — lexicographic ordering (3.2)', () => {
    it('uses the stronger of max-strength and hypertrophy evidence for strength-maintenance benefit', () => {
        const strengthObjective: WeeklyObjective = {
            id: 'obj_strength_axes', key: 'strength_maintenance', title: 'Strength maintenance',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { maxStrength: 0.2, hypertrophy: 0.9 },
        };
        const candidate: SessionTemplate = {
            id: 'strength_axes', category: 'Upper-body Strength', modality: 'Strength',
            durationMin: 30, durationMax: 40, title: 'Strength Axes', description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.3,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, maxStrength: 0.2, hypertrophy: 0.9 },
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0.2, impactTissue: 0, neuromuscular: 0.2 },
        };

        expect(calculateStimulusBenefit(candidate, [strengthObjective])).toBeCloseTo(0.9 * 0.9 * 1.6 + 0.5);
    });

    it('scores the vo2MaxPower axis so a vo2_max objective can prioritize its matching templates', () => {
        const vo2Objective: WeeklyObjective = {
            id: 'obj_vo2_max', key: 'vo2_max', title: 'VO2 max development',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { vo2MaxPower: 0.9, aerobicEndurance: 0.5 },
        };
        const candidate: SessionTemplate = {
            id: 'vo2_intervals', category: 'Hard Endurance', modality: 'Running',
            durationMin: 40, durationMax: 55, title: 'VO2 Intervals', description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.6,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, vo2MaxPower: 0.9 },
            costProfile: { systemic: 0.5, cardiovascular: 0.6, lowerBody: 0.4, upperBody: 0, impactTissue: 0.4, neuromuscular: 0.2 },
        };
        const nonMatching: SessionTemplate = {
            ...candidate, id: 'easy_no_vo2', category: 'Easy Endurance',
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance: 0.5 },
        };

        expect(calculateStimulusBenefit(candidate, [vo2Objective])).toBeCloseTo(0.9 * 0.9 * 1.5 + 0.5);
        // A candidate carrying no vo2MaxPower stimulus still earns credit for the objective's
        // secondary aerobicEndurance target, but none of the vo2MaxPower contribution.
        expect(calculateStimulusBenefit(nonMatching, [vo2Objective])).toBeCloseTo(0.5 * 0.5 * 1.2 + 0.5);
    });

    it('enforces qualification.minimumStimulus so a candidate that cannot resolve an objective earns no benefit from it', () => {
        const gatedObjective: WeeklyObjective = {
            id: 'obj_gated_threshold', key: 'threshold_quality', title: 'Threshold Development',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { thresholdPower: 0.9 },
            qualification: { minimumStimulus: { thresholdPower: 0.6 } },
        };
        const belowMinimum: SessionTemplate = {
            id: 'weak_threshold', category: 'Moderate Endurance', modality: 'Running',
            durationMin: 30, durationMax: 45, title: 'Weak Threshold', description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.4,
            // thresholdPower is present but below the objective's minimumStimulus floor.
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, thresholdPower: 0.3 },
            costProfile: { systemic: 0.3, cardiovascular: 0.3, lowerBody: 0.3, upperBody: 0, impactTissue: 0.3, neuromuscular: 0.1 },
        };
        const meetsMinimum: SessionTemplate = {
            ...belowMinimum, id: 'strong_threshold',
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, thresholdPower: 0.7 },
        };

        // Below the qualification floor: the objective contributes nothing, only the baseline.
        expect(calculateStimulusBenefit(belowMinimum, [gatedObjective])).toBeCloseTo(0.5);
        // At/above the floor: the objective's threshold-power axis scores normally.
        expect(calculateStimulusBenefit(meetsMinimum, [gatedObjective])).toBeCloseTo(0.9 * 0.7 * 1.5 + 0.5);
    });

    it('ensures preference multiplier cannot promote a zero-objective candidate over an objective-satisfying candidate', () => {
        const thresholdObj: WeeklyObjective = {
            id: 'obj_1', key: 'threshold_quality', title: 'Threshold Development',
            targetExposures: 1, completedExposures: 0, targetStimulus: { thresholdPower: 0.8 },
        };

        const thresholdCandidate = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance' && t.modality === 'Cycling')!;
        const dislikedObjCandidate = { ...thresholdCandidate, id: 'obj_candidate_disliked', modality: 'Running' as const };
        const preferredNoObjCandidate = {
            ...ENRICHED_TEMPLATES.find(t => t.category === 'Mobility/Recovery')!,
            id: 'no_obj_candidate_preferred', modality: 'Mobility' as const,
        };

        const prefs: UserPreferences = {
            ...DEFAULT_PREFERENCES, avoidedModalities: ['Running'], preferredModalities: ['Mobility'],
        };

        const result = rankCandidatesByUtility(
            [dislikedObjCandidate, preferredNoObjCandidate], [thresholdObj], DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY, [], prefs, { date: '2026-03-05' }
        );

        expect(result[0].template.id).toBe('obj_candidate_disliked');
    });

    it('populates excludedReasons for every filtered candidate', () => {
        const shortTimeAvailability: ResolvedAvailability = { ...DEFAULT_AVAILABILITY, maxTimeMinutes: 15 };
        const longWorkout = ENRICHED_TEMPLATES.find(t => t.durationMin > 30)!;
        const result = rankCandidates(
            [longWorkout], [], DEFAULT_FATIGUE, shortTimeAvailability, [], DEFAULT_PREFERENCES, { date: '2026-03-05' }
        );
        expect(result.accepted).toHaveLength(0);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].excludedReasons).toContain('TIME_BUDGET_EXCEEDED');
    });

    it('produces an input-order-independent ranking across a benefit chain a naive pairwise tie-band handles non-transitively', () => {
        const aeroObj: WeeklyObjective = {
            id: 'obj_chain', key: 'zone2_aerobic', title: 'Aerobic Base',
            targetExposures: 1, completedExposures: 0, targetStimulus: { aerobicEndurance: 1 },
        };
        const makeCandidate = (id: string, aerobicEndurance: number): SessionTemplate => ({
            id, category: 'Easy Endurance', modality: 'Running',
            durationMin: 30, durationMax: 45, title: id, description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.3,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance },
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        });
        const a = makeCandidate('chain_a', 1.00 / 1.2);
        const b = makeCandidate('chain_b', 0.96 / 1.2);
        const c = makeCandidate('chain_c', 0.92 / 1.2);

        const inOrder = rankCandidates(
            [a, b, c], [aeroObj], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES, { date: '2026-03-05' }
        );
        const shuffled = rankCandidates(
            [c, a, b], [aeroObj], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], DEFAULT_PREFERENCES, { date: '2026-03-05' }
        );

        expect(inOrder.accepted).toHaveLength(3);
        expect(inOrder.accepted.map(r => r.template.id)).toEqual(shuffled.accepted.map(r => r.template.id));
    });

    it('keeps two candidates within BENEFIT_TIE_BAND of each other in the same tier even when they straddle a naive rounding boundary', () => {
        const lowObj: WeeklyObjective = {
            id: 'obj_low', key: 'zone2_aerobic', title: 'Aerobic Base',
            targetExposures: 1, completedExposures: 0, targetStimulus: { aerobicEndurance: 1 },
        };
        const makeCandidate = (id: string, aerobicEndurance: number, avoided: boolean): SessionTemplate => ({
            id, category: 'Mobility/Recovery', modality: avoided ? 'Cross Training' : 'Mobility',
            durationMin: 20, durationMax: 30, title: id, description: '',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.1,
            stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance },
            costProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        });
        const low = makeCandidate('boundary_low', 0.02 / 1.2, false);
        const high = makeCandidate('boundary_high', 0.0592 / 1.2, true);

        const result = rankCandidates(
            [low, high], [lowObj], DEFAULT_FATIGUE, DEFAULT_AVAILABILITY, [], {
                ...DEFAULT_PREFERENCES, avoidedModalities: ['Cross Training'],
            }, { date: '2026-03-05' }
        );

        expect(result.accepted[0].template.id).toBe('boundary_low');
    });
});

describe('optimizer — one optimizer invocation context (F4 / 3.3)', () => {
    it('buildOptimizationContext produces equivalent context from intent and context inputs', () => {
        const intent = {
            unresolvedObjectives: [], fatigue: DEFAULT_FATIGUE, periodization: { focusEvent: null },
            history: [{ date: '2026-03-01', modality: 'Cycling', category: 'Hard Endurance' as const, systemicCost: 0.8, lowerBodyCost: 0.5 }],
        };
        const testContext = {
            trainingSettings: { userId: 'user_1', defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90 } },
            constraints: { restrictedModalities: ['Running'] }, preferences: DEFAULT_PREFERENCES,
        } as unknown as UserContext;

        const optContext = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');

        expect(optContext.injuryConstraints).toEqual(['Running']);
        expect(optContext.preferences.userId).toBe('user_1');
        expect(optContext.options.date).toBe('2026-03-05');
        expect(optContext.options.recentHistory).toHaveLength(1);
    });

    it('returns identical ranking when given identical OptimizationContext', () => {
        const template = ENRICHED_TEMPLATES.find(t => (t.requiredEquipment ?? []).length === 0)!;
        const intent = { unresolvedObjectives: [], fatigue: DEFAULT_FATIGUE, periodization: { focusEvent: null }, history: [] };
        const testContext = {
            trainingSettings: { userId: 'user_1', defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 90 } },
            constraints: { restrictedModalities: [] }, preferences: DEFAULT_PREFERENCES,
        } as unknown as UserContext;

        const optCtx1 = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');
        const optCtx2 = buildOptimizationContext(intent, testContext, DEFAULT_PREFERENCES, '2026-03-05');
        const res1 = rankCandidates([template], optCtx1.unresolvedObjectives, optCtx1.fatigueState, optCtx1.availability, optCtx1.injuryConstraints, optCtx1.preferences, optCtx1.options);
        const res2 = rankCandidates([template], optCtx2.unresolvedObjectives, optCtx2.fatigueState, optCtx2.availability, optCtx2.injuryConstraints, optCtx2.preferences, optCtx2.options);

        expect(res1.accepted[0].utilityScore).toEqual(res2.accepted[0].utilityScore);
    });
});
