import React, { useState } from 'react';
import type { SessionDefinition, OccurrenceAuthority } from '../../sessions/models';
import { sessionDefinitionService } from '../../services/sessionDefinitionService';
import { sessionOccurrenceService } from '../../services/sessionOccurrenceService';
import { hashSessionDefinition } from '../../sessions/sessionDefinitionHash';
import { getLocalDateString } from '../../utils/localDate';
import './SessionDestinationSheet.css';

export type DestinationChoice =
    | 'save_only'
    | 'schedule'
    | 'replace_recommendation'
    | 'additional_session'
    | 'start_unplanned';

interface SessionDestinationSheetProps {
    userId: string;
    definition: SessionDefinition;
    isOpen: boolean;
    onClose: () => void;
    onStartExecution?: (definition: SessionDefinition, occurrenceId?: string) => void;
    onSaved?: (destination: DestinationChoice) => void;
}

export const SessionDestinationSheet: React.FC<SessionDestinationSheetProps> = ({
    userId,
    definition,
    isOpen,
    onClose,
    onStartExecution,
    onSaved,
}) => {
    const [selectedDestination, setSelectedDestination] = useState<DestinationChoice>('schedule');
    const [scheduledDate, setScheduledDate] = useState<string>(getLocalDateString());
    const [saving, setSaving] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        setSaving(true);
        setError(null);
        try {
            const contentHash = await hashSessionDefinition(definition);
            const now = new Date().toISOString();

            // 1. Always persist the definition revision
            await sessionDefinitionService.saveDefinitionRevision(userId, definition, contentHash);

            if (selectedDestination === 'save_only') {
                if (onSaved) onSaved('save_only');
                onClose();
                return;
            }

            // 2. Map destination to occurrence authority
            let authority: OccurrenceAuthority = 'unplanned_log';
            if (selectedDestination === 'schedule') authority = 'schedule';
            else if (selectedDestination === 'replace_recommendation') authority = 'replace_recommendation';
            else if (selectedDestination === 'additional_session') authority = 'additional_session';

            const occurrenceId = `occ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const targetDate = selectedDestination === 'schedule' ? scheduledDate : getLocalDateString();

            await sessionOccurrenceService.saveOccurrence({
                userId,
                occurrenceId,
                date: targetDate,
                authority,
                state: 'active',
                definitionRef: {
                    definitionId: definition.id,
                    revision: definition.revision,
                    contentHash,
                },
                createdAt: now,
                updatedAt: now,
            });

            if (selectedDestination === 'start_unplanned' && onStartExecution) {
                onStartExecution(definition, occurrenceId);
            } else if (onSaved) {
                onSaved(selectedDestination);
            }

            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="destination-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="destination-title">
            <div className="destination-sheet-card">
                <header className="destination-header">
                    <h3 id="destination-title">Choose Session Destination</h3>
                    <p className="destination-subtitle">{definition.title}</p>
                </header>

                <div className="destination-options-list">
                    <label className={`destination-option ${selectedDestination === 'schedule' ? 'selected' : ''}`}>
                        <input
                            type="radio"
                            name="destination"
                            value="schedule"
                            checked={selectedDestination === 'schedule'}
                            onChange={() => setSelectedDestination('schedule')}
                        />
                        <div className="option-content">
                            <span className="option-title">📅 Schedule for a specific date</span>
                            <span className="option-desc">Places the session on your calendar without overriding today's readiness pick.</span>
                            {selectedDestination === 'schedule' && (
                                <input
                                    type="date"
                                    value={scheduledDate}
                                    onChange={e => setScheduledDate(e.target.value)}
                                    className="schedule-date-input"
                                />
                            )}
                        </div>
                    </label>

                    <label className={`destination-option ${selectedDestination === 'replace_recommendation' ? 'selected' : ''}`}>
                        <input
                            type="radio"
                            name="destination"
                            value="replace_recommendation"
                            checked={selectedDestination === 'replace_recommendation'}
                            onChange={() => setSelectedDestination('replace_recommendation')}
                        />
                        <div className="option-content">
                            <span className="option-title">🔄 Replace today's recommendation</span>
                            <span className="option-desc">Explicitly substitutes today's automated recommendation with this session.</span>
                        </div>
                    </label>

                    <label className={`destination-option ${selectedDestination === 'additional_session' ? 'selected' : ''}`}>
                        <input
                            type="radio"
                            name="destination"
                            value="additional_session"
                            checked={selectedDestination === 'additional_session'}
                            onChange={() => setSelectedDestination('additional_session')}
                        />
                        <div className="option-content">
                            <span className="option-title">➕ Add as an extra session today</span>
                            <span className="option-desc">Keeps today's primary recommendation and adds this as a secondary session.</span>
                        </div>
                    </label>

                    <label className={`destination-option ${selectedDestination === 'start_unplanned' ? 'selected' : ''}`}>
                        <input
                            type="radio"
                            name="destination"
                            value="start_unplanned"
                            checked={selectedDestination === 'start_unplanned'}
                            onChange={() => setSelectedDestination('start_unplanned')}
                        />
                        <div className="option-content">
                            <span className="option-title">⚡ Start immediately</span>
                            <span className="option-desc">Launches the session runner now without altering recommendation planning.</span>
                        </div>
                    </label>

                    <label className={`destination-option ${selectedDestination === 'save_only' ? 'selected' : ''}`}>
                        <input
                            type="radio"
                            name="destination"
                            value="save_only"
                            checked={selectedDestination === 'save_only'}
                            onChange={() => setSelectedDestination('save_only')}
                        />
                        <div className="option-content">
                            <span className="option-title">💾 Save to library only</span>
                            <span className="option-desc">Saves this definition revision for future use without scheduling an occurrence.</span>
                        </div>
                    </label>
                </div>

                {error && <div className="destination-error-box" role="alert">{error}</div>}

                <div className="destination-actions">
                    <button
                        type="button"
                        className="destination-confirm-btn"
                        onClick={handleConfirm}
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : 'Confirm & Proceed'}
                    </button>
                    <button
                        type="button"
                        className="destination-cancel-btn"
                        onClick={onClose}
                        disabled={saving}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};
