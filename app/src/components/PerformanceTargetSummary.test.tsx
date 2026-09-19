import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PerformanceTargetSummary } from './Goals';
import type { GoalPerformanceTarget } from '../engine/performanceTargetPolicy';
import type { AthletePerformanceProfile } from '../workouts/models';
import type { MetricObservationRevision } from '../observations/models';

function strengthTarget(): GoalPerformanceTarget {
  return {
    kind: 'performance_metric',
    metricId: 'strength_1rm_kg',
    subjectRef: { kind: 'exercise', exerciseId: 'conventional_deadlift' },
    targetValue: 220,
  };
}

describe('PerformanceTargetSummary (ADR-0041/PG3-PG4.5)', () => {
  it('renders the target, current e1RM and gap for a strength exercise target', () => {
    const profile: AthletePerformanceProfile = {
      estimated1RmKg: { conventional_deadlift: 180 },
      estimated1RmSources: { conventional_deadlift: { source: 'coach' } },
    };
    const html = renderToStaticMarkup(
      <PerformanceTargetSummary target={strengthTarget()} targetDate={null} performanceProfile={profile} />,
    );
    expect(html).toContain('Conventional Deadlift');
    expect(html).toContain('220 kg');
    expect(html).toContain('Current estimate');
    expect(html).toContain('180 kg');
    expect(html).toContain('gap 40 kg');
    expect(html).toContain('does not yet change your weekly plan');
  });

  it('shows a non-blocking empty state when there is no recorded baseline', () => {
    const html = renderToStaticMarkup(
      <PerformanceTargetSummary target={strengthTarget()} targetDate={null} performanceProfile={null} />,
    );
    expect(html).toContain('No recorded e1RM yet');
  });

  it('renders the latest comparable logged result for a performance-test target', () => {
    const target: GoalPerformanceTarget = {
      kind: 'performance_metric',
      metricId: 'sprint_elapsed_time_s',
      subjectRef: { kind: 'performance_test', performanceTestId: 'sprint_10m_standing-r1' },
      targetValue: 1.75,
    };
    const observation: MetricObservationRevision = {
      observationKey: 'attempt-1:sprint_elapsed_time_s',
      revision: 1,
      metricId: 'sprint_elapsed_time_s',
      value: 1.9,
      unit: 's',
      observedAt: '2026-09-18T06:00:00.000Z',
      source: 'manual',
      protocolRef: { id: 'sprint-10m-standing', revision: 1 },
      comparisonSeriesKey: 'sprint-series',
      comparisonCanonicalizationVersion: 'comparison-series-v1',
      assessmentAttemptId: 'attempt-1',
      validity: 'valid',
      context: {},
      createdAt: '2026-09-18T06:05:00.000Z',
    };
    const html = renderToStaticMarkup(
      <PerformanceTargetSummary
        target={target}
        targetDate={null}
        performanceProfile={null}
        comparableObservations={[observation]}
      />,
    );
    expect(html).toContain('Current result: 1.90 s');
    expect(html).toContain('gap 0.15 s');
  });

  it('shows a feasibility badge once a target date is present', () => {
    const profile: AthletePerformanceProfile = {
      estimated1RmKg: { conventional_deadlift: 100 },
      estimated1RmSources: { conventional_deadlift: { source: 'coach' } },
    };
    const html = renderToStaticMarkup(
      <PerformanceTargetSummary target={strengthTarget()} targetDate="2026-10-31" performanceProfile={profile} />,
    );
    expect(html).toContain('Goal feasibility:');
  });

  it('shows the horizon, weekly capacity and unknown target-specific frequency behind confidence', () => {
    const profile: AthletePerformanceProfile = {
      estimated1RmKg: { conventional_deadlift: 100 },
      estimated1RmSources: { conventional_deadlift: { source: 'coach' } },
    };
    const html = renderToStaticMarkup(
      <PerformanceTargetSummary
        target={strengthTarget()}
        targetDate="2099-10-31"
        performanceProfile={profile}
        capacity={{ weeklyMinSessions: 1, weeklyTargetSessions: 2, weeklyMaxSessions: 3 }}
      />,
    );
    expect(html).toContain('confidence: moderate');
    expect(html).toContain('weeks remaining');
    expect(html).toContain('weekly capacity 1-3 sessions (target 2)');
    expect(html).toContain('target-specific frequency not yet known');
    expect(html).toContain('baseline: estimated 1RM (coach)');
  });

  it('omits the feasibility badge entirely when there is no target date', () => {
    const html = renderToStaticMarkup(
      <PerformanceTargetSummary target={strengthTarget()} targetDate={null} performanceProfile={null} />,
    );
    expect(html).not.toContain('Goal feasibility:');
  });
});
