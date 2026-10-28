import React, { useEffect, useRef, useState } from 'react';

interface PlacementOverlayRecoveryCardProps {
  /** Replaces the unreadable overlay with the plan's own dates. Rejects when the save fails. */
  onReset: () => Promise<void>;
  /** True while reschedule controls are suppressed (for example clinical escalation). */
  disabled?: boolean;
}

type FocusTarget = 'cancel' | 'trigger' | null;

/**
 * #1172: the stored placement overlay could not be read, so the plan week shows its own
 * dates. The athlete can keep moving sessions or reset; both replace the unreadable moves.
 * Reset overwrites data that cannot be recovered, so it needs a deliberate confirm step.
 *
 * Focus never falls back to `body` (ui-ux.md §3.2): opening the confirm step focuses Cancel,
 * the safe default; Cancel or a failed reset returns focus to the Reset moves trigger. While
 * the reset is pending, the buttons stay focusable with `aria-disabled` and ignore activation.
 */
export const PlacementOverlayRecoveryCard: React.FC<PlacementOverlayRecoveryCardProps> = ({ onReset, disabled = false }) => {
  const [confirming, setConfirming] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<FocusTarget>(null);

  // Runs after each commit, once the button that should receive focus is mounted.
  useEffect(() => {
    const target = focusTarget.current === 'cancel' ? cancelRef.current
      : focusTarget.current === 'trigger' ? triggerRef.current : null;
    focusTarget.current = null;
    target?.focus();
  });

  const openConfirm = () => {
    focusTarget.current = 'cancel';
    setError(null);
    setConfirming(true);
  };

  const cancel = () => {
    if (resetting) return;
    focusTarget.current = 'trigger';
    setConfirming(false);
  };

  const confirmReset = async () => {
    if (resetting) return;
    setResetting(true);
    setError(null);
    try {
      await onReset();
      setConfirming(false);
    } catch {
      setError('Moves could not be reset. Check your connection and try again.');
      focusTarget.current = 'trigger';
      setConfirming(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="plan-unavailable-card plan-overlay-recovery-card">
      <h3><span aria-hidden="true">⚠️ </span>Earlier moves could not be read</h3>
      <p className="plan-unavailable-message" role="status">
        Sessions are shown on the plan&apos;s own dates. Saving a move or resetting replaces the unreadable moves.
      </p>
      {confirming ? (
        <div className="plan-unavailable-actions" role="group" aria-label="Confirm reset of moves">
          <p className="plan-unavailable-message">
            Reset all moves for this plan? The unreadable moves cannot be recovered.
          </p>
          <button type="button" className="plan-retry-btn plan-reset-confirm-btn" onClick={confirmReset} aria-disabled={resetting}>
            {resetting ? 'Resetting moves…' : 'Reset moves'}
          </button>
          <button type="button" ref={cancelRef} className="plan-retry-btn" onClick={cancel} aria-disabled={resetting}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="plan-unavailable-actions">
          <button type="button" ref={triggerRef} className="plan-retry-btn" onClick={openConfirm} disabled={disabled}>
            Reset moves
          </button>
        </div>
      )}
      {error && <p className="plan-error-message" role="alert">{error}</p>}
    </div>
  );
};
