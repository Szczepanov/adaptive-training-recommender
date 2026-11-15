import { describe, expect, it, vi } from 'vitest';
import {
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
    VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
} from '../derived/flags/illnessAnomaly/healthAnomaly';
import { healthAnomalyService } from './healthAnomalyService';
import {
    resolveConfiguredHealthAnomalyRuntimePolicy,
    resolveConfiguredHealthAnomalyShadowPolicy,
    runConfiguredHealthAnomalyShadow,
} from './healthAnomalyRuntime';

describe('resolveConfiguredHealthAnomalyRuntimePolicy', () => {
    it.each([undefined, null, ''])('defaults omitted/empty value %p to visible-v1', value => {
        expect(resolveConfiguredHealthAnomalyRuntimePolicy(value)).toBe('visible-v1');
        expect(resolveConfiguredHealthAnomalyShadowPolicy(value)).toBe('visible-v1');
    });

    it('accepts off, shadow-v1, and visible-v1 explicitly, and maps tighten-v1 to visible-v1', () => {
        expect(resolveConfiguredHealthAnomalyRuntimePolicy('off')).toBe('off');
        expect(resolveConfiguredHealthAnomalyRuntimePolicy('shadow-v1')).toBe('shadow-v1');
        expect(resolveConfiguredHealthAnomalyRuntimePolicy('visible-v1')).toBe('visible-v1');
        expect(resolveConfiguredHealthAnomalyRuntimePolicy('tighten-v1')).toBe('visible-v1');
        expect(resolveConfiguredHealthAnomalyShadowPolicy('visible-v1')).toBe('visible-v1');
    });

    it.each([
        'SHADOW-V1',
        ' shadow-v1 ',
        'visible',
        true,
        1,
    ])('fails malformed value %p closed to off', value => {
        expect(resolveConfiguredHealthAnomalyRuntimePolicy(value)).toBe('off');
    });

    it('passes the matching policy and threshold constant to healthAnomalyService', async () => {
        const spy = vi.spyOn(healthAnomalyService, 'assessAndPersist').mockResolvedValue(null);
        try {
            await runConfiguredHealthAnomalyShadow('u1', '2026-08-21', 'visible-v1');
            expect(spy).toHaveBeenLastCalledWith('u1', '2026-08-21', 'visible-v1', VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS);

            await runConfiguredHealthAnomalyShadow('u1', '2026-08-21', 'shadow-v1');
            expect(spy).toHaveBeenLastCalledWith('u1', '2026-08-21', 'shadow-v1', SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS);

            spy.mockClear();
            await expect(runConfiguredHealthAnomalyShadow('u1', '2026-08-21', 'off')).resolves.toBeNull();
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
