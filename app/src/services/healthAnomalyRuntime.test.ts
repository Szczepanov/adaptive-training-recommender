import { describe, expect, it } from 'vitest';
import { resolveConfiguredHealthAnomalyShadowPolicy } from './healthAnomalyRuntime';

describe('resolveConfiguredHealthAnomalyShadowPolicy', () => {
    it('allows only the explicitly configured shadow mode', () => {
        expect(resolveConfiguredHealthAnomalyShadowPolicy('shadow-v1')).toBe('shadow-v1');
    });

    it.each([
        undefined,
        null,
        '',
        'off',
        'visible-v1',
        'tighten-v1',
        'SHADOW-V1',
        ' shadow-v1 ',
        true,
        1,
    ])('fails value %p closed to off', value => {
        expect(resolveConfiguredHealthAnomalyShadowPolicy(value)).toBe('off');
    });
});
