import { describe, it, expect } from 'vitest';
import { ENRICHED_TEMPLATES } from './templates';
import { isTemplatePhaseEligible, type PeriodizationResult } from './periodization';
import { resolveDemandProfile } from './eventPresets';
import { rankCandidates, HEAVY_LOWER_BODY_STRENGTH_CATEGORIES, isCyclingDurabilityFocusEvent } from './optimizer';
import { createEmptyFatigue } from './fatigue';
import { evaluateTrainingWithIntent } from './rules';
import { SCENARIOS } from './simulation/scenarios';
import { runScenario } from './simulation/analyze';
import type { DailyReadiness, FixedActivity, UserContext, UserEvent, UserPreferences, WeeklyObjective } from './models';
import type { ResolvedAvailability } from './schedule';
import type { TrainingHistoryProvider } from './trainingHistory';

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

function fixtureContext(overrides: Partial<UserContext['constraints']> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 180, ...overrides },
        preferences: DEFAULT_PREFERENCES,
    };
}

function fixtureReadiness(overrides: Partial<DailyReadiness['subjective']> = {}): DailyReadiness {
    return {
        subjective: { readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8, timeAvailable: 180, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null, ...overrides },
        objective: { total_steps: 8000, sleep_score: 85, sleep_duration_min: 480, rhr: 50, rhr_7d_avg: 50, rhr_delta: 0, hrv_weekly_avg: 50, hrv_last_night: 50, hrv_delta: 0, respiration: 14, body_battery_wake: 90, last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null, sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0, hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7 },
    };
}

const fixtureHistory: TrainingHistoryProvider = { reconstruct: async () => [] };

