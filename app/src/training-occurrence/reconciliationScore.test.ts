import { describe, expect, it } from 'vitest';
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';
import { scoreCandidate } from './reconciliationScore';

function facts(overrides: Partial<ReconciliationSourceFacts> = {}): ReconciliationSourceFacts {
    return {
        sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        durationMin: 40,
        modality: 'strength',
        ...overrides,
    };
}

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-1',
        userId: 'user-1',
        status: 'active',
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:53:00.000Z',
        endedAt: '2026-08-26T07:30:00.000Z',
        modality: 'strength',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T06:53:00.000Z',
        updatedAt: '2026-08-26T06:53:00.000Z',
        ...overrides,
    };
}

describe('scoreCandidate', () => {
    it('scores 1.0 on explicit prescriptionHash correlation regardless of timing', () => {
        const incoming = facts({ sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }, prescriptionHash: 'hash-abc', startedAt: undefined, endedAt: undefined, localDate: '2026-08-30' });
        const candidate = occurrence({
            localDate: '2026-01-01',
            startedAt: undefined,
            endedAt: undefined,
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1', prescriptionHash: 'hash-abc' }],
        });

        const { confidence, features } = scoreCandidate(incoming, candidate);

        expect(confidence).toBe(1);
        expect(features.explicitCorrelation).toBe(true);
    });

    it('scores 0 when modality is known and incompatible, even with strong temporal overlap', () => {
        const incoming = facts({ modality: 'cycling' });
        const candidate = occurrence({ modality: 'strength' });

        const { confidence, features } = scoreCandidate(incoming, candidate);

        expect(confidence).toBe(0);
        expect(features.modalityCompatible).toBe(false);
    });

    it('scores highly for overlapping absolute timestamps and compatible modality', () => {
        const { confidence, features } = scoreCandidate(facts(), occurrence());

        expect(features.hasAbsoluteTimestamps).toBe(true);
        expect(features.overlapSeconds).toBeGreaterThan(0);
        expect(confidence).toBeGreaterThan(0.75);
    });

    it('decays confidence as the start-time gap grows, with no overlap', () => {
        const near = scoreCandidate(
            facts({ startedAt: '2026-08-26T06:52:00.000Z', endedAt: '2026-08-26T06:52:00.000Z' }),
            occurrence({ startedAt: '2026-08-26T07:10:00.000Z', endedAt: '2026-08-26T07:10:00.000Z' }),
        );
        const far = scoreCandidate(
            facts({ startedAt: '2026-08-26T06:52:00.000Z', endedAt: '2026-08-26T06:52:00.000Z' }),
            occurrence({ startedAt: '2026-08-26T11:52:00.000Z', endedAt: '2026-08-26T11:52:00.000Z' }),
        );

        expect(near.confidence).toBeGreaterThan(far.confidence);
        expect(far.features.overlapSeconds).toBe(0);
    });

    it('caps confidence well below auto-link range when neither side has an absolute timestamp (date+duration only)', () => {
        const incoming = facts({ startedAt: undefined, endedAt: undefined });
        const candidate = occurrence({ startedAt: undefined, endedAt: undefined });

        const { confidence, features } = scoreCandidate(incoming, candidate);

        expect(features.hasAbsoluteTimestamps).toBe(false);
        expect(confidence).toBeLessThan(0.5);
    });

    it('treats unknown modality on either side as neutral, not disqualifying', () => {
        const incoming = facts({ modality: undefined });
        const candidate = occurrence({ modality: 'strength' });

        const { features } = scoreCandidate(incoming, candidate);

        expect(features.modalityCompatible).toBeNull();
    });
});
