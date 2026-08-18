import React, { useState } from 'react';
import type { SessionDefinition } from '../../sessions/models';
import type { PreparedSessionLaunch } from '../../sessions/sessionLaunch';
import { validateSessionDefinition } from '../../sessions/validation';
import { sessionDefinitionService } from '../../services/sessionDefinitionService';
import { hashSessionDefinition } from '../../sessions/sessionDefinitionHash';
import { prepareUnplannedSessionLaunch } from '../../services/sessionAuthoringService';
import './SessionDestinationSheet.css';

export type DestinationChoice = 'save_only' | 'start_unplanned';

export type { PreparedSessionLaunch } from '../../sessions/sessionLaunch';

interface SessionDestinationSheetProps {
    userId: string;
    definition: SessionDefinition;
    isOpen: boolean;
    onClose: () => void;
    onStartExecution: (session: PreparedSessionLaunch) => void;
    onSaved?: () => void;
}

/**
 * The first authoring destination is intentionally bounded.  A user may save a definition
 * or run it unplanned; it cannot yet claim schedule/replace/add recommendation authority
 * before M3.2/M3.3 supply replay and same-day feasibility.
 */
export const SessionDestinationSheet: React.FC<SessionDestinationSheetProps> = ({
    userId,
    definition,
    isOpen,
    onClose,
    onStartExecution,
    onSaved,
}) => {
    const [selectedDestination, setSelectedDestination] = useState<DestinationChoice>('start_unplanned');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        setSaving(true);
        setError(null);
        try {
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

            onStartExecution(await prepareUnplannedSessionLaunch(userId, definition));
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="destination-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="destination-title">
            <div className="destination-sheet-card">
                <header className="destination-header">
                    <h3 id="destination-title">Save or start session</h3>
                    <p className="destination-subtitle">{definition.title}</p>
                </header>

                <div className="destination-options-list">
                    <label className={`destination-option ${selectedDestination === 'start_unplanned' ? 'selected' : ''}`}>
                        <input
                            type="radio"
                            name="destination"
                            checked={selectedDestination === 'start_unplanned'}
                            onChange={() => setSelectedDestination('start_unplanned')}
                        />
                        <span className="option-content">
                            <span className="option-title">Start now</span>
                            <span className="option-desc">Saves an immutable definition and execution snapshot, then starts an unplanned session. It does not alter today’s recommendation.</span>
                        </span>
                    </label>
                    <label className={`destination-option ${selectedDestination === 'save_only' ? 'selected' : ''}`}>
                        <input
                            type="radio"
                            name="destination"
                            checked={selectedDestination === 'save_only'}
                            onChange={() => setSelectedDestination('save_only')}
                        />
                        <span className="option-content">
                            <span className="option-title">Save to library</span>
                            <span className="option-desc">Stores this revision without creating an occurrence or changing planning.</span>
                        </span>
                    </label>
                </div>

                <p className="destination-subtitle">Scheduling and recommendation replacement stay unavailable until their replay and safety contracts are implemented.</p>
                {error && <pre className="destination-error-box" role="alert">{error}</pre>}

                <div className="destination-actions">
                    <button type="button" className="destination-confirm-btn" onClick={handleConfirm} disabled={saving}>
                        {saving ? 'Saving…' : selectedDestination === 'start_unplanned' ? 'Save & Start' : 'Save revision'}
                    </button>
                    <button type="button" className="destination-cancel-btn" onClick={onClose} disabled={saving}>Cancel</button>
                </div>
            </div>
        </div>
    );
};
