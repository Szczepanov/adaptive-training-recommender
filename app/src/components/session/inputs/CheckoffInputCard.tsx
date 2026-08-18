import React, { useState } from 'react';
import type { SessionStep, CheckoffEntryPayload } from '../../../sessions/models';

interface CheckoffInputCardProps {
    step: SessionStep;
    onSubmit: (payload: CheckoffEntryPayload) => void;
}

export const CheckoffInputCard: React.FC<CheckoffInputCardProps> = ({
    step,
    onSubmit,
}) => {
    const [roundIndex, setRoundIndex] = useState<number>(1);

    const handleCheckoff = () => {
        onSubmit({
            kind: 'checkoff',
            roundIndex,
            completed: true,
        });
        setRoundIndex(prev => prev + 1);
    };

    return (
        <div className="checkoff-input-card">
            <p className="checkoff-instructions">
                {step.notes || 'Mark this step / round as completed when finished.'}
            </p>
            <button
                type="button"
                className="log-set-btn checkoff-btn"
                onClick={handleCheckoff}
            >
                ✓ Complete Step (Round {roundIndex})
            </button>
        </div>
    );
};
