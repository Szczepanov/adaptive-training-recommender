import { describe, expect, it } from 'vitest';
import type { PersistedFlagEvaluation } from '../../ledger/flagEvaluation';
import { resolveTodayFlagStripItems } from './flagStripItems';

function makePersistedFlag(overrides: Partial<PersistedFlagEvaluation>): PersistedFlagEvaluation {
  return {
    schemaVersion: 1,
    userId: 'user-1',
    revisionId: `flag-${'a'.repeat(64)}`,
    idempotencyKey: `flag-${'a'.repeat(64)}`,
    id: 'recovery_beyond_baseline',
    observedOn: '2026-11-13',
    evaluatedAt: '2026-11-13T07:00:00.000Z',
    active: false,
    state: 'measured',
    reasonCode: 'within_baseline',
    definitionVersion: 'recovery_beyond_baseline-v1',
    threshold: 'Any core metric delta7d worse than 1.5 SD/MAD',
    inputs: [
      { name: 'sleep_score', value: { value: 82, unit: 'score', source: 'daily_recovery_snapshots', state: 'measured' } },
      { name: 'source_revision', value: { value: 'abc123', source: 'flag_capture', state: 'measured' } },
    ],
    ...overrides,
  };
}

describe('resolveTodayFlagStripItems', () => {
  it('emits not_recorded placeholders including illness_anomaly when nothing is captured', () => {
    const items = resolveTodayFlagStripItems({});
    expect(items.map(i => [i.id, i.state, i.active])).toEqual([
      ['recovery_beyond_baseline', 'not_recorded', null],
      ['illness_risk_symptom', 'not_recorded', null],
      ['illness_anomaly', 'not_recorded', null],
      ['injury_constraint_touches_session', 'not_recorded', null],
    ]);
    expect(items[2].reasonCode).toBe('flag_not_recorded');
  });

  it('surfaces captured measured, missing, and legacy not_yet_supported illness_anomaly evaluations', () => {
    const capturedActive = makePersistedFlag({
      id: 'illness_anomaly',
      evaluatedAt: '2026-11-13T07:30:00.000Z',
      active: true,
      state: 'measured',
      reasonCode: 'possible_illness_or_systemic_stress',
      inputs: [
        { name: 'anomaly_state', value: { value: 'possible_illness_or_systemic_stress', source: 'health_anomaly_assessment', state: 'measured' } },
        { name: 'assessment_mode', value: { value: 'visible-v1', source: 'health_anomaly_assessment', state: 'measured' } },
        { name: 'available_core_signals', value: { value: 3, source: 'health_anomaly_assessment', state: 'measured' } },
        { name: 'source_revision', value: { value: 'abc123', source: 'flag_capture', state: 'measured' } },
      ],
    });
    const activeItems = resolveTodayFlagStripItems({ capturedFlags: [capturedActive] });
    const anomalyItem = activeItems.find(i => i.id === 'illness_anomaly');
    expect(anomalyItem?.active).toBe(true);
    expect(anomalyItem?.state).toBe('measured');
    expect(anomalyItem?.reasonCode).toBe('possible_illness_or_systemic_stress');
    expect(anomalyItem?.inputs.some(inp => inp.name === 'source_revision')).toBe(false);

    const chained = resolveTodayFlagStripItems({ capturedFlags: [makePersistedFlag({
      inputs: [{ name: 'supersedes_revision', value: { value: 'flag-' + 'a'.repeat(64), source: 'flag_capture', state: 'measured' } }],
    })] });
    expect(chained.find(i => i.id === 'recovery_beyond_baseline')?.inputs).toEqual([]);

    const capturedLegacy = makePersistedFlag({
      id: 'illness_anomaly',
      active: null,
      state: 'not_yet_supported',
      reasonCode: 'ha7_release_gate_unmet',
      inputs: [],
    });
    const legacyItems = resolveTodayFlagStripItems({ capturedFlags: [capturedLegacy] });
    expect(legacyItems.find(i => i.id === 'illness_anomaly')).toMatchObject({
      active: null,
      state: 'not_yet_supported',
      reasonCode: 'ha7_release_gate_unmet',
    });
  });

  it('picks the latest revision per (id, sessionRef) and strips source_revision', () => {
    const older = makePersistedFlag({
      id: 'illness_risk_symptom',
      evaluatedAt: '2026-11-13T06:00:00.000Z',
      active: false,
      reasonCode: 'no_symptoms',
    });
    const newer = makePersistedFlag({
      id: 'illness_risk_symptom',
      evaluatedAt: '2026-11-13T08:00:00.000Z',
      active: true,
      reasonCode: 'non_allergy_illness_reported',
    });
    const items = resolveTodayFlagStripItems({ capturedFlags: [older, newer] });
    const illnessItem = items.find(i => i.id === 'illness_risk_symptom');
    expect(illnessItem?.active).toBe(true);
    expect(illnessItem?.reasonCode).toBe('non_allergy_illness_reported');
    expect(illnessItem?.inputs.some(inp => inp.name === 'source_revision')).toBe(false);
  });

  it('prefers matching captured injury flag or falls back to live session evaluation', () => {
    const items = resolveTodayFlagStripItems({
      capturedFlags: [],
      sessionEvaluations: [
        {
          sessionRef: 'external_plan:p1@1:s1',
          sessionTitle: 'Lower Body Strength',
          evaluation: {
            id: 'injury_constraint_touches_session',
            active: true,
            state: 'measured',
            reasonCode: 'constraint_touches_session',
            definitionVersion: 'injury_constraint_touches_session-v1',
            threshold: 'Active injury constraint overlaps session region',
            inputs: [{ name: 'matched_regions', value: { value: 'knee', source: 'training_settings', state: 'measured' } }],
          },
        },
      ],
    });
    const injury = items.find(i => i.id === 'injury_constraint_touches_session');
    expect(injury?.active).toBe(true);
    expect(injury?.sessionRef).toBe('external_plan:p1@1:s1');
    expect(injury?.sessionTitle).toBe('Lower Body Strength');
  });
});
