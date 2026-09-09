import { useCallback, useEffect, useState } from 'react';
import type { IntentBlock } from '../engine/blockIntent';
import { evaluateProgressionReview, type ProgressionReviewResult } from '../engine/progressionReview';
import { intentBlockService, type IntentBlockHeader } from '../services/intentBlockService';
import { assembleProgressionReviewInput } from '../services/progressionReviewInputService';
import {
  confirmProgressionRevision,
  ProgressionConfirmationError,
  type ConfirmProgressionRevisionResult,
} from '../services/progressionClaimService';
import { getLocalDateString } from '../utils/localDate';
import { deriveProposalId } from './progressionReviewPanelLogic';
import './ProgressionReviewPanel.css';

interface ProgressionReviewPanelProps {
  userId: string;
}

interface DueBlock {
  header: IntentBlockHeader;
  block: IntentBlock;
}

const ACTION_LABELS: Record<ProgressionReviewResult['action'], string> = {
  advance_proposal: 'Ready to advance',
  hold: 'Hold at current dose',
  reduce_proposal: 'Recommend reducing',
  redirect: 'Recommend redirecting to review',
};

export function ProgressionReviewPanel({ userId }: ProgressionReviewPanelProps) {
  const [dueBlocks, setDueBlocks] = useState<DueBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [result, setResult] = useState<ProgressionReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedActivation, setConfirmedActivation] = useState<ConfirmProgressionRevisionResult | null>(null);

  const today = getLocalDateString(new Date());

  const loadDueBlocks = useCallback(async () => {
    const idsState = await intentBlockService.listBlockIds(userId);
    if (idsState.status !== 'AVAILABLE') return;

    const due: DueBlock[] = [];
    for (const blockId of idsState.data) {
      const headerState = await intentBlockService.getHeaderState(userId, blockId);
      if (headerState.status !== 'AVAILABLE') continue;
      const revisionState = await intentBlockService.getRevisionState(userId, blockId, headerState.data.revision);
      if (revisionState.status !== 'AVAILABLE') continue;
      const block = revisionState.data.block;
      if (
        block.dateRange.startDate <= today
        && today <= block.dateRange.endDate
        && block.reviewSchedule.nextReviewDate <= today
      ) {
        due.push({ header: headerState.data, block });
      }
    }
    setDueBlocks(due);
  }, [userId, today]);

  useEffect(() => { void loadDueBlocks(); }, [loadDueBlocks]);

  const runReview = useCallback(async (blockId: string) => {
    setSelectedBlockId(blockId);
    setResult(null);
    setConfirmedActivation(null);
    setError(null);
    setLoading(true);
    try {
      const due = dueBlocks.find(item => item.header.blockId === blockId);
      if (!due) return;
      const input = await assembleProgressionReviewInput(userId, due.block, today);
      setResult(evaluateProgressionReview(input));
    } catch (cause) {
      console.error('Unable to run progression review', cause);
      setError('Unable to review this block right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [userId, today, dueBlocks]);

  const handleConfirm = useCallback(async () => {
    if (!selectedBlockId || !result?.proposedChange) return;
    const due = dueBlocks.find(item => item.header.blockId === selectedBlockId);
    if (!due) return;

    setConfirming(true);
    setError(null);
    try {
      const proposalId = deriveProposalId(due.header.revision, result.asOfDate, result.proposedChange);
      const confirmation = await confirmProgressionRevision(
        userId,
        selectedBlockId,
        proposalId,
        due.header.revision,
        result.proposedChange,
        result.asOfDate,
      );
      setConfirmedActivation(confirmation);
      await loadDueBlocks();
    } catch (cause) {
      if (cause instanceof ProgressionConfirmationError) {
        setError(cause.athleteMessage);
      } else {
        console.error('Unable to confirm progression revision', cause);
        setError('Unable to confirm this change. Please try again.');
      }
    } finally {
      setConfirming(false);
    }
  }, [userId, selectedBlockId, result, dueBlocks, loadDueBlocks]);

  return (
    <section aria-labelledby="progression-review-title" className="progression-review-panel">
      <h2 id="progression-review-title">Progression Review</h2>
      <p className="section-intro">
        Blocks with a review due are listed below. Reviewing checks canonical completed work,
        pinned execution-prescription identity, follow-up outcomes and active constraints against
        the block&apos;s bounded progression target. Nothing changes until you confirm it.
      </p>

      {dueBlocks.length === 0 ? (
        <p><small>No progression blocks are due for review right now.</small></p>
      ) : (
        <ul className="progression-review-due-list">
          {dueBlocks.map(({ header, block }) => (
            <li key={header.blockId}>
              <button type="button" onClick={() => void runReview(header.blockId)} disabled={loading}>
                {block.title ?? header.blockId}
              </button>
              <small> — due {block.reviewSchedule.nextReviewDate}</small>
            </li>
          ))}
        </ul>
      )}

      {loading && <p role="status">Reviewing…</p>}
      {error && <p role="alert" className="progression-review-error">{error}</p>}

      {result && (
        <div className="progression-review-result">
          <h3>{ACTION_LABELS[result.action]}</h3>
          {result.reasons.length > 0 && (
            <ul className="progression-review-reasons">
              {result.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
            </ul>
          )}

          <dl className="progression-review-audit">
            <dt>Exposures observed</dt><dd>{result.evidenceAudit.exposuresObserved} / {result.evidenceAudit.exposuresRequired}</dd>
            <dt>Follow-up coverage</dt><dd>{result.evidenceAudit.followUpCoveragePct}% (needs {result.evidenceAudit.requiredFollowUpCoveragePct}%)</dd>
            {result.evidenceAudit.adverseResponseCount > 0 && <><dt>Adverse responses</dt><dd>{result.evidenceAudit.adverseResponseCount}</dd></>}
          </dl>

          {result.proposedChange && (
            <div className="progression-review-proposal">
              <p>
                Proposed change: <strong>{result.proposedChange.previousValue}</strong> → <strong>{result.proposedChange.proposedValue}</strong> {result.proposedChange.unit}
              </p>
              {confirmedActivation ? (
                <p role="status" className="progression-review-confirmed">
                  {confirmedActivation.created ? 'Confirmed.' : 'Already confirmed earlier.'} Authored block revision {confirmedActivation.activation.activationRevisionId}.
                </p>
              ) : (
                <button type="button" onClick={() => void handleConfirm()} disabled={confirming}>
                  {confirming ? 'Confirming…' : 'Confirm this change'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
