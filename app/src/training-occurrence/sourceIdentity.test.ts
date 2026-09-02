import { describe, expect, it } from 'vitest';
import {
    encodeSourceKeyForDocId,
    providerActivitySourceKey,
    sourceKeyForRef,
    structuredExecutionSourceKey,
} from './sourceIdentity';

describe('structuredExecutionSourceKey / providerActivitySourceKey', () => {
    it('produces stable, kind-prefixed keys', () => {
        expect(structuredExecutionSourceKey('exec-1')).toBe('structured_execution:exec-1');
        expect(providerActivitySourceKey('garmin', 'act-1')).toBe('provider_activity:garmin:act-1');
    });
});

describe('sourceKeyForRef', () => {
    it('derives the same key as the standalone builders', () => {
        expect(sourceKeyForRef({ kind: 'structured_execution', executionId: 'exec-1' })).toBe('structured_execution:exec-1');
        expect(sourceKeyForRef({ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' })).toBe('provider_activity:garmin:act-1');
    });
});

describe('encodeSourceKeyForDocId', () => {
    it('is deterministic for the same input', () => {
        const key = 'provider_activity:garmin:12345';
        expect(encodeSourceKeyForDocId(key)).toBe(encodeSourceKeyForDocId(key));
    });

    it('never produces "/" in the encoded doc id', () => {
        const key = 'structured_execution:exec/with/slashes';
        expect(encodeSourceKeyForDocId(key)).not.toContain('/');
    });

    it('never produces the reserved "." or ".." doc ids', () => {
        expect(encodeSourceKeyForDocId('.')).not.toBe('.');
        expect(encodeSourceKeyForDocId('..')).not.toBe('..');
    });

    it('produces different doc ids for different source keys', () => {
        const a = encodeSourceKeyForDocId('provider_activity:garmin:1');
        const b = encodeSourceKeyForDocId('provider_activity:garmin:2');
        expect(a).not.toBe(b);
    });

    it('falls back to a stable hash for unexpectedly long keys instead of truncating', () => {
        const longKey = `structured_execution:${'x'.repeat(1000)}`;
        const encoded = encodeSourceKeyForDocId(longKey);
        expect(encoded.length).toBeLessThan(100);
        expect(encoded).toBe(encodeSourceKeyForDocId(longKey));

        const otherLongKey = `structured_execution:${'y'.repeat(1000)}`;
        expect(encoded).not.toBe(encodeSourceKeyForDocId(otherLongKey));
    });
});
