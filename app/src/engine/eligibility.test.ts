import { describe, expect, it } from 'vitest';
import { eligibleTemplates, evaluateTemplateEligibility, resolveMaximumSessionMinutes } from './eligibility';
import { TEMPLATES, TEMPLATES_BY_ID } from './templates';
import type { SessionTemplate, TrainingSettings, UserContext } from './models';

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
        constraints: { hasCableMachine: true, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 180 },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        trainingSettings,
    };
}

describe('training-settings eligibility', () => {
    it('requires a pull-up bar for the pull-up strength template', () => {
        const result = evaluateTemplateEligibility(TEMPLATES_BY_ID.get('str_upper_pull_01')!, context(settings()), 60, '2026-08-07');
        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('equipment');
    });

    it('filters high-impact sessions when the athlete blocks high impact', () => {
        const profile = settings({ guardrails: { avoid_high_impact: true, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false } });
        expect(eligibleTemplates(TEMPLATES, context(profile), 60, '2026-08-07').some(t => t.modality === 'Running' || t.modality === 'Field')).toBe(false);
    });

    it('filters explicitly restricted modalities as a hard gate', () => {
        const profile = settings();
        const ctx = context(profile);
        ctx.constraints.restrictedModalities = ['Cycling'];

        const result = evaluateTemplateEligibility(TEMPLATES_BY_ID.get('cycling_technical_01')!, ctx, 60, '2026-08-07');
        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('restricted_modality');
        expect(eligibleTemplates(TEMPLATES, ctx, 60, '2026-08-07').some(t => t.modality === 'Cycling')).toBe(false);
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

    it('attaches a cap-safe dose when an eligible wide-range template has no authored easier dose', () => {
        const profile = settings({ defaults: { weekdayMaxMinutes: 40, weekendMaxMinutes: 90, environment: 'either' } });
        const template = eligibleTemplates(TEMPLATES, context(profile), 60, '2026-08-07')
            .find(candidate => candidate.id === 'cycling_technical_01');

        expect(template).toBeDefined();
        expect(template?.durationMin).toBe(30);
        expect(template?.durationMax).toBe(55);
        expect(template?.easierDose).toMatchObject({ durationMin: 30, durationMax: 40 });
        expect(template?.easierDose?.doseRatio).toBeCloseTo(40 / 55, 6);
    });

    it('caps an authored easier dose too, so modify-mode auto-adjustment cannot overrun availability', () => {
        const wideTemplate: SessionTemplate = {
            id: 'wide-test',
            category: 'Easy Endurance',
            modality: 'Cycling',
            durationMin: 20,
            durationMax: 60,
            title: 'Wide test session',
            description: 'Synthetic wide-range session for the cap invariant.',
            requiredEquipment: [],
            environment: 'either',
            safetyTags: [],
            systemicCost: 0.3,
            easierDose: {
                label: 'Authored easier',
                durationMin: 15,
                durationMax: 45,
                doseRatio: 0.7,
                prescriptionSummary: 'Shorter authored session.',
            },
        };
        const profile = settings({ defaults: { weekdayMaxMinutes: 30, weekendMaxMinutes: 90, environment: 'either' } });
        const [eligible] = eligibleTemplates([wideTemplate], context(profile), 60, '2026-08-07');

        expect(eligible).toBeDefined();
        expect(eligible.easierDose).toMatchObject({ durationMin: 15, durationMax: 30 });
        expect(eligible.easierDose?.doseRatio).toBeCloseTo(0.7 * (30 / 45), 6);
    });

    it('excludes a whole restricted category even when the template carries no matching safetyTag', () => {
        // str_upper_pull_01 ("Pull-up Strength Practice") is Upper-body Strength with
        // safetyTags: [] -- an excluded-elbow injury's avoid_overhead_pressing guardrail
        // alone would never catch it. restrictedCategories exists precisely for this case
        // (see injuryPolicy.ts: exclude severity on shoulder/elbow/wrist restricts the whole
        // Upper-body Strength category, not just overhead-press-tagged templates), and it
        // must be enforced by eligibleTemplates() itself so every caller -- planner.ts's
        // 7-day forecast included, not just rules.ts's today/tomorrow path -- gets it for free.
        const profile = settings({ equipment: { free_weights: true, cable_machine: true, treadmill: false, indoor_bike: true, pullup_bar: true } });
        const ctx = context(profile);
        ctx.constraints.restrictedCategories = ['Upper-body Strength'];

        const result = evaluateTemplateEligibility(TEMPLATES_BY_ID.get('str_upper_pull_01')!, ctx, 60, '2026-08-07');
        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('restricted_category');

        expect(eligibleTemplates(TEMPLATES, ctx, 60, '2026-08-07').some(t => t.category === 'Upper-body Strength')).toBe(false);
    });
});
