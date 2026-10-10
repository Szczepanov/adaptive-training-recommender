import { describe, expect, it } from 'vitest';
import type {
    AssessmentAttempt,
    AssessmentAttemptPurpose,
    AssessmentAttemptState,
    MetricObservationRevision,
} from '../observations/models';
import type { AthletePerformanceProfile } from '../workouts/models';
import { goalProgressEvidenceQuery, resolveGoalProgress } from './goalProgress';
import type { GoalPerformanceTarget } from './performanceTargetPolicy';

function strengthTarget(overrides: Partial<GoalPerformanceTarget> = {}): GoalPerformanceTarget {
    return {
        kind: 'performance_metric',
        metricId: 'strength_1rm_kg',
        subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
        targetValue: 220,
        ...overrides,
    };
}

function speedTarget(overrides: Partial<GoalPerformanceTarget> = {}): GoalPerformanceTarget {
    return {
        kind: 'performance_metric',
        metricId: 'sprint_elapsed_time_s',
        subjectRef: { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
        targetValue: 1.75,
        ...overrides,
    };
}

function observation(overrides: Partial<MetricObservationRevision> = {}): MetricObservationRevision {
    return {
        observationKey: 'obs-1',
        revision: 1,
        metricId: 'sprint_elapsed_time_s',
        value: 1.86,
        unit: 's',
        observedAt: '2026-09-01T10:00:00.000Z',
        source: 'manual',
        protocolRef: { id: 'sprint-10m-standing', revision: 1 },
        comparisonSeriesKey: 'series-1',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: 'attempt-1',
        validity: 'valid',
        context: {},
        createdAt: '2026-09-01T10:05:00.000Z',
        ...overrides,
    };
}

function attempt(
    id = 'attempt-1',
    purpose: AssessmentAttemptPurpose = 'baseline',
    state: AssessmentAttemptState = 'completed',
): AssessmentAttempt {
    return { id, protocolRef: { id: 'sprint-10m-standing', revision: 1 }, state, purpose };
}

function strengthObservation(overrides: Partial<MetricObservationRevision> = {}): MetricObservationRevision {
    return {
        observationKey: 'obs-squat-1',
        revision: 1,
        metricId: 'strength_1rm_kg',
        value: 140,
        unit: 'kg',
        observedAt: '2026-09-01T10:00:00.000Z',
        source: 'manual',
        protocolRef: { id: 'strength-back-squat-1rm', revision: 1 },
        comparisonSeriesKey: 'squat-series-1',
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: 'attempt-squat-1',
        validity: 'valid',
        context: {},
        createdAt: '2026-09-01T10:05:00.000Z',
        ...overrides,
    };
}

function strengthAttempt(
    id = 'attempt-squat-1',
    protocolId = 'strength-back-squat-1rm',
    purpose: AssessmentAttemptPurpose = 'baseline',
    state: AssessmentAttemptState = 'completed',
): AssessmentAttempt {
    return { id, protocolRef: { id: protocolId, revision: 1 }, state, purpose };
}

describe('resolveGoalProgress', () => {
    it('shows the estimated 1RM as current evidence for a strength exercise target', () => {
        const profile: AthletePerformanceProfile = { estimated1RmKg: { conventional_deadlift: 180 } };
        const result = resolveGoalProgress(strengthTarget(), { athletePerformanceProfile: profile });
        expect(result).toMatchObject({
            currentValue: 180,
            currentEvidenceKind: 'estimated_1rm',
            gap: 40,
            alreadyAchieved: false,
            hasComparableEvidence: true,
            reasonCode: 'ok',
        });
    });

    it('prefers the sport-scoped strength.estimated1RmKg map and surfaces its provenance', () => {
        const profile: AthletePerformanceProfile = {
            strength: { estimated1RmKg: { conventional_deadlift: 190 } },
            estimated1RmSources: { conventional_deadlift: { source: 'coach' } },
        };
        const result = resolveGoalProgress(strengthTarget(), { athletePerformanceProfile: profile });
        expect(result.currentValue).toBe(190);
        expect(result.currentSource).toBe('coach');
    });

    it('reports no_baseline when no e1RM is recorded for the exercise', () => {
        const result = resolveGoalProgress(strengthTarget(), { athletePerformanceProfile: {} });
        expect(result).toMatchObject({ currentValue: null, hasComparableEvidence: false, reasonCode: 'no_baseline' });
    });

    it('computes a lower-is-better gap for a sprint target from the latest comparable observation', () => {
        const result = resolveGoalProgress(speedTarget(), {
            comparableObservations: [observation()],
            assessmentAttempts: [attempt()],
        });
        expect(result).toMatchObject({
            currentValue: 1.86,
            currentEvidenceKind: 'measured_observation',
            hasComparableEvidence: true,
            reasonCode: 'ok',
        });
        expect(result.gap).toBeCloseTo(0.11, 5);
    });

    it('ignores an observation from a different protocol id (standing vs a hypothetical flying test)', () => {
        const result = resolveGoalProgress(speedTarget(), {
            assessmentAttempts: [attempt()],
            comparableObservations: [observation({ protocolRef: { id: 'sprint-flying-10m', revision: 1 } })],
        });
        expect(result).toMatchObject({ currentValue: null, reasonCode: 'no_comparable_observation' });
    });

    it('ignores an observation from a different revision of the same protocol', () => {
        const result = resolveGoalProgress(speedTarget(), {
            assessmentAttempts: [attempt()],
            comparableObservations: [observation({ protocolRef: { id: 'sprint-10m-standing', revision: 2 } })],
        });
        expect(result).toMatchObject({ currentValue: null, reasonCode: 'no_comparable_observation' });
    });

    it('ignores invalid/questionable observations', () => {
        const result = resolveGoalProgress(speedTarget(), {
            assessmentAttempts: [attempt()],
            comparableObservations: [observation({ validity: 'questionable' })],
        });
        expect(result.hasComparableEvidence).toBe(false);
    });

    it('picks the most recent valid observation when several exist', () => {
        const result = resolveGoalProgress(speedTarget(), {
            assessmentAttempts: [attempt()],
            comparableObservations: [
                observation({ observationKey: 'old', value: 2.0, observedAt: '2026-08-01T00:00:00.000Z' }),
                observation({ observationKey: 'new', value: 1.80, observedAt: '2026-09-10T00:00:00.000Z' }),
            ],
        });
        expect(result.currentValue).toBe(1.80);
    });

    it('flags already_achieved once the current comparable result beats the target', () => {
        const result = resolveGoalProgress(speedTarget(), {
            assessmentAttempts: [attempt()],
            comparableObservations: [observation({ value: 1.70 })],
        });
        expect(result.alreadyAchieved).toBe(true);
        expect(result.gap).toBeLessThanOrEqual(0);
    });

    describe('goalProgressEvidenceQuery', () => {
        it('ignores exercise subjects', () => {
            expect(goalProgressEvidenceQuery([strengthTarget()])).toEqual({ metricIds: [], protocolIds: [] });
        });

        it('de-duplicates and sorts ids across performance_test targets', () => {
            const query = goalProgressEvidenceQuery([
                speedTarget(),
                strengthTarget(),
                speedTarget({ targetValue: 1.6 }),
            ]);
            expect(query).toEqual({
                metricIds: ['sprint_elapsed_time_s'],
                protocolIds: ['sprint-10m-standing'],
            });
        });

        it('returns the protocol id that resolveGoalProgress matches for the same target', () => {
            const target = speedTarget();
            const [protocolId] = goalProgressEvidenceQuery([target]).protocolIds;
            const result = resolveGoalProgress(target, {
                comparableObservations: [observation({ protocolRef: { id: protocolId, revision: 1 } })],
                assessmentAttempts: [{ ...attempt(), protocolRef: { id: protocolId, revision: 1 } }],
            });
            expect(result).toMatchObject({ currentValue: 1.86, reasonCode: 'ok' });
        });
    });

    describe('benchmark evidence eligibility (#897 WP8)', () => {
        it('does not let a later familiarization-attempt result become the current value', () => {
            const result = resolveGoalProgress(speedTarget(), {
                comparableObservations: [
                    observation({ observationKey: 'base', assessmentAttemptId: 'attempt-base', value: 1.90, observedAt: '2026-09-01T00:00:00.000Z' }),
                    observation({ observationKey: 'famil', assessmentAttemptId: 'attempt-famil', value: 1.70, observedAt: '2026-09-10T00:00:00.000Z' }),
                ],
                assessmentAttempts: [
                    attempt('attempt-base', 'baseline'),
                    attempt('attempt-famil', 'familiarization'),
                ],
            });
            expect(result).toMatchObject({ currentValue: 1.90, reasonCode: 'ok', alreadyAchieved: false });
            expect(result.currentObservedAt).toBe('2026-09-01T00:00:00.000Z');
        });

        it('ignores an observation from an abandoned attempt', () => {
            const result = resolveGoalProgress(speedTarget(), {
                comparableObservations: [
                    observation({ observationKey: 'base', assessmentAttemptId: 'attempt-base', value: 1.90, observedAt: '2026-09-01T00:00:00.000Z' }),
                    observation({ observationKey: 'aband', assessmentAttemptId: 'attempt-aband', value: 1.72, observedAt: '2026-09-10T00:00:00.000Z' }),
                ],
                assessmentAttempts: [
                    attempt('attempt-base', 'baseline'),
                    attempt('attempt-aband', 'checkpoint', 'abandoned'),
                ],
            });
            expect(result.currentValue).toBe(1.90);
        });

        it.each(['in_progress', 'scheduled'] as const)('ignores an observation from a %s attempt', state => {
            const result = resolveGoalProgress(speedTarget(), {
                comparableObservations: [observation()],
                assessmentAttempts: [attempt('attempt-1', 'baseline', state)],
            });
            expect(result).toMatchObject({ currentValue: null, reasonCode: 'no_comparable_observation' });
        });

        it('fails closed when the observation attempt was not supplied', () => {
            const withoutAttempts = resolveGoalProgress(speedTarget(), { comparableObservations: [observation()] });
            expect(withoutAttempts).toMatchObject({
                currentValue: null,
                hasComparableEvidence: false,
                reasonCode: 'no_comparable_observation',
            });
            const otherAttempt = resolveGoalProgress(speedTarget(), {
                comparableObservations: [observation()],
                assessmentAttempts: [attempt('attempt-other')],
            });
            expect(otherAttempt.reasonCode).toBe('no_comparable_observation');
        });

        it('does not require attempts for exercise (e1RM) targets', () => {
            const result = resolveGoalProgress(strengthTarget(), {
                athletePerformanceProfile: { estimated1RmKg: { conventional_deadlift: 180 } },
            });
            expect(result.reasonCode).toBe('ok');
        });
    });

    describe('exercise-subject measured 1RM bridge (#897 WP8.1)', () => {
        it('connects measured back squat observation to back squat goal progress', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'back_squat' },
                targetValue: 160,
            });
            const obs = strengthObservation({
                protocolRef: { id: 'strength-back-squat-1rm', revision: 1 },
                assessmentAttemptId: 'att-sq-1',
                value: 140,
                observedAt: '2026-09-05T08:00:00.000Z',
            });
            const att = strengthAttempt('att-sq-1', 'strength-back-squat-1rm', 'baseline', 'completed');

            const result = resolveGoalProgress(target, {
                comparableObservations: [obs],
                assessmentAttempts: [att],
            });

            expect(result).toMatchObject({
                currentValue: 140,
                currentEvidenceKind: 'measured_observation',
                currentObservedAt: '2026-09-05T08:00:00.000Z',
                gap: 20,
                alreadyAchieved: false,
                hasComparableEvidence: true,
                reasonCode: 'ok',
            });
            expect(result.currentSource).toBeUndefined();
        });

        it('connects measured bench press observation to bench press goal progress', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'bench_press' },
                targetValue: 120,
            });
            const obs = strengthObservation({
                observationKey: 'obs-bench-1',
                protocolRef: { id: 'strength-bench-press-1rm', revision: 1 },
                assessmentAttemptId: 'att-bp-1',
                value: 110,
                observedAt: '2026-09-06T09:00:00.000Z',
            });
            const att = strengthAttempt('att-bp-1', 'strength-bench-press-1rm', 'baseline', 'completed');

            const result = resolveGoalProgress(target, {
                comparableObservations: [obs],
                assessmentAttempts: [att],
            });

            expect(result).toMatchObject({
                currentValue: 110,
                currentEvidenceKind: 'measured_observation',
                currentObservedAt: '2026-09-06T09:00:00.000Z',
                gap: 10,
                alreadyAchieved: false,
                hasComparableEvidence: true,
                reasonCode: 'ok',
            });
        });

        it('strictly separates squat and bench observations despite shared strength_1rm_kg metricId', () => {
            const benchTarget = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'bench_press' },
                targetValue: 120,
            });
            const squatTarget = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'back_squat' },
                targetValue: 160,
            });

            const squatObs = strengthObservation({
                protocolRef: { id: 'strength-back-squat-1rm', revision: 1 },
                assessmentAttemptId: 'att-sq-1',
                value: 150,
            });
            const squatAtt = strengthAttempt('att-sq-1', 'strength-back-squat-1rm');

            const benchObs = strengthObservation({
                observationKey: 'obs-bench-1',
                protocolRef: { id: 'strength-bench-press-1rm', revision: 1 },
                assessmentAttemptId: 'att-bp-1',
                value: 105,
            });
            const benchAtt = strengthAttempt('att-bp-1', 'strength-bench-press-1rm');

            const allObs = [squatObs, benchObs];
            const allAtts = [squatAtt, benchAtt];

            const benchResult = resolveGoalProgress(benchTarget, {
                comparableObservations: allObs,
                assessmentAttempts: allAtts,
            });
            expect(benchResult.currentValue).toBe(105);

            const squatResult = resolveGoalProgress(squatTarget, {
                comparableObservations: allObs,
                assessmentAttempts: allAtts,
            });
            expect(squatResult.currentValue).toBe(150);

            // Squat observation alone cannot satisfy bench goal
            const benchWithOnlySquat = resolveGoalProgress(benchTarget, {
                comparableObservations: [squatObs],
                assessmentAttempts: [squatAtt],
            });
            expect(benchWithOnlySquat).toMatchObject({
                currentValue: null,
                hasComparableEvidence: false,
                reasonCode: 'no_baseline',
            });
        });

        it('prefers measured 1RM over e1RM when eligible measured observation exists', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'bench_press' },
                targetValue: 120,
            });
            const obs = strengthObservation({
                protocolRef: { id: 'strength-bench-press-1rm', revision: 1 },
                assessmentAttemptId: 'att-bp-1',
                value: 115,
                observedAt: '2026-09-08T00:00:00.000Z',
            });
            const att = strengthAttempt('att-bp-1', 'strength-bench-press-1rm');
            const profile: AthletePerformanceProfile = {
                estimated1RmKg: { bench_press: 100 },
                estimated1RmSources: { bench_press: { source: 'coach' } },
            };

            const result = resolveGoalProgress(target, {
                athletePerformanceProfile: profile,
                comparableObservations: [obs],
                assessmentAttempts: [att],
            });

            expect(result).toMatchObject({
                currentValue: 115,
                currentEvidenceKind: 'measured_observation',
                currentObservedAt: '2026-09-08T00:00:00.000Z',
            });
            expect(result.currentSource).toBeUndefined();
        });

        it('falls back to e1RM when measured assessment attempts are familiarization', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'back_squat' },
                targetValue: 160,
            });
            const obs = strengthObservation({
                protocolRef: { id: 'strength-back-squat-1rm', revision: 1 },
                assessmentAttemptId: 'att-famil',
                value: 155,
            });
            const att = strengthAttempt('att-famil', 'strength-back-squat-1rm', 'familiarization', 'completed');
            const profile: AthletePerformanceProfile = {
                estimated1RmKg: { back_squat: 140 },
                estimated1RmSources: { back_squat: { source: 'manual' } },
            };

            const result = resolveGoalProgress(target, {
                athletePerformanceProfile: profile,
                comparableObservations: [obs],
                assessmentAttempts: [att],
            });

            expect(result).toMatchObject({
                currentValue: 140,
                currentEvidenceKind: 'estimated_1rm',
                currentSource: 'manual',
                reasonCode: 'ok',
            });
        });

        it('falls back to e1RM when measured assessment attempts are abandoned or in_progress', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'bench_press' },
                targetValue: 120,
            });
            const obs = strengthObservation({
                protocolRef: { id: 'strength-bench-press-1rm', revision: 1 },
                assessmentAttemptId: 'att-aband',
                value: 115,
            });
            const att = strengthAttempt('att-aband', 'strength-bench-press-1rm', 'baseline', 'abandoned');
            const profile: AthletePerformanceProfile = {
                estimated1RmKg: { bench_press: 102 },
            };

            const result = resolveGoalProgress(target, {
                athletePerformanceProfile: profile,
                comparableObservations: [obs],
                assessmentAttempts: [att],
            });

            expect(result).toMatchObject({
                currentValue: 102,
                currentEvidenceKind: 'estimated_1rm',
            });
        });

        it('falls back to e1RM when candidate observation attempt is missing (fails closed)', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'bench_press' },
                targetValue: 120,
            });
            const obs = strengthObservation({
                protocolRef: { id: 'strength-bench-press-1rm', revision: 1 },
                assessmentAttemptId: 'att-bp-unknown',
                value: 115,
            });
            const profile: AthletePerformanceProfile = {
                estimated1RmKg: { bench_press: 105 },
            };

            const result = resolveGoalProgress(target, {
                athletePerformanceProfile: profile,
                comparableObservations: [obs],
                assessmentAttempts: [], // attempt not provided
            });

            expect(result).toMatchObject({
                currentValue: 105,
                currentEvidenceKind: 'estimated_1rm',
            });
        });

        it('falls back to e1RM when observation validity is invalid', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'back_squat' },
                targetValue: 160,
            });
            const obs = strengthObservation({
                protocolRef: { id: 'strength-back-squat-1rm', revision: 1 },
                assessmentAttemptId: 'att-sq-1',
                value: 170,
                validity: 'invalid',
            });
            const att = strengthAttempt('att-sq-1', 'strength-back-squat-1rm');
            const profile: AthletePerformanceProfile = {
                estimated1RmKg: { back_squat: 135 },
            };

            const result = resolveGoalProgress(target, {
                athletePerformanceProfile: profile,
                comparableObservations: [obs],
                assessmentAttempts: [att],
            });

            expect(result).toMatchObject({
                currentValue: 135,
                currentEvidenceKind: 'estimated_1rm',
            });
        });

        it('fails closed to no_baseline when neither eligible observation nor e1RM exists', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'back_squat' },
                targetValue: 160,
            });

            const result = resolveGoalProgress(target, {
                athletePerformanceProfile: null,
                comparableObservations: [],
                assessmentAttempts: [],
            });

            expect(result).toMatchObject({
                currentValue: null,
                currentEvidenceKind: null,
                hasComparableEvidence: false,
                reasonCode: 'no_baseline',
            });
        });

        it('ignores assessment observations for exercises without a mapped protocol (e.g. conventional_deadlift)', () => {
            const deadliftTarget = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
                targetValue: 240,
            });
            const squatObs = strengthObservation({
                protocolRef: { id: 'strength-back-squat-1rm', revision: 1 },
                assessmentAttemptId: 'att-sq-1',
                value: 200,
            });
            const squatAtt = strengthAttempt('att-sq-1', 'strength-back-squat-1rm');
            const profile: AthletePerformanceProfile = {
                estimated1RmKg: { conventional_deadlift: 210 },
            };

            const result = resolveGoalProgress(deadliftTarget, {
                athletePerformanceProfile: profile,
                comparableObservations: [squatObs],
                assessmentAttempts: [squatAtt],
            });

            expect(result).toMatchObject({
                currentValue: 210,
                currentEvidenceKind: 'estimated_1rm',
            });
        });

        it('selects latest valid eligible observation revision when multiple exist', () => {
            const target = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'back_squat' },
                targetValue: 180,
            });
            const obs1 = strengthObservation({
                observationKey: 'obs-1',
                protocolRef: { id: 'strength-back-squat-1rm', revision: 1 },
                assessmentAttemptId: 'att-sq-1',
                value: 140,
                observedAt: '2026-09-01T10:00:00.000Z',
            });
            const obs2 = strengthObservation({
                observationKey: 'obs-2',
                protocolRef: { id: 'strength-back-squat-1rm', revision: 1 },
                assessmentAttemptId: 'att-sq-2',
                value: 150,
                observedAt: '2026-09-15T10:00:00.000Z',
            });
            const att1 = strengthAttempt('att-sq-1', 'strength-back-squat-1rm');
            const att2 = strengthAttempt('att-sq-2', 'strength-back-squat-1rm');

            const result = resolveGoalProgress(target, {
                comparableObservations: [obs1, obs2],
                assessmentAttempts: [att1, att2],
            });

            expect(result.currentValue).toBe(150);
            expect(result.currentObservedAt).toBe('2026-09-15T10:00:00.000Z');
        });

        it('includes metricId and protocolId for bridged exercises in goalProgressEvidenceQuery', () => {
            const squatTarget = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'back_squat' },
                targetValue: 160,
            });
            const benchTarget = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'bench_press' },
                targetValue: 120,
            });
            const deadliftTarget = strengthTarget({
                subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
                targetValue: 220,
            });

            const query = goalProgressEvidenceQuery([squatTarget, benchTarget, deadliftTarget]);

            expect(query.metricIds).toEqual(['strength_1rm_kg']);
            expect(query.protocolIds).toEqual([
                'strength-back-squat-1rm',
                'strength-bench-press-1rm',
            ]);
        });
    });
});
