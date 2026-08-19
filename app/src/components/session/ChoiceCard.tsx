import React, { useState } from 'react';
import type { SessionChoice } from '../../sessions/models';
import './ChoiceCard.css';

interface ChoiceCardProps {
    choice: SessionChoice;
    /** `SessionOption.id`s that must not be offered as selectable right now. */
    ineligibleOptionIds: ReadonlySet<string>;
    onSelect: (optionId: string, reason?: string) => Promise<void>;
}

/**
 * Presents an authored branch point (ADR-0023 D-MCHOICE) and records the athlete's answer.
 * Nothing here evaluates automatically -- every action only fires because this component
 * called `onSelect` in response to a tap.
 */
export const ChoiceCard: React.FC<ChoiceCardProps> = ({ choice, ineligibleOptionIds, onSelect }) => {
    const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handlePick = (optionId: string) => {
        setPendingOptionId(optionId);
        setReason('');
    };

    const handleConfirm = async () => {
        if (!pendingOptionId) return;
        setSubmitting(true);
        try {
            await onSelect(pendingOptionId, reason.trim().length > 0 ? reason.trim() : undefined);
        } finally {
            setSubmitting(false);
            setPendingOptionId(null);
            setReason('');
        }
    };

    return (
        <div className="choice-card" role="group" aria-label="Athlete choice">
            <p className="choice-trigger">{choice.trigger.description}</p>
            <div className="choice-options">
                {choice.options.map(option => {
                    const ineligible = ineligibleOptionIds.has(option.id);
                    return (
                        <button
                            key={option.id}
                            type="button"
                            className={`choice-option-btn ${pendingOptionId === option.id ? 'selected' : ''}`}
                            disabled={ineligible || submitting}
                            title={ineligible ? 'Not available under a current restriction' : undefined}
                            onClick={() => handlePick(option.id)}
                        >
                            {option.label}
                            {ineligible && <span className="choice-option-restricted"> — restricted</span>}
                        </button>
                    );
                })}
            </div>
            {pendingOptionId && (
                <div className="choice-reason-row">
                    <input
                        type="text"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="Optional reason"
                        className="choice-reason-input"
                        aria-label="Optional reason for this choice"
                    />
                    <button type="button" className="choice-confirm-btn" disabled={submitting} onClick={handleConfirm}>
                        {submitting ? 'Recording…' : 'Confirm'}
                    </button>
                    <button type="button" className="choice-cancel-btn" disabled={submitting} onClick={() => setPendingOptionId(null)}>
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
};
