import { describe, expect, it } from 'vitest';
import { parsePerformedTrainingOccurrence, parsePerformedOccurrenceSourceLink } from './validation';
import { prepareTo4Evidence, type TrainingOccurrenceRecordExport } from './to4EvidencePreparation';

describe('backfillContract - Python/TypeScript schema & pairing integration', () => {
    const testUserId = 'test-user-123';
    const activityId = '1234567890';
    const localDate = '2026-07-15';
    const startedAt = '2026-07-15T08:30:00Z';
    const endedAt = '2026-07-15T09:30:00Z';
    const modality = 'cycling';
    const sourceKey = `provider_activity:garmin:${activityId}`;
    const occId = 'pto_20260715_abcdef123456';

    const backfilledOccurrenceDoc = {
        schemaVersion: 1,
        performedOccurrenceId: occId,
        userId: testUserId,
        status: 'active',
        localDate,
        startedAt,
        endedAt,
        modality,
        sourceRefs: [
            {
                kind: 'provider_activity',
                provider: 'garmin',
                activityId,
            },
        ],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-09-28T08:00:00Z',
        updatedAt: '2026-09-28T08:00:00Z',
    };

    const backfilledSourceLinkDoc = {
        schemaVersion: 1,
        sourceKey,
        sourceKind: 'provider_activity',
        userId: testUserId,
        performedOccurrenceId: occId,
        createdAt: '2026-09-28T08:00:00Z',
        updatedAt: '2026-09-28T08:00:00Z',
    };

    it('successfully parses backfill-produced PerformedTrainingOccurrence document', () => {
        const parsed = parsePerformedTrainingOccurrence(backfilledOccurrenceDoc, testUserId);
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.performedOccurrenceId).toBe(occId);
        expect(parsed.userId).toBe(testUserId);
        expect(parsed.status).toBe('active');
        expect(parsed.localDate).toBe(localDate);
        expect(parsed.startedAt).toBe(startedAt);
        expect(parsed.endedAt).toBe(endedAt);
        expect(parsed.modality).toBe(modality);
        expect(parsed.sourceRefs).toEqual([
            {
                kind: 'provider_activity',
                provider: 'garmin',
                activityId,
            },
        ]);
        expect(parsed.reconciliation).toEqual({ state: 'single_source' });
    });

    it('successfully parses backfill-produced PerformedOccurrenceSourceLink document', () => {
        const parsed = parsePerformedOccurrenceSourceLink(backfilledSourceLinkDoc, testUserId);
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.sourceKey).toBe(sourceKey);
        expect(parsed.sourceKind).toBe('provider_activity');
        expect(parsed.userId).toBe(testUserId);
        expect(parsed.performedOccurrenceId).toBe(occId);
    });

    it('demonstrates closure of historical pairedLiveOnly gap when backfilled occurrences are present', () => {
        const options = {
            sourceCommit: 'synthetic-fixture',
            coveragePolicyVersion: 'coverage-v1',
            fitFingerprintVersion: 'fit-workout-v2',
        };

        const activities = [
            {
                id: 'act-101',
                data: {
                    activityId: 'act-101',
                    date: '2026-07-10',
                    type: 'cycling',
                    durationMin: 60,
                    trainingEffectAerobic: 3.0,
                    trainingEffectAnaerobic: null,
                    averageHr: 140,
                    activityTrainingLoad: 80,
                    intensityTag: 'moderate',
                },
            },
            {
                id: 'act-102',
                data: {
                    activityId: 'act-102',
                    date: '2026-07-12',
                    type: 'running',
                    durationMin: 45,
                    trainingEffectAerobic: 3.5,
                    trainingEffectAnaerobic: null,
                    averageHr: 155,
                    activityTrainingLoad: 95,
                    intensityTag: 'hard',
                },
            },
        ];

        // 1. Unbackfilled historical export: only activities exist, occurrences are empty
        const unbackfilledExport: TrainingOccurrenceRecordExport = {
            schemaVersion: 1,
            userId: testUserId,
            window: { startDate: '2026-07-01', endDateExclusive: '2026-07-31' },
            performedTrainingOccurrences: [],
            sessionExecutions: [],
            activities,
            dailyRecommendations: [],
        };

        const unbackfilledPrepared = prepareTo4Evidence(unbackfilledExport, options);
        // Without occurrences, live activities produce pairedLiveOnly = 2 and pairedMatched = 0
        expect(unbackfilledPrepared.preparedInput).toMatchObject({
            identityEvidence: {
                pairedLiveOnly: 2,
                pairedMatched: 0,
            },
        });

        // 2. Backfilled export: add backfilled occurrences corresponding to both activities
        const backfilledOccurrences = activities.map((act, index) => ({
            id: `pto-backfilled-${index}`,
            data: {
                schemaVersion: 1,
                performedOccurrenceId: `pto-backfilled-${index}`,
                userId: testUserId,
                status: 'active' as const,
                localDate: act.data.date,
                modality: act.data.type,
                sourceRefs: [
                    {
                        kind: 'provider_activity' as const,
                        provider: 'garmin',
                        activityId: act.data.activityId,
                    },
                ],
                reconciliation: { state: 'single_source' as const },
                createdAt: '2026-09-28T00:00:00Z',
                updatedAt: '2026-09-28T00:00:00Z',
            },
        }));

        const backfilledExport: TrainingOccurrenceRecordExport = {
            ...unbackfilledExport,
            performedTrainingOccurrences: backfilledOccurrences,
        };

        const backfilledPrepared = prepareTo4Evidence(backfilledExport, options);
        // With backfilled occurrences, pairedLiveOnly drops to 0 and pairedMatched matches total activities!
        expect(backfilledPrepared.preparedInput).toMatchObject({
            identityEvidence: {
                pairedLiveOnly: 0,
                pairedMatched: 2,
            },
            hardGates: {
                noCrossUserEvidenceLeakage: 'pass',
                deterministicReplayStable: 'pass',
            },
        });
    });
});
