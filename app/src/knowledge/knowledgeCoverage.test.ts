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

    it('keeps existing Sports Knowledge Registry migrations covered', () => {
        expect(byId('evergreen.adult_aerobic_weekly_volume')).toMatchObject({ coverage: 'covered', knowledgeRefs: ['health.adults.aerobic.weekly_volume'] });
        expect(byId('evergreen.adult_strength_weekly_frequency')).toMatchObject({ coverage: 'covered', knowledgeRefs: ['health.adults.strength.weekly_frequency'] });
        expect(byId('evergreen.strength_default_upper_target')).toMatchObject({ coverage: 'covered', knowledgeRefs: ['health.adults.strength.default_upper_target'] });
        expect(byId('evergreen.high_intensity_weekly_prior')).toMatchObject({ coverage: 'covered', knowledgeRefs: ['performance.high_intensity.conditional_weekly_prior'] });
    });

    it('surfaces the highest-impact research gaps rather than treating them as covered', () => {
        const expectedP0Gaps = [
            'readiness.physiological_strain_model',
            'readiness.subjective_mode_thresholds',
            'readiness.absolute_device_floors',
            'readiness.acute_biometric_floors',
            'readiness.recent_hard_session_penalty',
            'readiness.mode_score_thresholds',
            'fatigue.dimension_half_lives',
            'fatigue.internal_response_model',
            'injury.tissue_response_severity',
            'injury.region_restriction_mapping',
            'injury.pain_envelope_mapping',
            'spacing.anchor_next_day',
            'spacing.rolling_hard_cap',
            'spacing.hard_lower_body_recovery',
            'spacing.strength_key_cycling_adjacency',
            'periodization.taper_windows_volume',
        ];
        expectedP0Gaps.forEach(id => {
            expect(byId(id)).toMatchObject({ coverage: 'uncovered', researchPriority: 'p0' });
        });
    });

    it('separates conservative software invariants from missing sports-science claims', () => {
        expect(byId('safety.minimum_checkin_gate')).toMatchObject({ classification: 'safety_invariant', coverage: 'not_applicable' });
        expect(byId('readiness.already_trained_fail_closed')).toMatchObject({ classification: 'safety_invariant', coverage: 'not_applicable' });
        expect(byId('planning.user_capacity_authority')).toMatchObject({ classification: 'implementation_constant', coverage: 'not_applicable' });
        expect(byId('data_trust.identity_gated_source_fail_closed')).toMatchObject({ classification: 'safety_invariant', coverage: 'not_applicable' });
    });

    it('reports coverage and high-risk debt as first-class metrics', () => {
        const summary = summarizeKnowledgeCoverage();
        expect(summary.total).toBe(ENGINE_KNOWLEDGE_COVERAGE.length);
        expect(summary.byCoverage.covered).toBe(4);
        expect(summary.byCoverage.uncovered).toBeGreaterThan(30);
        expect(summary.highImpactUncovered).toBeGreaterThan(15);
        expect(summary.highSafetyUncovered).toBeGreaterThan(5);
        expect(summary.byPriority.p0).toBeGreaterThan(10);
    });

    it('records shadow/observability models outside live decision coverage', () => {
        const refs = REVIEWED_NON_AUTHORITY_SURFACES.map(surface => surface.ref);
        expect(refs).toContain('engine/sleepRecoveryEvidence.ts');
        expect(refs).toContain('engine/dataConfidence.ts');
        expect(refs).toContain('engine/healthAnomaly.ts');
        expect(refs).toContain('engine/activityHrFidelity.ts');
        expect(refs).toContain('engine/identityAttribution.ts');
    });

    it('rejects false coverage and category errors', () => {
        const base = ENGINE_KNOWLEDGE_COVERAGE[0];
        const invalid = [
            { ...base, id: 'bad covered', coverage: 'covered' as const, knowledgeRefs: [] },
            { ...base, id: 'bad.na', classification: 'scientific_claim' as const, coverage: 'not_applicable' as const, knowledgeRefs: [], researchPriority: 'none' as const },
        ];
        const result = validateKnowledgeCoverageInventory(invalid);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('id must be stable lowercase machine-safe text'),
            expect.stringContaining('covered items require at least one knowledgeRef'),
            expect.stringContaining('not_applicable is reserved'),
        ]));
    });
});
