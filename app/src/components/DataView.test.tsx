import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanonicalActivitiesPanel } from './CanonicalActivitiesPanel';
import { DataView } from './DataView';
import type { DailyDecisionInput } from '../engine/models';
import { garminOnlyView, structuredOnlyView, workoutView } from '../training-occurrence/workoutSourceDiagnostics.fixtures';

/**
 * Minimal fixture for the recovery tab (the component's default `initialTab`) only.
 * Other tabs (checkin/goals/constraints/preferences) read other `decisionInput` fields
 * behind `activeTab === '<tab>' && (...)` -- JS short-circuits the right side, so those
 * fields are never touched while the recovery tab is active and can stay absent here.
 * Cast through `unknown` deliberately: this fixture is intentionally partial, not a
 * claim that every `DailyDecisionInput` field is provided.
 */
function recoveryDecisionInput(baselineComputationVersion: number): DailyDecisionInput {
  return {
    userId: 'athlete-1',
    date: '2026-09-17',
    recoverySnapshot: {
      userId: 'athlete-1',
      date: '2026-09-17',
      raw: {},
      dataQuality: {},
      derived: {
        baselineComputationVersion,
        respiration7dAvg: 14,
        respiration28dAvg: 14.5,
        respiration28dMad: 0.8,
        sleepScore7dMedian: 80, sleepScore28dMedian: 78, sleepScore28dMad: 4, deltas: {
          sleepScoreVs7dMedian: 2, sleepScoreVs28dMedian: 4,
          restingHrVs7dMedian: -1, restingHrVs28dMedian: -2,
          hrvVs7dMedian: 3, hrvVs28dMedian: 5,
          stepsVs7dMedian: 500, stepsVs28dMedian: 800,
          bodyBatteryWakeVs7dMedian: 2, bodyBatteryWakeVs28dMedian: 3,
          stressAvgVs7dMedian: -1, stressAvgVs28dMedian: -2,
          stressMaxVs7dMedian: -3, stressMaxVs28dMedian: -4,
          trainingReadinessScoreVs7dMedian: 1, trainingReadinessScoreVs28dMedian: 2,
        },
        restingHr7dMedian: 48, restingHr28dMedian: 49, restingHr28dMad: 1,
        hrv7dMedian: 62, hrv28dMedian: 60, hrv28dMad: 3,
        steps7dMedian: 8000, steps28dMedian: 7500, steps28dMad: 400,
        bodyBatteryWake7dMedian: 85, bodyBatteryWake28dMedian: 83, bodyBatteryWake28dMad: 3,
        stressAvg7dMedian: 25, stressAvg28dMedian: 27, stressAvg28dMad: 4,
        stressMax7dMedian: 60, stressMax28dMedian: 62, stressMax28dMad: 5,
        trainingReadinessScore7dMedian: 70, trainingReadinessScore28dMedian: 68, trainingReadinessScore28dMad: 3,
      },
    },
  } as unknown as DailyDecisionInput;
}

describe('DataView gated recovery metrics (#588 review follow-up)', () => {
  it('shows "Not available yet" for every gated field below baseline v3', () => {
    const html = renderToStaticMarkup(
      <DataView decisionInput={recoveryDecisionInput(2)} userId="athlete-1" onBack={() => {}} />,
    );

    expect(html).toContain('Respiration 7d Avg:');
    expect(html).toContain('Respiration 28d Avg:');
    expect(html).not.toContain('legacy pre-v3');
    expect(html).not.toContain('requires baseline');
    // Respiration MAD and every candidate-baseline field are gated below their own threshold.
    const notAvailableCount = html.split('Not available yet').length - 1;
    expect(notAvailableCount).toBe(9); // respiration28dMad + 4 v4 fields + 4 v5 fields
  });

  it('unlocks respiration medians at v3 while candidate baselines stay gated until v4/v5', () => {
    const html = renderToStaticMarkup(
      <DataView decisionInput={recoveryDecisionInput(3)} userId="athlete-1" onBack={() => {}} />,
    );

    expect(html).toContain('Respiration 7d Median:');
    expect(html).toContain('Respiration 28d Median:');
    expect(html).toContain('Respiration 28d MAD:');
    expect(html).toContain('0.8'); // the real MAD value, not the gated placeholder
    // v4/v5-gated candidate baselines are still unavailable.
    const notAvailableCount = html.split('Not available yet').length - 1;
    expect(notAvailableCount).toBe(8); // 4 v4 fields + 4 v5 fields
  });

  it('unlocks v4 candidate baselines (Sleep Score, Resting HR, HRV, Steps) while v5 fields stay gated', () => {
    const html = renderToStaticMarkup(
      <DataView decisionInput={recoveryDecisionInput(4)} userId="athlete-1" onBack={() => {}} />,
    );

    expect(html).toContain('7d med 80 · 28d med 78'); // Sleep Score candidate baseline, now resolved
    const notAvailableCount = html.split('Not available yet').length - 1;
    expect(notAvailableCount).toBe(4); // Body Battery Wake, Stress Avg, Stress Max, Training Readiness Score (v5-gated)
  });

  it('unlocks every gated field at v5, with none of the version-gate copy left visible', () => {
    const html = renderToStaticMarkup(
      <DataView decisionInput={recoveryDecisionInput(5)} userId="athlete-1" onBack={() => {}} />,
    );

    expect(html).not.toContain('Not available yet');
    expect(html).toContain('7d med 85 · 28d med 83'); // Body Battery Wake candidate baseline
  });
});

