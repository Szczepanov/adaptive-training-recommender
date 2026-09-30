import { describe, expect, it } from 'vitest';
import type {
    AssessmentAttempt,
    MeasurementProtocol,
    MetricObservationHead,
    MetricObservationRevision,
} from './models';
import {
    computeObservationRowProgress,
    computeProgressForExport,
    computeSeriesProgress,
    explainNonComparability,
    selectSeriesBaselineCandidate,
    type AssessmentSeriesObservation,
} from './assessmentProgress';
import {
    STANDING_BROAD_JUMP_PROTOCOL,
} from './physicalCapitalProtocols';

function makeAttempt(
    id: string,
    protocolRef: { id: string; revision: number },
    purpose: AssessmentAttempt['purpose'],
    completedAt: string,
    state: AssessmentAttempt['state'] = 'completed',
): AssessmentAttempt {
    return {
        id,
        protocolRef,
        scheduledDate: completedAt.slice(0, 10),
        state,
        purpose,
        completedAt,
    };
}

function makeObservation(
    attempt: AssessmentAttempt,
    metricId: string,
    value: number,
    seriesKey: string,
    observedAt: string,
    validity: MetricObservationRevision['validity'] = 'valid',
    revision = 1,
): AssessmentSeriesObservation {
    const observationKey = `${attempt.id}:${metricId}`;
    const head: MetricObservationHead = {
        observationKey,
        assessmentAttemptId: attempt.id,
        metricId,
        headRevision: revision,
        createdAt: observedAt,
        updatedAt: observedAt,
    };
    const rev: MetricObservationRevision = {
        observationKey,
        revision,
        metricId,
        value,
        unit: 'cm',
        observedAt,
        source: 'derived',
        protocolRef: attempt.protocolRef,
        comparisonSeriesKey: seriesKey,
        comparisonCanonicalizationVersion: 'ov-series-v1',
        assessmentAttemptId: attempt.id,
        validity,
        context: {},
        createdAt: observedAt,
    };
    return { head, revision: rev, attempt };
}

