import { describe, expect, it } from 'vitest';
import { applyCompletedSessionLoad, createEmptyFatigue } from './fatigue';
import { generateWeeklyObjectives, updateMicrocycleProgress } from './microcycle';
import type { TrainingSettings, UserContext, UserEvent, UserGoal, UserPreferences } from './models';
import { rankCandidatesByUtility } from './optimizer';
import { deriveEventPriority, deriveGoalCategory, evaluatePeriodizationPhase, getDaysToEvent, goalToUserEvent, isTemplatePhaseEligible } from './periodization';
import { resolveAvailability } from './schedule';
import { ENRICHED_TEMPLATES } from './templates';

function testTrainingSettings(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: false },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 45, weekendMaxMinutes: 120, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function testContext(overrides: Partial<UserContext['constraints']> = {}, trainingSettings = testTrainingSettings()): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, injuries: [], maxTimeMinutes: 90, ...overrides },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        trainingSettings,
    };
}

describe('Architecture & Phased Engine Integration', () => {
    describe('Phase 1: Schedule & Availability', () => {
        it("uses the athlete's own weekday/weekend budget from TrainingSettings, not a fabricated day-of-week table", () => {
            // Saturday (2026-08-08) -> weekend default; Monday (2026-08-10) -> weekday default.
            expect(resolveAvailability('2026-08-08', null, [], testContext()).maxTimeMinutes).toBe(120);
            expect(resolveAvailability('2026-08-10', null, [], testContext()).maxTimeMinutes).toBe(45);
        });

        it("caps (rather than blindly overrides) today's check-in time with the athlete's own profile limit", () => {
            const todayCheckin = {
                readiness: 5, sleepQuality: 5, fatigue: 5, soreness: 5, stress: 5, motivation: 5,
                timeAvailable: 200, // Claims 200 min available
                painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            };
            // Friday (weekday) profile limit is 45 -- wins over the 200 min claim.
            const availability = resolveAvailability('2026-08-07', todayCheckin, [], testContext());
            expect(availability.maxTimeMinutes).toBe(45);
        });

        it('deducts fixed activity duration and reserves capacity for future scheduled activities', () => {
            const fixedActivities = [
                {
                    id: 'fixed_1',
                    title: 'Evening Football',
                    date: '2026-08-12',
                    durationMin: 90,
                    isCompleted: false,
                    expectedCost: { systemic: 0.8 },
                },
            ];

            const availability = resolveAvailability('2026-08-12', null, fixedActivities, testContext());
            // Wednesday weekday budget is 45 min, minus 90 min fixed activity -> floored at 0
            expect(availability.maxTimeMinutes).toBe(0);
            expect(availability.reservedCapacityCost).toBe(0.8);
        });

        it('grants equipment strictly from the athlete\'s own constraints -- never fabricates a "gym day" bundle', () => {
            const noKit = testContext({ hasFreeWeights: false, hasIndoorBike: false, hasCableMachine: false, hasTreadmill: false });
            for (const date of ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']) {
                expect(resolveAvailability(date, null, [], noKit).availableEquipment).toEqual([]);
            }
            const withBike = testContext({ hasIndoorBike: true });
            // Equipment access doesn't depend on which day of the week it is.
            expect(resolveAvailability('2026-08-10', null, [], withBike).availableEquipment).toContain('indoor_bike');
            expect(resolveAvailability('2026-08-11', null, [], withBike).availableEquipment).toContain('indoor_bike');
        });
    });

    describe('Phase 2: Events & Periodization', () => {
        it('evaluates A-event tapers and prevents C-events from hijacking taper phase', () => {
            const events: UserEvent[] = [
                {
                    id: 'c_race',
                    title: 'Practice 5K',
                    date: '2026-08-10', // 3 days away
                    priority: 'C',
                    lifecycle: 'scheduled',
                    category: 'running_race',
                    demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.9, vo2MaxPower: 0.9, repeatedSurges: 0.5, sprintPower: 0.5, fatigueResistance: 0.5, neuromuscular: 0.5 },
                },
                {
                    id: 'a_race',
                    title: 'Championship Marathon',
                    date: '2026-09-06', // 30 days away (Specificity Phase)
                    priority: 'A',
                    lifecycle: 'scheduled',
                    category: 'running_race',
                    demandProfile: { aerobicEndurance: 1.0, thresholdPower: 0.8, vo2MaxPower: 0.5, repeatedSurges: 0.3, sprintPower: 0.2, fatigueResistance: 0.9, neuromuscular: 0.3 },
                },
            ];

            const phase = evaluatePeriodizationPhase(events, '2026-08-07');
            // Primary event is A-race (30 days out), C-race 3 days away does not trigger taper override
            expect(phase.phase.phaseName).toBe('Specificity');
            expect(phase.phase.taperActive).toBe(false);
        });

        it('keeps passed scheduled events stale, while completed/DNF events alone unlock recovery', () => {
            const event = (id: string, lifecycle: UserEvent['lifecycle']): UserEvent => ({
                id,
                title: id,
                date: '2026-08-06',
                priority: 'A',
                lifecycle,
                category: 'cycling_event',
                demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.7, vo2MaxPower: 0.4, repeatedSurges: 0.5, sprintPower: 0.2, fatigueResistance: 0.8, neuromuscular: 0.3 },
            });

            const scheduled = evaluatePeriodizationPhase([event('awaiting-outcome', 'scheduled')], '2026-08-07');
            expect(scheduled.phase.phaseName).toBe('Base');
            expect(scheduled.focusEvent).toBeNull();
            expect(scheduled.staleEvents.map(e => e.id)).toEqual(['awaiting-outcome']);

            const completed = evaluatePeriodizationPhase([event('finished', 'completed')], '2026-08-07');
            expect(completed.phase.phaseName).toBe('Post-Event Recovery');
            expect(completed.focusEvent?.id).toBe('finished');
            expect(completed.partialEffort).toBe(false);

            const dnf = evaluatePeriodizationPhase([event('partial', 'DNF')], '2026-08-07');
            expect(dnf.phase.phaseName).toBe('Post-Event Recovery');
            expect(dnf.partialEffort).toBe(true);

            for (const lifecycle of ['DNS', 'cancelled'] as const) {
                const excluded = evaluatePeriodizationPhase([event(lifecycle, lifecycle)], '2026-08-07');
                expect(excluded.focusEvent).toBeNull();
                expect(excluded.staleEvents).toEqual([]);
            }
        });
    });

    describe('Phase 2b: Goal -> Event derivation', () => {
        const baseGoal: UserGoal = {
            userId: 'u1',
            category: 'long-term',
            domain: 'endurance',
            title: 'Road cycling event',
            priority: 5,
            status: 'active',
            schemaVersion: 1,
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
        };

        it('deriveGoalCategory buckets by days-until-date, independent of any stored category', () => {
            expect(deriveGoalCategory('2026-08-20', '2026-08-07')).toBe('short-term'); // 13 days
            expect(deriveGoalCategory('2026-11-01', '2026-08-07')).toBe('mid-term'); // ~86 days
            expect(deriveGoalCategory('2027-06-01', '2026-08-07')).toBe('long-term'); // ~10 months
        });

        it('deriveEventPriority maps the 5-star priority control onto A/B/C taper class', () => {
            expect(deriveEventPriority(5)).toBe('A');
            expect(deriveEventPriority(4)).toBe('B');
            expect(deriveEventPriority(3)).toBe('B');
            expect(deriveEventPriority(2)).toBe('C');
            expect(deriveEventPriority(1)).toBe('C');
        });

        it('getDaysToEvent is a standalone helper independent of evaluatePeriodizationPhase', () => {
            expect(getDaysToEvent('2026-09-13', '2026-08-07')).toBe(37);
            expect(getDaysToEvent('2026-08-01', '2026-08-07')).toBe(-6); // already passed
        });

        it('counts calendar days correctly across Europe/Warsaw DST transitions', () => {
            expect(getDaysToEvent('2026-10-26', '2026-10-25')).toBe(1);
            expect(getDaysToEvent('2026-03-29', '2026-03-30')).toBe(-1);
        });

        it('goalToUserEvent returns null for a goal with no target date or no event category', () => {
            expect(goalToUserEvent({ ...baseGoal, targetDate: null, eventCategory: null })).toBeNull();
            expect(goalToUserEvent({ ...baseGoal, targetDate: '2026-09-13', eventCategory: null })).toBeNull();
            expect(goalToUserEvent({ ...baseGoal, targetDate: null, eventCategory: 'cycling_event' })).toBeNull();
        });

        it('goalToUserEvent returns null for a paused/archived/completed goal even if dated and categorized', () => {
            expect(goalToUserEvent({ ...baseGoal, status: 'paused', targetDate: '2026-09-13', eventCategory: 'cycling_event' })).toBeNull();
        });

        it('goalToUserEvent adapts a dated, categorized, active goal into a UserEvent with a demand profile from its preset', () => {
            const event = goalToUserEvent({
                ...baseGoal,
                id: 'goal123',
                targetDate: '2026-09-13',
                eventCategory: 'cycling_event',
                eventPreset: 'road_race',
            });

            expect(event).not.toBeNull();
            expect(event!.id).toBe('goal123');
            expect(event!.priority).toBe('A'); // 5-star -> A
            expect(event!.lifecycle).toBe('scheduled'); // defaulted, not required on the goal
            expect(event!.category).toBe('cycling_event');
            expect(event!.demandProfile.thresholdPower).toBeGreaterThan(0);
        });

        it('goalToUserEvent falls back to the goal title as an id when no Firestore doc id is available', () => {
            const event = goalToUserEvent({ ...baseGoal, targetDate: '2026-09-13', eventCategory: 'cycling_event' });
            expect(event!.id).toBe('Road cycling event');
        });

        it('feeds naturally into evaluatePeriodizationPhase: an A-priority cycling goal ~37 days out is already in Build phase, well before any taper', () => {
            const event = goalToUserEvent({ ...baseGoal, targetDate: '2026-09-13', eventCategory: 'cycling_event', eventPreset: 'road_race' })!;
            const phase = evaluatePeriodizationPhase([event], '2026-08-07');
            expect(phase.phase.phaseName).toBe('Build');
            expect(phase.phase.taperActive).toBe(false);
            expect(phase.focusEvent).toMatchObject({ id: 'Road cycling event' });
            expect(phase.daysToEvent).toBe(37);
            // Blended toward the cycling demand vector, not the flat default base demand
            expect(phase.phase.targetDemandVector.thresholdPower).toBeGreaterThan(0.5);
        });
    });

    describe('Phase 3: Microcycle Objectives', () => {
        it('generates weekly objectives and marks them satisfied when matching sessions complete', () => {
            const phaseWeights = evaluatePeriodizationPhase([], '2026-08-07').phase;
            const microcycle = generateWeeklyObjectives(phaseWeights, '2026-08-03');

            expect(microcycle.objectives.length).toBeGreaterThan(0);

            const updated = updateMicrocycleProgress(microcycle, {
                type: 'Threshold Running',
                duration_min: 45,
                training_effect: 3.5,
                intensity_tag: 'hard',
            });

            const thresholdObj = updated.objectives.find(o => o.key === 'threshold_quality');
            if (thresholdObj) {
                expect(thresholdObj.completedExposures).toBe(1);
            }
        });
    });

    describe('Phase 4: Multidimensional Fatigue & Decay', () => {
        it('applies exponential decay over elapsed hours and accumulates completed session load', () => {
            const initial = createEmptyFatigue('2026-08-07');
            const costProfile = { systemic: 0.8, cardiovascular: 0.9, lowerBody: 1.0, upperBody: 0.0, impactTissue: 0.8, neuromuscular: 0.9 };

            const loaded = applyCompletedSessionLoad(initial, '2026-08-07', costProfile);
            expect(loaded.externalLoadFatigue.lowerBody).toBe(1.0);

            // After 48 hours, lowerBody fatigue (halflife 48h) should decay to ~0.5
            const after48h = applyCompletedSessionLoad(loaded, '2026-08-09', { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 });
            expect(after48h.externalLoadFatigue.lowerBody).toBeCloseTo(0.5, 1);
        });
    });

    describe('Phase 5: Utility Optimization & Safety Gating', () => {
        it('allows upper-body strength while lower-body fatigue is elevated, and applies soft penalty to avoided modalities', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            fatigue.combinedFatigue.lowerBody = 0.9; // Legs wrecked

            const availability = resolveAvailability('2026-08-07', null, [], testContext());
            const preferences: UserPreferences = {
                userId: 'test_user',
                preferredRecoveryStyle: 'active',
                defaultWeekdayTimeMin: 60,
                defaultWeekendTimeMin: 120,
                preferredTimeOfDay: 'morning',
                preferredModalities: ['Strength'],
                deprioritizedModalities: [],
                avoidedModalities: ['Running'], // Soft penalty
                explanationVerbosity: 'brief',
                conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
                schemaVersion: 1,
                createdAt: '',
                updatedAt: '',
            };

            const ranked = rankCandidatesByUtility(
                ENRICHED_TEMPLATES,
                [],
                fatigue,
                availability,
                [], // No injury hard gates
                preferences
            );

            expect(ranked.length).toBeGreaterThan(0);

            // Upper-body strength should rank high because lower-body cost penalty is 0 for upper-body exercises
            const upperBodyOption = ranked.find(r => r.template.category === 'Upper-body Strength');
            const lowerBodyOption = ranked.find(r => r.template.category === 'Lower-body Strength');

            expect(upperBodyOption).toBeDefined();
            expect(lowerBodyOption).toBeDefined();
            expect(upperBodyOption!.utilityScore).toBeGreaterThan(lowerBodyOption!.utilityScore);

            // Running options should receive soft penalty note without crashing
            const runningOption = ranked.find(r => r.template.modality === 'Running');
            if (runningOption) {
                expect(runningOption.rationale).toContain('Soft penalty applied');
            }
        });

        it('penalizes repeated modality stacking on 3rd+ consecutive day, for EVERY modality including endurance (anti-stacking)', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = resolveAvailability('2026-08-07', null);
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };

            const unstackedRanked = rankCandidatesByUtility(
                ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs,
                { recentHistory: [] }
            );

            const stackedRanked = rankCandidatesByUtility(
                ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs,
                { recentHistory: [{ modality: 'Strength' }, { modality: 'Strength' }] }
            );

            const unstackedStrength = unstackedRanked.find(r => r.template.modality === 'Strength');
            const stackedStrength = stackedRanked.find(r => r.template.modality === 'Strength');

            expect(unstackedStrength).toBeDefined();
            expect(stackedStrength).toBeDefined();
            expect(stackedStrength!.utilityScore).toBeLessThan(unstackedStrength!.utilityScore * 0.2);

            // Cycling/Running used to be explicitly exempted from this same check --
            // exactly the gap that let the optimizer chain the identical endurance
            // template every day of a 7-day forecast (see docs/adr/0008 incident notes).
            const cyclingAvailability = { ...availability, availableEquipment: ['indoor_bike'] };
            const unstackedCyclingRanked = rankCandidatesByUtility(
                ENRICHED_TEMPLATES, [], fatigue, cyclingAvailability, [], prefs,
                { recentHistory: [] }
            );
            const stackedCyclingRanked = rankCandidatesByUtility(
                ENRICHED_TEMPLATES, [], fatigue, cyclingAvailability, [], prefs,
                { recentHistory: [{ modality: 'Cycling' }, { modality: 'Cycling' }] }
            );
            const unstackedCycling = unstackedCyclingRanked.find(r => r.template.modality === 'Cycling');
            const stackedCycling = stackedCyclingRanked.find(r => r.template.modality === 'Cycling');

            expect(unstackedCycling).toBeDefined();
            expect(stackedCycling).toBeDefined();
            expect(stackedCycling!.utilityScore).toBeLessThan(unstackedCycling!.utilityScore * 0.2);
        });

        it('suppresses a second consecutive Moderate/Hard day across DIFFERENT modalities (intensity-stacking cap)', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = {
                ...resolveAvailability('2026-08-07', null),
                availableEquipment: ['indoor_bike', 'free_weights'],
            };
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };

            // Yesterday: a hard cycling day. Today's candidate: a hard STRENGTH session --
            // different modality, so the same-modality anti-stacking check above never
            // fires, yet back-to-back hard days is still the thing to avoid.
            const afterHardBike = rankCandidatesByUtility(
                ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs,
                { recentHistory: [{ modality: 'Cycling', type: 'Bike VO2 Intervals', systemicCost: 1.0 }] }
            );
            const afterEasyBike = rankCandidatesByUtility(
                ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs,
                { recentHistory: [{ modality: 'Cycling', type: 'Zone 2 Spin', systemicCost: 0.3 }] }
            );

            const hardStrengthAfterHard = afterHardBike.find(r => r.template.category === 'Full-body Strength');
            const hardStrengthAfterEasy = afterEasyBike.find(r => r.template.category === 'Full-body Strength');

            expect(hardStrengthAfterHard).toBeDefined();
            expect(hardStrengthAfterEasy).toBeDefined();
            expect(hardStrengthAfterHard!.utilityScore).toBeLessThan(hardStrengthAfterEasy!.utilityScore);
        });

        it('applies event-priority utility boost when an A-priority cycling event is active', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = {
                ...resolveAvailability('2026-08-07', null),
                maxTimeMinutes: 90,
                availableEquipment: ['indoor_bike', 'free_weights', 'cable_machine'],
            };
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };

            const cyclingFocusEvent: UserEvent = {
                id: 'c1', title: 'Road Race', date: '2026-09-12', priority: 'A', lifecycle: 'scheduled',
                category: 'cycling_event', demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.6, repeatedSurges: 0.5, sprintPower: 0.3, fatigueResistance: 0.7, neuromuscular: 0.4 }
            };

            const rankedWithEvent = rankCandidatesByUtility(
                ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs,
                { focusEvent: cyclingFocusEvent }
            );

            const cyclingPick = rankedWithEvent.find(r => r.template.modality === 'Cycling');
            const strengthPick = rankedWithEvent.find(r => r.template.modality === 'Strength');

            expect(cyclingPick).toBeDefined();
            expect(strengthPick).toBeDefined();
            expect(cyclingPick!.utilityScore).toBeGreaterThan(strengthPick!.utilityScore);
        });

        it('boosts BOTH Cycling and Running (not neither) for an A-priority triathlon event -- regression for the category-substring bug', () => {
            // 'triathlon' doesn't substring-match 'cycling'/'running'/'strength', so this
            // used to fall through to the non-event-modality PENALTY branch instead of the
            // boost -- silently suppressing the two modalities that matter most for a
            // triathlete, contradicting ADR-0007's own documented intent.
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = {
                ...resolveAvailability('2026-08-07', null),
                maxTimeMinutes: 90,
                availableEquipment: ['indoor_bike', 'free_weights', 'cable_machine'],
            };
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };

            const triathlonFocusEvent: UserEvent = {
                id: 't1', title: 'Olympic Triathlon', date: '2026-09-12', priority: 'A', lifecycle: 'scheduled',
                category: 'triathlon', demandProfile: { aerobicEndurance: 0.75, thresholdPower: 0.8, vo2MaxPower: 0.45, repeatedSurges: 0.2, sprintPower: 0.1, fatigueResistance: 0.65, neuromuscular: 0.15 },
            };

            const withoutEvent = rankCandidatesByUtility(ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs, {});
            const withTriathlon = rankCandidatesByUtility(ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs, { focusEvent: triathlonFocusEvent });

            const cyclingBaseline = withoutEvent.find(r => r.template.modality === 'Cycling')!;
            const runningBaseline = withoutEvent.find(r => r.template.modality === 'Running')!;
            const cyclingWithEvent = withTriathlon.find(r => r.template.id === cyclingBaseline.template.id)!;
            const runningWithEvent = withTriathlon.find(r => r.template.id === runningBaseline.template.id)!;

            // Both must be BOOSTED (not penalized) relative to their no-event baseline.
            expect(cyclingWithEvent.utilityScore).toBeGreaterThan(cyclingBaseline.utilityScore);
            expect(runningWithEvent.utilityScore).toBeGreaterThan(runningBaseline.utilityScore);

            const strengthWithEvent = withTriathlon.find(r => r.template.modality === 'Strength')!;
            expect(cyclingWithEvent.utilityScore).toBeGreaterThan(strengthWithEvent.utilityScore);
            expect(runningWithEvent.utilityScore).toBeGreaterThan(strengthWithEvent.utilityScore);
        });
    });

    describe('Phase 6: Race-Specific Endurance phase-gating', () => {
        const raceSpecificIds = ['end_race_specific_01', 'end_race_sim_01', 'end_taper_sharpen_01', 'end_pre_race_openers_01'];
        const cyclingEvent = (date: string): UserEvent => ({
            id: 'c1', title: 'Road Race', date, priority: 'A', lifecycle: 'scheduled',
            category: 'cycling_event', demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.6, repeatedSurges: 0.5, sprintPower: 0.3, fatigueResistance: 0.7, neuromuscular: 0.4 },
        });

        it('excludes every Race-Specific Endurance template when no focus event governs the day', () => {
            const noEvent = evaluatePeriodizationPhase([], '2026-08-07');
            raceSpecificIds.forEach(id => {
                const template = ENRICHED_TEMPLATES.find(t => t.id === id)!;
                expect(isTemplatePhaseEligible(template, noEvent)).toBe(false);
            });
        });

        it('progresses eligibility from event-specific endurance -> race simulation -> taper sharpening -> pre-race openers as the event approaches', () => {
            const buildPhase = evaluatePeriodizationPhase([cyclingEvent('2026-09-16')], '2026-08-07'); // 40 days out: Build
            const specificityPhase = evaluatePeriodizationPhase([cyclingEvent('2026-08-27')], '2026-08-07'); // 20 days out: Specificity
            const taperPhase = evaluatePeriodizationPhase([cyclingEvent('2026-08-14')], '2026-08-07'); // 7 days out: A-event taper window
            const finalDays = evaluatePeriodizationPhase([cyclingEvent('2026-08-09')], '2026-08-07'); // 2 days out: taper + within openers window

            const eligible = (result: typeof buildPhase, id: string) => isTemplatePhaseEligible(ENRICHED_TEMPLATES.find(t => t.id === id)!, result);

            // 40 days out: only the aerobic-dominant event-specific ride is on, nothing taper/sim-specific yet.
            expect(eligible(buildPhase, 'end_race_specific_01')).toBe(true);
            expect(eligible(buildPhase, 'end_race_sim_01')).toBe(false);
            expect(eligible(buildPhase, 'end_taper_sharpen_01')).toBe(false);
            expect(eligible(buildPhase, 'end_pre_race_openers_01')).toBe(false);

            // 20 days out: race simulation joins (still pre-taper), taper-only sessions still don't.
            expect(eligible(specificityPhase, 'end_race_specific_01')).toBe(true);
            expect(eligible(specificityPhase, 'end_race_sim_01')).toBe(true);
            expect(eligible(specificityPhase, 'end_taper_sharpen_01')).toBe(false);

            // 7 days out (tapering): both pre-taper templates step aside, taper sharpening
            // takes over, openers still too early (>3 days out).
            expect(eligible(taperPhase, 'end_race_specific_01')).toBe(false);
            expect(eligible(taperPhase, 'end_race_sim_01')).toBe(false);
            expect(eligible(taperPhase, 'end_taper_sharpen_01')).toBe(true);
            expect(eligible(taperPhase, 'end_pre_race_openers_01')).toBe(false);

            // 2 days out: openers finally on.
            expect(eligible(finalDays, 'end_pre_race_openers_01')).toBe(true);
        });

        it('Path B ranks a phase-eligible Race-Specific Endurance template with real (non-zero) utility', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = {
                ...resolveAvailability('2026-08-07', null),
                maxTimeMinutes: 120,
                availableEquipment: [],
            };
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 90,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };
            const periodization = evaluatePeriodizationPhase([cyclingEvent('2026-08-27')], '2026-08-07'); // Specificity, both event-specific + race-sim on

            const candidates = ENRICHED_TEMPLATES.filter(t => isTemplatePhaseEligible(t, periodization));
            expect(candidates.some(t => t.category === 'Race-Specific Endurance')).toBe(true);

            const ranked = rankCandidatesByUtility(candidates, [], fatigue, availability, [], prefs, { focusEvent: periodization.focusEvent });
            const raceSpecificPick = ranked.find(r => r.template.category === 'Race-Specific Endurance');
            expect(raceSpecificPick).toBeDefined();
            expect(raceSpecificPick!.utilityScore).toBeGreaterThan(0);
        });
    });
});
