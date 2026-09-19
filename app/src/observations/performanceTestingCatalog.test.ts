import { describe, expect, it } from 'vitest';
import { assertValidMeasurementProtocol } from './protocols';
import { PERFORMANCE_TEST_DEFINITIONS, getPerformanceTestDefinition } from './performanceTestingCatalog';
import { validateSessionDefinition } from '../sessions/validation';

describe('performance testing catalog', () => {
    it('contains the bounded v1 test set', () => {
        expect(PERFORMANCE_TEST_DEFINITIONS.map(definition => definition.id)).toEqual([
            'cycling-20m-tt-r1',
            'cycling-4m-tt-r1',
            'sprint_10m_standing-r1',
            'cycling_5s_peak_power-r1',
        ]);
    });

    it.each(PERFORMANCE_TEST_DEFINITIONS)('validates $id protocol and session contracts', definition => {
        expect(() => assertValidMeasurementProtocol(definition.protocol)).not.toThrow();
        expect(validateSessionDefinition(definition.sessionDefinition).ok).toBe(true);
        expect(definition.sessionDefinition.intent).toBe('testing');
        expect(definition.protocol.intent).toBe('testing');
    });

    it('keeps raw 20-minute power raw rather than naming or deriving FTP', () => {
        const definition = getPerformanceTestDefinition('cycling-20m-tt-r1');
        expect(definition.protocol.metricIds).toEqual(['cycling_tt_20m_mean_power_w']);
        expect(definition.sessionDefinition.summary.toLowerCase()).toContain('does not estimate ftp');
    });

    it('fails closed for unknown catalog ids', () => {
        expect(() => getPerformanceTestDefinition('unknown-test')).toThrow(/Unknown performance test definition/);
    });

    it('keeps standing and flying 10 m sprints as distinct series-defining subjects', () => {
        const standing = getPerformanceTestDefinition('sprint_10m_standing-r1');
        expect(standing.protocol.metricIds).toEqual(['sprint_elapsed_time_s']);
        expect(standing.protocol.comparisonContext.seriesDefining).toEqual(
            expect.arrayContaining(['start_mode', 'timing_method']),
        );
        expect(standing.defaultContext.start_mode).toBe('standing');
    });

    it('keeps the 5-second peak-power test distinct from the mean-power TT tests', () => {
        const definition = getPerformanceTestDefinition('cycling_5s_peak_power-r1');
        expect(definition.protocol.metricIds).toEqual(['cycling_5s_peak_power_w']);
        expect(definition.defaultContext.duration_seconds).toBe(5);
    });
});
