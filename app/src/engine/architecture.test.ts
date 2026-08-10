import { describe, expect, it } from 'vitest';
import { applyCompletedSessionLoad, createEmptyFatigue } from './fatigue';
import { generateWeeklyObjectives, updateMicrocycleProgress } from './microcycle';
import type { SessionTemplate, TrainingSettings, UserContext, UserEvent, UserGoal, UserPreferences } from './models';
import { rankCandidates, rankCandidatesByUtility } from './optimizer';
import { deriveEventPriority, deriveGoalCategory, evaluatePeriodizationPhase, getDaysToEvent, goalToUserEvent, isTemplatePhaseEligible } from './periodization';
import { resolveAvailability } from './schedule';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveInjuryRestrictions } from './injuryPolicy';
import { eligibleTemplates } from './eligibility';

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
        constraints: { hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 90, ...overrides },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        trainingSettings,
    };
}

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

describe('Architecture & Phased Engine Integration', () => {
    describe('Phase 1: Schedule & Availability', () => {
        it("uses the athlete's own weekday/weekend budget from TrainingSettings, not a fabricated day-of-week table", () => {
            expect(resolveAvailability('2026-08-08', null, [], testContext()).maxTimeMinutes).toBe(120);
            expect(resolveAvailability('2026-08-10', null, [], testContext()).maxTimeMinutes).toBe(45);
        });

        it("caps (rather than blindly overrides) today's check-in time with the athlete's own profile limit", () => {
            const todayCheckin = {
                readiness: 5, sleepQuality: 5, fatigue: 5, soreness: 5, stress: 5, motivation: 5,
                timeAvailable: 200,
                painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
            };
            const availability = resolveAvailability('2026-08-07', todayCheckin, [], testContext());
            expect(availability.maxTimeMinutes).toBe(45);
        });

        it('deducts fixed activity duration and reserves capacity for future scheduled activities', () => {
            const fixedActivities = [
                {
                    id: 'fixed_1', userId: 'athlete-1', title: 'Evening Football', date: '2026-08-12', durationMin: 90,
                    isCompleted: false, expectedCost: { systemic: 0.8 }, fixed: true, environment: 'outdoor' as const,
                    equipment: [], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
            ];
            const availability = resolveAvailability('2026-08-12', null, fixedActivities, testContext());
            expect(availability.maxTimeMinutes).toBe(0);
            expect(availability.reservedCapacityCost).toBe(0.8);
        });

        it('caps the whole day budget with availabilityOverride before deducting fixed-activity duration', () => {
            // 2026-08-08 is a Saturday -- the athlete's normal weekend budget is 120 min
            // (see testTrainingSettings above), but a travel day shrinks that outright.
            const fixedActivities = [
                {
                    id: 'travel', userId: 'athlete-1', title: 'Travel day', date: '2026-08-08', durationMin: 30,
                    isCompleted: false, fixed: true, environment: 'either' as const, equipment: [],
                    availabilityOverride: 60,
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
            ];
            const availability = resolveAvailability('2026-08-08', null, fixedActivities, testContext());
            expect(availability.maxTimeMinutes).toBe(30); // min(120, 60) override - 30 min activity
        });

        it('takes the most restrictive availabilityOverride when several activities disagree', () => {
            const fixedActivities = [
                {
                    id: 'a', userId: 'athlete-1', title: 'A', date: '2026-08-08', durationMin: 0,
                    isCompleted: false, fixed: true, environment: 'either' as const, equipment: [],
                    availabilityOverride: 90,
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
                {
                    id: 'b', userId: 'athlete-1', title: 'B', date: '2026-08-08', durationMin: 0,
                    isCompleted: false, fixed: true, environment: 'either' as const, equipment: [],
                    availabilityOverride: 20,
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
            ];
            const availability = resolveAvailability('2026-08-08', null, fixedActivities, testContext());
            expect(availability.maxTimeMinutes).toBe(20);
        });

        it('grants equipment strictly from the athlete\'s own constraints -- never fabricates a "gym day" bundle', () => {
            const noKit = testContext({ hasFreeWeights: false, hasIndoorBike: false, hasCableMachine: false, hasTreadmill: false });
            for (const date of ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']) {
                expect(resolveAvailability(date, null, [], noKit).availableEquipment).toEqual([]);
            }
            const withBike = testContext({ hasIndoorBike: true });
            expect(resolveAvailability('2026-08-10', null, [], withBike).availableEquipment).toContain('indoor_bike');
            expect(resolveAvailability('2026-08-11', null, [], withBike).availableEquipment).toContain('indoor_bike');
        });

        it('D6-C: a fixed activity missing expectedCost reserves zero load, never an invented default', () => {
            const fixedActivities = [
                {
                    id: 'unknown_cost', userId: 'athlete-1', title: 'Casual bike commute', date: '2026-08-12', durationMin: 20,
                    isCompleted: false, fixed: true, environment: 'outdoor' as const, equipment: [],
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
            ];
            const availability = resolveAvailability('2026-08-12', null, fixedActivities, testContext());
            expect(availability.reservedCapacityCost).toBe(0);
            expect(availability.reservedCapacityCostProfile).toEqual({
                systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
            });
            // Time is still reserved regardless -- only the fabricated fatigue default is
            // gone. 2026-08-12 is a Wednesday: weekday budget is 45 (testTrainingSettings).
            expect(availability.maxTimeMinutes).toBe(45 - 20);
        });

        it('sums reservedCapacityCostProfile across every authored dimension and every uncompleted activity that day', () => {
            const fixedActivities = [
                {
                    id: 'a', userId: 'athlete-1', title: 'Football', date: '2026-08-12', durationMin: 60,
                    isCompleted: false, expectedCost: { systemic: 0.4, lowerBody: 0.5, impactTissue: 0.3 },
                    fixed: true, environment: 'outdoor' as const, equipment: [],
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
                {
                    id: 'b', userId: 'athlete-1', title: 'Long walk', date: '2026-08-12', durationMin: 30,
                    isCompleted: false, expectedCost: { systemic: 0.1, lowerBody: 0.1 },
                    fixed: false, environment: 'outdoor' as const, equipment: [],
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
                // Completed activities never reserve capacity -- their load already reached
                // the athlete's real completed-training ledger elsewhere.
                {
                    id: 'c', userId: 'athlete-1', title: 'Already done', date: '2026-08-12', durationMin: 45,
                    isCompleted: true, expectedCost: { systemic: 0.9 },
                    fixed: true, environment: 'outdoor' as const, equipment: [],
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
            ];
            const availability = resolveAvailability('2026-08-12', null, fixedActivities, testContext());
            expect(availability.reservedCapacityCostProfile).toEqual({
                systemic: 0.5, cardiovascular: 0, lowerBody: 0.6, upperBody: 0, impactTissue: 0.3, neuromuscular: 0,
            });
            expect(availability.reservedCapacityCost).toBe(0.5); // compatibility scalar == .systemic
        });

        it("D6-B: a fixed activity's own environment/equipment never restrict a separate session on the same date without an explicit override", () => {
            const outdoorFootball = [
                {
                    id: 'football', userId: 'athlete-1', title: 'Football', date: '2026-08-12', durationMin: 60,
                    isCompleted: false, fixed: true, environment: 'outdoor' as const, equipment: ['boots'],
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
            ];
            const withBike = testContext({ hasIndoorBike: true });
            const availability = resolveAvailability('2026-08-12', null, outdoorFootball, withBike);
            expect(availability.environmentOverride).toBeNull();
            expect(availability.availableEquipment).toContain('indoor_bike');
        });

        it('an explicit availabilityContextOverride restricts the day-wide environment and intersects equipment', () => {
            const travelDay = [
                {
                    id: 'travel', userId: 'athlete-1', title: 'Away game trip', date: '2026-08-12', durationMin: 60,
                    isCompleted: false, fixed: true, environment: 'outdoor' as const, equipment: [],
                    availabilityContextOverride: { environment: 'indoor' as const, equipment: ['indoor_bike'] },
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
            ];
            const withFullKit = testContext({ hasIndoorBike: true, hasFreeWeights: true, hasCableMachine: true, hasTreadmill: true });
            const availability = resolveAvailability('2026-08-12', null, travelDay, withFullKit);
            expect(availability.environmentOverride).toBe('indoor');
            expect(availability.availableEquipment.sort()).toEqual(['indoor_bike']);
        });

        it('intersects equipment across several same-day availabilityContextOverrides -- most restrictive wins', () => {
            const twoOverrides = [
                {
                    id: 'a', userId: 'athlete-1', title: 'A', date: '2026-08-12', durationMin: 10,
                    isCompleted: false, fixed: true, environment: 'either' as const, equipment: [],
                    availabilityContextOverride: { equipment: ['indoor_bike', 'free_weights'] },
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
                {
                    id: 'b', userId: 'athlete-1', title: 'B', date: '2026-08-12', durationMin: 10,
                    isCompleted: false, fixed: true, environment: 'either' as const, equipment: [],
                    availabilityContextOverride: { equipment: ['indoor_bike'] },
                    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
                },
            ];
            const withFullKit = testContext({ hasIndoorBike: true, hasFreeWeights: true });
            const availability = resolveAvailability('2026-08-12', null, twoOverrides, withFullKit);
            expect(availability.availableEquipment).toEqual(['indoor_bike']);
        });
    });

    describe('Phase 2: Events & Periodization', () => {
        it('evaluates A-event tapers and prevents C-events from hijacking taper phase', () => {
            const events: UserEvent[] = [
                {
                    id: 'c_race', title: 'Practice 5K', date: '2026-08-10', priority: 'C', lifecycle: 'scheduled', category: 'running_race',
                    demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.9, vo2MaxPower: 0.9, repeatedSurges: 0.5, sprintPower: 0.5, fatigueResistance: 0.5, neuromuscular: 0.5 },
                },
                {
                    id: 'a_race', title: 'Championship Marathon', date: '2026-09-06', priority: 'A', lifecycle: 'scheduled', category: 'running_race',
                    demandProfile: { aerobicEndurance: 1.0, thresholdPower: 0.8, vo2MaxPower: 0.5, repeatedSurges: 0.3, sprintPower: 0.2, fatigueResistance: 0.9, neuromuscular: 0.3 },
                },
            ];
            const phase = evaluatePeriodizationPhase(events, '2026-08-07');
            expect(phase.phase.phaseName).toBe('Specificity');
            expect(phase.phase.taperActive).toBe(false);
        });

        it('keeps passed scheduled events stale, while completed/DNF events alone unlock recovery', () => {
            const event = (id: string, lifecycle: UserEvent['lifecycle']): UserEvent => ({
                id, title: id, date: '2026-08-06', priority: 'A', lifecycle, category: 'cycling_event',
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
            userId: 'u1', category: 'long-term', domain: 'endurance', title: 'Road cycling event', priority: 5, status: 'active',
            schemaVersion: 1, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        };

        it('deriveGoalCategory buckets by days-until-date, independent of any stored category', () => {
            expect(deriveGoalCategory('2026-08-20', '2026-08-07')).toBe('short-term');
            expect(deriveGoalCategory('2026-11-01', '2026-08-07')).toBe('mid-term');
            expect(deriveGoalCategory('2027-06-01', '2026-08-07')).toBe('long-term');
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
            expect(getDaysToEvent('2026-08-01', '2026-08-07')).toBe(-6);
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
            const event = goalToUserEvent({ ...baseGoal, id: 'goal123', targetDate: '2026-09-13', eventCategory: 'cycling_event', eventPreset: 'road_race' });
            expect(event).not.toBeNull();
            expect(event!.id).toBe('goal123');
            expect(event!.priority).toBe('A');
            expect(event!.lifecycle).toBe('scheduled');
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
            expect(phase.phase.targetDemandVector.thresholdPower).toBeGreaterThan(0.5);
        });

        it('goalToUserEvent carries timing through onto UserEvent when present', () => {
            const timing = { earliestDate: '2026-09-05', latestDate: '2026-09-20', planningDate: '2026-09-05' };
            const event = goalToUserEvent({ ...baseGoal, targetDate: '2026-09-05', eventCategory: 'cycling_event', timing });
            expect(event!.timing).toEqual(timing);
        });

        it('goalToUserEvent omits timing entirely when the goal has none', () => {
            const event = goalToUserEvent({ ...baseGoal, targetDate: '2026-09-13', eventCategory: 'cycling_event' });
            expect(event!.timing).toBeUndefined();
        });

        it('evaluatePeriodizationPhase anchors on an unconfirmed timing.planningDate rather than the fallback targetDate', () => {
            const event = goalToUserEvent({
                ...baseGoal, targetDate: '2026-09-13', eventCategory: 'cycling_event',
                timing: { earliestDate: '2026-08-17', latestDate: '2026-09-13', planningDate: '2026-08-17' },
            })!;
            const phase = evaluatePeriodizationPhase([event], '2026-08-07');
            expect(phase.daysToEvent).toBe(10);
        });
    });

    describe('Phase 3: Microcycle Objectives', () => {
        it('generates weekly objectives and marks them satisfied when matching sessions complete', () => {
            const phaseWeights = evaluatePeriodizationPhase([], '2026-08-07').phase;
            const microcycle = generateWeeklyObjectives(phaseWeights, '2026-08-03', null);
            expect(microcycle.objectives.length).toBeGreaterThan(0);
            const updated = updateMicrocycleProgress(microcycle, {
                type: 'Threshold Running', duration_min: 45, training_effect: 3.5, intensity_tag: 'hard',
            });
            const thresholdObj = updated.objectives.find(o => o.key === 'threshold_quality');
            if (thresholdObj) expect(thresholdObj.completedExposures).toBe(1);
        });
    });

    describe('Phase 4: Multidimensional Fatigue & Decay', () => {
        it('applies exponential decay over elapsed hours and accumulates completed session load', () => {
            const initial = createEmptyFatigue('2026-08-07');
            const costProfile = { systemic: 0.8, cardiovascular: 0.9, lowerBody: 1.0, upperBody: 0.0, impactTissue: 0.8, neuromuscular: 0.9 };
            const loaded = applyCompletedSessionLoad(initial, '2026-08-07', costProfile);
            expect(loaded.externalLoadFatigue.lowerBody).toBe(1.0);
            const after48h = applyCompletedSessionLoad(loaded, '2026-08-09', { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 });
            expect(after48h.externalLoadFatigue.lowerBody).toBeCloseTo(0.5, 1);
        });
    });

    describe('Phase 5: Utility Optimization & Safety Gating', () => {
        it('allows upper-body strength while lower-body fatigue is elevated, and applies soft penalty to avoided modalities', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            fatigue.combinedFatigue.lowerBody = 0.9;
            const availability = resolveAvailability('2026-08-07', null, [], testContext());
            const preferences: UserPreferences = {
                userId: 'test_user', preferredRecoveryStyle: 'active', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 120,
                preferredTimeOfDay: 'morning', preferredModalities: ['Strength'], deprioritizedModalities: [], avoidedModalities: ['Running'],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };
            const ranked = rankCandidatesByUtility(ENRICHED_TEMPLATES, [], fatigue, availability, [], preferences);
            expect(ranked.length).toBeGreaterThan(0);
            const upperBodyOption = ranked.find(r => r.template.category === 'Upper-body Strength');
            const lowerBodyOption = ranked.find(r => r.template.category === 'Lower-body Strength');
            expect(upperBodyOption).toBeDefined();
            expect(lowerBodyOption).toBeDefined();
            expect(upperBodyOption!.utilityScore).toBeGreaterThan(lowerBodyOption!.utilityScore);
            const runningOption = ranked.find(r => r.template.modality === 'Running');
            if (runningOption) expect(runningOption.rationale).toContain('Soft penalty applied');
        });

        it('a limit hamstring injury excludes heavy lower-body work from the intent path', () => {
            const settings: TrainingSettings = testTrainingSettings({ injuries: [{ region: 'hamstring', severity: 'limit' }] });
            const resolved = resolveInjuryRestrictions(settings.injuries, '2026-08-07');
            const context = testContext({ impliedGuardrails: resolved.impliedGuardrails, restrictedCategories: resolved.restrictedCategories, restrictedModalities: resolved.restrictedModalities }, settings);
            const availability = resolveAvailability('2026-08-07', null, [], context);
            const eligible = eligibleTemplates(ENRICHED_TEMPLATES, context, availability.maxTimeMinutes, '2026-08-07');
            expect(eligible.some(t => t.safetyTags.includes('avoid_heavy_lower_body'))).toBe(false);
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
            const strengthAvailability = { ...availability, availableEquipment: ['free_weights', 'indoor_bike'] };
            const unstackedRanked = rankCandidatesByUtility(ENRICHED_TEMPLATES, [], fatigue, strengthAvailability, [], prefs, { date: '2026-08-07', recentHistory: [] });
            const stackedRanked = rankCandidates(ENRICHED_TEMPLATES, [], fatigue, strengthAvailability, [], prefs, { date: '2026-08-07', recentHistory: [{ date: '2026-08-06', modality: 'Strength', category: 'Lower-body Strength', systemicCost: 0.8, lowerBodyCost: 0.8 }] });
            const unstackedStrength = unstackedRanked.find(r => r.template.category === 'Lower-body Strength');
            const stackedStrength = stackedRanked.rejected.find(r => r.template.category === 'Lower-body Strength');
            expect(unstackedStrength).toBeDefined();
            expect(stackedStrength).toBeDefined();
            expect(stackedStrength!.excludedReasons).toContain('HARD_LOWER_BODY_SPACING_VIOLATION');

            const cyclingAvailability = { ...availability, availableEquipment: ['indoor_bike'] };
            const unstackedCyclingRanked = rankCandidatesByUtility(ENRICHED_TEMPLATES, [], fatigue, cyclingAvailability, [], prefs, { date: '2026-08-07', recentHistory: [] });
            const stackedCyclingRanked = rankCandidates(ENRICHED_TEMPLATES, [], fatigue, cyclingAvailability, [], prefs, { date: '2026-08-07', recentHistory: [{ date: '2026-08-06', modality: 'Cycling', category: 'Hard Endurance', role: 'anchor', systemicCost: 0.8 }] });
            const unstackedCycling = unstackedCyclingRanked.find(r => r.template.modality === 'Cycling');
            const stackedCycling = stackedCyclingRanked.rejected.find(r => r.template.modality === 'Cycling' && r.template.category === 'Hard Endurance');
            expect(unstackedCycling).toBeDefined();
            expect(stackedCycling).toBeDefined();
            expect(stackedCycling!.excludedReasons).toContain('QUALITY_SPACING_VIOLATION');
        });

        it('suppresses a second consecutive Moderate/Hard day across DIFFERENT modalities (intensity-stacking cap)', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = { ...resolveAvailability('2026-08-07', null), availableEquipment: ['indoor_bike', 'free_weights'] };
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };
            const afterHardBike = rankCandidates(ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs, { recentHistory: [{ date: '2026-08-06', modality: 'Cycling', category: 'Hard Endurance', type: 'Bike VO2 Intervals', systemicCost: 1.0 }] });
            const afterEasyBike = rankCandidates(ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs, { recentHistory: [{ date: '2026-08-06', modality: 'Cycling', type: 'Zone 2 Spin', systemicCost: 0.3 }] });
            const hardStrengthAfterHard = afterHardBike.accepted.find(r => r.template.category === 'Full-body Strength');
            const hardStrengthAfterEasy = afterEasyBike.accepted.find(r => r.template.category === 'Full-body Strength');
            expect(hardStrengthAfterEasy).toBeDefined();
            if (hardStrengthAfterHard) {
                expect(hardStrengthAfterHard.utilityScore).toBeLessThan(hardStrengthAfterEasy!.utilityScore);
            } else {
                const rejected = afterHardBike.rejected.find(r => r.template.category === 'Full-body Strength');
                expect(rejected).toBeDefined();
                expect(rejected!.excludedReasons.length).toBeGreaterThan(0);
            }
        });

        it('rotates between near-equivalent templates in the same modality/category rather than always returning the same one', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = resolveAvailability('2026-08-07', null, [], testContext());
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };
            const sharedProfile = {
                requiredEquipment: [] as SessionTemplate['requiredEquipment'],
                environment: 'either' as const,
                safetyTags: [] as SessionTemplate['safetyTags'],
                systemicCost: 0.4,
                stimulusProfile: { ...ZERO_CANONICAL_STIMULUS, aerobicEndurance: 0.6 },
                costProfile: { systemic: 0.2, cardiovascular: 0.3, lowerBody: 0.1, upperBody: 0, impactTissue: 0.1, neuromuscular: 0 },
            };
            const templateA: SessionTemplate = { id: 'variety_test_a', category: 'Easy Endurance', modality: 'Running', durationMin: 30, durationMax: 45, title: 'Variety Test Run A', description: '', ...sharedProfile };
            const templateB: SessionTemplate = { id: 'variety_test_b', category: 'Easy Endurance', modality: 'Running', durationMin: 30, durationMax: 45, title: 'Variety Test Run B', description: '', ...sharedProfile };
            const rankedFavoringB = rankCandidatesByUtility([templateA, templateB], [], fatigue, availability, [], prefs, { recentHistory: [{ type: 'Variety Test Run B' }, { type: 'Variety Test Run A' }] });
            expect(rankedFavoringB[0].template.id).toBe('variety_test_b');
            expect(rankedFavoringB[1].template.id).toBe('variety_test_a');
            const rankedFavoringA = rankCandidatesByUtility([templateA, templateB], [], fatigue, availability, [], prefs, { recentHistory: [{ type: 'Variety Test Run A' }, { type: 'Variety Test Run B' }] });
            expect(rankedFavoringA[0].template.id).toBe('variety_test_a');
            const differentCategory: SessionTemplate = { id: 'variety_test_c', category: 'Moderate Endurance', modality: 'Cycling', durationMin: 30, durationMax: 45, title: 'Variety Test Bike C', description: '', ...sharedProfile };
            const rankedAcrossCategories = rankCandidatesByUtility([templateA, templateB, differentCategory], [], fatigue, availability, [], prefs, { recentHistory: [] });
            expect(rankedAcrossCategories.map(r => r.template.id)).toEqual(expect.arrayContaining(['variety_test_a', 'variety_test_b', 'variety_test_c']));
            expect(rankedAcrossCategories.find(r => r.template.id === 'variety_test_c')).toBeDefined();
        });

        it('applies event-priority utility boost when an A-priority cycling event is active', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = { ...resolveAvailability('2026-08-07', null), maxTimeMinutes: 90, availableEquipment: ['indoor_bike', 'free_weights', 'cable_machine'] };
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };
            const cyclingFocusEvent: UserEvent = {
                id: 'c1', title: 'Road Race', date: '2026-09-12', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
                demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.6, repeatedSurges: 0.5, sprintPower: 0.3, fatigueResistance: 0.7, neuromuscular: 0.4 }
            };
            const rankedWithEvent = rankCandidatesByUtility(ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs, { focusEvent: cyclingFocusEvent });
            const cyclingPick = rankedWithEvent.find(r => r.template.modality === 'Cycling');
            const strengthPick = rankedWithEvent.find(r => r.template.modality === 'Strength');
            expect(cyclingPick).toBeDefined();
            expect(strengthPick).toBeDefined();
            expect(cyclingPick!.utilityScore).toBeGreaterThan(strengthPick!.utilityScore);
        });

        it('boosts BOTH Cycling and Running (not neither) for an A-priority triathlon event -- regression for the category-substring bug', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = { ...resolveAvailability('2026-08-07', null), maxTimeMinutes: 90, availableEquipment: ['indoor_bike', 'free_weights', 'cable_machine'] };
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };
            const triathlonFocusEvent: UserEvent = {
                id: 't1', title: 'Olympic Triathlon', date: '2026-09-12', priority: 'A', lifecycle: 'scheduled', category: 'triathlon',
                demandProfile: { aerobicEndurance: 0.75, thresholdPower: 0.8, vo2MaxPower: 0.45, repeatedSurges: 0.2, sprintPower: 0.1, fatigueResistance: 0.65, neuromuscular: 0.15 },
            };
            const withoutEvent = rankCandidatesByUtility(ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs, {});
            const withTriathlon = rankCandidatesByUtility(ENRICHED_TEMPLATES, [], fatigue, availability, [], prefs, { focusEvent: triathlonFocusEvent });
            const cyclingBaseline = withoutEvent.find(r => r.template.modality === 'Cycling')!;
            const runningBaseline = withoutEvent.find(r => r.template.modality === 'Running')!;
            const cyclingWithEvent = withTriathlon.find(r => r.template.id === cyclingBaseline.template.id)!;
            const runningWithEvent = withTriathlon.find(r => r.template.id === runningBaseline.template.id)!;
            expect(cyclingWithEvent.utilityScore).toBeGreaterThan(cyclingBaseline.utilityScore);
            expect(runningWithEvent.utilityScore).toBeGreaterThan(runningBaseline.utilityScore);
            const strengthWithEvent = withTriathlon.find(r => r.template.modality === 'Strength')!;
            expect(cyclingWithEvent.utilityScore).toBeGreaterThan(strengthWithEvent.utilityScore);
            expect(runningWithEvent.utilityScore).toBeGreaterThan(strengthWithEvent.utilityScore);
        });
    });

    describe('Phase 6: Race-Specific Endurance phase-gating', () => {
        const raceSpecificIds = ['end_race_specific_01', 'end_race_sim_01', 'end_taper_sharpen_01', 'end_pre_race_openers_01'];
        const cyclingEvent = (date: string, taper?: UserEvent['taper']): UserEvent => ({
            id: 'c1', title: 'Road Race', date, priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
            demandProfile: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.6, repeatedSurges: 0.5, sprintPower: 0.3, fatigueResistance: 0.7, neuromuscular: 0.4 },
            ...(taper ? { taper } : {}),
        });

        it('excludes every Race-Specific Endurance template when no focus event governs the day', () => {
            const noEvent = evaluatePeriodizationPhase([], '2026-08-07');
            raceSpecificIds.forEach(id => expect(isTemplatePhaseEligible(ENRICHED_TEMPLATES.find(t => t.id === id)!, noEvent)).toBe(false));
        });

        it('progresses eligibility from event-specific endurance -> race simulation -> taper sharpening -> pre-race openers as the event approaches', () => {
            const buildPhase = evaluatePeriodizationPhase([cyclingEvent('2026-09-16')], '2026-08-07');
            const specificityPhase = evaluatePeriodizationPhase([cyclingEvent('2026-08-27')], '2026-08-07');
            const taperPhase = evaluatePeriodizationPhase([cyclingEvent('2026-08-14', { startDate: '2026-08-07' })], '2026-08-07');
            const finalDays = evaluatePeriodizationPhase([cyclingEvent('2026-08-09', { startDate: '2026-08-07' })], '2026-08-07');
            const eligible = (result: typeof buildPhase, id: string) => isTemplatePhaseEligible(ENRICHED_TEMPLATES.find(t => t.id === id)!, result);
            expect(eligible(buildPhase, 'end_race_specific_01')).toBe(true);
            expect(eligible(buildPhase, 'end_race_sim_01')).toBe(false);
            expect(eligible(buildPhase, 'end_taper_sharpen_01')).toBe(false);
            expect(eligible(buildPhase, 'end_pre_race_openers_01')).toBe(false);
            expect(eligible(specificityPhase, 'end_race_specific_01')).toBe(true);
            expect(eligible(specificityPhase, 'end_race_sim_01')).toBe(true);
            expect(eligible(specificityPhase, 'end_taper_sharpen_01')).toBe(false);
            expect(eligible(taperPhase, 'end_race_specific_01')).toBe(false);
            expect(eligible(taperPhase, 'end_race_sim_01')).toBe(false);
            expect(eligible(taperPhase, 'end_taper_sharpen_01')).toBe(true);
            expect(eligible(taperPhase, 'end_pre_race_openers_01')).toBe(false);
            expect(eligible(finalDays, 'end_pre_race_openers_01')).toBe(true);
        });

        it('Path B ranks a phase-eligible Race-Specific Endurance template with real (non-zero) utility', () => {
            const fatigue = createEmptyFatigue('2026-08-07');
            const availability = { ...resolveAvailability('2026-08-07', null), maxTimeMinutes: 120, availableEquipment: [] };
            const prefs: UserPreferences = {
                userId: '', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 90,
                preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
                explanationVerbosity: 'brief', conservativeBias: false,
                preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
            };
            const periodization = evaluatePeriodizationPhase([cyclingEvent('2026-08-27')], '2026-08-07');
            const candidates = ENRICHED_TEMPLATES.filter(t => isTemplatePhaseEligible(t, periodization));
            expect(candidates.some(t => t.category === 'Race-Specific Endurance')).toBe(true);
            const ranked = rankCandidatesByUtility(candidates, [], fatigue, availability, [], prefs, { focusEvent: periodization.focusEvent });
            const raceSpecificPick = ranked.find(r => r.template.category === 'Race-Specific Endurance');
            expect(raceSpecificPick).toBeDefined();
            expect(raceSpecificPick!.utilityScore).toBeGreaterThan(0);
        });
    });
});
