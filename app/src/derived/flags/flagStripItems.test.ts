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
  it('emits not_recorded placeholders and HA7 withheld illness_anomaly when nothing is captured', () => {
    const items = resolveTodayFlagStripItems({});
    expect(items.map(i => [i.id, i.state, i.active])).toEqual([
      ['recovery_beyond_baseline', 'not_recorded', null],
      ['illness_risk_symptom', 'not_recorded', null],
      ['illness_anomaly', 'not_yet_supported', null],
      ['injury_constraint_touches_session', 'not_recorded', null],
    ]);
    expect(items[2].reasonCode).toBe('ha7_release_gate_unmet');
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
