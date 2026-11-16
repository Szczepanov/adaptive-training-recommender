import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FlagStripItem } from '../derived/flags/flagStripItems';
import { FlagStrip } from './FlagStrip';

const flag = (overrides: Partial<FlagStripItem>): FlagStripItem => ({
  id: 'injury_constraint_touches_session', active: false, state: 'measured', reasonCode: 'no_touch',
  threshold: 'internal rule ADR-0052', inputs: [], ...overrides,
});

describe('FlagStrip', () => {
  it('shows evidence by default with readable labels and separate closed rules', () => {
    const html = renderToStaticMarkup(<FlagStrip flags={[
      flag({ id: 'recovery_beyond_baseline', active: true, reasonCode: 'adverse:rhr', inputs: [
        { name: 'rhr_delta7d', value: { value: 3.7, unit: 'bpm', source: 'snapshot', state: 'measured' } },
      ] }),
      flag({ sessionTitle: 'Lower Power', inputs: [
        { name: 'active_constraint_families', value: { value: ['lower_limb_strength'], source: 'settings', state: 'measured' } },
        { name: 'touched_patterns', value: { value: [], source: 'session', state: 'measured' } },
        { name: 'session_pattern_evidence_complete', value: { value: false, source: 'session', state: 'measured' } },
      ] }),
      flag({ id: 'illness_anomaly', active: null, state: 'not_yet_supported', reasonCode: 'ha7_release_gate_unmet' }),
    ]} />);
    expect(html).toContain('Today’s checks');
    expect(html).toContain('Recovery signals');
    expect(html).toContain('Resting heart rate · 7-day change');
    expect(html).toContain('3.7 bpm');
    expect(html).toContain('Injury restrictions');
    expect(html).toContain('No matching restrictions');
    expect(html).toContain('Lower limb strength');
    expect(html).toContain('Matching movements');
    expect(html).toContain('None');
    expect(html).toContain('Incomplete');
    expect(html).toContain('<details');
    expect(html).toContain('Evaluation rules');
    expect(html).not.toContain('<details open');
    expect(html).not.toMatch(/ADR-|HA7|rhr_delta7d|active_constraint_families|\(false\)/);
    expect(html).toContain('Automatic illness detection isn’t available');
  });

  it('distinguishes allergy symptoms, missing evidence, stale values and active matches', () => {
    const html = renderToStaticMarkup(<FlagStrip flags={[
      flag({ id: 'illness_risk_symptom', reasonCode: 'allergy_like_symptom_day' }),
      flag({ active: null, state: 'not_recorded', reasonCode: 'pattern_evidence_incomplete', inputs: [
        { name: 'active_constraint_families', value: { value: null, source: 'settings', state: 'missing' } },
      ] }),
      flag({ id: 'recovery_beyond_baseline', active: null, state: 'stale', reasonCode: 'snapshot_stale', inputs: [
        { name: 'hrv', value: { value: 40, unit: 'ms', source: 'snapshot', state: 'stale' } },
      ] }),
      flag({ active: true, reasonCode: 'pattern_touch' }),
    ]} />);
    expect(html).toContain('Allergy-like symptoms reported');
    expect(html).toContain('Couldn’t fully check this session');
    expect(html).toContain('Movement information is incomplete');
    expect(html).toContain('Missing');
    expect(html).toContain('40 ms (out of date)');
    expect(html).toContain('Restrictions match this session');
    expect(html).not.toContain('No symptoms reported');
  });

  it('explains capture read failures without raw source or reason identifiers', () => {
    const html = renderToStaticMarkup(<FlagStrip flags={[
      flag({ id: 'recovery_beyond_baseline', active: null, state: 'unavailable', reasonCode: 'source_unavailable', inputs: [
        { name: 'daily_recovery_snapshots', value: { value: null, source: 'daily_recovery_snapshots', state: 'unavailable' } },
      ] }),
      flag({ id: 'illness_risk_symptom', active: null, state: 'invalid', reasonCode: 'source_invalid', inputs: [
        { name: 'daily_subjective_checkins', value: { value: null, source: 'daily_subjective_checkins', state: 'invalid' } },
      ] }),
    ]} />);
    expect(html).toContain('The information for this check could not be loaded.');
    expect(html).toContain('The information for this check could not be read.');
    expect(html).toContain('Recovery data:');
    expect(html).toContain('Check-in:');
    expect(html).not.toMatch(/source_|daily_recovery_snapshots|daily_subjective_checkins|information prevented/);
  });

  it('renders evaluated measured illness_anomaly flags alongside legacy not_yet_supported', () => {
    const measuredHtml = renderToStaticMarkup(<FlagStrip flags={[
      flag({
        id: 'illness_anomaly',
        active: true,
        state: 'measured',
        reasonCode: 'possible_illness_or_systemic_stress',
        inputs: [
          { name: 'anomaly_state', value: { value: 'possible_illness_or_systemic_stress', source: 'health_anomaly_assessment', state: 'measured' } },
          { name: 'assessment_mode', value: { value: 'visible-v1', source: 'health_anomaly_assessment', state: 'measured' } },
          { name: 'available_core_signals', value: { value: 3, source: 'health_anomaly_assessment', state: 'measured' } },
        ],
      }),
      flag({
        id: 'illness_anomaly',
        active: false,
        state: 'measured',
        reasonCode: 'watch_unexplained',
      }),
    ]} />);
    expect(measuredHtml).toContain('Strong anomaly pattern');
    expect(measuredHtml).toContain('Early watch signal');
    expect(measuredHtml).toContain('Anomaly assessment:');
    expect(measuredHtml).toContain('Persistent multi-signal shift');
    expect(measuredHtml).toContain('Assessment mode:');
    expect(measuredHtml).toContain('Early warnings');
    expect(measuredHtml).toContain('Available signals:');
    expect(measuredHtml).toContain('Evaluation rules');
    expect(measuredHtml).not.toMatch(/ADR-|HA7/);
  });

  it('humanizes injury rule-table severities', () => {
    const html = renderToStaticMarkup(<FlagStrip flags={[flag({})]} />);
    expect(html).toMatch(/· (Limit|Exclude):/);
    expect(html).not.toMatch(/· (limit|exclude):/);
  });

  it('explains both insufficient baseline history and unavailable signals for no_core_signals', () => {
    const html = renderToStaticMarkup(<FlagStrip flags={[
      flag({
        id: 'illness_anomaly',
        active: false,
        state: 'missing',
        reasonCode: 'no_core_signals',
      }),
    ]} />);
    expect(html).toContain('Not enough baseline history or core signals');
    expect(html).not.toContain('are all unavailable today');
  });
});
