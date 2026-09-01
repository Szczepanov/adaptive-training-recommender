import { describe, expect, it } from 'vitest';
import {
    ENGINE_KNOWLEDGE_COVERAGE,
    REVIEWED_NON_AUTHORITY_SURFACES,
    summarizeKnowledgeCoverage,
    validateKnowledgeCoverageInventory,
} from './knowledgeCoverage';

const byId = (id: string) => ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === id);

describe('engine knowledge coverage inventory', () => {
    it('is structurally valid and references only active knowledge claims', () => {
        const result = validateKnowledgeCoverageInventory();
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('keeps the original Sports Knowledge Registry migrations covered', () => {
        expect(byId('evergreen.adult_aerobic_weekly_volume')).toMatchObject({ coverage: 'covered', knowledgeRefs: ['health.adults.aerobic.weekly_volume'] });
        expect(byId('evergreen.adult_strength_weekly_frequency')).toMatchObject({ coverage: 'covered', knowledgeRefs: ['health.adults.strength.weekly_frequency'] });
        expect(byId('evergreen.strength_default_upper_target')).toMatchObject({ coverage: 'covered', knowledgeRefs: ['health.adults.strength.default_upper_target'] });
        expect(byId('evergreen.high_intensity_weekly_prior')).toMatchObject({ coverage: 'covered', knowledgeRefs: ['performance.high_intensity.conditional_weekly_prior'] });
    });

    it('keeps the load, intensity and recovery evidence pack covered', () => {
        const covered = [
            'readiness.recent_hard_session_penalty',
            'fatigue.dimension_half_lives',
            'spacing.anchor_next_day',
            'spacing.rolling_hard_cap',
            'spacing.strength_key_cycling_adjacency',
            'optimizer.intensity_class_thresholds',
        ];
        covered.forEach(id => expect(byId(id)).toMatchObject({ coverage: 'covered', researchPriority: 'none' }));
        expect(byId('spacing.hard_lower_body_recovery')).toMatchObject({ coverage: 'partial', researchPriority: 'p1', safetyImpact: 'high' });
    });

    it('migrates the objective-readiness evidence pack while keeping exact cut-points explicitly heuristic', () => {
        const covered = [
            'readiness.physiological_strain_model',
            'readiness.absolute_device_floors',
            'readiness.acute_biometric_floors',
            'readiness.mode_score_thresholds',
            'fatigue.internal_response_model',
        ];
        covered.forEach(id => {
            const item = byId(id);
            expect(item).toMatchObject({ classification: 'product_heuristic', coverage: 'covered', researchPriority: 'none' });
            expect(item?.knowledgeRefs.length).toBeGreaterThanOrEqual(3);
            expect(item?.coverageRationale).toMatch(/product|Product/);
        });

        expect(byId('readiness.physiological_strain_model')?.knowledgeRefs).toEqual(expect.arrayContaining([
            'readiness.hrv.contextual_individualized_monitoring',
            'readiness.rhr.contextual_individualized_monitoring',
            'readiness.sleep.loss_impairs_performance',
            'readiness.sleep.consumer_wearable_measurement_limits',
            'readiness.respiration.longitudinal_contextual_signal',
            'policy.readiness.physiological_strain_model_v1',
        ]));
        expect(byId('readiness.acute_biometric_floors')?.knowledgeRefs).toContain('readiness.rhr.contextual_individualized_monitoring');
        expect(byId('readiness.mode_score_thresholds')?.knowledgeRefs).toContain('readiness.respiration.longitudinal_contextual_signal');
    });

    it('keeps the remaining P0 research gaps visible and subjective readiness partial', () => {
        const expectedP0Gaps = [
            'injury.tissue_response_severity',
            'injury.region_restriction_mapping',
            'injury.pain_envelope_mapping',
            'periodization.taper_windows_volume',
        ];
        expectedP0Gaps.forEach(id => expect(byId(id)).toMatchObject({ coverage: 'uncovered', researchPriority: 'p0' }));
        expect(byId('readiness.subjective_mode_thresholds')).toMatchObject({ coverage: 'partial', researchPriority: 'p0', safetyImpact: 'high' });
    });

    it('separates conservative software invariants from missing sports-science claims', () => {
        expect(byId('safety.minimum_checkin_gate')).toMatchObject({ classification: 'safety_invariant', coverage: 'not_applicable' });
        expect(byId('readiness.already_trained_fail_closed')).toMatchObject({ classification: 'safety_invariant', coverage: 'not_applicable' });
        expect(byId('planning.user_capacity_authority')).toMatchObject({ classification: 'implementation_constant', coverage: 'not_applicable' });
        expect(byId('data_trust.identity_gated_source_fail_closed')).toMatchObject({ classification: 'safety_invariant', coverage: 'not_applicable' });
    });

    it('reports the post-readiness-pack coverage and risk debt exactly', () => {
        const summary = summarizeKnowledgeCoverage();
        expect(summary.total).toBe(47);
        expect(summary.byCoverage).toEqual({ covered: 15, partial: 2, uncovered: 25, not_applicable: 5 });
        expect(summary.byPriority).toEqual({ p0: 5, p1: 13, p2: 7, p3: 2, none: 20 });
        expect(summary.highImpactUncovered).toBe(12);
        expect(summary.highSafetyUncovered).toBe(3);
    });

    it('records shadow/observability models outside live decision coverage', () => {
        const refs = REVIEWED_NON_AUTHORITY_SURFACES.map(surface => surface.ref);
        expect(refs).toContain('engine/sleepRecoveryEvidence.ts');
        expect(refs).toContain('engine/dataConfidence.ts');
        expect(refs).toContain('engine/healthAnomaly.ts');
        expect(refs).toContain('engine/activityHrFidelity.ts');
        expect(refs).toContain('engine/identityAttribution.ts');
    });

    it('rejects false coverage, category errors and partial items that drop their backlog priority', () => {
        const base = ENGINE_KNOWLEDGE_COVERAGE[0];
        const invalid = [
            { ...base, id: 'bad covered', coverage: 'covered' as const, knowledgeRefs: [] },
            { ...base, id: 'bad.na', classification: 'scientific_claim' as const, coverage: 'not_applicable' as const, knowledgeRefs: [], researchPriority: 'none' as const },
            { ...base, id: 'bad.partial', coverage: 'partial' as const, knowledgeRefs: ['health.adults.aerobic.weekly_volume'], researchPriority: 'none' as const },
        ];
        const result = validateKnowledgeCoverageInventory(invalid);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('id must be stable lowercase machine-safe text'),
            expect.stringContaining('covered items require at least one knowledgeRef'),
            expect.stringContaining('not_applicable is reserved'),
            expect.stringContaining('partial items must retain a research priority'),
        ]));
    });
});
