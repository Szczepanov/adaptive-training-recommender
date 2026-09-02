import { describe, expect, it } from 'vitest';
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';
import { filterCandidates } from './reconciliationCandidates';

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-1',
        userId: 'user-1',
        status: 'active',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T06:00:00.000Z',
        updatedAt: '2026-08-26T06:00:00.000Z',
        ...overrides,
    };
}

const structuredFacts: ReconciliationSourceFacts = {
    sourceRef: { kind: 'structured_execution', executionId: 'exec-new' },
    localDate: '2026-08-26',
    durationMin: 40,
};

const providerFacts: ReconciliationSourceFacts = {
    sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: 'act-new' },
    localDate: '2026-08-26',
    durationMin: 40,
};

describe('filterCandidates', () => {
    it('excludes merged (tombstoned) occurrences', () => {
        const pool = [occurrence({ status: 'merged', mergedIntoOccurrenceId: 'pto-2' })];
        expect(filterCandidates(structuredFacts, pool)).toHaveLength(0);
    });

    it('excludes an occurrence whose excludedSourceKeys contains the incoming source (sticky manual unlink)', () => {
        const pool = [occurrence({
            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-x' }],
            reconciliation: { state: 'single_source', excludedSourceKeys: ['structured_execution:exec-new'] },
        })];
        expect(filterCandidates(structuredFacts, pool)).toHaveLength(0);
    });

    it('excludes an occurrence that already carries the exact incoming source', () => {
        const pool = [occurrence({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-new' }] })];
        expect(filterCandidates(structuredFacts, pool)).toHaveLength(0);
    });

    it('excludes an occurrence that already has a structured_execution source when the incoming source is also structured', () => {
        const pool = [occurrence({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-other' }] })];
        expect(filterCandidates(structuredFacts, pool)).toHaveLength(0);
    });

    it('allows an occurrence that already has one provider_activity source to still be a candidate for another provider_activity (multi-device)', () => {
        const pool = [occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-other-device' }] })];
        expect(filterCandidates(providerFacts, pool)).toHaveLength(1);
    });

    it('keeps a plausible opposite-kind, active, non-excluded candidate', () => {
        const pool = [occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-x' }] })];
        expect(filterCandidates(structuredFacts, pool)).toHaveLength(1);
    });
});
