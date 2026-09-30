import { describe, expect, it } from 'vitest';
import { ASSESSMENT_REDUCER_VERSION_V1 } from './assessmentCapture';
import { deriveTrialObservationRevisions } from './assessmentDerivation';
import { makeTrial, trialAttempt } from './fixtures/assessmentTrialFixtures';
import type { AssessmentAttempt, MetricObservationRevision } from './models';
import {
    CYCLING_6S_SEATED_SPRINT_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
} from './physicalCapitalProtocols';
import { assertValidMetricObservationRevision } from './validation';

describe('deriveTrialObservationRevisions (WP3.2)', () => {
    const jumpContext = {
        test_environment: 'indoor-track',
    };

    it('emits a canonical derived revision with typed evidence refs and no observation IDs', async () => {
        const attempt = trialAttempt();
        const trials = [
            makeTrial(1, { distance_cm: 230 }),
            makeTrial(2, { distance_cm: 242 }),
            makeTrial(3, { distance_cm: 238 }),
        ];

        const derived = await deriveTrialObservationRevisions({
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials,
            context: jumpContext,
            observedAt: '2026-10-19T07:45:00.000Z',
            sourceRef: 'session-log-123',
        });

        expect(derived.missingMetricIds).toEqual([]);
        expect(derived.observations).toHaveLength(1);

        const [revision] = derived.observations;
        expect(revision.metricId).toBe('standing_broad_jump_distance_cm');
        expect(revision.value).toBe(242);
        expect(revision.unit).toBe('cm');
        expect(revision.source).toBe('derived');
        expect(revision.sourceRef).toBe('session-log-123');
        expect(revision.derivedFromObservationIds).toBeUndefined();
        expect(revision.derivedFromEvidenceRefs).toEqual([
            {
                kind: 'assessment_trial',
                assessmentAttemptId: attempt.id,
                trialId: 'trial-2',
            },
        ]);
        expect(revision.algorithmVersion).toBe(ASSESSMENT_REDUCER_VERSION_V1);
        expect(revision.validity).toBe('valid');
        expect(() => assertValidMetricObservationRevision(revision)).not.toThrow();
    });

    it('gives trial device precedence over attempt-level default device', async () => {
        const attempt = trialAttempt();
        const trialWithDevice = makeTrial(1, { distance_cm: 250 }, {
            device: { provider: 'Optojump', model: 'NextGen', deviceId: 'opto-1' },
        });

        const derivedWithTrialDevice = await deriveTrialObservationRevisions({
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials: [trialWithDevice],
            context: jumpContext,
            observedAt: '2026-10-19T07:45:00.000Z',
            device: { provider: 'AttemptDefaultDevice' },
        });

        expect(derivedWithTrialDevice.observations[0].device).toEqual({
            provider: 'Optojump',
            model: 'NextGen',
            deviceId: 'opto-1',
        });

        const trialWithoutDevice = makeTrial(1, { distance_cm: 250 });
        const derivedWithAttemptDevice = await deriveTrialObservationRevisions({
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials: [trialWithoutDevice],
            context: jumpContext,
            observedAt: '2026-10-19T07:45:00.000Z',
            device: { provider: 'AttemptDefaultDevice' },
        });

        expect(derivedWithAttemptDevice.observations[0].device).toEqual({
            provider: 'AttemptDefaultDevice',
        });
    });

    it('reports missingMetricIds when no valid trial produces a result', async () => {
        const attempt = trialAttempt();
        const invalidTrials = [
            makeTrial(1, { distance_cm: 240 }, { validity: 'invalid', invalidReason: 'Fell backward' }),
            makeTrial(2, { distance_cm: 245 }, { validity: 'practice' }),
        ];

        const derived = await deriveTrialObservationRevisions({
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials: invalidTrials,
            context: jumpContext,
            observedAt: '2026-10-19T07:45:00.000Z',
        });

        expect(derived.observations).toHaveLength(0);
        expect(derived.missingMetricIds).toEqual(['standing_broad_jump_distance_cm']);
    });

    it('rejects scheduled, abandoned, and protocol-mismatched attempts', async () => {
        const validTrials = [makeTrial(1, { distance_cm: 230 })];

        const scheduledAttempt = trialAttempt({ state: 'scheduled', startedAt: undefined });
        await expect(deriveTrialObservationRevisions({
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt: scheduledAttempt,
            trials: validTrials,
            context: jumpContext,
            observedAt: '2026-10-19T07:45:00.000Z',
        })).rejects.toThrow(/Cannot derive canonical observations from a scheduled attempt/);

        const abandonedAttempt = trialAttempt({ state: 'abandoned' });
        await expect(deriveTrialObservationRevisions({
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt: abandonedAttempt,
            trials: validTrials,
            context: jumpContext,
            observedAt: '2026-10-19T07:45:00.000Z',
        })).rejects.toThrow(/Cannot derive canonical observations from a abandoned attempt/);

        const mismatchedProtocolAttempt = trialAttempt({
            protocolRef: { id: 'other-protocol', revision: 1 },
        });
        await expect(deriveTrialObservationRevisions({
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt: mismatchedProtocolAttempt,
            trials: validTrials,
            context: jumpContext,
            observedAt: '2026-10-19T07:45:00.000Z',
        })).rejects.toThrow(/bound to a different protocol revision/);

        const mismatchedRevisionAttempt = trialAttempt({
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 },
        });
        await expect(deriveTrialObservationRevisions({
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt: mismatchedRevisionAttempt,
            trials: validTrials,
            context: jumpContext,
            observedAt: '2026-10-19T07:45:00.000Z',
        })).rejects.toThrow(/bound to a different protocol revision/);
    });

    it('derives separate metric revisions with independent source refs and respects identityByMetric corrections', async () => {
        const sprintAttempt: AssessmentAttempt = {
            id: 'assessment-cycling-sprint-attempt-1',
            protocolRef: { id: CYCLING_6S_SEATED_SPRINT_PROTOCOL.id, revision: CYCLING_6S_SEATED_SPRINT_PROTOCOL.revision },
            startedAt: '2026-10-20T08:00:00.000Z',
            state: 'completed',
            completedAt: '2026-10-20T08:30:00.000Z',
            purpose: 'baseline',
        };
        const sprintContext = {
            power_source_id: 'favero-assioma-duo',
            bike_setup_id: 'road-bike-1',
            test_environment: 'indoor-trainer',
            start_mode: 'standing',
            warmup_revision: 'cycling-sprint-warmup-r1',
        };
        // Trial 1 has peak power 1250, mean power 1000
        // Trial 2 has peak power 1200, mean power 1100 (best mean)
        const sprintTrials = [
            makeTrial(1, { peak_power_1s_w: 1250, mean_power_5s_w: 1000 }, { assessmentAttemptId: sprintAttempt.id }),
            makeTrial(2, { peak_power_1s_w: 1200, mean_power_5s_w: 1100 }, { assessmentAttemptId: sprintAttempt.id }),
        ];

        const derived = await deriveTrialObservationRevisions({
            protocol: CYCLING_6S_SEATED_SPRINT_PROTOCOL,
            attempt: sprintAttempt,
            trials: sprintTrials,
            context: sprintContext,
            observedAt: '2026-10-20T08:30:00.000Z',
            identityByMetric: {
                cycling_sprint_1s_peak_power_w: {
                    revision: 2,
                    supersedesRevision: 1,
                    correctionReason: 'Recalibrated sprint start point',
                    createdAt: '2026-10-20T09:00:00.000Z',
                },
            },
        });

        expect(derived.missingMetricIds).toEqual([]);
        expect(derived.observations).toHaveLength(2);

        const peakObs = derived.observations.find(obs => obs.metricId === 'cycling_sprint_1s_peak_power_w');
        expect(peakObs).toBeDefined();
        expect(peakObs!.value).toBe(1250);
        expect(peakObs!.revision).toBe(2);
        expect(peakObs!.supersedesRevision).toBe(1);
        expect(peakObs!.correctionReason).toBe('Recalibrated sprint start point');
        expect(peakObs!.derivedFromEvidenceRefs).toEqual([
            { kind: 'assessment_trial', assessmentAttemptId: sprintAttempt.id, trialId: 'trial-1' },
        ]);
        expect(() => assertValidMetricObservationRevision(peakObs as MetricObservationRevision)).not.toThrow();

        const meanObs = derived.observations.find(obs => obs.metricId === 'cycling_sprint_5s_mean_power_w');
        expect(meanObs).toBeDefined();
        expect(meanObs!.value).toBe(1100);
        expect(meanObs!.revision).toBe(1);
        expect(meanObs!.supersedesRevision).toBeUndefined();
        expect(meanObs!.derivedFromEvidenceRefs).toEqual([
            { kind: 'assessment_trial', assessmentAttemptId: sprintAttempt.id, trialId: 'trial-2' },
        ]);
        expect(() => assertValidMetricObservationRevision(meanObs as MetricObservationRevision)).not.toThrow();
    });
});
