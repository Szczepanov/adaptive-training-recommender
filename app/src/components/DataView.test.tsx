import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataView } from './DataView';
import type { DailyDecisionInput } from '../engine/models';

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
