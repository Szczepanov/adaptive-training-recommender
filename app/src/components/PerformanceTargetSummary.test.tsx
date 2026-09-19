import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PerformanceTargetSummary } from './Goals';
import type { GoalPerformanceTarget } from '../engine/performanceTargetPolicy';
import type { AthletePerformanceProfile } from '../workouts/models';

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

  it('omits the feasibility badge entirely when there is no target date', () => {
    const html = renderToStaticMarkup(
      <PerformanceTargetSummary target={strengthTarget()} targetDate={null} performanceProfile={null} />,
    );
    expect(html).not.toContain('Goal feasibility:');
  });
});
