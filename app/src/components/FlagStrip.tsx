import type { FlagStripItem } from '../derived/flags/flagStripItems';
import type { LedgerFlagId, LedgerState } from '../ledger/export/schema';
import { INJURY_SESSION_TOUCH_TABLE } from '../derived/flags/injuryConstraintTouchesSession';
import { RECOVERY_VARIABILITY_FLOORS, SLEEP_SCORE_ABSOLUTE_FLOOR } from '../derived/flags/recoveryBeyondBaseline';
import './FlagStrip.css';

const FLAG_LABELS: Record<LedgerFlagId, string> = {
  recovery_beyond_baseline: 'Recovery signals',
  illness_risk_symptom: 'Reported symptoms',
  illness_anomaly: 'Automatic illness detection',
  injury_constraint_touches_session: 'Injury restrictions',
};

const INPUT_LABELS: Record<string, string> = {
  hrv: 'Heart rate variability', rhr: 'Resting heart rate', sleep: 'Sleep score', sleep_score: 'Sleep score',
  hrv_delta7d: 'Heart rate variability · 7-day change', rhr_delta7d: 'Resting heart rate · 7-day change',
  sleep_delta7d: 'Sleep score · 7-day change', hrv_band: 'Heart rate variability · comparison threshold',
  rhr_band: 'Resting heart rate · comparison threshold', sleep_band: 'Sleep score · comparison threshold',
  snapshot: 'Recovery data date', illness_symptoms: 'Illness symptoms reported',
  allergy_like_symptom_day: 'Allergy-like symptom pattern', active_constraint_families: 'Restriction categories',
  touched_patterns: 'Matching movements', touched_modalities: 'Matching activities',
  session_pattern_evidence_complete: 'Movement information', matched_regions: 'Matching regions',
  daily_recovery_snapshots: 'Recovery data', daily_subjective_checkins: 'Check-in',
};

const STATE_LABELS: Record<LedgerState, string> = {
  measured: 'Available', missing: 'Missing', not_recorded: 'Not recorded', not_collected: 'Not collected',
  not_yet_supported: 'Not available', not_applicable: 'Not applicable', stale: 'Out of date',
  unavailable: 'Unavailable', invalid: 'Invalid',
};

const REASONS: Record<string, string> = {
  no_snapshot: 'Recovery data is missing.', snapshot_stale: 'Recovery data is out of date.',
  baseline_immature: 'Not enough history is available to establish a baseline.',
  incomplete_none_adverse: 'Some recovery signals could not be evaluated.', no_judged_metric: 'Recovery signals could not be evaluated.',
  no_checkin: 'Complete your check-in to assess symptoms.', illness_question_unanswered: 'The illness question was not answered.',
  flag_not_recorded: 'This check has not been recorded.', no_constraints_record: 'Injury restrictions have not been recorded.',
  no_session: 'Session information is missing.', pattern_evidence_incomplete: 'Movement information is incomplete.',
  session_modality_not_recorded: 'The session activity type is not recorded.',
  unmapped_active_constraint: 'A restriction does not have enough information to check.',
  source_unavailable: 'The information for this check could not be loaded.',
  source_invalid: 'The information for this check could not be read.',
};

const ILLNESS_CLEAR_LABELS: Record<string, string> = {
  allergy_like_symptom_day: 'Allergy-like symptoms reported',
  no_illness_symptoms: 'No illness symptoms reported',
};

const RULES: Record<Exclude<LedgerFlagId, 'illness_anomaly'>, string> = {
  recovery_beyond_baseline: `A decrease in heart rate variability or sleep score, or an increase in resting heart rate, triggers this check when the 7-day change reaches the greater of 28-day variability and the minimum threshold: ${RECOVERY_VARIABILITY_FLOORS.hrv} ms for heart rate variability, ${RECOVERY_VARIABILITY_FLOORS.rhr} bpm for resting heart rate, and ${RECOVERY_VARIABILITY_FLOORS.sleep} points for sleep. A sleep score below ${SLEEP_SCORE_ABSOLUTE_FLOOR} also triggers it. All three signals must be current and assessed to rule out a flag.`,
  illness_risk_symptom: 'Checks reported illness symptoms. A mild or moderate self-reported allergy with only congestion, runny nose or sneezing is treated as an allergy-like symptom pattern.',
  injury_constraint_touches_session: 'Compares active limit or exclude restrictions with the session’s recorded movements and activity types. Monitor-only entries are not counted. Missing movement or activity information can leave the assessment incomplete.',
};

