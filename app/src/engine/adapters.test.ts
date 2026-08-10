import { describe, expect, it } from 'vitest';
import { mapContextFromGoalsAndTrainingSettings } from './adapters';
import type { DailySubjectiveCheckin, TrainingSettings, UserPreferences } from './models';

function testTrainingSettings(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: false },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 45, weekendMaxMinutes: 120, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function testCheckin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'athlete', date: '2026-08-08',
        readiness: 8, sleepQuality: 8, fatigue: 3, soreness: 3, mentalStress: 3, motivation: 8,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: '2026-08-08T07:00:00.000Z',
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1, createdAt: '2026-08-08T07:00:00.000Z', updatedAt: '2026-08-08T07:00:00.000Z',
        ...overrides,
    };
}

describe('mapContextFromGoalsAndTrainingSettings (Phase 5.4 tissue response wiring)', () => {
    it('turns persisted unavailable modalities into hard engine restrictions', () => {
        const preferences: UserPreferences = {
            userId: 'athlete', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 45, defaultWeekendTimeMin: 60,
            preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
            unavailableModalities: ['Cycling'], explanationVerbosity: 'detailed', conservativeBias: false,
            preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1,
            createdAt: '', updatedAt: '',
        };

        const context = mapContextFromGoalsAndTrainingSettings([], testTrainingSettings(), preferences, '2026-08-08');
        expect(context.constraints.restrictedModalities).toContain('Cycling');
    });

    it("threads today's tissue response into the injury gate, tightening a monitor-only knee constraint", () => {
        const settings = testTrainingSettings({ injuries: [{ region: 'knee', severity: 'monitor' }] });
        const checkin = testCheckin({
            painOrInjury: true,
            tissueResponses: { knee: { region: 'knee', morningState: 'normal', painDuringTraining: 'severe' } },
        });

        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08', checkin);

        expect(context.constraints.restrictedModalities).toContain('Running');
    });

    it("a high-readiness, no-pain check-in leaves an existing constraint's restrictions exactly as they were", () => {
        const settings = testTrainingSettings({ injuries: [{ region: 'knee', severity: 'exclude', reviewBy: '2026-09-01' }] });
        const checkin = testCheckin({ readiness: 10 });

        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08', checkin);

        expect(context.constraints.restrictedModalities).toContain('Running');
    });

    it('behaves the same with no check-in supplied at all (backward compatible)', () => {
        const settings = testTrainingSettings({ injuries: [{ region: 'shoulder', severity: 'limit' }] });
        const context = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08');
        expect(context.constraints.impliedGuardrails).toContain('avoid_overhead_pressing');
    });

    // Regression coverage for the Home.tsx forecast-leak bug: a today-only tissue-derived
    // restriction (no standing InjuryConstraint at all) must restrict a decision built WITH
    // today's checkin, but must NOT restrict a decision built without one -- which is
    // exactly the distinction Home.tsx's `context` (today) vs `forecastContext`
    // (tomorrow's provisional plan and the week-ahead strip) relies on to keep a single
    // day's tissue flag from silently blocking Running on every projected day of the week.
    it("a today-only tissue-derived restriction (no standing InjuryConstraint) restricts today's context but not a forecast context built without the checkin", () => {
        const settings = testTrainingSettings({ injuries: [] });
        const checkin = testCheckin({
            painOrInjury: true,
            tissueResponses: { knee: { region: 'knee', morningState: 'severe' } },
        });

        const todayContext = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08', checkin);
        expect(todayContext.constraints.restrictedModalities).toContain('Running');

        const forecastContext = mapContextFromGoalsAndTrainingSettings([], settings, null, '2026-08-08', null);
        expect(forecastContext.constraints.restrictedModalities).not.toContain('Running');
    });
});
