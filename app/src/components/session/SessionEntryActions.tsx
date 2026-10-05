import React from 'react';
import type { SessionEntry } from '../../sessions/models';

interface SessionEntryActionsProps {
    entry: SessionEntry;
    index: number;
    isEffectiveChoice: boolean;
    onEdit: () => void;
    onRemove: () => void;
    onCorrectChoice: () => void;
}

export const SessionEntryActions: React.FC<SessionEntryActionsProps> = ({ entry, index, isEffectiveChoice, onEdit, onRemove, onCorrectChoice }) => (
    <div className="entry-actions">
        {entry.payload.kind === 'choice' ? (
            isEffectiveChoice ? (
                <button type="button" className="entry-btn edit" onClick={onCorrectChoice} aria-label={`Correct choice ${index + 1}`}>
                    Correct choice
                </button>
            ) : null
        ) : (
            <>
                {entry.payload.kind === 'repetition' && (
                    <button type="button" className="entry-btn edit" onClick={onEdit} aria-label={`Edit set ${index + 1}`}>
                        Edit
                    </button>
                )}
                <button type="button" className="entry-btn remove" onClick={onRemove} aria-label={`Remove set ${index + 1}`}>
                    ✕
                </button>
            </>
        )}
    </div>
);
