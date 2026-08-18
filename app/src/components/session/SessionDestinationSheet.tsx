import React, { useState } from 'react';
import type { SessionDefinition, SessionOccurrence } from '../../sessions/models';
import type { PreparedSessionLaunch } from '../../sessions/sessionLaunch';
import { validateSessionDefinition } from '../../sessions/validation';
import { sessionDefinitionService } from '../../services/sessionDefinitionService';
import { hashSessionDefinition } from '../../sessions/sessionDefinitionHash';
import { prepareUnplannedSessionLaunch } from '../../services/sessionAuthoringService';
import { sessionOccurrenceService } from '../../services/sessionOccurrenceService';
import { getLocalDateString } from '../../utils/localDate';
import { isValidDate } from '../../engine/validation';
import './SessionDestinationSheet.css';

export type DestinationChoice = 'save_only' | 'schedule' | 'replace_recommendation' | 'additional_session' | 'start_unplanned';

export type { PreparedSessionLaunch } from '../../sessions/sessionLaunch';

const DESTINATION_EFFECT: Record<DestinationChoice, string> = {
    start_unplanned: 'Saves an immutable definition and execution snapshot, then starts an unplanned session. It does not alter today’s recommendation.',
    save_only: 'Stores this revision without creating an occurrence or changing planning.',
    schedule: 'Commits to a date for calendar visibility only. It does not change a recommendation unless it is later promoted to a fully adjudicated authority.',
    replace_recommendation: 'Not yet available: replacement must pass clinical, injury, time, equipment, environment, readiness and replay checks before it can become executable.',
    additional_session: 'Not yet available: an additional session must be adjudicated after the primary session and attached to the ordered recommendation audit.',
};

const UNAVAILABLE_DESTINATIONS = new Set<DestinationChoice>(['replace_recommendation', 'additional_session']);

interface SessionDestinationSheetProps {
    userId: string;
    definition: SessionDefinition;
    isOpen: boolean;
    onClose: () => void;
    onStartExecution: (session: PreparedSessionLaunch) => void;
    onSaved?: () => void;
    onOccurrenceCreated?: (occurrence: SessionOccurrence) => void;
}

export const SessionDestinationSheet: React.FC<SessionDestinationSheetProps> = ({
    userId,
    definition,
    isOpen,
    onClose,
    onStartExecution,
    onSaved,
    onOccurrenceCreated,
}) => {
    const [selectedDestination, setSelectedDestination] = useState<DestinationChoice>('start_unplanned');
    const [scheduleDate, setScheduleDate] = useState<string>(getLocalDateString());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const selectDestination = (choice: DestinationChoice) => {
        setSelectedDestination(choice);
        setError(null);
    };

    const handleConfirm = async () => {
        setSaving(true);
        setError(null);
        try {
            if (UNAVAILABLE_DESTINATIONS.has(selectedDestination)) {
                throw new Error('This destination is not available until its full hard-gate and replay contract is implemented.');
            }
            const today = getLocalDateString();
            if (selectedDestination === 'schedule' && (!isValidDate(scheduleDate) || scheduleDate < today)) {
                throw new Error('Choose today or a future date in the Europe/Warsaw calendar.');
            }
            const validation = validateSessionDefinition(definition);
            if (!validation.ok) {
                throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
            }

            const contentHash = await hashSessionDefinition(definition);
            await sessionDefinitionService.saveDefinitionRevision(userId, definition, contentHash);

            if (selectedDestination === 'save_only') {
                onSaved?.();
                onClose();
                return;
            }

            if (selectedDestination === 'start_unplanned') {
                onStartExecution(await prepareUnplannedSessionLaunch(userId, definition));
                onClose();
                return;
            }

            const definitionRef = { definitionId: definition.id, revision: definition.revision, contentHash };
            const occurrence = await sessionOccurrenceService.scheduleOccurrence(userId, scheduleDate, definitionRef);
            onOccurrenceCreated?.(occurrence);
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const confirmLabel = saving
        ? 'Saving…'
        : selectedDestination === 'start_unplanned' ? 'Save & Start'
            : selectedDestination === 'save_only' ? 'Save revision'
                : selectedDestination === 'schedule' ? 'Save & schedule'
                    : selectedDestination === 'replace_recommendation' ? 'Save & replace today'
                        : 'Save & add to today';

    return (
        <div className="destination-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="destination-title">
            <div className="destination-sheet-card">
                <header className="destination-header">
                    <h3 id="destination-title">Save or start session</h3>
                    <p className="destination-subtitle">{definition.title}</p>
                </header>

                <div className="destination-options-list">
                    {(['start_unplanned', 'schedule', 'replace_recommendation', 'additional_session', 'save_only'] as DestinationChoice[]).map(choice => (
                        <label key={choice} className={`destination-option ${selectedDestination === choice ? 'selected' : ''}`}>
                            <input
                                type="radio"
                                name="destination"
                                checked={selectedDestination === choice}
                                disabled={UNAVAILABLE_DESTINATIONS.has(choice)}
                                onChange={() => selectDestination(choice)}
                            />
                            <span className="option-content">
                                <span className="option-title">
                                    {choice === 'start_unplanned' && 'Start now'}
                                    {choice === 'schedule' && 'Schedule for a date'}
                                    {choice === 'replace_recommendation' && 'Replace today’s recommendation'}
                                    {choice === 'additional_session' && 'Add to today'}
                                    {choice === 'save_only' && 'Save to library'}
                                </span>
                                <span className="option-desc">{DESTINATION_EFFECT[choice]}</span>
                            </span>
                        </label>
                    ))}
                </div>

                {selectedDestination === 'schedule' && (
                    <label className="destination-schedule-date">
                        Date
                        <input
                            type="date"
                            className="schedule-date-input"
                            value={scheduleDate}
                            min={getLocalDateString()}
                            required
                            onChange={event => setScheduleDate(event.target.value)}
                        />
                    </label>
                )}

                {error && <pre className="destination-error-box" role="alert">{error}</pre>}

                <div className="destination-actions">
                    <button type="button" className="destination-confirm-btn" onClick={handleConfirm} disabled={saving}>
                        {confirmLabel}
                    </button>
                    <button type="button" className="destination-cancel-btn" onClick={onClose} disabled={saving}>Cancel</button>
                </div>
            </div>
        </div>
    );
};