describe('assessmentProgress', () => {
    const protoRefR1 = { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 };
    const protoRefR2 = { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 };

    describe('selectSeriesBaselineCandidate (D3)', () => {
        it('prefers explicit baseline-purpose attempt over non-familiarization checkpoint', () => {
            const attCheckpoint = makeAttempt('att-1', protoRefR1, 'checkpoint', '2026-10-15T10:00:00Z');
            const attBaseline = makeAttempt('att-2', protoRefR1, 'baseline', '2026-10-20T10:00:00Z');

            const obs1 = makeObservation(attCheckpoint, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-15T10:00:00Z');
            const obs2 = makeObservation(attBaseline, 'standing_broad_jump_distance_cm', 235, 'series-1', '2026-10-20T10:00:00Z');

            const selected = selectSeriesBaselineCandidate([obs1, obs2]);
            expect(selected?.attempt.id).toBe('att-2');
        });

        it('falls back to earliest valid non-familiarization when no baseline-purpose exists', () => {
            const att1 = makeAttempt('att-1', protoRefR1, 'checkpoint', '2026-10-15T10:00:00Z');
            const att2 = makeAttempt('att-2', protoRefR1, 'checkpoint', '2026-10-20T10:00:00Z');

            const obs1 = makeObservation(att1, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-15T10:00:00Z');
            const obs2 = makeObservation(att2, 'standing_broad_jump_distance_cm', 235, 'series-1', '2026-10-20T10:00:00Z');

            const selected = selectSeriesBaselineCandidate([obs2, obs1]);
            expect(selected?.attempt.id).toBe('att-1');
        });

        it('never allows familiarization to become baseline', () => {
            const attFam = makeAttempt('att-fam', protoRefR1, 'familiarization', '2026-10-10T10:00:00Z');
            const obsFam = makeObservation(attFam, 'standing_broad_jump_distance_cm', 220, 'series-1', '2026-10-10T10:00:00Z');

            const selected = selectSeriesBaselineCandidate([obsFam]);
            expect(selected).toBeNull();
        });

        it('excludes invalid and practice attempts from baseline selection', () => {
            const att1 = makeAttempt('att-1', protoRefR1, 'baseline', '2026-10-10T10:00:00Z');
            const att2 = makeAttempt('att-2', protoRefR1, 'checkpoint', '2026-10-20T10:00:00Z');

            const obsInvalid = makeObservation(att1, 'standing_broad_jump_distance_cm', 250, 'series-1', '2026-10-10T10:00:00Z', 'invalid');
            const obsValid = makeObservation(att2, 'standing_broad_jump_distance_cm', 235, 'series-1', '2026-10-20T10:00:00Z', 'valid');

            const selected = selectSeriesBaselineCandidate([obsInvalid, obsValid]);
            expect(selected?.attempt.id).toBe('att-2');
        });
    });

    describe('computeSeriesProgress (D1, D4)', () => {
        it('computes comparable raw delta with insufficient_evidence status when no reliability exists', () => {
            const attBase = makeAttempt('att-1', protoRefR1, 'baseline', '2026-10-20T10:00:00Z');
            const attCheck = makeAttempt('att-2', protoRefR1, 'checkpoint', '2026-10-25T10:00:00Z');

            const obs1 = makeObservation(attBase, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-20T10:00:00Z');
            const obs2 = makeObservation(attCheck, 'standing_broad_jump_distance_cm', 238, 'series-1', '2026-10-25T10:00:00Z');

            const result = computeSeriesProgress(
                {
                    protocolId: STANDING_BROAD_JUMP_PROTOCOL.id,
                    protocolRevision: 1,
                    metricId: 'standing_broad_jump_distance_cm',
                    comparisonSeriesKey: 'series-1',
                },
                [obs1, obs2],
                [],
            );

            expect(result.progress.comparable).toBe(true);
            expect(result.progress.absoluteChange).toBe(8);
            expect(result.progress.percentChange).toBeCloseTo(3.478, 2);
            expect(result.progress.status).toBe('insufficient_evidence');
            expect(result.progress.reasons).toContain('no_reliability_estimate');
            expect(result.progress.reasons).toContain('raw_change_favorable');
        });

        it('returns insufficient_evidence when only baseline exists (no repeat yet)', () => {
            const attBase = makeAttempt('att-1', protoRefR1, 'baseline', '2026-10-20T10:00:00Z');
            const obs1 = makeObservation(attBase, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-20T10:00:00Z');

            const result = computeSeriesProgress(
                {
                    protocolId: STANDING_BROAD_JUMP_PROTOCOL.id,
                    protocolRevision: 1,
                    metricId: 'standing_broad_jump_distance_cm',
                    comparisonSeriesKey: 'series-1',
                },
                [obs1],
                [],
            );

            expect(result.progress.comparable).toBe(false);
            expect(result.progress.status).toBe('insufficient_evidence');
            expect(result.progress.reasons).toContain('post_baseline_observation_not_found');
            expect(result.latest).toBeNull();
        });
    });

    describe('computeProgressForExport (D1, D2)', () => {
        it('regression test for known issue: surfaces both baseline series and newer different series', () => {
            // att-1: baseline on series-A
            // att-2: checkpoint on series-A
            // att-3: checkpoint on series-B (e.g. equipment or setup changed)
            const att1 = makeAttempt('att-1', protoRefR2, 'baseline', '2026-10-20T10:00:00Z');
            const att2 = makeAttempt('att-2', protoRefR2, 'checkpoint', '2026-10-22T10:00:00Z');
            const att3 = makeAttempt('att-3', protoRefR2, 'checkpoint', '2026-10-25T10:00:00Z');

            const obs1 = makeObservation(att1, 'standing_broad_jump_distance_cm', 230, 'series-A', '2026-10-20T10:00:00Z');
            const obs2 = makeObservation(att2, 'standing_broad_jump_distance_cm', 235, 'series-A', '2026-10-22T10:00:00Z');
            const obs3 = makeObservation(att3, 'standing_broad_jump_distance_cm', 240, 'series-B', '2026-10-25T10:00:00Z');

            const canonicalExport = [
                { observationKey: obs1.head.observationKey, head: obs1.head, revisions: [obs1.revision] },
                { observationKey: obs2.head.observationKey, head: obs2.head, revisions: [obs2.revision] },
                { observationKey: obs3.head.observationKey, head: obs3.head, revisions: [obs3.revision] },
            ];

            const protocols: MeasurementProtocol[] = [
                { ...STANDING_BROAD_JUMP_PROTOCOL, revision: 2 },
            ];

            const exportProgress = computeProgressForExport(protocols, [att1, att2, att3], canonicalExport);

            // In v1, only one progress result was produced and series-B was either hidden or marked non-comparable against series-A.
            // In v2 (D1/D2), we get 2 series: series-A has progress, series-B has its own series!
            expect(exportProgress).toHaveLength(2);
            const seriesA = exportProgress.find(p => p.comparisonSeriesKey === 'series-A');
            const seriesB = exportProgress.find(p => p.comparisonSeriesKey === 'series-B');

            expect(seriesA).toBeDefined();
            expect(seriesA?.comparable).toBe(true);
            expect(seriesA?.absoluteChange).toBe(5);

            expect(seriesB).toBeDefined();
            expect(seriesB?.comparable).toBe(false); // only 1 observation in series-B, so no post-baseline observation yet
            expect(seriesB?.reasons).toContain('post_baseline_observation_not_found');
        });

        it('never compares protocol revision 1 with protocol revision 2', () => {
            const attR1 = makeAttempt('att-r1', protoRefR1, 'baseline', '2026-10-10T10:00:00Z');
            const attR2 = makeAttempt('att-r2', protoRefR2, 'checkpoint', '2026-10-20T10:00:00Z');

            const obsR1 = makeObservation(attR1, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-10T10:00:00Z');
            const obsR2 = makeObservation(attR2, 'standing_broad_jump_distance_cm', 240, 'series-1', '2026-10-20T10:00:00Z');

            const canonicalExport = [
                { observationKey: obsR1.head.observationKey, head: obsR1.head, revisions: [obsR1.revision] },
                { observationKey: obsR2.head.observationKey, head: obsR2.head, revisions: [obsR2.revision] },
            ];

            const protocols: MeasurementProtocol[] = [
                { ...STANDING_BROAD_JUMP_PROTOCOL, revision: 1 },
                { ...STANDING_BROAD_JUMP_PROTOCOL, revision: 2 },
            ];

            const exportProgress = computeProgressForExport(protocols, [attR1, attR2], canonicalExport);

            expect(exportProgress).toHaveLength(2);
            // Neither compares across revisions
            expect(exportProgress.every(p => !p.comparable)).toBe(true);
        });
    });

    describe('computeObservationRowProgress', () => {
        it('returns baseline status for the baseline observation', () => {
            const att = makeAttempt('att-1', protoRefR1, 'baseline', '2026-10-20T10:00:00Z');
            const obs = makeObservation(att, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-20T10:00:00Z');

            const row = computeObservationRowProgress(obs, obs, []);
            expect(row).toEqual({
                baselineValue: 230,
                status: 'baseline',
            });
        });

        it('computes delta and status for post-baseline valid observation', () => {
            const attBase = makeAttempt('att-1', protoRefR1, 'baseline', '2026-10-20T10:00:00Z');
            const attCheck = makeAttempt('att-2', protoRefR1, 'checkpoint', '2026-10-25T10:00:00Z');

            const obsBase = makeObservation(attBase, 'standing_broad_jump_distance_cm', 230, 'series-1', '2026-10-20T10:00:00Z');
            const obsCheck = makeObservation(attCheck, 'standing_broad_jump_distance_cm', 241.5, 'series-1', '2026-10-25T10:00:00Z');

            const row = computeObservationRowProgress(obsCheck, obsBase, []);
            expect(row.baselineValue).toBe(230);
            expect(row.absoluteChange).toBe(11.5);
            expect(row.percentChange).toBe(5);
            expect(row.status).toBe('insufficient_evidence');
        });

        it('returns familiarization status for familiarization attempts', () => {
            const attFam = makeAttempt('att-fam', protoRefR1, 'familiarization', '2026-10-18T10:00:00Z');
            const obsFam = makeObservation(attFam, 'standing_broad_jump_distance_cm', 220, 'series-1', '2026-10-18T10:00:00Z');

            const row = computeObservationRowProgress(obsFam, null, []);
            expect(row).toEqual({ status: 'familiarization' });
        });

        it('returns validity status for invalid/practice/questionable observation', () => {
            const att = makeAttempt('att-inv', protoRefR1, 'checkpoint', '2026-10-22T10:00:00Z');
            const obsInv = makeObservation(att, 'standing_broad_jump_distance_cm', 250, 'series-1', '2026-10-22T10:00:00Z', 'invalid');

            const row = computeObservationRowProgress(obsInv, null, []);
            expect(row).toEqual({ status: 'invalid' });
        });
    });

    describe('explainNonComparability', () => {
        it('identifies protocol revision change', () => {
            expect(explainNonComparability(
                { protocolRevision: 1, comparisonSeriesKey: 'key-1' },
                { protocolRevision: 2, comparisonSeriesKey: 'key-1' },
            )).toBe('protocol revision changed');
        });

        it('identifies setup/method change', () => {
            expect(explainNonComparability(
                { protocolRevision: 2, comparisonSeriesKey: 'key-1' },
                { protocolRevision: 2, comparisonSeriesKey: 'key-2' },
            )).toBe('setup/method changed');
        });
    });
});
