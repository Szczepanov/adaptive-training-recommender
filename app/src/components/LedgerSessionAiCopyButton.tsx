import { useState } from 'react';
import { sessionResponseService } from '../services/sessionResponseService';
import type { SessionExecution } from '../sessions/models';
import { getCompletedWorkoutsInRange } from '../training-occurrence/activitiesReadModelService';
import { addDaysToLocalDateString } from '../utils/localDate';
import { buildWorkoutAiCopy } from './completedWorkoutCopy';
import { findCompletedWorkoutForExecution } from './session/postCompletionAiCopy';

type CopyState = 'idle' | 'busy' | 'copied' | 'not_ready' | 'error';

const NOT_READY = 'Not ready yet — it will be available in History once the session is saved.';

interface Props {
  userId: string;
  execution: Pick<SessionExecution, 'executionId' | 'date'>;
}

/** Copies the Markdown session report (the History "Copy for AI" payload) for a just-completed session. */
export function LedgerSessionAiCopyButton({ userId, execution }: Props) {
  const [state, setState] = useState<CopyState>('idle');

  const copy = async () => {
    setState('busy');
    try {
      const views = await getCompletedWorkoutsInRange(userId, execution.date, addDaysToLocalDateString(execution.date, 1));
      const view = findCompletedWorkoutForExecution(views, execution.executionId);
      if (!view) {
        setState('not_ready');
        return;
      }
      const text = await buildWorkoutAiCopy(view, new Date().toISOString(), id =>
        sessionResponseService.getResponsesForSource(userId, { kind: 'execution', id }));
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState(curr => (curr === 'copied' ? 'idle' : curr)), 2000);
    } catch {
      setState('error');
    }
  };

  return (
    <>
      <button
        type="button"
        className="ledger-today-start-btn is-redo"
        disabled={state === 'busy'}
        onClick={() => { void copy(); }}
        title="Copy a Markdown session report to paste into an AI assistant"
      >
        {state === 'copied' ? '✓ Copied for AI' : 'Copy session for AI'}
      </button>
      {state === 'not_ready' && <span role="status" className="ledger-today-meta">{NOT_READY}</span>}
      {state === 'error' && <span role="status" className="ledger-today-error">Could not copy the session report. Try again.</span>}
    </>
  );
}
