import { describe, expect, it } from 'vitest';
import { assertValidMeasurementProtocol } from './protocols';
import { PERFORMANCE_TEST_DEFINITIONS, getPerformanceTestDefinition } from './performanceTestingCatalog';
import { validateSessionDefinition } from '../sessions/validation';

describe('performance testing catalog', () => {
    it('contains only the bounded cycling v1 test set', () => {
        expect(PERFORMANCE_TEST_DEFINITIONS.map(definition => definition.id)).toEqual([
            'cycling-20m-tt-r1',
            'cycling-4m-tt-r1',
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
        expect(definition.sessionDefinition.summary?.toLowerCase()).toContain('does not estimate ftp');
    });

    it('fails closed for unknown catalog ids', () => {
        expect(() => getPerformanceTestDefinition('unknown-test')).toThrow(/Unknown performance test definition/);
    });
});