describe('DataView canonical Activities states (#895 WP5: loading != failed != empty)', () => {
  const range = { from: '2026-09-11', toExclusive: '2026-09-18' };

  it('renders a loading state while the canonical window has not resolved', () => {
    const html = renderToStaticMarkup(<CanonicalActivitiesPanel workouts={null} failed={false} range={range} />);
    expect(html).toContain('Loading recent activities');
    expect(html).not.toContain('Read-model projection failed');
    expect(html).not.toContain('No workouts were recorded');
  });

  it('renders a genuinely empty window as empty, not as a failure', () => {
    const html = renderToStaticMarkup(<CanonicalActivitiesPanel workouts={[]} failed={false} range={range} reconciliationSweep="completed" />);
    expect(html).toContain('No workouts were recorded');
    expect(html).not.toContain('Read-model projection failed');
  });

  it.each(['incomplete', 'failed', 'not_run'] as const)(
    'does not claim "nothing recorded" for an empty window whose matching check is %s',
    (sweep) => {
      const html = renderToStaticMarkup(<CanonicalActivitiesPanel workouts={[]} failed={false} range={range} reconciliationSweep={sweep} />);
      expect(html).not.toContain('No workouts were recorded');
      expect(html).toContain('newly synced activities may be missing');
      // an empty window can still be exported, with the sweep status in its header
      expect(html).toContain('Copy source diagnostics');
    },
  );

  it('names a failed read as state 8 and never as an empty list, a loading spinner or zero', () => {
    const html = renderToStaticMarkup(<CanonicalActivitiesPanel workouts={null} failed range={range} />);
    expect(html).toContain('Read-model projection failed');
    expect(html).toContain('State 8');
    expect(html).toContain('not an empty list');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Loading recent activities');
    expect(html).not.toContain('No workouts were recorded');
    expect(html).not.toMatch(/\b0 workouts\b/);
  });

  it('hands the real sweep outcome to the failed-window alert so its export does not claim "not_run"', () => {
    const html = renderToStaticMarkup(<CanonicalActivitiesPanel workouts={null} failed range={range} reconciliationSweep="incomplete" />);
    expect(html).toContain('Copy source diagnostics');
    expect(html).toContain('Read-model projection failed');
  });

  it('keeps the failure visible even if stale workouts are still cached', () => {
    const html = renderToStaticMarkup(<CanonicalActivitiesPanel workouts={[workoutView()]} failed range={range} />);
    expect(html).toContain('Read-model projection failed');
    expect(html).not.toContain('activity-telemetry-card');
  });

  it('offers the user-initiated diagnostics export with the displayed window', () => {
    const html = renderToStaticMarkup(<CanonicalActivitiesPanel workouts={[workoutView()]} failed={false} range={range} />);
    expect(html).toContain('Copy source diagnostics');
  });

  it('explains each incomplete workout in the list with named states', () => {
    const html = renderToStaticMarkup(
      <CanonicalActivitiesPanel
        workouts={[
          structuredOnlyView({ performedOccurrenceId: 'ambiguous', reconciliation: { state: 'ambiguous' } }),
          garminOnlyView({ performedOccurrenceId: 'orphan' }),
          structuredOnlyView({ performedOccurrenceId: 'unreadable', sourceReads: { structured: { status: 'execution_unavailable' } } }),
        ]}
        failed={false}
        range={range}
      />,
    );
    expect(html).toContain('Ambiguous matching candidates');
    expect(html).toContain('No Adaptive session record is linked to this workout.');
    expect(html).toContain('The Adaptive session record could not be loaded.');
    expect(html).not.toContain('No structured or telemetry detail is available');
  });

  describe('through DataView with the canonical read model enabled', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('shows the loading state, not a failure, before the canonical window resolves', () => {
      vi.stubEnv('VITE_TRAINING_OCCURRENCE_ACTIVITIES_POLICY', 'canonical-v1');
      const html = renderToStaticMarkup(
        <DataView decisionInput={recoveryDecisionInput(5)} userId="athlete-1" onBack={() => {}} initialTab="activities" />,
      );
      expect(html).toContain('Loading recent activities');
      expect(html).not.toContain('Read-model projection failed');
    });
  });
});

describe('DataView null-input empty state', () => {
  it('offers retry and a way home instead of a dead-end banner (#493)', () => {
    const html = renderToStaticMarkup(
      <DataView decisionInput={null} userId="athlete-1" onBack={() => {}} onRetry={() => {}} />,
    );

    expect(html).toContain('No data available');
    expect(html).toContain('Retry');
    expect(html).toContain('Back to Home');
  });

  it('still offers a way home when no retry handler is injected (#493)', () => {
    const html = renderToStaticMarkup(
      <DataView decisionInput={null} userId="athlete-1" onBack={() => {}} />,
    );

    expect(html).toContain('No data available');
    expect(html).toContain('Back to Home');
    // No retry button without an injected handler (the guidance copy may still
    // name the dashboard refresh as the recourse).
    expect(html).not.toContain('>Retry<');
  });
});
