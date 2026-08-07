import { describe, expect, it } from 'vitest';
import { eligibleTemplates, evaluateTemplateEligibility, resolveMaximumSessionMinutes } from './eligibility';
import { TEMPLATES } from './templates';
import type { TrainingSettings, UserContext } from './models';

function settings(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 2,
        equipment: { free_weights: true, cable_machine: true, treadmill: false, indoor_bike: true, pullup_bar: false },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 45, weekendMaxMinutes: 90, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function context(trainingSettings: TrainingSettings): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: { hasCableMachine: true, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, injuries: [], maxTimeMinutes: 180 },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        trainingSettings,
    };
}

describe('training-settings eligibility', () => {
    it('requires a pull-up bar for the pull-up strength template', () => {
        const result = evaluateTemplateEligibility(TEMPLATES.find(t => t.id === 'str_upper_pull_01')!, context(settings()), 60, '2026-08-07');
        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('equipment');
    });

    it('filters high-impact sessions when the athlete blocks high impact', () => {
        const profile = settings({ guardrails: { avoid_high_impact: true, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false } });
        expect(eligibleTemplates(TEMPLATES, context(profile), 60, '2026-08-07').some(t => t.modality === 'Running' || t.modality === 'Field')).toBe(false);
    });

    it('enforces an indoor-only boundary and keeps either-location recovery available', () => {
        const profile = settings({ defaults: { weekdayMaxMinutes: 45, weekendMaxMinutes: 90, environment: 'indoor' } });
        const templates = eligibleTemplates(TEMPLATES, context(profile), 60, '2026-08-07');
        expect(templates.some(t => t.environment === 'outdoor')).toBe(false);
        expect(templates.some(t => t.id === 'rest_01')).toBe(true);
    });

    it('uses the smaller of today’s availability and the day-specific profile limit', () => {
        const profile = settings();
        expect(resolveMaximumSessionMinutes(context(profile), 60, '2026-08-07')).toBe(45);
        expect(resolveMaximumSessionMinutes(context(profile), 30, '2026-08-08')).toBe(30);
    });
});
