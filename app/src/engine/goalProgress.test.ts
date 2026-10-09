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
});
