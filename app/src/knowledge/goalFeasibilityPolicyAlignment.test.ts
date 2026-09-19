import { describe, expect, it } from 'vitest';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS, validateCanonicalSportsKnowledgeRegistry } from './sportsKnowledgeRegistry';
import { assessGoalFeasibility } from '../engine/goalFeasibility';
import { resolveGoalProgress } from '../engine/goalProgress';
import type { GoalPerformanceTarget } from '../engine/performanceTargetPolicy';
import type { AthletePerformanceProfile } from '../workouts/models';

function benchTarget(targetValue: number): GoalPerformanceTarget {
    return {
        kind: 'performance_metric',
        metricId: 'strength_1rm_kg',
        subjectRef: { kind: 'exercise', exerciseId: 'bench_press' },
        targetValue,
    };
}

function progressAt(currentValue: number): ReturnType<typeof resolveGoalProgress> {
    const profile: AthletePerformanceProfile = {
        estimated1RmKg: { bench_press: currentValue },
        estimated1RmSources: { bench_press: { source: 'coach' } },
    };
    return resolveGoalProgress(benchTarget(1), { athletePerformanceProfile: profile });
}

describe('goal-feasibility strength band policy alignment (ADR-0041, PG4.5.5)', () => {
    it('keeps the canonical registry valid with the goal-feasibility claim registered', () => {
        expect(validateCanonicalSportsKnowledgeRegistry()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('registers the claim as a conditional, low-certainty, advisory-only heuristic', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.strengthRequiredChangeBands);
        expect(claim).toMatchObject({ claimType: 'heuristic', evidenceCertainty: 'low', recommendationStrength: 'conditional', safetyImpact: 'low' });
        expect(claim.applicability.sports).toEqual(['strength']);
    });

    it('keeps ~1.3%/week as the plausible ceiling at adequate (2+/week) capacity', () => {
        const progress = progressAt(100);
        const plausible = assessGoalFeasibility(benchTarget(107.5), progress, {
            targetDate: '2026-10-31', today: '2026-09-19', capacity: { weeklyMaxSessions: 2 },
        }); // 7.5% over 6 weeks -> 1.25%/week
        const stretch = assessGoalFeasibility(benchTarget(110), progress, {
            targetDate: '2026-10-31', today: '2026-09-19', capacity: { weeklyMaxSessions: 2 },
        }); // 10% over 6 weeks -> 1.67%/week
        expect(plausible.plausibility).toBe('plausible');
        expect(stretch.plausibility).toBe('stretch');
    });

    it('classifies a pace above the stretch ceiling as unlikely, matching the registered band', () => {
        const progress = progressAt(100);
        const result = assessGoalFeasibility(benchTarget(200), progress, {
            targetDate: '2026-10-31', today: '2026-09-19', capacity: { weeklyMaxSessions: 1 },
        });
        expect(result.plausibility).toBe('unlikely');
    });

    it('tightens the plausible/stretch ceilings when available frequency is below the 2/week reference', () => {
        const progress = progressAt(100);
        const lowFrequency = assessGoalFeasibility(benchTarget(108), progress, {
            targetDate: '2026-10-17', today: '2026-09-19', capacity: { weeklyMaxSessions: 1 },
        }); // 8% over 4 weeks -> 2%/week, at the stretch ceiling for 2/week and above it at 1/week
        const adequateFrequency = assessGoalFeasibility(benchTarget(108), progress, {
            targetDate: '2026-10-17', today: '2026-09-19', capacity: { weeklyMaxSessions: 2 },
        });
        expect(adequateFrequency.plausibility).toBe('stretch');
        expect(lowFrequency.plausibility).toBe('unlikely');
    });

    it('reports insufficient_evidence for speed/power families and cites no strength-only evidence', () => {
        const target: GoalPerformanceTarget = {
            kind: 'performance_metric', metricId: 'sprint_elapsed_time_s',
            subjectRef: { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' }, targetValue: 1.5,
        };
        const progress = resolveGoalProgress(target, {
            comparableObservations: [{
                observationKey: 'o1', revision: 1, metricId: 'sprint_elapsed_time_s', value: 1.8, unit: 's',
                observedAt: '2026-09-01T00:00:00.000Z', source: 'manual',
                protocolRef: { id: 'sprint-10m-standing', revision: 1 }, comparisonSeriesKey: 's1',
                comparisonCanonicalizationVersion: 'comparison-series-v1', assessmentAttemptId: 'a1',
                validity: 'valid', context: {}, createdAt: '2026-09-01T00:05:00.000Z',
            }],
        });
        const result = assessGoalFeasibility(target, progress, { targetDate: '2026-12-01', today: '2026-09-19' });
        expect(result.plausibility).toBe('insufficient_evidence');
        expect(result.evidenceRefs).toEqual([]);
    });
});
