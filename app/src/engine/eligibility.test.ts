import { describe, expect, it } from 'vitest';
import { eligibleTemplates, evaluateTemplateEligibility, resolveMaximumSessionMinutes } from './eligibility';
import { TEMPLATES, TEMPLATES_BY_ID } from './templates';
import type { SessionTemplate, TrainingSettings, UserContext } from './models';
import { DEFAULT_MAX_TIME_MINUTES } from './adapters';

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

    it('keeps low-load strength available under overhead and spinal-loading guardrails', () => {
        const guarded = settings({ guardrails: {
            avoid_high_impact: false, avoid_heavy_lower_body: false,
            avoid_overhead_pressing: true, avoid_heavy_spinal_loading: true,
        } });
        const candidate = TEMPLATES_BY_ID.get('str_low_load_maint_01')!;
        expect(candidate.systemicCost).toBeLessThanOrEqual(0.35);
        expect(candidate.safetyTags).not.toContain('avoid_overhead_pressing');
        expect(candidate.safetyTags).not.toContain('avoid_heavy_spinal_loading');
        expect(evaluateTemplateEligibility(candidate, context(guarded), 30, '2026-08-07').eligible).toBe(true);
        expect(evaluateTemplateEligibility(TEMPLATES_BY_ID.get('str_full_03')!, context(guarded), 60, '2026-08-07').eligible).toBe(false);
    });

    it('activates low-load strength only when a shoulder or spinal guardrail calls for that fallback', () => {
        const id = 'str_low_load_maint_01';
        const candidateIds = (profile: TrainingSettings) => eligibleTemplates(TEMPLATES, context(profile), 60, '2026-08-07').map(template => template.id);
        expect(candidateIds(settings())).not.toContain(id);
        for (const guardrail of ['avoid_overhead_pressing', 'avoid_heavy_spinal_loading'] as const) {
            expect(candidateIds(settings({ guardrails: { ...settings().guardrails, [guardrail]: true } }))).toContain(id);
        }
        expect(candidateIds(settings({ guardrails: { ...settings().guardrails, avoid_heavy_lower_body: true, avoid_overhead_pressing: true } })))
            .not.toContain(id);
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

    it('terminates the no-answer sentinel at a finite runtime fallback without changing unset profile semantics', () => {
        const profile = settings({ defaults: { weekdayMaxMinutes: null, weekendMaxMinutes: null, environment: 'either' } });
        expect(profile.defaults.weekdayMaxMinutes).toBeNull();
        expect(profile.defaults.weekendMaxMinutes).toBeNull();
        expect(resolveMaximumSessionMinutes(context(profile), Number.POSITIVE_INFINITY, '2026-08-07'))
            .toBe(DEFAULT_MAX_TIME_MINUTES);
    });

    it('keeps a finite check-in time authoritative when the profile limit is unset', () => {
        const profile = settings({ defaults: { weekdayMaxMinutes: null, weekendMaxMinutes: null, environment: 'either' } });
        expect(resolveMaximumSessionMinutes(context(profile), 75, '2026-08-07')).toBe(75);
    });

    it('ignores a non-finite legacy profile limit rather than leaking it downstream', () => {
        const ctx = context(settings());
        ctx.trainingSettings = undefined;
        ctx.constraints.maxTimeMinutes = Number.POSITIVE_INFINITY;
        expect(resolveMaximumSessionMinutes(ctx, Number.POSITIVE_INFINITY, '2026-08-07'))
            .toBe(DEFAULT_MAX_TIME_MINUTES);
    });

    it('rejects a negative profile limit rather than making every session ineligible', () => {
        // migrateLegacyConstraints copies a legacy max_time_minutes value without a
        // non-negativity check, so a bad historical import can persist a negative limit.
        // Number.isFinite(-30) is true, so this must be rejected on its own term.
        const profile = settings({ defaults: { weekdayMaxMinutes: -30, weekendMaxMinutes: null, environment: 'either' } });
        expect(resolveMaximumSessionMinutes(context(profile), 60, '2026-08-07')).toBe(60);
    });

    it('rejects a negative check-in time rather than propagating it past the day boundary', () => {
        // parseSubjectiveCheckin's read-path nullableNumber only requires finite, unlike
        // the write-path's [0, 1440] range validation -- a malformed persisted document can
        // still carry a negative timeAvailableMin.
        const profile = settings({ defaults: { weekdayMaxMinutes: null, weekendMaxMinutes: null, environment: 'either' } });
        expect(resolveMaximumSessionMinutes(context(profile), -10, '2026-08-07')).toBe(DEFAULT_MAX_TIME_MINUTES);
    });

    it('treats zero as a valid, meaningful limit rather than falling back', () => {
        const profile = settings({ defaults: { weekdayMaxMinutes: 0, weekendMaxMinutes: null, environment: 'either' } });
        expect(resolveMaximumSessionMinutes(context(profile), 60, '2026-08-07')).toBe(0);
        expect(resolveMaximumSessionMinutes(context(settings({ defaults: { weekdayMaxMinutes: null, weekendMaxMinutes: null, environment: 'either' } })), 0, '2026-08-07')).toBe(0);
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

    it('admits the authored 30-minute tempo variation under a 35-minute cap without changing its 40-minute default', () => {
        const tempo = TEMPLATES_BY_ID.get('end_mod_02')!;
        const ctx = context(settings({ defaults: { weekdayMaxMinutes: 35, weekendMaxMinutes: 35, environment: 'either' } }));
        expect(tempo.durationMin).toBe(40);
        expect(tempo.allowsShortTimeCapDose).toBe(true);
        expect(tempo.easierDose).toMatchObject({ durationMin: 30, durationMax: 30 });
        expect(evaluateTemplateEligibility(tempo, ctx, 35, '2026-08-07').eligible).toBe(true);
        expect(eligibleTemplates([tempo], ctx, 35, '2026-08-07')[0]?.easierDose)
            .toMatchObject({ durationMin: 30, durationMax: 30 });
        expect(evaluateTemplateEligibility(tempo, ctx, 29, '2026-08-07').reasons).toContain('time_limit');
        const nonOptedIn = TEMPLATES_BY_ID.get('end_hard_03')!;
        expect(nonOptedIn.easierDose?.durationMin).toBeLessThan(nonOptedIn.durationMin);
        expect(evaluateTemplateEligibility(nonOptedIn, ctx, 30, '2026-08-07').reasons).toContain('time_limit');
    });

    it('excludes a whole restricted category even when a template carries no matching safetyTag', () => {
        // Every current Upper-body Strength template now carries avoid_overhead_pressing
        // (issue #680 fixed the gap where str_upper_pull_01 had safetyTags: []), so this
        // uses a synthetic template to keep proving restrictedCategories is enforced on its
        // own -- not merely redundant with safetyTags -- for a template that (by omission,
        // future addition, or a not-yet-conservative tag) carries no matching safetyTag.
        // restrictedCategories exists precisely for this case (see injuryPolicy.ts: exclude
        // severity on shoulder/elbow/wrist restricts the whole Upper-body Strength category,
        // not just overhead-press-tagged templates), and it must be enforced by
        // eligibleTemplates() itself so every caller -- planner.ts's 7-day forecast included,
        // not just rules.ts's today/tomorrow path -- gets it for free.
        const untaggedUpperBodyTemplate: SessionTemplate = {
            id: 'synthetic_upper_untagged', category: 'Upper-body Strength', modality: 'Strength',
            durationMin: 20, durationMax: 30, title: 'Synthetic untagged upper-body template',
            description: 'Test-only template with no safetyTags, to isolate restrictedCategories.',
            requiredEquipment: [], environment: 'either', safetyTags: [], systemicCost: 0.3,
        };

        const profile = settings({ equipment: { free_weights: true, cable_machine: true, treadmill: false, indoor_bike: true, pullup_bar: true } });
        const ctx = context(profile);
        ctx.constraints.restrictedCategories = ['Upper-body Strength'];

        const result = evaluateTemplateEligibility(untaggedUpperBodyTemplate, ctx, 60, '2026-08-07');
        expect(result.eligible).toBe(false);
        expect(result.reasons).toContain('restricted_category');

        expect(eligibleTemplates(TEMPLATES, ctx, 60, '2026-08-07').some(t => t.category === 'Upper-body Strength')).toBe(false);
    });

    it('excludes pull-up and bodyweight full-body strength templates once avoid_overhead_pressing is active (issue #680)', () => {
        // Regression for the reported gap: str_upper_pull_01 and str_full_02 had
        // safetyTags: [] despite containing shoulder-loading movements (pull-ups, push-ups,
        // a prone row), so an active shoulder/back guardrail never excluded them. Covers
        // every strength template whose linked workout contains a shoulder-contraindicated
        // exercise (see templateWorkoutSafetyAlignment.test.ts for the general audit).
        const profile = settings({ equipment: { free_weights: true, cable_machine: true, treadmill: false, indoor_bike: true, pullup_bar: true } });
        const ctx = context(profile);
        ctx.constraints.impliedGuardrails = ['avoid_overhead_pressing'];

        for (const templateId of ['str_upper_pull_01', 'str_upper_01', 'str_full_02', 'str_full_01', 'str_full_03', 'str_power_01']) {
            const result = evaluateTemplateEligibility(TEMPLATES_BY_ID.get(templateId)!, ctx, 60, '2026-08-07');
            expect(result.eligible, `${templateId} should be excluded by avoid_overhead_pressing`).toBe(false);
            expect(result.reasons).toContain('safety_guardrail');
        }
    });

    it('does not blanket-exclude non-strength templates when avoid_overhead_pressing is active', () => {
        // The guardrail is scoped to templates whose safetyTags actually match -- it must
        // not silently remove unrelated, symptom-compatible candidates (e.g. walking) that
        // the planner could otherwise pick automatically.
        const profile = settings({ equipment: { free_weights: true, cable_machine: true, treadmill: false, indoor_bike: true, pullup_bar: true } });
        const ctx = context(profile);
        ctx.constraints.impliedGuardrails = ['avoid_overhead_pressing'];

        expect(eligibleTemplates(TEMPLATES, ctx, 60, '2026-08-07').some(t => t.id === 'end_walk_01')).toBe(true);
    });
});
