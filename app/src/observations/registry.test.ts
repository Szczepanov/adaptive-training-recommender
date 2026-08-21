import { describe, expect, it } from 'vitest';
import {
    assertMetricAllowedForOutcomeRole,
    assertMetricUnit,
    getMetricDefinition,
    listMetricDefinitions,
} from './registry';

describe('OV1 metric registry', () => {
    it('ships only the bounded cycling-first v1 registry', () => {
        expect(listMetricDefinitions().map(metric => metric.id)).toEqual([
            'cycling_tt_20m_mean_power_w',
            'cycling_tt_4m_mean_power_w',
            'cycling_submax_mean_hr_bpm',
            'cycling_submax_rpe',
        ]);
        expect(getMetricDefinition('cycling_tt_20m_mean_power_w').direction).toBe('higher_is_better');
    });

    it('requires the metric exact unit', () => {
        expect(assertMetricUnit('cycling_tt_20m_mean_power_w', 'W').unit).toBe('W');
        expect(() => assertMetricUnit('cycling_tt_20m_mean_power_w', 'kW')).toThrow(/requires unit W/);
    });

    it('fails closed for unsupported metric ids', () => {
        expect(() => getMetricDefinition('cycling_magic_fitness_score')).toThrow(/Unsupported metric id/);
    });

    it('does not allow context-only evidence to be promoted to a primary or secondary outcome', () => {
        expect(() => assertMetricAllowedForOutcomeRole('cycling_submax_mean_hr_bpm', 'primary'))
            .toThrow(/Context-only metric/);
        expect(() => assertMetricAllowedForOutcomeRole('cycling_submax_rpe', 'secondary'))
            .toThrow(/Context-only metric/);
        expect(assertMetricAllowedForOutcomeRole('cycling_submax_rpe', 'context').direction).toBe('context_only');
    });
});
