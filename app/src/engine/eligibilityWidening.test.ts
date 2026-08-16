import { describe, expect, it } from 'vitest';
import { evaluateTemplateEligibility, eligibleTemplates, type GateableSession } from './eligibility';
import { TEMPLATES } from './templates';
import type { TrainingSettings, UserContext } from './models';

/**
 * Phase 8.2 / ADR-0019 D-CANDIDATE. The hard feasibility gates were widened from
 * `SessionTemplate` to the structural `GateableSession` so an imported external session
 * passes the *same* gates rather than getting a parallel path that can drift.
 *
 * These tests pin both halves of that: catalog templates behave exactly as before, and a
 * non-catalog object carrying only the structural fields is gated identically.
 */

function settings(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
    return {
        userId: 'athlete', schemaVersion: 3,
        equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: true, pullup_bar: false },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 120, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function context(constraints: Partial<UserContext['constraints']> = {}, trainingSettings = settings()): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true,
            restrictedModalities: [], maxTimeMinutes: 90, ...constraints,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        trainingSettings,
    };
}

/** Deliberately NOT a SessionTemplate: no id, title, or description. */
function externalSession(overrides: Partial<GateableSession> = {}): GateableSession {
    return {
        durationMin: 45, durationMax: 60,
        requiredEquipment: [], environment: 'either', safetyTags: [],
        modality: 'Cycling', category: 'Moderate Endurance', systemicCost: 0.5,
        ...overrides,
    };
}

const WEEKDAY = '2026-08-18'; // Tuesday

describe('GateableSession widening (Phase 8.2)', () => {
    it('gates a non-catalog session on the athlete time budget', () => {
        const tooLong = evaluateTemplateEligibility(externalSession({ durationMin: 90 }), context(), 120, WEEKDAY);
        expect(tooLong.eligible).toBe(false);
        expect(tooLong.reasons).toContain('time_limit');

        const fits = evaluateTemplateEligibility(externalSession({ durationMin: 45 }), context(), 120, WEEKDAY);
        expect(fits.eligible).toBe(true);
    });

    it('gates a non-catalog session on absent equipment', () => {
        const result = evaluateTemplateEligibility(externalSession({ requiredEquipment: ['treadmill'] }), context(), 120, WEEKDAY);
        expect(result.reasons).toContain('equipment');
    });

    it('gates a non-catalog session on environment, guardrails, modality and category', () => {
        const indoorOnly = settings({ defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 120, environment: 'indoor' } });
        expect(evaluateTemplateEligibility(externalSession({ environment: 'outdoor' }), context({}, indoorOnly), 120, WEEKDAY).reasons)
            .toContain('environment');

        const guarded = settings({ guardrails: { avoid_high_impact: true, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false } });
        expect(evaluateTemplateEligibility(externalSession({ safetyTags: ['avoid_high_impact'] }), context({}, guarded), 120, WEEKDAY).reasons)
            .toContain('safety_guardrail');

        expect(evaluateTemplateEligibility(externalSession({ modality: 'Running' }), context({ restrictedModalities: ['Running'] }), 120, WEEKDAY).reasons)
            .toContain('restricted_modality');

        expect(evaluateTemplateEligibility(
            externalSession({ category: 'Upper-body Strength' }),
            context({ restrictedCategories: ['Upper-body Strength'] }),
            120, WEEKDAY,
        ).reasons).toContain('restricted_category');
    });

    it('returns the caller\'s own session type, not a widened one', () => {
        const session = externalSession();
        const result = evaluateTemplateEligibility(session, context(), 120, WEEKDAY);
        // Identity, not a copy: downstream can read fields the gate never knew about.
        expect(result.template).toBe(session);

        const template = TEMPLATES[0];
        expect(evaluateTemplateEligibility(template, context(), 120, WEEKDAY).template.id).toBe(template.id);
    });

    it('filters a mixed list without narrowing catalog templates', () => {
        const kept = eligibleTemplates(TEMPLATES, context(), 120, WEEKDAY);
        expect(kept.length).toBeGreaterThan(0);
        // Still SessionTemplate at the type level and at runtime.
        expect(kept.every(item => typeof item.id === 'string' && typeof item.title === 'string')).toBe(true);
    });

    it('applies the identical verdict to a template and to its structural copy', () => {
        const template = TEMPLATES.find(item => item.requiredEquipment.length > 0) ?? TEMPLATES[0];
        const copy: GateableSession = {
            durationMin: template.durationMin, durationMax: template.durationMax,
            requiredEquipment: template.requiredEquipment, environment: template.environment,
            safetyTags: template.safetyTags, modality: template.modality,
            category: template.category, systemicCost: template.systemicCost,
        };
        const viaTemplate = evaluateTemplateEligibility(template, context(), 120, WEEKDAY);
        const viaCopy = evaluateTemplateEligibility(copy, context(), 120, WEEKDAY);

        expect(viaCopy.eligible).toBe(viaTemplate.eligible);
        expect(viaCopy.reasons).toEqual(viaTemplate.reasons);
    });
});
