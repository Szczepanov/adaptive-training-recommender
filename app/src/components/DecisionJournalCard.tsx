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
  /** Whether the athlete has already seen today's recommendation in the current Home
   *  instance. The card additionally remembers that observed reveal across same-day
   *  reloads so a refresh cannot manufacture a "blind" sample. */
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

const REVEAL_MARKER_PREFIX = 'adaptive-training:decision-journal:engine-revealed';

function revealMarkerKey(userId: string, date: string): string {
  return `${REVEAL_MARKER_PREFIX}:${userId}:${date}`;
}

function hasPersistedReveal(userId: string, date: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(revealMarkerKey(userId, date)) === '1';
  } catch {
    // Storage can be disabled. The current-page observed flag still works; failure to
    // persist must never block the journal itself.
    return false;
  }
}

function persistReveal(userId: string, date: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(revealMarkerKey(userId, date), '1');
  } catch {
    // Evidence capture remains usable when browser storage is unavailable. The row can
    // still be anchored correctly for the current page instance through engineRevealed.
  }
}

/**
 * Phase 9.0.3: records today's shadow-mode entry -- what the athlete's own (non-app)
 * planner said, and later what actually happened -- so it can be compared against the
 * engine's verdict. Deliberately has no path back into the engine: `externalArchitecture.test.ts`
 * (9.0.6) asserts no selection or safety module can import `decisionJournalService.ts`.
 *
 * The morning observation is create-only. After it is saved, Home is allowed to reveal the
 * engine recommendation, so permitting a later edit would make an anchored rewrite look
 * like an unanchored observation. Only the evening actual outcome remains editable.
 */
export const DecisionJournalCard = memo(function DecisionJournalCard({
  userId, date, engineVerdict, engineRevealed, onEntryChange,
}: DecisionJournalCardProps) {
  const [entry, setEntry] = useState<DecisionJournalEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [externalVerdict, setExternalVerdict] = useState<ShadowVerdict>('proceed');
  const [externalNote, setExternalNote] = useState('');
  const [actualVerdict, setActualVerdict] = useState<ShadowVerdict | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readBlocked, setReadBlocked] = useState(false);

  useEffect(() => {
    if (engineRevealed) persistReveal(userId, date);
  }, [userId, date, engineRevealed]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setReadBlocked(false);
    setError(null);
    decisionJournalService.getEntryState(userId, date)
      .then(state => {
        if (cancelled) return;
        if (state.status === 'AVAILABLE') {
          setEntry(state.data);
          setExternalVerdict(state.data.externalVerdict);
          setExternalNote(state.data.externalNote ?? '');
          setActualVerdict(state.data.actualVerdict ?? '');
          onEntryChange(state.data);
          return;
        }
        setEntry(null);
        setExternalVerdict('proceed');
        setExternalNote('');
        setActualVerdict('');
        onEntryChange(null);
        if (state.status === 'INVALID') {
          setReadBlocked(true);
          setError('Today’s stored journal entry is invalid. Do not overwrite it; repair the stored evidence first.');
        } else if (state.status === 'UNAVAILABLE') {
          setReadBlocked(true);
          setError('Could not confirm whether today’s journal entry already exists. Please retry before recording.');
        }
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('Failed to load decision journal entry:', err);
        setReadBlocked(true);
        setError('Could not load today’s journal entry. Please retry before recording.');
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userId, date, onEntryChange]);

  const submitMorning = async () => {
    if (readBlocked) return;
    setSubmitting(true);
    setError(null);
    try {
      // Re-read the marker at the moment of submission rather than relying only on React
      // state. A same-day reload/navigation may have happened between the original reveal
      // and this form; once observed, anchoring can only move from false -> true.
      const sawEngineVerdictFirst = engineRevealed || hasPersistedReveal(userId, date);
      const saved = await decisionJournalService.recordMorningEntry(userId, date, {
        externalVerdict,
        externalNote: externalNote.trim() || undefined,
        sawEngineVerdictFirst,
      });
      setEntry(saved);
      onEntryChange(saved);
    } catch (err) {
      console.error('Failed to save decision journal entry:', err);
      setError(err instanceof Error ? err.message : 'Could not save your entry -- please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitEvening = async () => {
    if (!actualVerdict || readBlocked) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = await decisionJournalService.recordActualVerdict(userId, date, actualVerdict);
      setEntry(saved);
      onEntryChange(saved);
    } catch (err) {
      console.error('Failed to save what actually happened:', err);
      setError(err instanceof Error ? err.message : 'Could not save -- please try again.');
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

  // Whichever order the athlete chooses, this reflects it -- it is never asked. A prior
  // same-day reveal remains a reveal even after navigation/reload.
  const engineWasSeen = engineRevealed || hasPersistedReveal(userId, date);
  const engineVerdictVisible = engineWasSeen || !!entry;

  return (
    <div className="dashboard-card decision-journal-card">
      <div className="card-header">
        <h3>Decision Journal</h3>
        {entry && <span className="status-badge success">Recorded</span>}
      </div>
      <p className="journal-subtitle">What did your own plan say today?</p>

      {error && <p className="journal-error">{error}</p>}

      {!entry ? (
        <div className="journal-form">
          <div className="form-group">
            <label>Today's verdict</label>
            <select
              className="select-input"
              value={externalVerdict}
              disabled={readBlocked}
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
              disabled={readBlocked}
              onChange={(e) => setExternalNote(e.target.value)}
              maxLength={2000}
              placeholder="e.g. said take it easy, HRV was low"
            />
          </div>
          <div className="journal-form-actions">
            <button type="button" className="journal-btn primary" disabled={submitting || readBlocked} onClick={submitMorning}>
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
          <p className="journal-locked">Morning verdict locked after recording so the anchoring record cannot be rewritten.</p>
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