function readable(value: string): string {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatInputValue(input: FlagStripItem['inputs'][number]): string {
  const { value, unit, state } = input.value;
  if (value === null || value === undefined) return STATE_LABELS[state];
  let formatted: string;
  if (input.name === 'session_pattern_evidence_complete' && typeof value === 'boolean') {
    formatted = value ? 'Complete' : 'Incomplete';
  } else if (typeof value === 'boolean') {
    formatted = value ? 'Yes' : 'No';
  } else if (Array.isArray(value)) {
    formatted = value.length ? value.map(entry => readable(String(entry))).join(', ') : 'None';
  } else if (typeof value === 'object') {
    formatted = JSON.stringify(value).replace(/_/g, ' ');
  } else {
    formatted = typeof value === 'string' && value.includes('_') ? readable(value) : String(value);
  }
  const withUnit = unit ? `${formatted} ${unit}` : formatted;
  return state === 'measured' ? withUnit : `${withUnit} (${STATE_LABELS[state].toLowerCase()})`;
}

function statusBadge(item: FlagStripItem): { label: string; tone: 'active' | 'clear' | 'missing' | 'withheld' | 'na' } {
  if (item.id === 'illness_anomaly' || item.state === 'not_yet_supported') return { label: 'Not available', tone: 'withheld' };
  if (item.state === 'not_applicable') return { label: 'Not applicable', tone: 'na' };
  if (item.active === null) return { label: item.id === 'injury_constraint_touches_session' ? 'Couldn’t fully check this session' : 'Not fully assessed', tone: 'missing' };
  if (item.id === 'injury_constraint_touches_session') return item.active
    ? { label: 'Restrictions match this session', tone: 'active' }
    : { label: 'No matching restrictions', tone: 'clear' };
  if (item.id === 'illness_risk_symptom') return item.active
    ? { label: 'Illness symptoms reported', tone: 'active' }
    : { label: ILLNESS_CLEAR_LABELS[item.reasonCode] ?? 'No illness flag', tone: 'clear' };
  return item.active ? { label: 'Needs attention', tone: 'active' } : { label: 'No adverse signals', tone: 'clear' };
}

export interface FlagStripProps {
  flags: readonly FlagStripItem[];
  title?: string;
}

export function FlagStrip({ flags, title = 'Today’s checks' }: FlagStripProps) {
  if (flags.length === 0) return null;

  return (
    <section className="flag-strip" aria-label={title}>
      <div className="flag-strip-header">
        <h3 className="flag-strip-title">{title}</h3>
        <span className="flag-strip-advisory-note">These checks don’t change your planned workout.</span>
      </div>
      <ul className="flag-strip-list">
        {flags.map((item, idx) => {
          const badge = statusBadge(item);
          const key = `${item.id}:${item.sessionRef ?? idx}`;
          const reason = REASONS[item.reasonCode];
          const adverse = item.id === 'recovery_beyond_baseline' && item.reasonCode.startsWith('adverse:')
            ? item.reasonCode.slice('adverse:'.length).split('+').map(name => INPUT_LABELS[name] ?? readable(name)).join(', ')
            : null;
          return (
            <li key={key} className={`flag-strip-item tone-${badge.tone}`}>
              <div className="flag-strip-item-top">
                <div className="flag-strip-item-heading">
                  <span className="flag-strip-flag-name">{FLAG_LABELS[item.id]}</span>
                  {item.sessionTitle && <span className="flag-strip-session-tag">{item.sessionTitle}</span>}
                </div>
                <span className={`flag-strip-badge tone-${badge.tone}`}>{badge.label}</span>
              </div>
              {item.id === 'illness_anomaly' ? <p className="flag-strip-missingness">Automatic illness detection isn’t available.</p> : <>
                {adverse && <p className="flag-strip-missingness">Signals needing attention: {adverse}.</p>}
                {reason && <p className="flag-strip-missingness">{reason}</p>}
                {item.active === null && !reason && <p className="flag-strip-missingness">{STATE_LABELS[item.state]} information prevented a complete assessment.</p>}
                {item.inputs.length > 0 && (
                  <ul className="flag-strip-inputs" aria-label={`${FLAG_LABELS[item.id]} evidence`}>
                    {item.inputs.map(input => (
                      <li key={input.name} className="flag-strip-input-chip">
                        <span className="flag-strip-input-name">{INPUT_LABELS[input.name] ?? readable(input.name)}:</span>{' '}
                        <span className="flag-strip-input-value">{formatInputValue(input)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="flag-strip-details">
                  <summary>Evaluation rules</summary>
                  <p>{RULES[item.id]}</p>
                  {item.id === 'injury_constraint_touches_session' && <>
                    <p>Each exercise or alternative needs its own recorded movement evidence; required movements can add a match but do not complete missing evidence. Explicit activity restrictions are also checked.</p>
                    <ul>{Object.entries(INJURY_SESSION_TOUCH_TABLE).flatMap(([family, severities]) =>
                      Object.entries(severities).map(([severity, cell]) => (
                        <li key={`${family}:${severity}`}>{readable(family)} · {readable(severity)}: {cell.patterns.map(readable).join(', ')}; activities: {cell.modalities.length ? cell.modalities.join(', ') : 'none'}</li>
                      )))}
                    </ul>
                  </>}
                </details>
              </>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
