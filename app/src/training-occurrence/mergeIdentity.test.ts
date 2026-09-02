import { describe, expect, it } from 'vitest';
import type { PerformedTrainingOccurrence } from './models';
import { orderOccurrencesForMerge } from './mergeIdentity';

function occurrence(id: string, createdAt: string): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: id,
        userId: 'user-1',
        status: 'active',
        localDate: '2026-08-26',
        sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: id }],
        reconciliation: { state: 'single_source' },
        createdAt,
        updatedAt: createdAt,
    };
}

describe('orderOccurrencesForMerge', () => {
    it('uses the earlier creation time as the primary survivor key', () => {
        const earlier = occurrence('pto-z', '2026-08-26T06:00:00.000Z');
        const later = occurrence('pto-a', '2026-08-26T06:00:01.000Z');

        expect(orderOccurrencesForMerge(later, earlier).map(item => item.performedOccurrenceId))
            .toEqual(['pto-z', 'pto-a']);
    });

    it('tie-breaks equal creation timestamps by canonical ID independent of argument order', () => {
        const lowerId = occurrence('pto-a', '2026-08-26T06:00:00.000Z');
        const higherId = occurrence('pto-z', '2026-08-26T06:00:00.000Z');

        expect(orderOccurrencesForMerge(lowerId, higherId).map(item => item.performedOccurrenceId))
            .toEqual(['pto-a', 'pto-z']);
        expect(orderOccurrencesForMerge(higherId, lowerId).map(item => item.performedOccurrenceId))
            .toEqual(['pto-a', 'pto-z']);
    });
});
