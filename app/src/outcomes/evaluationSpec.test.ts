import { describe, expect, it } from 'vitest';
import type { OutcomeEvaluationSpecRevision, OutcomeMetricBinding } from './evaluationSpec';
import {
    assertValidBaselineSelection,
    assertValidOutcomeEvaluationSnapshot,
    assertValidOutcomeMetricBinding,
} from './evaluationSpec';
import { canonicalEvaluationContent, hashEvaluationContent } from './evaluationHash';

const revision: OutcomeEvaluationSpecRevision = {
    id: 'block-1',
    revision: 1,
    title: 'Cycling build block',
    startDate: '2026-08-24',
    endDate: '2026-10-04',
    status: 'draft',
    contentHash: '',
    createdAt: '2026-08-21T08:00:00.000Z',
};

const primary: OutcomeMetricBinding = {
    id: 'p20',
    metricId: 'cycling_tt_20m_mean_power_w',
    protocolRef: { id: 'cycling-20m-tt', revision: 1 },
    role: 'primary',
    expectedDirection: { kind: 'higher_is_better' },
    baseline: { kind: 'declared_observation', observationId: 'baseline:p20' },
    targetObservationWindow: { startDate: '2026-09-28', endDate: '2026-10-04' },
    practicalThreshold: { kind: 'percent', value: 2 },
    rationale: 'Primary block outcome',
};

describe('OutcomeEvaluationSpec OV5.1', () => {
    it('requires mechanically complete baseline selection', () => {
        expect(() => assertValidBaselineSelection({ kind: 'declared_observation', observationId: '' })).toThrow(/observationId/);
        expect(() => assertValidBaselineSelection({
            kind: 'first_valid_in_window',
            window: { startDate: '2026-09-01', endDate: '2026-08-01' },
            selection: 'earliest_valid',
        })).toThrow(/cannot exceed/);
    });

    it('blocks context-only metrics from primary/secondary roles', () => {
        expect(() => assertValidOutcomeMetricBinding({
            ...primary,
            metricId: 'cycling_submax_mean_hr_bpm',
        })).toThrow(/Context-only metric/);
    });

    it('requires finite ordered target-range bounds in the metric unit', () => {
        expect(() => assertValidOutcomeMetricBinding({
            ...primary,
            expectedDirection: { kind: 'target_range', lowerBound: 300, upperBound: 290, unit: 'W' },
        })).toThrow(/lowerBound < upperBound/);
        expect(() => assertValidOutcomeMetricBinding({
            ...primary,
            expectedDirection: { kind: 'target_range', lowerBound: 290, upperBound: 310, unit: 'bpm' },
        })).toThrow(/requires unit W/);
    });

    it('context bindings cannot smuggle direction or practical thresholds', () => {
        expect(() => assertValidOutcomeMetricBinding({
            id: 'hr',
            metricId: 'cycling_submax_mean_hr_bpm',
            role: 'context',
            baseline: { kind: 'declared_observation', observationId: 'hr-base' },
            rationale: 'Context',
            expectedDirection: { kind: 'lower_is_better' },
        } as unknown as OutcomeMetricBinding)).toThrow(/Context binding cannot declare expectedDirection/);
    });

    it('requires at least one primary and unique binding ids', () => {
        expect(() => assertValidOutcomeEvaluationSnapshot({
            revision,
            bindings: [{
                id: 'hr', metricId: 'cycling_submax_mean_hr_bpm', role: 'context',
                baseline: { kind: 'declared_observation', observationId: 'hr-base' }, rationale: 'Context',
            }],
        })).toThrow(/at least one primary/);
        expect(() => assertValidOutcomeEvaluationSnapshot({ revision, bindings: [primary, { ...primary }] })).toThrow(/Duplicate/);
    });

    it('canonical hash is binding-order independent and changes when criteria change', async () => {
        const secondary: OutcomeMetricBinding = { ...primary, id: 'p4', metricId: 'cycling_tt_4m_mean_power_w', role: 'secondary' };
        const one = { revision, bindings: [primary, secondary] };
        const two = { revision, bindings: [secondary, primary] };
        expect(canonicalEvaluationContent(one)).toBe(canonicalEvaluationContent(two));
        expect(await hashEvaluationContent(one)).toBe(await hashEvaluationContent(two));
        expect(await hashEvaluationContent(one)).not.toBe(await hashEvaluationContent({
            revision,
            bindings: [{ ...primary, rationale: 'Changed after review' }, secondary],
        }));
    });
});
