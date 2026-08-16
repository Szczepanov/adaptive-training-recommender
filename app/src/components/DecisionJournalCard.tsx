import { useEffect, useState, memo } from 'react';
import { decisionJournalService } from '../services/decisionJournalService';
import { SHADOW_VERDICTS, type DecisionJournalEntry, type ShadowVerdict } from '../engine/models';
import './DecisionJournalCard.css';

interface DecisionJournalCardProps {
  userId: string;
  date: string;
  /** The engine's own verdict for today, derived from the live recommendation. Null while
   *  none has been computed yet (loading, or no recovery data synced). */
  engineVerdict: ShadowVerdict | null;
  /** Whether the athlete has already seen today's recommendation on this page load --
   *  Home's reveal gate, read at submit time to lock `sawEngineVerdictFirst` from observed
   *  interaction. Never asked as a self-report (Phase 9.0.3). */
  engineRevealed: boolean;
  /** Reports the loaded/updated entry so Home can also treat "an entry already exists" as
   *  reveal-equivalent -- a returning athlete who recorded blind earlier today shouldn't be
   *  re-hidden from their own recommendation on a later page load. */
  onEntryChange: (entry: DecisionJournalEntry | null) => void;
}

const VERDICT_LABELS: Record<ShadowVerdict, string> = {
  proceed: 'Do it',
  scale: 'Do it easier',
  defer: 'Move it',
  skip: 'Skip it',
  advisory: 'Your call',
};

/**
 * Phase 9.0.3: records today's shadow-mode entry -- what the athlete's own (non-app)
 * planner said, and later what actually happened -- so it can be compared against the
 * engine's verdict. Deliberately has no path back into the engine: `externalArchitecture.test.ts`
 * (9.0.6) asserts no selection or safety module can import `decisionJournalService.ts`.
 */
export const DecisionJournalCard = memo(function DecisionJournalCard({
  userId, date, engineVerdict, engineRevealed, onEntryChange,
}: DecisionJournalCardProps) {
  const [entry, setEntry] = useState<DecisionJournalEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editingMorning, setEditingMorning] = useState(false);
  const [externalVerdict, setExternalVerdict] = useState<ShadowVerdict>('proceed');
  const [externalNote, setExternalNote] = useState('');
  const [actualVerdict, setActualVerdict] = useState<ShadowVerdict | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setEditingMorning(false);
    decisionJournalService.getEntry(userId, date)
      .then(loadedEntry => {
        if (cancelled) return;
        setEntry(loadedEntry);
        setExternalVerdict(loadedEntry?.externalVerdict ?? 'proceed');
        setExternalNote(loadedEntry?.externalNote ?? '');
        setActualVerdict(loadedEntry?.actualVerdict ?? '');
        onEntryChange(loadedEntry);
      })
      .catch(err => {
        console.warn('Failed to load decision journal entry:', err);
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userId, date, onEntryChange]);

  const submitMorning = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const saved = await decisionJournalService.recordMorningEntry(userId, date, {
        externalVerdict,
        externalNote: externalNote.trim() || undefined,
        sawEngineVerdictFirst: engineRevealed,
      });
      setEntry(saved);
      onEntryChange(saved);
      setEditingMorning(false);
    } catch (err) {
      console.error('Failed to save decision journal entry:', err);
      setError('Could not save your entry -- please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitEvening = async () => {
    if (!actualVerdict) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = await decisionJournalService.recordActualVerdict(userId, date, actualVerdict);
      setEntry(saved);
      onEntryChange(saved);
    } catch (err) {
      console.error('Failed to save what actually happened:', err);
      setError('Could not save -- please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!loaded) {
    return (
      <div className="dashboard-card decision-journal-card">
        <div className="card-header"><h3>Decision Journal</h3></div>
      </div>
    );
  }

  const showMorningForm = !entry || editingMorning;
  // Whichever order the athlete chooses, this reflects it -- it is never asked.
  const engineVerdictVisible = engineRevealed || !!entry;

  return (
    <div className="dashboard-card decision-journal-card">
      <div className="card-header">
        <h3>Decision Journal</h3>
        {entry && <span className="status-badge success">Recorded</span>}
      </div>
      <p className="journal-subtitle">What did your own plan say today?</p>

      {error && <p className="journal-error">{error}</p>}

      {showMorningForm ? (
        <div className="journal-form">
          <div className="form-group">
            <label>Today's verdict</label>
            <select
              className="select-input"
              value={externalVerdict}
              onChange={(e) => setExternalVerdict(e.target.value as ShadowVerdict)}
            >
              {SHADOW_VERDICTS.map((verdict) => (
                <option key={verdict} value={verdict}>{VERDICT_LABELS[verdict]}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Notes (optional, your own words)</label>
            <input
              type="text"
              className="text-input"
              value={externalNote}
              onChange={(e) => setExternalNote(e.target.value)}
              placeholder="e.g. said take it easy, HRV was low"
            />
          </div>
          <div className="journal-form-actions">
            {entry && (
              <button type="button" className="journal-btn secondary" disabled={submitting} onClick={() => setEditingMorning(false)}>
                Cancel
              </button>
            )}
            <button type="button" className="journal-btn primary" disabled={submitting} onClick={submitMorning}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="journal-recorded">
          <p className="journal-recorded-verdict">
            <strong>{VERDICT_LABELS[entry.externalVerdict]}</strong>
            {entry.externalNote ? ` — ${entry.externalNote}` : ''}
          </p>
          <p className="journal-anchoring">
            {entry.sawEngineVerdictFirst
              ? "Recorded after seeing today's recommendation"
              : "Recorded before seeing today's recommendation"}
          </p>
          <button type="button" className="journal-btn secondary" disabled={submitting} onClick={() => setEditingMorning(true)}>
            Edit
          </button>
        </div>
      )}

      {engineVerdict !== null && (
        <div className="journal-engine-verdict">
          {engineVerdictVisible ? (
            <p>Engine said: <strong>{VERDICT_LABELS[engineVerdict]}</strong></p>
          ) : (
            <p className="journal-hidden">Engine verdict hidden until you record your own or reveal it above.</p>
          )}
        </div>
      )}

      {entry && (
        <div className="journal-evening">
          <label>What actually happened?</label>
          <div className="journal-evening-row">
            <select
              className="select-input"
              value={actualVerdict}
              onChange={(e) => setActualVerdict(e.target.value as ShadowVerdict | '')}
            >
              <option value="">Not recorded yet</option>
              {SHADOW_VERDICTS.map((verdict) => (
                <option key={verdict} value={verdict}>{VERDICT_LABELS[verdict]}</option>
              ))}
            </select>
            <button type="button" className="journal-btn primary" disabled={submitting || !actualVerdict} onClick={submitEvening}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
