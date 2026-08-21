import { describe, expect, it } from 'vitest';
import type { MeasurementProtocol } from './models';
import { COMPARISON_CANONICALIZATION_V1 } from './comparability';
import { adaptManualObservation } from './manualAdapter';

const protocol: MeasurementProtocol = {
    id: 'cycling-20m-tt',
    revision: 1,
    title: 'Cycling 20-minute TT',
    intent: 'testing',
    metricIds: ['cycling_tt_20m_mean_power_w'],
    instructions: [{ id: 'main', text: 'Complete the declared test.' }],
    comparisonContext: {
        required: ['power_source_id', 'duration_seconds', 'warmup_revision'],
        seriesDefining: ['power_source_id', 'duration_seconds', 'warmup_revision'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'high',
    invalidationRules: ['Interrupted effort'],
    createdAt: '2026-08-21T00:00:00.000Z',
};

describe('OV2 manual observation adapter', () => {
    it('creates a provenance-complete raw revision and deterministic series key', async () => {
        const revision = await adaptManualObservation({
            assessmentAttemptId: 'attempt-1',
            metricId: 'cycling_tt_20m_mean_power_w',
            value: 305,
            unit: 'W',
            observedAt: '2026-08-21T06:00:00.000Z',
            protocol,
            context: { power_source_id: 'Assioma', duration_seconds: 1200, warmup_revision: 'WU-1' },
            validity: 'valid',
            device: { provider: 'Favero', model: 'Assioma Duo', deviceId: 'pedals-a' },
        }, { revision: 1, createdAt: '2026-08-21T06:05:00.000Z' });

        expect(revision.observationKey).toBe('attempt-1:cycling_tt_20m_mean_power_w');
        expect(revision.source).toBe('manual');
        expect(revision.protocolRef).toEqual({ id: 'cycling-20m-tt', revision: 1 });
        expect(revision.comparisonCanonicalizationVersion).toBe(COMPARISON_CANONICALIZATION_V1);
        expect(revision.comparisonSeriesKey).toMatch(/^[0-9a-f]{64}$/);
        expect(revision.device?.deviceId).toBe('pedals-a');
    });

    it('reuses the same logical identity for a correction while creating a new immutable revision', async () => {
        const corrected = await adaptManualObservation({
            assessmentAttemptId: 'attempt-1',
            metricId: 'cycling_tt_20m_mean_power_w',
            value: 306,
            unit: 'W',
            observedAt: '2026-08-21T06:00:00.000Z',
            protocol,
            context: { power_source_id: 'Assioma', duration_seconds: 1200, warmup_revision: 'WU-1' },
            validity: 'valid',
        }, {
            revision: 2,
            supersedesRevision: 1,
            correctionReason: 'Transcription error',
            createdAt: '2026-08-21T07:00:00.000Z',
        });

        expect(corrected.observationKey).toBe('attempt-1:cycling_tt_20m_mean_power_w');
        expect(corrected.revision).toBe(2);
        expect(corrected.supersedesRevision).toBe(1);
        expect(corrected.correctionReason).toBe('Transcription error');
    });

    it('rejects undeclared metrics and invalid comparison context instead of storing best-effort evidence', async () => {
        await expect(adaptManualObservation({
            assessmentAttemptId: 'attempt-1',
            metricId: 'cycling_tt_4m_mean_power_w',
            value: 400,
            unit: 'W',
            observedAt: '2026-08-21T06:00:00.000Z',
            protocol,
            context: { power_source_id: 'Assioma', duration_seconds: 240, warmup_revision: 'WU-1' },
            validity: 'valid',
        })).rejects.toThrow(/not declared by protocol/);

        await expect(adaptManualObservation({
            assessmentAttemptId: 'attempt-1',
            metricId: 'cycling_tt_20m_mean_power_w',
            value: 300,
            unit: 'W',
            observedAt: '2026-08-21T06:00:00.000Z',
            protocol,
            context: { duration_seconds: 1200, warmup_revision: 'WU-1' },
            validity: 'valid',
        })).rejects.toThrow(/Missing required comparison dimension: power_source_id/);
    });
});
