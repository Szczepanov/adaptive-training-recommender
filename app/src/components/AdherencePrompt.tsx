import { useState, memo, useEffect, useCallback } from 'react';
import { recommendationService } from '../services/recommendationService';
import type { DailyRecommendation } from '../engine/models';
import { usabilityMetrics } from '../utils/usabilityMetrics';
import './AdherencePrompt.css';

export type AdherenceAnswer = Parameters<typeof recommendationService.recordAdherence>[2];

interface AdherencePromptProps {
  userId: string;
  date: string; // the date the recommendation being answered for was generated
  recommendation: DailyRecommendation;
  /** Called once an answer has been recorded, so the parent can hide this prompt, refresh
   *  adherence stats, and (Phase 9.0.3) sync the decision journal's `actualVerdict` when
   *  the athlete followed the plan as given. */
  onResolved: (answer: AdherenceAnswer) => void;
}

const MODALITY_OPTIONS = ['Running', 'Cycling', 'Strength', 'Mobility', 'Field', 'Cross Training', 'Other'];

export const AdherencePrompt = memo(function AdherencePrompt({ userId, date, recommendation, onResolved }: AdherencePromptProps) {
  const [step, setStep] = useState<'initial' | 'details'>('initial');
  const [rpe, setRpe] = useState<number>(7);
  const [actualModality, setActualModality] = useState('');
  const [actualDurationMin, setActualDurationMin] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (answer: AdherenceAnswer) => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await recommendationService.recordAdherence(userId, date, answer);
      if (!result) {
        setError('Could not save your answer -- please try again.');
        return;
      }
      usabilityMetrics.recordCompletionReport(userId, date, answer.followed === true, answer.actualModality);
      onResolved(answer);
    } finally {
      setSubmitting(false);
    }
  }, [userId, date, onResolved]);

  const handleFollowed = useCallback(() => submit({ followed: true, notes: `RPE ${rpe}/10` }), [submit, rpe]);
  const handleSkipped = useCallback(() => submit({ followed: false, skipped: true }), [submit]);
  const handleDidSomethingElseSubmit = useCallback(() => submit({
    followed: false,
    skipped: false,
    actualModality: actualModality || null,
    actualDurationMin: actualDurationMin ? Number(actualDurationMin) : null,
    notes: notes ? `${notes} · RPE ${rpe}/10` : `RPE ${rpe}/10`,
  }), [submit, actualModality, actualDurationMin, notes, rpe]);

  // Keyboard shortcut listener
  useEffect(() => {
    if (step !== 'initial') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === '1') {
        void handleFollowed();
      } else if (e.key === '2') {
        setStep('details');
      } else if (e.key === '3') {
        void handleSkipped();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, handleFollowed, handleSkipped]);

  return (
    <section className="dashboard-card adherence-prompt" aria-label="Completed Training Report">
      <div className="card-header">
        <h3>Did you complete yesterday&apos;s workout?</h3>
        <span className="status-badge pending">{date}</span>
      </div>

      <p className="adherence-recommended">
        Scheduled: <strong>{recommendation.templateTitle}</strong> ({recommendation.category})
      </p>

      {error && <p className="adherence-error">{error}</p>}

      {step === 'initial' ? (
        <div className="adherence-quick-flow">
          <div className="rpe-quick-slider">
            <div className="rpe-label-row">
              <label htmlFor="adherence-rpe">How hard did it feel? (RPE)</label>
              <span className="rpe-val-pill">{rpe}/10</span>
            </div>
            <input
              id="adherence-rpe"
              type="range"
              min="1"
              max="10"
              value={rpe}
              onChange={(e) => setRpe(Number(e.target.value))}
              className="range-input"
              aria-label="Rate perceived exertion from 1 to 10"
            />
          </div>

          <div className="adherence-buttons">
            <button
              type="button"
              className="adherence-btn followed"
              disabled={submitting}
              onClick={handleFollowed}
              aria-label="Completed session as prescribed (Keyboard shortcut 1)"
            >
              ✅ [1] Followed as prescribed
            </button>
            <button
              type="button"
              className="adherence-btn modified"
              disabled={submitting}
              onClick={() => setStep('details')}
              aria-label="Modified session or did something else (Keyboard shortcut 2)"
            >
              🔄 [2] Did something else
            </button>
            <button
              type="button"
              className="adherence-btn skipped"
              disabled={submitting}
              onClick={handleSkipped}
              aria-label="Skipped workout or rested (Keyboard shortcut 3)"
            >
              ⏭️ [3] Rested / skipped
            </button>
          </div>
        </div>
      ) : (
        <div className="adherence-details-form">
          <div className="form-group">
            <label htmlFor="actual-modality">What did you actually do?</label>
            <select
              id="actual-modality"
              value={actualModality}
              onChange={(e) => setActualModality(e.target.value)}
              className="select-input"
            >
              <option value="">Select modality</option>
              {MODALITY_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="actual-duration">Duration (minutes)</label>
            <input
              id="actual-duration"
              type="number"
              min="0"
              max="600"
              value={actualDurationMin}
              onChange={(e) => setActualDurationMin(e.target.value)}
              className="number-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="actual-notes">Notes (optional)</label>
            <input
              id="actual-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. felt good, swapped for upper body"
              className="text-input"
            />
          </div>
          <div className="adherence-details-actions">
            <button
              type="button"
              className="adherence-btn secondary"
              disabled={submitting}
              onClick={() => setStep('initial')}
            >
              Back
            </button>
            <button
              type="button"
              className="adherence-btn modified"
              disabled={submitting}
              onClick={handleDidSomethingElseSubmit}
            >
              Save Report ✓
            </button>
          </div>
        </div>
      )}
    </section>
  );
});
