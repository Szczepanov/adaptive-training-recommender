import { useState } from 'react';
import { sessionResponseService } from '../services/sessionResponseService';
import type { SessionExecution } from '../sessions/models';
import { getCompletedWorkoutsInRange } from '../training-occurrence/activitiesReadModelService';
import { addDaysToLocalDateString } from '../utils/localDate';
import { copyDeferredText } from '../utils/copyDeferredText';
import { loadLedgerSessionAiCopyText, WorkoutNotReadyError } from './ledgerSessionAiCopyText';

type CopyState = 'idle' | 'busy' | 'copied' | 'not_ready' | 'error';

const NOT_READY = 'Not ready yet — it will be available in History once the session is saved.';

interface Props {
  userId: string;
  execution: Pick<SessionExecution, 'executionId' | 'date'>;
  /** Session title, used for the accessible name. */
  title: string;
}

/** Copies the Markdown session report (the History "Copy for AI" payload) for a just-completed session. */
export function LedgerSessionAiCopyButton({ userId, execution, title }: Props) {
  const [state, setState] = useState<CopyState>('idle');

  const copy = async () => {
    setState('busy');
    // The text promise is created and handed to the clipboard before any await, so the click's
    // user activation survives the Firestore reads (WebKit drops it otherwise).
    const text = loadLedgerSessionAiCopyText(
      execution.executionId,
      () => getCompletedWorkoutsInRange(userId, execution.date, addDaysToLocalDateString(execution.date, 1)),
      new Date().toISOString(),
      id => sessionResponseService.getResponsesForSource(userId, { kind: 'execution', id }),
    );
    try {
      await copyDeferredText(text);
      setState('copied');
      setTimeout(() => setState(curr => (curr === 'copied' ? 'idle' : curr)), 2000);
    } catch (err) {
      setState(err instanceof WorkoutNotReadyError ? 'not_ready' : 'error');
    }
  };

  return (
    <>
      <button
        type="button"
        className="ledger-today-start-btn is-redo"
        disabled={state === 'busy'}
        onClick={() => { void copy(); }}
        aria-label={`Copy ${title} for AI`}
        title="Copy a Markdown session report to paste into an AI assistant"
      >
        {state === 'copied' ? '✓ Copied for AI' : 'Copy session for AI'}
      </button>
      {state === 'not_ready' && <span role="status" className="ledger-today-meta">{NOT_READY}</span>}
      {state === 'error' && <span role="status" className="ledger-today-error">Could not copy the session report. Try again.</span>}
    </>
  );
}