describe('Gran Fondo Durability & Anchor Protection Remediation (Issue #675)', () => {
    it('prevents compact criterium surges from qualifying for Gran Fondo phase eligibility', () => {
        const critSurges = ENRICHED_TEMPLATES.find(t => t.id === 'end_crit_surges_01')!;
        expect(critSurges).toBeDefined();
        expect(critSurges.phaseEligibility?.minRepeatedSurges).toBe(0.6);

        const granFondoDemand = resolveDemandProfile('cycling_event', 'gran_fondo');
        expect(granFondoDemand.repeatedSurges).toBe(0.3);

        const granFondoPeriodization: PeriodizationResult = {
            focusEvent: {
                id: 'e-gran-fondo',
                category: 'cycling_event',
                title: 'Gran Fondo Test',
                date: '2026-09-20',
                priority: 'A',
                lifecycle: 'scheduled',
                demandProfile: granFondoDemand,
            },
            phase: {
                phaseName: 'Specificity',
                volumeScale: 1.0,
                intensityScale: 1.0,
                taperActive: false,
                targetDemandVector: granFondoDemand,
            },
            daysToEvent: 20,
            staleEvents: [],
            partialEffort: false,
            governingEventTie: [],
        };

        // Under Gran Fondo (0.3 surges < 0.6 min), end_crit_surges_01 must NOT be eligible in specific prep
        expect(isTemplatePhaseEligible(critSurges, granFondoPeriodization)).toBe(false);

        // Under Criterium (0.9 surges >= 0.6 min), end_crit_surges_01 MUST be eligible
        const critDemand = resolveDemandProfile('cycling_event', 'criterium');
        expect(critDemand.repeatedSurges).toBe(0.9);
        const critPeriodization: PeriodizationResult = {
            focusEvent: {
                id: 'e-crit',
                category: 'cycling_event',
                title: 'Criterium Test',
                date: '2026-09-20',
                priority: 'A',
                lifecycle: 'scheduled',
                demandProfile: critDemand,
            },
            phase: {
                phaseName: 'Specificity',
                volumeScale: 1.0,
                intensityScale: 1.0,
                taperActive: false,
                targetDemandVector: critDemand,
            },
            daysToEvent: 20,
            staleEvents: [],
            partialEffort: false,
            governingEventTie: [],
        };
        expect(isTemplatePhaseEligible(critSurges, critPeriodization)).toBe(true);
    });

    it('scopes the durability exception to low-surge cycling demand rather than high-aerobic events generally', () => {
        const event = (category: UserEvent['category'], preset: string): UserEvent => ({
            id: `scope-${category}-${preset}`,
            category,
            title: preset,
            date: '2026-09-20',
            priority: 'A',
            lifecycle: 'scheduled',
            demandProfile: resolveDemandProfile(category, preset),
        });

        expect(isCyclingDurabilityFocusEvent(event('cycling_event', 'gran_fondo'))).toBe(true);
        expect(isCyclingDurabilityFocusEvent(event('cycling_event', 'gravel'))).toBe(true);
        expect(isCyclingDurabilityFocusEvent(event('cycling_event', 'road_race'))).toBe(false);
        expect(isCyclingDurabilityFocusEvent(event('triathlon', 'half_iron'))).toBe(false);
        expect(isCyclingDurabilityFocusEvent(event('running_race', 'marathon'))).toBe(false);
    });

    it('preserves long-horizon benefit for Gran Fondo durability sessions (>21 days)', () => {
        const raceSpecific = ENRICHED_TEMPLATES.find(t => t.id === 'end_race_specific_01')!;
        const granFondoDemand = resolveDemandProfile('cycling_event', 'gran_fondo');
        const focusEvent: UserEvent = {
            id: 'e-gran-fondo',
            category: 'cycling_event',
            title: 'Gran Fondo Long Horizon',
            date: '2026-09-30', // 45 days away
            priority: 'A',
            lifecycle: 'scheduled',
            demandProfile: granFondoDemand,
        };

        const unresolved: WeeklyObjective[] = [
            {
                id: 'obj_gran_fondo',
                key: 'race_specific_endurance',
                title: 'Gran Fondo Durability',
                targetExposures: 1,
                completedExposures: 0,
                targetStimulus: { aerobicEndurance: 0.9, fatigueResistance: 0.8 },
                qualification: {
                    minimumStimulus: { aerobicEndurance: 0.6, fatigueResistance: 0.6 },
                    allowedModalities: ['Cycling'],
                    allowedCategories: ['Race-Specific Endurance'],
                },
            },
        ];

        const availability: ResolvedAvailability = {
            date: '2026-08-16',
            maxTimeMinutes: 180,
            availableEquipment: ['indoor_bike', 'outdoor_bike'],
            fixedActivities: [],
            reservedCapacityCost: 0,
            reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            environmentOverride: null,
        };

        const preferences: UserPreferences = {
            ...DEFAULT_PREFERENCES,
            preferredModalities: ['Cycling'],
        };

        const ranking = rankCandidates(
            [raceSpecific],
            unresolved,
            createEmptyFatigue('2026-08-16'),
            availability,
            [],
            preferences,
            { date: '2026-08-16', focusEvent, resolvedAvailability: availability },
        );

        expect(ranking.accepted.length).toBe(1);
        const candidate = ranking.accepted[0];
        // Benefit should not be halved (should exceed 1.0 due to preference and stimulus)
        expect(candidate.benefitScore).toBeGreaterThan(1.0);
    });

    it('scores capped race-specific work from the effective dose, not the authored 150-minute dose', () => {
        const raceSpecific = ENRICHED_TEMPLATES.find(t => t.id === 'end_race_specific_01')!;
        const granFondoDemand = resolveDemandProfile('cycling_event', 'gran_fondo');
        const focusEvent: UserEvent = {
            id: 'e-gran-fondo-effective-dose',
            category: 'cycling_event',
            title: 'Gran Fondo Effective Dose',
            date: '2026-09-30',
            priority: 'A',
            lifecycle: 'scheduled',
            demandProfile: granFondoDemand,
        };
        const unresolved: WeeklyObjective[] = [{
            id: 'obj_gran_fondo_effective_dose',
            key: 'race_specific_endurance',
            title: 'Gran Fondo Durability',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { aerobicEndurance: 0.9, fatigueResistance: 0.85, thresholdPower: 0.6 },
            qualification: {
                minimumStimulus: { aerobicEndurance: 0.6, fatigueResistance: 0.6 },
                allowedModalities: ['Cycling'],
                allowedCategories: ['Race-Specific Endurance'],
            },
        }];

        const rankAtCap = (cap: number, doseRatio: number) => {
            const candidate = {
                ...raceSpecific,
                easierDose: {
                    label: `cap-${cap}`,
                    durationMin: raceSpecific.durationMin,
                    durationMax: cap,
                    doseRatio,
                    prescriptionSummary: `Cap-safe ${cap} minute durability dose.`,
                },
            };
            const availability: ResolvedAvailability = {
                date: '2026-08-16',
                maxTimeMinutes: cap,
                availableEquipment: ['outdoor_bike'],
                fixedActivities: [],
                reservedCapacityCost: 0,
                reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
                environmentOverride: null,
            };
            return rankCandidates(
                [candidate],
                unresolved,
                createEmptyFatigue('2026-08-16'),
                availability,
                [],
                { ...DEFAULT_PREFERENCES, preferredModalities: ['Cycling'] },
                { date: '2026-08-16', focusEvent, resolvedAvailability: availability },
            ).accepted[0];
        };

        const capped60 = rankAtCap(60, 0.4);
        const capped120 = rankAtCap(120, 0.8);
        expect(capped60.benefitScore).toBeLessThan(1);
        expect(capped120.benefitScore).toBeGreaterThan(3);
        expect(capped120.benefitScore).toBeGreaterThan(capped60.benefitScore);
    });

    it('suppresses heavy lower-body strength and high systemic cost candidates when adjacent to an anchor', () => {
        const fullBodyStrength = ENRICHED_TEMPLATES.find(t => t.id === 'str_full_01')!;
        expect(HEAVY_LOWER_BODY_STRENGTH_CATEGORIES).toContain('Full-body Strength');

        const availability: ResolvedAvailability = {
            date: '2026-08-14',
            maxTimeMinutes: 60,
            availableEquipment: ['free_weights', 'indoor_bike'],
            fixedActivities: [],
            reservedCapacityCost: 0,
            reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            environmentOverride: null,
        };

        const rankingNonAdjacent = rankCandidates(
            [fullBodyStrength],
            [],
            createEmptyFatigue('2026-08-14'),
            availability,
            [],
            DEFAULT_PREFERENCES,
            { date: '2026-08-14', adjacentToAnchor: false, resolvedAvailability: availability },
        );

        const rankingAdjacent = rankCandidates(
            [fullBodyStrength],
            [],
            createEmptyFatigue('2026-08-14'),
            availability,
            [],
            DEFAULT_PREFERENCES,
            { date: '2026-08-14', adjacentToAnchor: true, resolvedAvailability: availability },
        );

        expect(rankingAdjacent.accepted[0].utilityScore).toBeLessThan(rankingNonAdjacent.accepted[0].utilityScore);
        expect(rankingAdjacent.accepted[0].utilityScore).toBeCloseTo(
            rankingNonAdjacent.accepted[0].utilityScore * 0.3,
            5,
        );
    });

    it('does not apply heavy-strength adjacency suppression after a cap reduces the effective dose below the heavy threshold', () => {
        const fullBodyStrength = ENRICHED_TEMPLATES.find(t => t.id === 'str_full_01')!;
        const availability: ResolvedAvailability = {
            date: '2026-08-14',
            maxTimeMinutes: 45,
            availableEquipment: ['free_weights'],
            fixedActivities: [],
            reservedCapacityCost: 0,
            reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
            environmentOverride: null,
        };

        const nonAdjacent = rankCandidates(
            [fullBodyStrength],
            [],
            createEmptyFatigue('2026-08-14'),
            availability,
            [],
            DEFAULT_PREFERENCES,
            { date: '2026-08-14', adjacentToAnchor: false, resolvedAvailability: availability },
        );
        const adjacent = rankCandidates(
            [fullBodyStrength],
            [],
            createEmptyFatigue('2026-08-14'),
            availability,
            [],
            DEFAULT_PREFERENCES,
            { date: '2026-08-14', adjacentToAnchor: true, resolvedAvailability: availability },
        );

        // The authored 0.6 session is automatically reduced to its 0.75 easier dose:
        // 0.6 * 0.75 = 0.45, below the optimizer's 0.5 heavy/intensity-stack threshold.
        expect(nonAdjacent.accepted[0].utilityScore).toBeCloseTo(adjacent.accepted[0].utilityScore, 5);
    });

    it('enforces dailyLedger accounting boundary in evaluateTrainingWithIntent for scheduled race days', async () => {
        const raceActivity: FixedActivity = {
            id: 'gran_fondo_race',
            userId: 'u1',
            title: 'Gran Fondo Race Day',
            date: '2026-09-20',
            durationMin: 180,
            fixed: true,
            environment: 'outdoor',
            equipment: ['outdoor_bike'],
            isCompleted: false,
            createdAt: '2026-09-20T08:00:00.000Z',
            updatedAt: '2026-09-20T08:00:00.000Z',
            expectedCost: {
                systemic: 0.95,
                cardiovascular: 0.9,
                lowerBody: 0.8,
                upperBody: 0.1,
                impactTissue: 0.1,
                neuromuscular: 0.7,
            },
        };

        const raceEvent: UserEvent = {
            id: 'e-race',
            title: 'Gran Fondo Race',
            date: '2026-09-20',
            priority: 'A',
            lifecycle: 'scheduled',
            category: 'cycling_event',
            demandProfile: resolveDemandProfile('cycling_event', 'gran_fondo'),
        };

        const rec = await evaluateTrainingWithIntent(
            'u1',
            fixtureReadiness(),
            fixtureContext(),
            [raceEvent],
            '2026-09-20',
            undefined,
            fixtureHistory,
            undefined,
            [raceActivity],
        );

        // The day must be designated Rest or Mobility/Recovery because race consumes systemic capacity
        expect(['Rest', 'Mobility/Recovery']).toContain(rec.template.category);
    });

    it('ensures cycling_gran_fondo_A scenario achieves sustained durability anchors without criterium surges', async () => {
        const scenario = SCENARIOS.find(s => s.id === 'cycling_gran_fondo_A');
        expect(scenario).toBeDefined();
        if (!scenario) return;

        const result = await runScenario(scenario);

        // 1. Verify the durability objective is generated and the sustained template is used.
        const durabilityObj = result.objectiveResolution.find(o => o.key === 'race_specific_endurance');
        expect(durabilityObj).toBeDefined();
        expect(durabilityObj!.timesGenerated).toBeGreaterThanOrEqual(1);
        expect(result.decisionTraces.some(trace => trace.selected.templateId === 'end_race_specific_01')).toBe(true);

        // 2. Verify end_crit_surges_01 is never selected across the entire simulation
        const critSurgePicks = result.decisionTraces.filter(t => t.selected.templateId === 'end_crit_surges_01');
        expect(critSurgePicks.length).toBe(0);

        // 3. Verify eventSpecificAnchorHit rate is maintained
        const nonTaperWeeks = result.anchorWeeks.filter(w => w.eventSpecificAnchorDate !== null);
        const fulfilled = nonTaperWeeks.filter(w => w.eventSpecificAnchorFulfilled);
        expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    });

    it('materially separates the 60-minute baseline gran-fondo and criterium controls at equal cap and horizon', async () => {
        const granFondo = SCENARIOS.find(s => s.id === 'cycling_gran_fondo_A');
        const criterium = SCENARIOS.find(s => s.id === 'cycling_criterium_A');
        expect(granFondo).toBeDefined();
        expect(criterium).toBeDefined();
        if (!granFondo || !criterium) return;

        expect(granFondo.startDate).toBe(criterium.startDate);
        expect(granFondo.weeks).toBe(criterium.weeks);
        expect(granFondo.context.constraints).toEqual(criterium.context.constraints);
        // These legacy scenario controls intentionally remain 60-minute check-in cases.
        // Issue #675's 90/120-minute acceptance evidence lives in the plan-judge
        // event-demand family, where capacity is now explicit and invariant-checked.
        expect(granFondo.readinessForWeek(0).subjective.timeAvailable).toBe(60);
        expect(criterium.readinessForWeek(0).subjective.timeAvailable).toBe(60);

        const [granResult, criteriumResult] = await Promise.all([
            runScenario(granFondo),
            runScenario(criterium),
        ]);
        const granRaceSpecific = granResult.decisionTraces.filter(trace => trace.selected.category === 'Race-Specific Endurance');
        const criteriumRaceSpecific = criteriumResult.decisionTraces.filter(trace => trace.selected.category === 'Race-Specific Endurance');

        expect(granRaceSpecific.map(trace => trace.selected.templateId)).not.toEqual(
            criteriumRaceSpecific.map(trace => trace.selected.templateId),
        );
        expect(granRaceSpecific.some(trace => trace.selected.templateId === 'end_crit_surges_01')).toBe(false);
        expect(criteriumRaceSpecific.some(trace => trace.selected.templateId === 'end_crit_surges_01')).toBe(true);
        expect(Math.max(...granRaceSpecific.map(trace => trace.selected.durationMax ?? 0)))
            .toBeGreaterThan(Math.max(...criteriumRaceSpecific.map(trace => trace.selected.durationMax ?? 0)));
    });
});
