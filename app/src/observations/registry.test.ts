import { describe, expect, it } from 'vitest';
import {
    assertMetricAllowedForOutcomeRole,
    assertMetricUnit,
    getMetricDefinition,
    listMetricDefinitions,
} from './registry';

describe('OV1 metric registry', () => {
    it('ships the bounded v1 registry', () => {
        expect(listMetricDefinitions().map(metric => metric.id)).toEqual([
            'cycling_tt_20m_mean_power_w',
            'cycling_tt_4m_mean_power_w',
            'cycling_submax_mean_hr_bpm',
            'cycling_submax_rpe',
            'strength_1rm_kg',
            'sprint_elapsed_time_s',
            'cycling_5s_peak_power_w',
            'standing_broad_jump_distance_cm',
            'wall_touch_cmj_height_cm',
            'seated_medball_throw_distance_m',
            'cycling_sprint_1s_peak_power_w',
            'cycling_sprint_5s_mean_power_w',
        ]);
        expect(getMetricDefinition('cycling_tt_20m_mean_power_w').direction).toBe('higher_is_better');
    });

    it('registers the #897 physical-capital benchmark metrics with units and direction', () => {
        expect(getMetricDefinition('standing_broad_jump_distance_cm')).toMatchObject({ domain: 'field', unit: 'cm', direction: 'higher_is_better' });
        expect(getMetricDefinition('wall_touch_cmj_height_cm')).toMatchObject({ domain: 'field', unit: 'cm', direction: 'higher_is_better' });
        expect(getMetricDefinition('seated_medball_throw_distance_m')).toMatchObject({ domain: 'field', unit: 'm', direction: 'higher_is_better' });
        expect(getMetricDefinition('cycling_sprint_1s_peak_power_w')).toMatchObject({ domain: 'cycling', unit: 'W', direction: 'higher_is_better' });
        expect(getMetricDefinition('cycling_sprint_5s_mean_power_w')).toMatchObject({ domain: 'cycling', unit: 'W', direction: 'higher_is_better' });
        expect(() => assertMetricUnit('seated_medball_throw_distance_m', 'cm')).toThrow(/requires unit m/);
        // Raw capture fields (cadence, balance, bar velocity, RPE) are deliberately not metrics.
        expect(() => getMetricDefinition('peak_cadence_rpm')).toThrow(/Unsupported metric id/);
        expect(() => getMetricDefinition('mean_concentric_velocity_mps')).toThrow(/Unsupported metric id/);
    });

    it('registers the strength/speed/power performance-goal metrics with the correct direction', () => {
        expect(getMetricDefinition('strength_1rm_kg')).toMatchObject({ domain: 'strength', unit: 'kg', direction: 'higher_is_better' });
        expect(getMetricDefinition('sprint_elapsed_time_s')).toMatchObject({ domain: 'field', unit: 's', direction: 'lower_is_better' });
        expect(getMetricDefinition('cycling_5s_peak_power_w')).toMatchObject({ domain: 'cycling', unit: 'W', direction: 'higher_is_better' });
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
