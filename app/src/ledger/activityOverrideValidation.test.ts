import { describe, expect, it } from 'vitest';
import { assertValidActivityOverride, validateActivityOverride } from './activityOverrideValidation';

function override(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        activityId: 'act-1',
        userId: 'u1',
        date: '2026-03-30',
        originalType: 'Running',
        originalIntensityTag: 'hard',
        overriddenModality: 'Running',
        overriddenIntensity: 'moderate',
        rpe: 7,
        stimulusFocus: 'thresholdPower',
        notes: 'note',
        createdAt: '2026-03-30T10:00:00Z',
        updatedAt: '2026-03-30T10:00:00Z',
        ...extra,
    };
}

describe('validateActivityOverride', () => {
    it('accepts a complete override', () => {
        expect(validateActivityOverride(override())).toEqual([]);
    });

    it.each([
        ['null rpe', { rpe: null }],
        ['absent rpe', { rpe: undefined }],
        ['boundary rpe 1', { rpe: 1 }],
        ['boundary rpe 10', { rpe: 10 }],
        ['null stimulusFocus', { stimulusFocus: null }],
        ['absent stimulusFocus', { stimulusFocus: undefined }],
        ['Unknown modality', { overriddenModality: 'Unknown' }],
        ['unknown intensity', { overriddenIntensity: 'unknown' }],
        ['empty originalIntensityTag', { originalIntensityTag: '' }],
    ])('accepts %s', (_label, extra) => {
        expect(validateActivityOverride(override(extra))).toEqual([]);
    });

    it.each([
        ['a malformed date', { date: '2026-3-30' }, 'date'],
        ['an impossible date', { date: '2026-02-30' }, 'date'],
        ['a non-string date', { date: 20260330 }, 'date'],
        ['an unknown modality', { overriddenModality: 'Walking' }, 'overriddenModality'],
        ['an unknown intensity', { overriddenIntensity: 'extreme' }, 'overriddenIntensity'],
        ['rpe 0', { rpe: 0 }, 'rpe'],
        ['rpe 11', { rpe: 11 }, 'rpe'],
        ['NaN rpe', { rpe: Number.NaN }, 'rpe'],
        ['Infinity rpe', { rpe: Number.POSITIVE_INFINITY }, 'rpe'],
        ['a string rpe', { rpe: '7' }, 'rpe'],
        ['an unknown stimulusFocus', { stimulusFocus: 'power' }, 'stimulusFocus'],
        ['a non-string originalIntensityTag', { originalIntensityTag: 3 }, 'originalIntensityTag'],
        ['a missing originalIntensityTag', { originalIntensityTag: undefined }, 'originalIntensityTag'],
    ])('rejects %s', (_label, extra, path) => {
        const issues = validateActivityOverride(override(extra));
        expect(issues.map(issue => issue.path)).toContain(path);
        expect(() => assertValidActivityOverride(override(extra))).toThrow(/Invalid activity override/);
    });

    it('rejects a non-object', () => {
        expect(validateActivityOverride(null)).toHaveLength(1);
        expect(() => assertValidActivityOverride([])).toThrow('Expected object');
    });
});
