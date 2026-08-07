import { describe, expect, it } from 'vitest';
import { applyCompletedSessionLoad, createEmptyFatigue } from './fatigue';
import { generateWeeklyObjectives, updateMicrocycleProgress } from './microcycle';
import type { UserEvent, UserPreferences } from './models';
import { rankCandidatesByUtility } from './optimizer';
import { evaluatePeriodizationPhase } from './periodization';
import { resolveAvailability } from './schedule';
import { ENRICHED_TEMPLATES } from './templates';

describe('Architecture & Phased Engine Integration', () => {
    describe('Phase 1: Schedule & Location Availability', () => {
        it('resolves day-of-week schedule time and isolates tomorrow from today check-in', () => {
            const todayCheckin = {
                readiness: 5,
                sleepQuality: 5,
                fatigue: 5,
                soreness: 5,
                stress: 5,
                motivation: 5,
                timeAvailable: 30, // Today explicitly limited to 30 min
                painFlag: false,
                alreadyTrainedToday: false,
                preferredModalityToday: null,
            };

            // Resolving Saturday (2026-08-08) should use weekend default (120 min), not today's 30 min
            const tomorrowAvailability = resolveAvailability('2026-08-08', null);
            expect(tomorrowAvailability.maxTimeMinutes).toBe(120);

            // Today (Friday 2026-08-07) with check-in uses 30 min
            const todayAvailability = resolveAvailability('2026-08-07', todayCheckin);
            expect(todayAvailability.maxTimeMinutes).toBe(30);
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

            const availability = resolveAvailability('2026-08-12', null, undefined, undefined, fixedActivities);
            // Default Wednesday is 45 min, subtracted 90 min fixed activity -> max remaining time is 0
            expect(availability.maxTimeMinutes).toBe(0);
            expect(availability.reservedCapacityCost).toBe(0.8);
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
            expect(phase.phaseName).toBe('Specificity');
            expect(phase.taperActive).toBe(false);
        });
    });

    describe('Phase 3: Microcycle Objectives', () => {
        it('generates weekly objectives and marks them satisfied when matching sessions complete', () => {
            const phaseWeights = evaluatePeriodizationPhase([], '2026-08-07');
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

            const availability = resolveAvailability('2026-08-07', null);
            const preferences: UserPreferences = {
                userId: 'test_user',
                preferredRecoveryStyle: 'active',
                defaultWeekdayTimeMin: 60,
                defaultWeekendTimeMin: 120,
                preferredTimeOfDay: 'morning',
                preferredModalities: ['Strength'],
                deprioritizedModalities: [],
                avoidedModalities: ['Running'], // Soft penalty
                explanationStyle: 'brief',
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
    });
});
