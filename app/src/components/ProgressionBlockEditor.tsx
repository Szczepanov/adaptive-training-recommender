import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  validateIntentBlock,
  SUPPORTED_BLOCK_SPORTS,
  SUPPORTED_ADAPTATION_SCOPES,
  SUPPORTED_PLAN_COVERAGE_KEYS,
  SUPPORTED_OBJECTIVE_PRIORITIES,
  type BlockIntent,
  type ValidationIssue,
} from '../engine/blockIntent';
import {
  intentBlockService,
  IntentBlockValidationFailedError,
  MissingTrainingIntentProfileError,
  type IntentBlockHeader,
} from '../services/intentBlockService';
import { getLocalDateString } from '../utils/localDate';
import {
  defaultDraft,
  buildBlock,
  sportLabels,
  adaptationScopeLabels,
  coverageKeyLabels,
  priorityLabels,
} from './progressionBlockDraft';
import './ProgressionBlockEditor.css';

interface ProgressionBlockEditorProps {
  userId: string;
  /** Notifies the parent so a review panel elsewhere on the page can refresh its own list. */
  onBlockSaved?: () => void;
}

export function ProgressionBlockEditor({ userId, onBlockSaved }: ProgressionBlockEditorProps) {
  const today = getLocalDateString(new Date());
  const [draft, setDraft] = useState(defaultDraft(today));
  const [blocks, setBlocks] = useState<IntentBlockHeader[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const loadBlocks = useCallback(async () => {
    const idsState = await intentBlockService.listBlockIds(userId);
    if (idsState.status !== 'AVAILABLE') return;
    const headers = await Promise.all(idsState.data.map(id => intentBlockService.getHeaderState(userId, id)));
    setBlocks(headers.flatMap(state => state.status === 'AVAILABLE' ? [state.data] : []));
  }, [userId]);

  useEffect(() => { void loadBlocks(); }, [loadBlocks]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSavedMessage(null);

    const candidate = buildBlock(draft);
    const validation = validateIntentBlock(candidate);
    if (!validation.valid) {
      setIssues(validation.issues);
      return;
    }
    setIssues([]);
    setSaving(true);
    try {
      await intentBlockService.save(userId, candidate);
      setSavedMessage(`Saved "${candidate.title ?? candidate.id}".`);
      setDraft(defaultDraft(today));
      await loadBlocks();
      onBlockSaved?.();
    } catch (cause) {
      if (cause instanceof IntentBlockValidationFailedError) {
        setIssues([...cause.issues]);
      } else if (cause instanceof MissingTrainingIntentProfileError) {
        setError('Set up your training intent profile (priorities and weekly commitment) before authoring a progression block.');
      } else {
        console.error('Unable to save progression block', cause);
        setError('Unable to save this progression block. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="progression-block-editor-title" className="progression-block-editor">
      <h2 id="progression-block-editor-title">Progression Blocks</h2>
      <p className="section-intro">
        A block declares one objective&apos;s intent (develop or maintain) and, optionally, one bounded
        progression target the app can review. A block does not schedule or prescribe sessions by itself.
      </p>

      <form onSubmit={handleSubmit} className="progression-block-form">
        <h3>New progression block</h3>

        <label>Title (optional)
          <input type="text" value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} maxLength={120} />
        </label>

        <div className="form-row">
          <label>Start date
            <input type="date" value={draft.startDate} onChange={event => setDraft(current => ({ ...current, startDate: event.target.value }))} required />
          </label>
          <label>End date
            <input type="date" value={draft.endDate} onChange={event => setDraft(current => ({ ...current, endDate: event.target.value }))} required />
          </label>
        </div>

        <div className="form-row">
          <label>Sport
            <select value={draft.sport} onChange={event => setDraft(current => ({ ...current, sport: event.target.value as typeof draft.sport }))}>
              {SUPPORTED_BLOCK_SPORTS.map(sport => <option key={sport} value={sport}>{sportLabels[sport]}</option>)}
            </select>
          </label>
          <label>Adaptation focus
            <select value={draft.adaptationScope} onChange={event => setDraft(current => ({ ...current, adaptationScope: event.target.value as typeof draft.adaptationScope }))}>
              {SUPPORTED_ADAPTATION_SCOPES.map(scope => <option key={scope} value={scope}>{adaptationScopeLabels[scope]}</option>)}
            </select>
          </label>
          <label>Programming role
            <select value={draft.coverageKey} onChange={event => setDraft(current => ({ ...current, coverageKey: event.target.value as typeof draft.coverageKey }))}>
              {SUPPORTED_PLAN_COVERAGE_KEYS.map(key => <option key={key} value={key}>{coverageKeyLabels[key]}</option>)}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>Intent
            <select value={draft.intent} onChange={event => setDraft(current => ({ ...current, intent: event.target.value as BlockIntent }))}>
              <option value="develop">Develop</option>
              <option value="maintain">Maintain</option>
            </select>
          </label>
          <label>Priority
            <select value={draft.priority} onChange={event => setDraft(current => ({ ...current, priority: event.target.value as typeof draft.priority }))}>
              {SUPPORTED_OBJECTIVE_PRIORITIES.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend>Dose envelope (minutes per session)</legend>
          <div className="form-row">
            <label>Min<input type="number" min={0} value={draft.doseMin} onChange={event => setDraft(current => ({ ...current, doseMin: Number(event.target.value) }))} /></label>
            <label>Target<input type="number" min={0} value={draft.doseTarget} onChange={event => setDraft(current => ({ ...current, doseTarget: Number(event.target.value) }))} /></label>
            <label>Max<input type="number" min={0} value={draft.doseMax} onChange={event => setDraft(current => ({ ...current, doseMax: Number(event.target.value) }))} /></label>
          </div>
        </fieldset>

        <div className="form-row">
          <label>Exposures required before review
            <input type="number" min={1} value={draft.minCompletedExposures} onChange={event => setDraft(current => ({ ...current, minCompletedExposures: Number(event.target.value) }))} />
          </label>
          <label>Review every (days)
            <input type="number" min={1} value={draft.reviewCadenceDays} onChange={event => setDraft(current => ({ ...current, reviewCadenceDays: Number(event.target.value) }))} />
          </label>
          <label>First review date
            <input type="date" value={draft.nextReviewDate} onChange={event => setDraft(current => ({ ...current, nextReviewDate: event.target.value }))} required />
          </label>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={draft.trackProgression} onChange={event => setDraft(current => ({ ...current, trackProgression: event.target.checked }))} />
          {' '}Track a bounded progression target for this objective
        </label>

        {draft.trackProgression && (
          <fieldset>
            <legend>Progression target</legend>
            <p className="section-intro">
              Starts at the dose target above ({draft.doseTarget} min) and may only advance in fixed steps,
              up to the ceiling below, after a review you confirm.
            </p>
            <p className="section-intro">
              Qualifying progression evidence must come from completed sessions with an immutable prescription
              bound to this block&apos;s source revision. This manual form does not create those session prescriptions;
              without a compatible binding, reviews hold rather than guessing that performed work matched the target.
            </p>
            <div className="form-row">
              <label>Increment per step (min)
                <input type="number" min={1} value={draft.progressionIncrement} onChange={event => setDraft(current => ({ ...current, progressionIncrement: Number(event.target.value) }))} />
              </label>
              <label>Ceiling (min)
                <input type="number" min={draft.doseTarget} value={draft.progressionMax} onChange={event => setDraft(current => ({ ...current, progressionMax: Number(event.target.value) }))} />
              </label>
              <label>Reduction step if adverse (min)
                <input type="number" min={1} value={draft.reductionDecrement} onChange={event => setDraft(current => ({ ...current, reductionDecrement: Number(event.target.value) }))} />
              </label>
            </div>
            <div className="form-row">
              <label>Observation window (days)
                <input type="number" min={1} value={draft.observationWindowDays} onChange={event => setDraft(current => ({ ...current, observationWindowDays: Number(event.target.value) }))} />
              </label>
              <label>Required follow-up coverage (%)
                <input type="number" min={1} max={100} value={draft.requiredFollowUpCoveragePct} onChange={event => setDraft(current => ({ ...current, requiredFollowUpCoveragePct: Number(event.target.value) }))} />
              </label>
            </div>
          </fieldset>
        )}

        {issues.length > 0 && (
          <div role="alert" className="progression-block-issues">
            <strong>Fix the following before saving:</strong>
            <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
          </div>
        )}
        {error && <p role="alert" className="progression-block-error">{error}</p>}
        {savedMessage && <p role="status" className="progression-block-saved">{savedMessage}</p>}

        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save progression block'}</button>
      </form>

      {blocks.length > 0 && (
        <div className="progression-block-list">
          <h3>Existing blocks</h3>
          {blocks.map(header => (
            <div key={header.blockId} className="setting-row">
              <strong>{header.blockId}</strong> — revision {header.revision}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
