import { describe, expect, it } from 'vitest';
import {
    assessmentDiagnosticExportToJson,
    buildAssessmentDiagnosticExport,
    type CanonicalObservationExport,
    type ResolvedContextExport,
} from './assessmentExport';
import type { AssessmentAttempt, AssessmentTrial, MetricObservationRevision } from './models';
import {
    BENCH_PRESS_1RM_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
} from './physicalCapitalProtocols';

describe('assessmentExport', () => {
    const attempt1: AssessmentAttempt = {
        id: 'att-1',
        protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
        scheduledDate: '2026-10-20',
        state: 'completed',
        purpose: 'baseline',
        completedAt: '2026-10-20T10:15:00.000Z',
    };

    const attempt2: AssessmentAttempt = {
        id: 'att-2',
        protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
        scheduledDate: '2026-10-25',
        state: 'completed',
        purpose: 'checkpoint',
        completedAt: '2026-10-25T10:15:00.000Z',
    };

    const trial1A: AssessmentTrial = {
        id: 'trial-1',
        assessmentAttemptId: 'att-1',
        ordinal: 1,
        correctionIndex: 0,
        validity: 'valid',
        values: { distance_cm: 230 },
        context: { test_environment: 'indoor-gym-floor' },
        createdAt: '2026-10-20T10:00:00.000Z',
    };

    const trial1B: AssessmentTrial = {
        id: 'trial-2',
        assessmentAttemptId: 'att-1',
        ordinal: 2,
        correctionIndex: 0,
        validity: 'valid',
        values: { distance_cm: 238 },
        context: { test_environment: 'indoor-gym-floor' },
        createdAt: '2026-10-20T10:05:00.000Z',
    };

    const trial2A: AssessmentTrial = {
        id: 'trial-1',
        assessmentAttemptId: 'att-2',
        ordinal: 1,
        correctionIndex: 0,
        validity: 'valid',
        values: { distance_cm: 242 },
        context: { test_environment: 'indoor-gym-floor' },
        createdAt: '2026-10-25T10:00:00.000Z',
    };

    // Superseded trial and its correction on attempt 2
    const trial2B: AssessmentTrial = {
        id: 'trial-2',
        assessmentAttemptId: 'att-2',
        ordinal: 2,
        correctionIndex: 0,
        validity: 'invalid',
        invalidReason: 'Foot slipped',
        values: { distance_cm: 200 },
        context: { test_environment: 'indoor-gym-floor' },
        createdAt: '2026-10-25T10:05:00.000Z',
    };

    const trial2BCorrected: AssessmentTrial = {
        id: 'trial-2-c1',
        assessmentAttemptId: 'att-2',
        ordinal: 2,
        correctionIndex: 1,
        supersedesTrialId: 'trial-2',
        correctionReason: 'Corrected measurement',
        validity: 'valid',
        values: { distance_cm: 245 },
        context: { test_environment: 'indoor-gym-floor' },
        createdAt: '2026-10-25T10:10:00.000Z',
    };

    const obsRev1A: MetricObservationRevision = {
        observationKey: 'att-1:standing_broad_jump_distance_cm',
        revision: 1,
        metricId: 'standing_broad_jump_distance_cm',
        value: 238,
        unit: 'cm',
        observedAt: '2026-10-20T10:15:00.000Z',
        source: 'derived',
        protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
        comparisonSeriesKey: 'series-jump',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: 'att-1',
        validity: 'valid',
        context: { test_environment: 'indoor-gym-floor' },
        derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-1', trialId: 'trial-2' }],
        algorithmVersion: 'assessment-reducer-v1',
        createdAt: '2026-10-20T10:15:00.000Z',
    };

    const obsRev2A: MetricObservationRevision = {
        observationKey: 'att-2:standing_broad_jump_distance_cm',
        revision: 1,
        metricId: 'standing_broad_jump_distance_cm',
        value: 242,
        unit: 'cm',
        observedAt: '2026-10-25T10:15:00.000Z',
        source: 'derived',
        protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
        comparisonSeriesKey: 'series-jump',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: 'att-2',
        validity: 'valid',
        context: { test_environment: 'indoor-gym-floor' },
        derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-2', trialId: 'trial-1' }],
        algorithmVersion: 'assessment-reducer-v1',
        createdAt: '2026-10-25T10:15:00.000Z',
    };

    const obsRev2ACorrected: MetricObservationRevision = {
        observationKey: 'att-2:standing_broad_jump_distance_cm',
        revision: 2,
        supersedesRevision: 1,
        correctionReason: 'Trial 2 corrected, becoming best valid jump',
        metricId: 'standing_broad_jump_distance_cm',
        value: 245,
        unit: 'cm',
        observedAt: '2026-10-25T10:15:00.000Z',
        source: 'derived',
        protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
        comparisonSeriesKey: 'series-jump',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: 'att-2',
        validity: 'valid',
        context: { test_environment: 'indoor-gym-floor' },
        derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-2', trialId: 'trial-2-c1' }],
        algorithmVersion: 'assessment-reducer-v1',
        createdAt: '2026-10-25T10:20:00.000Z',
    };

    const canonicalObs: CanonicalObservationExport[] = [
        {
            observationKey: 'att-1:standing_broad_jump_distance_cm',
            head: {
                observationKey: 'att-1:standing_broad_jump_distance_cm',
                assessmentAttemptId: 'att-1',
                metricId: 'standing_broad_jump_distance_cm',
                headRevision: 1,
                createdAt: '2026-10-20T10:15:00.000Z',
                updatedAt: '2026-10-20T10:15:00.000Z',
            },
            revisions: [obsRev1A],
        },
        {
            observationKey: 'att-2:standing_broad_jump_distance_cm',
            head: {
                observationKey: 'att-2:standing_broad_jump_distance_cm',
                assessmentAttemptId: 'att-2',
                metricId: 'standing_broad_jump_distance_cm',
                headRevision: 2,
                createdAt: '2026-10-25T10:15:00.000Z',
                updatedAt: '2026-10-25T10:20:00.000Z',
            },
            revisions: [obsRev2A, obsRev2ACorrected],
        },
    ];

    const resolvedContext: ResolvedContextExport[] = [
        {
            attemptId: 'att-1',
            protocolId: STANDING_BROAD_JUMP_PROTOCOL.id,
            protocolRevision: 1,
            context: { test_environment: 'indoor-gym-floor' },
            seriesKeys: { standing_broad_jump_distance_cm: 'series-jump' },
        },
        {
            attemptId: 'att-2',
            protocolId: STANDING_BROAD_JUMP_PROTOCOL.id,
            protocolRevision: 1,
            context: { test_environment: 'indoor-gym-floor' },
            seriesKeys: { standing_broad_jump_distance_cm: 'series-jump' },
        },
    ];

    it('produces byte-stable deterministic output regardless of input array ordering', () => {
        const protocols = [BENCH_PRESS_1RM_PROTOCOL, STANDING_BROAD_JUMP_PROTOCOL];
        const trials = [trial2BCorrected, trial1A, trial2A, trial1B, trial2B];
        const attempts = [attempt2, attempt1];

        const export1 = buildAssessmentDiagnosticExport({
            exportedAt: '2026-10-25T12:00:00.000Z',
            protocols,
            attempts,
            trials,
            canonicalObservations: canonicalObs,
            resolvedContext,
        });

        // Reverse all input arrays
        const export2 = buildAssessmentDiagnosticExport({
            exportedAt: '2026-10-25T12:00:00.000Z',
            protocols: [...protocols].reverse(),
            attempts: [...attempts].reverse(),
            trials: [...trials].reverse(),
            canonicalObservations: [...canonicalObs].reverse(),
            resolvedContext: [...resolvedContext].reverse(),
        });

        const json1 = assessmentDiagnosticExportToJson(export1);
        const json2 = assessmentDiagnosticExportToJson(export2);

        expect(json1).toBe(json2);
    });

    it('includes superseded trials and full observation revision chains', () => {
        const exportData = buildAssessmentDiagnosticExport({
            exportedAt: '2026-10-25T12:00:00.000Z',
            protocols: [STANDING_BROAD_JUMP_PROTOCOL],
            attempts: [attempt1, attempt2],
            trials: [trial1A, trial1B, trial2A, trial2B, trial2BCorrected],
            canonicalObservations: canonicalObs,
            resolvedContext,
        });

        // Verify superseded trial is retained alongside correction
        const att2Trials = exportData.trials.filter(t => t.assessmentAttemptId === 'att-2');
        expect(att2Trials).toHaveLength(3);
        expect(att2Trials.map(t => t.id)).toEqual(['trial-1', 'trial-2', 'trial-2-c1']);

        // Verify full revision chain on observation
        const att2Obs = exportData.canonicalObservations.find(o => o.observationKey === 'att-2:standing_broad_jump_distance_cm');
        expect(att2Obs?.revisions).toHaveLength(2);
        expect(att2Obs?.revisions[0].revision).toBe(1);
        expect(att2Obs?.revisions[1].revision).toBe(2);
        expect(att2Obs?.revisions[1].supersedesRevision).toBe(1);
    });

    it('never promotes a familiarization attempt to the implicit longitudinal baseline', () => {
        const familiarizationAttempt: AssessmentAttempt = {
            ...attempt1,
            id: 'att-familiarization',
            purpose: 'familiarization',
            scheduledDate: '2026-10-18',
            completedAt: '2026-10-18T10:15:00.000Z',
        };
        const checkpointAttempt: AssessmentAttempt = {
            ...attempt2,
            id: 'att-checkpoint',
            purpose: 'checkpoint',
        };
        const familiarizationKey = 'att-familiarization:standing_broad_jump_distance_cm';
        const checkpointKey = 'att-checkpoint:standing_broad_jump_distance_cm';
        const familiarizationRevision: MetricObservationRevision = {
            ...obsRev1A,
            observationKey: familiarizationKey,
            assessmentAttemptId: 'att-familiarization',
            value: 220,
            observedAt: '2026-10-18T10:15:00.000Z',
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-familiarization', trialId: 'trial-1' }],
        };
        const checkpointRevision: MetricObservationRevision = {
            ...obsRev1A,
            observationKey: checkpointKey,
            assessmentAttemptId: 'att-checkpoint',
            value: 242,
            observedAt: '2026-10-25T10:15:00.000Z',
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-checkpoint', trialId: 'trial-1' }],
        };
        const observations: CanonicalObservationExport[] = [
            {
                observationKey: familiarizationKey,
                head: {
                    observationKey: familiarizationKey,
                    assessmentAttemptId: 'att-familiarization',
                    metricId: 'standing_broad_jump_distance_cm',
                    headRevision: 1,
                    createdAt: familiarizationRevision.createdAt,
                    updatedAt: familiarizationRevision.createdAt,
                },
                revisions: [familiarizationRevision],
            },
            {
                observationKey: checkpointKey,
                head: {
                    observationKey: checkpointKey,
                    assessmentAttemptId: 'att-checkpoint',
                    metricId: 'standing_broad_jump_distance_cm',
                    headRevision: 1,
                    createdAt: checkpointRevision.createdAt,
                    updatedAt: checkpointRevision.createdAt,
                },
                revisions: [checkpointRevision],
            },
        ];

        const exportData = buildAssessmentDiagnosticExport({
            exportedAt: '2026-10-25T12:00:00.000Z',
            protocols: [STANDING_BROAD_JUMP_PROTOCOL],
            attempts: [familiarizationAttempt, checkpointAttempt],
            trials: [],
            canonicalObservations: observations,
            resolvedContext: [],
        });

        expect(exportData.progress).toHaveLength(1);
        expect(exportData.progress[0].baselineObservationId).toBe(checkpointKey);
        expect(exportData.progress[0].baselineObservationId).not.toBe(familiarizationKey);
        expect(exportData.progress[0].latestObservationId).toBeUndefined();
        expect(exportData.progress[0].status).toBe('insufficient_evidence');
    });

    it('keeps non-completed evidence in the diagnostic payload but excludes it from progress', () => {
        const interruptedAttempt: AssessmentAttempt = {
            ...attempt2,
            id: 'att-interrupted',
            state: 'in_progress',
            completedAt: undefined,
        };
        const interruptedKey = 'att-interrupted:standing_broad_jump_distance_cm';
        const interruptedRevision: MetricObservationRevision = {
            ...obsRev2A,
            observationKey: interruptedKey,
            assessmentAttemptId: interruptedAttempt.id,
            value: 260,
            derivedFromEvidenceRefs: [{
                kind: 'assessment_trial',
                assessmentAttemptId: interruptedAttempt.id,
                trialId: 'trial-1',
            }],
        };
        const interruptedObservation: CanonicalObservationExport = {
            observationKey: interruptedKey,
            head: {
                observationKey: interruptedKey,
                assessmentAttemptId: interruptedAttempt.id,
                metricId: 'standing_broad_jump_distance_cm',
                headRevision: 1,
                createdAt: interruptedRevision.createdAt,
                updatedAt: interruptedRevision.createdAt,
            },
            revisions: [interruptedRevision],
        };

        const exportData = buildAssessmentDiagnosticExport({
            exportedAt: '2026-10-25T12:00:00.000Z',
            protocols: [STANDING_BROAD_JUMP_PROTOCOL],
            attempts: [attempt1, interruptedAttempt],
            trials: [],
            canonicalObservations: [canonicalObs[0], interruptedObservation],
            resolvedContext: [],
        });

        expect(exportData.canonicalObservations.map(item => item.observationKey)).toContain(interruptedKey);
        expect(exportData.progress).toHaveLength(1);
        expect(exportData.progress[0].baselineObservationId).toBe('att-1:standing_broad_jump_distance_cm');
        expect(exportData.progress[0].latestObservationId).toBeUndefined();
        expect(exportData.progress[0].status).toBe('insufficient_evidence');
    });

    it('computes progress using deriveProgress and omits user ID from output', () => {
        const exportData = buildAssessmentDiagnosticExport({
            exportedAt: '2026-10-25T12:00:00.000Z',
            protocols: [STANDING_BROAD_JUMP_PROTOCOL],
            attempts: [attempt1, attempt2],
            trials: [trial1A, trial1B, trial2A, trial2B, trial2BCorrected],
            canonicalObservations: canonicalObs,
            resolvedContext,
        });

        expect(exportData.progress).toHaveLength(1);
        const progress = exportData.progress[0];
        expect(progress.metricId).toBe('standing_broad_jump_distance_cm');
        expect(progress.baselineObservationId).toBe('att-1:standing_broad_jump_distance_cm');
        expect(progress.latestObservationId).toBe('att-2:standing_broad_jump_distance_cm');
        expect(progress.absoluteChange).toBe(7); // 245 - 238
        expect(progress.comparable).toBe(true);

        const json = assessmentDiagnosticExportToJson(exportData);
        // Ensure no user id / uid property
        expect(json).not.toContain('userId');
        expect(json).not.toContain('uid');
    });
});
