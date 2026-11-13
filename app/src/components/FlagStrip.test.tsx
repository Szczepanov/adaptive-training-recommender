import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FlagStripItem } from '../derived/flags/flagStripItems';
import { FlagStrip } from './FlagStrip';

describe('FlagStrip', () => {
  it('renders active true, active false, missing null, HA7 not_yet_supported, and session-scoped injury flags', () => {
    const flags: FlagStripItem[] = [
      {
        id: 'recovery_beyond_baseline',
        active: true,
        state: 'measured',
        reasonCode: 'beyond_baseline',
        threshold: 'HRV or sleep worse than 1.5 SD below 28d baseline',
        inputs: [
          { name: 'hrv_delta7d', value: { value: -14, unit: 'ms', source: 'daily_recovery_snapshots', state: 'measured' } },
        ],
      },
      {
        id: 'illness_risk_symptom',
        active: false,
        state: 'measured',
        reasonCode: 'no_non_allergy_illness',
        threshold: 'Non-allergy illness symptoms reported today',
        inputs: [
          { name: 'illness_symptoms', value: { value: false, source: 'daily_subjective_checkins', state: 'measured' } },
        ],
      },
      {
        id: 'illness_anomaly',
        active: null,
        state: 'not_yet_supported',
        reasonCode: 'ha7_release_gate_unmet',
        threshold: 'Withheld until the HA7 release gate is met',
        inputs: [
          { name: 'ha7_release_gate', value: { value: 'unmet', source: 'health_anomaly_assessment', state: 'not_yet_supported' } },
        ],
      },
      {
        id: 'injury_constraint_touches_session',
        active: true,
        state: 'measured',
        reasonCode: 'constraint_touches_session',
        threshold: 'Standing knee constraint overlaps Lower Body Strength',
        sessionRef: 'external_plan:plan-1@1:strength-today',
        sessionTitle: 'Lower Body Strength',
        inputs: [
          { name: 'matched_regions', value: { value: 'knee', source: 'training_settings', state: 'measured' } },
        ],
      },
    ];

    const html = renderToStaticMarkup(<FlagStrip flags={flags} />);
    expect(html).toContain('Advisory only — never blocks or re-doses your session');
    expect(html).toContain('Recovery beyond baseline');
    expect(html).toContain('Active (true)');
    expect(html).toContain('HRV or sleep worse than 1.5 SD below 28d baseline');
    expect(html).toContain('hrv_delta7d:');
    expect(html).toContain('-14 ms');

    expect(html).toContain('Illness-risk symptom');
    expect(html).toContain('Clear (false)');

    expect(html).toContain('Illness / physiological anomaly');
    expect(html).toContain('Not yet supported (HA7 withheld)');
    expect(html).toContain('Withheld until the HA7 release gate is met');

    expect(html).toContain('Injury constraint touches session');
    expect(html).toContain('Lower Body Strength');
    expect(html).toContain('matched_regions:');
    expect(html).toContain('knee');
  });

  it('renders missingness and null states clearly', () => {
    const flags: FlagStripItem[] = [
      {
        id: 'recovery_beyond_baseline',
        active: null,
        state: 'missing',
        reasonCode: 'no_snapshot',
        threshold: null,
        inputs: [
          { name: 'snapshot', value: { value: null, source: 'daily_recovery_snapshots', state: 'missing' } },
        ],
      },
      {
        id: 'illness_risk_symptom',
        active: null,
        state: 'not_recorded',
        reasonCode: 'flag_not_recorded',
        threshold: null,
        inputs: [],
      },
    ];

    const html = renderToStaticMarkup(<FlagStrip flags={flags} />);
    expect(html).toContain('Missing input (null)');
    expect(html).toContain('missing · no_snapshot');
    expect(html).toContain('Not evaluated (missing)');
    expect(html).toContain('Not recorded (null)');
    expect(html).toContain('not_recorded · flag_not_recorded');
  });
});
