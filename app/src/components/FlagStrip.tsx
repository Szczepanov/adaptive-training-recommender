import type { FlagStripItem } from '../derived/flags/flagStripItems';
import type { LedgerFlagId, LedgerState } from '../ledger/export/schema';
import './FlagStrip.css';

const FLAG_LABELS: Record<LedgerFlagId, string> = {
  recovery_beyond_baseline: 'Recovery beyond baseline',
  illness_risk_symptom: 'Illness-risk symptom',
  illness_anomaly: 'Illness / physiological anomaly',
  injury_constraint_touches_session: 'Injury constraint touches session',
};

function formatInputValue(input: FlagStripItem['inputs'][number]): string {
  const { value, unit, state } = input.value;
  if (value === null || value === undefined) {
    return `— (${state})`;
  }
  const formatted = Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  const withUnit = unit ? `${formatted} ${unit}` : formatted;
  return state === 'measured' ? withUnit : `${withUnit} (${state})`;
}

function statusBadge(item: FlagStripItem): { label: string; tone: 'active' | 'clear' | 'missing' | 'withheld' | 'na' } {
  if (item.id === 'illness_anomaly' || item.state === 'not_yet_supported') {
    return { label: 'Not yet supported (HA7 withheld)', tone: 'withheld' };
  }
  if (item.active === true) {
    return { label: 'Active (true)', tone: 'active' };
  }
  if (item.active === false) {
    if (item.state === 'not_applicable') {
      return { label: 'Not applicable (false)', tone: 'na' };
    }
    return { label: 'Clear (false)', tone: 'clear' };
  }
  const stateLabels: Record<LedgerState, string> = {
    measured: 'Unknown (null)',
    missing: 'Missing input (null)',
    not_recorded: 'Not recorded (null)',
    not_collected: 'Not collected (null)',
    not_yet_supported: 'Not yet supported (null)',
    not_applicable: 'Not applicable (null)',
    stale: 'Stale (null)',
    unavailable: 'Unavailable (null)',
    invalid: 'Invalid (null)',
  };
  return { label: stateLabels[item.state], tone: 'missing' };
}

export interface FlagStripProps {
  flags: readonly FlagStripItem[];
  title?: string;
}

export function FlagStrip({ flags, title = 'Safety & readiness flags' }: FlagStripProps) {
  if (flags.length === 0) return null;

  return (
    <section className="flag-strip" aria-label={title}>
      <div className="flag-strip-header">
        <h3 className="flag-strip-title">{title}</h3>
        <span className="flag-strip-advisory-note">
          Advisory only — never blocks or re-doses your session
        </span>
      </div>
      <ul className="flag-strip-list">
        {flags.map((item, idx) => {
          const badge = statusBadge(item);
          const key = `${item.id}:${item.sessionRef ?? idx}`;
          const showMissingness = item.active === null || item.state !== 'measured';

          return (
            <li key={key} className={`flag-strip-item tone-${badge.tone}`}>
              <div className="flag-strip-item-top">
                <div className="flag-strip-item-heading">
                  <span className="flag-strip-flag-name">{FLAG_LABELS[item.id]}</span>
                  {item.sessionTitle && (
                    <span className="flag-strip-session-tag">{item.sessionTitle}</span>
                  )}
                </div>
                <span className={`flag-strip-badge tone-${badge.tone}`}>
                  {badge.label}
                </span>
              </div>

              {item.threshold ? (
                <p className="flag-strip-rule">
                  <strong>Rule:</strong> {item.threshold}
                </p>
              ) : (
                <p className="flag-strip-rule is-muted">
                  <strong>Rule:</strong> Not evaluated ({item.state})
                </p>
              )}

              {showMissingness && (
                <p className="flag-strip-missingness">
                  <strong>Status:</strong> {item.state} · {item.reasonCode}
                </p>
              )}

              {item.inputs.length > 0 && (
                <ul className="flag-strip-inputs" aria-label={`${FLAG_LABELS[item.id]} inputs`}>
                  {item.inputs.map(input => (
                    <li key={input.name} className="flag-strip-input-chip">
                      <span className="flag-strip-input-name">{input.name}:</span>{' '}
                      <span className="flag-strip-input-value">{formatInputValue(input)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
