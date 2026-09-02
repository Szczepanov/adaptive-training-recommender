import { describe, expect, it } from 'vitest';
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';
import { buildProjection, mergeProjection, projectionAfterAttach } from './projectionBuilder';

function structuredFacts(overrides: Partial<ReconciliationSourceFacts> = {}): ReconciliationSourceFacts {
    return {
        sourceRef: { kind: 'structured_execution', executionId: 'exec-1' },
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        durationMin: 40,
        modality: 'strength',
        ...overrides,
    };
}

function garminFacts(overrides: Partial<ReconciliationSourceFacts> = {}): ReconciliationSourceFacts {
    return {
        sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:53:00.000Z',
        endedAt: '2026-08-26T07:30:00.000Z',
        durationMin: 39,
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
        modality: 'strength',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T06:52:00.000Z',
        updatedAt: '2026-08-26T06:52:00.000Z',
        ...overrides,
    };
}

describe('buildProjection', () => {
    it('returns an empty projection for no facts', () => {
        expect(buildProjection([])).toEqual({});
    });

    it('prefers structured-execution facts over provider-activity facts', () => {
        const projection = buildProjection([garminFacts(), structuredFacts({ startedAt: '2026-08-26T06:52:30.000Z' })]);
        expect(projection.startedAt).toBe('2026-08-26T06:52:30.000Z');
    });

    it('falls back to provider facts when no structured source is present', () => {
        const projection = buildProjection([garminFacts()]);
        expect(projection.startedAt).toBe('2026-08-26T06:53:00.000Z');
        expect(projection.modality).toBe('strength');
    });
});

describe('mergeProjection', () => {
    it('never overwrites a known field with an absent one', () => {
        const existing = { localDate: '2026-08-26', modality: 'strength', startedAt: '2026-08-26T06:52:00.000Z', endedAt: '2026-08-26T07:32:00.000Z' };
        const merged = mergeProjection(existing, { localDate: undefined, modality: undefined, startedAt: undefined, endedAt: undefined });
        expect(merged).toEqual(existing);
    });
});

describe('projectionAfterAttach', () => {
    it('lets a newly attached structured source overwrite a Garmin-only occurrence\'s fields', () => {
        const garminOnly = occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }], startedAt: '2026-08-26T06:53:00.000Z' });
        const result = projectionAfterAttach(garminOnly, structuredFacts({ startedAt: '2026-08-26T06:52:30.000Z' }));
        expect(result.startedAt).toBe('2026-08-26T06:52:30.000Z');
    });

    it('never lets a newly attached Garmin source overwrite an existing structured occurrence\'s fields', () => {
        const structuredOwned = occurrence();
        const result = projectionAfterAttach(structuredOwned, garminFacts({ startedAt: '2026-08-26T06:53:00.000Z' }));
        expect(result.startedAt).toBe('2026-08-26T06:52:00.000Z'); // unchanged from the occurrence, not Garmin's
    });

    it('fills in fields from a Garmin source when the occurrence has no structured source yet', () => {
        const garminOnly = occurrence({
            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-other' }],
            startedAt: undefined,
        });
        const result = projectionAfterAttach(garminOnly, garminFacts());
        expect(result.startedAt).toBe('2026-08-26T06:53:00.000Z');
    });
});
