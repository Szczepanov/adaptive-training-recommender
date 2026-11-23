import { useEffect, useId, useRef, useState } from 'react';
import type { DEvalRollbackUsage } from '../../derived/eval/dEvalReadout';
import type { DEvalReadoutOutput } from '../../services/dEvalReadoutService';
import { downloadDEvalResultFile } from '../../utils/contextBriefExport';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate';

interface DEvalReadoutSectionProps {
  userId: string;
  defaultAsOfDate?: string;
}

function overallLabel(result: DEvalReadoutOutput['result']): string {
  switch (result.overall) {
    case 'GO':
      return 'GO';
    case 'NO_GO':
      return 'NO-GO';
    case 'EXTEND':
      return 'EXTEND';
    case 'PENDING':
      return result.c2.pendingDueDates.length > 0
        ? `PENDING (C2 due ${result.c2.pendingDueDates.join(', ')})`
        : 'PENDING';
  }
}

export function DEvalReadoutSection({ userId, defaultAsOfDate }: DEvalReadoutSectionProps) {
  const initialAsOf = defaultAsOfDate ?? getLocalDateString();
  const initialStart = addDaysToLocalDateString(initialAsOf, -27);
  const [blockStartDate, setBlockStartDate] = useState(initialStart);
  const [blockEndDate, setBlockEndDate] = useState(addDaysToLocalDateString(initialStart, 27));
  const [endEdited, setEndEdited] = useState(false);
  const [asOfDate, setAsOfDate] = useState(initialAsOf);
  const [rollbackState, setRollbackState] = useState<DEvalRollbackUsage>('unused');
  const [rollbackAtDate, setRollbackAtDate] = useState('');
  const [rollbackReason, setRollbackReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [output, setOutput] = useState<DEvalReadoutOutput | null>(null);

  const mounted = useRef(true);
  const pending = useRef(false);
  const baseId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function handleStartChange(nextStart: string) {
    setBlockStartDate(nextStart);
    if (!endEdited && /^\d{4}-\d{2}-\d{2}$/.test(nextStart)) {
      const shifted = addDaysToLocalDateString(nextStart, 27);
      if (/^\d{4}-\d{2}-\d{2}$/.test(shifted)) {
        setBlockEndDate(shifted);
      }
    }
  }

  function handleEndChange(nextEnd: string) {
    setEndEdited(true);
    setBlockEndDate(nextEnd);
  }

  async function handleRun() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { dEvalReadoutService } = await import('../../services/dEvalReadoutService');
      if (!mounted.current) return;
      const result = await dEvalReadoutService.run(userId, {
        blockStartDate,
        blockEndDate,
        asOfDate,
        rollbackState,
        rollbackAtDate: rollbackState === 'unused' ? null : (rollbackAtDate.trim() || null),
        rollbackReason: rollbackState === 'unused' ? null : (rollbackReason.trim() || null),
      });
      if (mounted.current) {
        setOutput(result);
      }
    } catch (err: unknown) {
      if (mounted.current) {
        setError(err instanceof Error && err.message ? err.message : 'D-EVAL readout failed. Check dates and retry.');
      }
    } finally {
      if (mounted.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  async function handleCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output.markdown);
      if (mounted.current) setCopied(true);
    } catch {
      if (mounted.current) setError('Could not copy Markdown to clipboard.');
    }
  }

  function handleDownload() {
    if (!output) return;
    downloadDEvalResultFile(output.result.asOfDate, output.markdown);
  }

  const startId = `${baseId}-start`;
  const endId = `${baseId}-end`;
  const asOfId = `${baseId}-asof`;
  const rollbackId = `${baseId}-rollback`;
  const rollbackDateId = `${baseId}-rollback-date`;
  const rollbackReasonId = `${baseId}-rollback-reason`;

  return (
    <details className="deval-readout-disclosure">
      <summary className="deval-readout-summary">
        ADR-0052 D-EVAL Block Readout (Read-only)
      </summary>
      <div className="deval-readout-body">
        <p className="brief-intro">
          Evaluates criteria C1–C4 over a 28-day qualifying block as of the selected Warsaw date. Strictly read-only.
        </p>

        <div className="deval-readout-fields">
          <div className="deval-readout-field">
            <label htmlFor={startId}>Block start date</label>
            <input
              id={startId}
              type="date"
              value={blockStartDate}
              onChange={(e) => handleStartChange(e.target.value)}
            />
          </div>
          <div className="deval-readout-field">
            <label htmlFor={endId}>Block end date</label>
            <input
              id={endId}
              type="date"
              value={blockEndDate}
              onChange={(e) => handleEndChange(e.target.value)}
            />
          </div>
          <div className="deval-readout-field">
            <label htmlFor={asOfId}>As-of date</label>
            <input
              id={asOfId}
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </div>
          <div className="deval-readout-field">
            <label htmlFor={rollbackId}>Rollback usage (C4)</label>
            <select
              id={rollbackId}
              value={rollbackState}
              onChange={(e) => setRollbackState(e.target.value as DEvalRollbackUsage)}
            >
              <option value="unused">Unused (setting off)</option>
              <option value="non_safety">Used (non-safety reason)</option>
              <option value="safety">Used (safety reason)</option>
            </select>
          </div>
          {rollbackState !== 'unused' && (
            <>
              <div className="deval-readout-field">
                <label htmlFor={rollbackDateId}>Rollback date</label>
                <input
                  id={rollbackDateId}
                  type="date"
                  value={rollbackAtDate}
                  onChange={(e) => setRollbackAtDate(e.target.value)}
                />
              </div>
              <div className="deval-readout-field">
                <label htmlFor={rollbackReasonId}>Rollback reason</label>
                <input
                  id={rollbackReasonId}
                  type="text"
                  value={rollbackReason}
                  placeholder="Optional reason"
                  onChange={(e) => setRollbackReason(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="brief-actions">
          <button type="button" className="brief-copy" disabled={busy} onClick={handleRun}>
            {busy ? 'Running readout…' : 'Run Readout'}
          </button>
          {output && (
            <>
              <button type="button" className="brief-copy" onClick={handleCopy}>
                {copied ? 'Copied Markdown' : 'Copy Markdown'}
              </button>
              <button type="button" className="brief-copy" onClick={handleDownload}>
                Download Markdown
              </button>
            </>
          )}
        </div>

        {error && <p className="data-state-notice" role="status">{error}</p>}

        {output && (
          <div className="deval-readout-result">
            <div className="deval-verdict-row">
              <span className={`deval-verdict-badge deval-verdict-${output.result.overall.toLowerCase()}`}>
                Overall: {overallLabel(output.result)}
              </span>
              <span className="brief-range">
                {output.result.blockStartDate} → {output.result.blockEndDate} ({output.result.blockDays}d) · as of {output.result.asOfDate}
              </span>
            </div>

            <ul className="deval-criteria-list">
              <li>
                <strong>C1 Adherence:</strong> {output.result.c1.status}
                {' '}({output.result.c1.block.completed + output.result.c1.block.moved}/{output.result.c1.block.eligible} eligible,{' '}
                {output.result.c1.block.unknown} unknown)
              </li>
              <li>
                <strong>C2 Benchmarks:</strong> {output.result.c2.status}
                {output.result.c2.pendingDueDates.length > 0 && ` (pending due ${output.result.c2.pendingDueDates.join(', ')})`}
              </li>
              <li>
                <strong>C3 Flagged Days:</strong> {output.result.c3.status}
                {' '}(adverse={output.result.c3.adverseOutcomes.length}, blind dates={output.result.c3.blindFlagDates.length})
              </li>
              <li>
                <strong>C4 Rollback:</strong> {output.result.c4.status} ({output.result.c4.rollbackState})
              </li>
            </ul>

            {output.result.knownLimits.length > 0 && (
              <div className="deval-known-limits">
                <strong>Known limits & notices:</strong>
                <ul>
                  {output.result.knownLimits.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              </div>
            )}

            <textarea
              className="brief-text"
              readOnly
              aria-label="D-EVAL result Markdown"
              value={output.markdown}
              rows={14}
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </details>
  );
}
