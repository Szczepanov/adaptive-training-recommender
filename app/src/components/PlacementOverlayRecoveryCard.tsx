import React, { useState } from 'react';

interface PlacementOverlayRecoveryCardProps {
  /** Replaces the unreadable overlay with the plan's own dates. Rejects when the save fails. */
  onReset: () => Promise<void>;
  /** True while reschedule controls are suppressed (for example clinical escalation). */
  disabled?: boolean;
}

/**
 * #1172: the stored placement overlay could not be read, so the plan week shows its own
 * dates. The athlete can keep moving sessions or reset; both replace the unreadable moves.
 * Reset overwrites data that cannot be recovered, so it needs a deliberate confirm step.
 */
export const PlacementOverlayRecoveryCard: React.FC<PlacementOverlayRecoveryCardProps> = ({ onReset, disabled = false }) => {
  const [confirming, setConfirming] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const confirmReset = async () => {
    setResetting(true);
    setError(null);
    try {
      await onReset();
      setConfirming(false);
    } catch {
      setError('Moves could not be reset. Check your connection and try again.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="plan-unavailable-card plan-overlay-recovery-card" role="status">
      <h3><span aria-hidden="true">⚠️ </span>Earlier moves could not be read</h3>
      <p className="plan-unavailable-message">
        Sessions are shown on the plan&apos;s own dates. Saving a move or resetting replaces the unreadable moves.
      </p>
      {confirming ? (
        <div className="plan-unavailable-actions" role="group" aria-label="Confirm reset of moves">
          <p className="plan-unavailable-message">
            Reset all moves for this plan? The unreadable moves cannot be recovered.
          </p>
          <button type="button" className="plan-retry-btn plan-reset-confirm-btn" onClick={confirmReset} disabled={resetting}>
            {resetting ? 'Resetting moves…' : 'Reset moves'}
          </button>
          <button type="button" className="plan-retry-btn" onClick={() => { setConfirming(false); setError(null); }} disabled={resetting}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="plan-unavailable-actions">
          <button type="button" className="plan-retry-btn" onClick={() => setConfirming(true)} disabled={disabled}>
            Reset moves
          </button>
        </div>
      )}
      {error && <p className="plan-error-message" role="alert">{error}</p>}
    </div>
  );
};
