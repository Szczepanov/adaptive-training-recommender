import React, { useState } from 'react';
import { recordLaterDayFollowup, type LaterDayFollowupTarget } from './laterDayFollowupAction';
import './LaterDayFollowupCard.css';

export type { LaterDayFollowupTarget };

interface LaterDayFollowupCardProps {
    userId: string;
    target: LaterDayFollowupTarget;
    onAnswered: () => void;
    onDismiss: () => void;
}

/**
 * M5.2: a same-day, whole-session follow-up -- distinct from the next-morning per-region
 * tissue prompt (`DailyCheckin.tsx`), which the check-in model has no same-day field for.
 * Answering records a session-level `SessionResponse` (M5.1: linkage plus non-tissue facts
 * only, never a tissue value); "Not now" dismisses without writing anything, so a skipped
 * prompt stays unknown rather than defaulting to "felt normal".
 */
export const LaterDayFollowupCard: React.FC<LaterDayFollowupCardProps> = ({ userId, target, onAnswered, onDismiss }) => {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const answer = async (unexpectedFatigue: boolean) => {
        setSaving(true);
        setError(null);
        try {
            await recordLaterDayFollowup(userId, target, unexpectedFatigue);
            onAnswered();
        } catch {
            setError('Could not save this. You can answer again later.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <aside className="later-day-followup-card" aria-label="Later-day session follow-up">
            <div>
                <strong>How does {target.title} feel now?</strong>
                <span>A few hours on, not right after finishing.</span>
                {error && <span className="later-day-followup-error" role="alert">{error}</span>}
            </div>
            <div className="later-day-followup-actions">
                <button type="button" disabled={saving} onClick={() => answer(false)}>Feeling normal</button>
                <button type="button" disabled={saving} onClick={() => answer(true)}>Unexpectedly fatigued</button>
                <button type="button" className="later-day-followup-dismiss" disabled={saving} onClick={onDismiss}>Not now</button>
            </div>
        </aside>
    );
};
