import { useState, useEffect, memo } from 'react';
import type { TrainingEnvironment } from '../../engine/models';
import { scheduleWindowService, type ScheduleWindowWithId } from '../../services/scheduleWindowService';
import { getLocalDateString } from '../../utils/localDate';
import './ScheduleWindowModal.css';

interface ScheduleWindowModalProps {
    userId: string;
    /** `null` creates a new window. Editing reuses this window's own `date` as the
     * `currentDate` the service needs to locate its manifest, independent of whatever
     * date the form is showing (the athlete may move it to a different date). */
    existingWindow: ScheduleWindowWithId | null;
    /** Pre-fills the date field when creating a window from a specific day's context
     * (e.g. "add a window for today"). Ignored when editing. */
    defaultDate?: string;
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const ENVIRONMENT_OPTIONS: Array<{ value: TrainingEnvironment | ''; label: string }> = [
    { value: '', label: 'No restriction' },
    { value: 'outdoor', label: 'Outdoor only' },
    { value: 'indoor', label: 'Indoor only' },
    { value: 'either', label: 'Either' },
];

export const ScheduleWindowModal = memo(function ScheduleWindowModal({
    userId,
    existingWindow,
    defaultDate,
    isOpen,
    onClose,
    onSaved,
}: ScheduleWindowModalProps) {
    const today = getLocalDateString();
    const [date, setDate] = useState(today);
    const [startLocal, setStartLocal] = useState('07:00');
    const [endLocal, setEndLocal] = useState('08:00');
    const [label, setLabel] = useState('');
    const [environment, setEnvironment] = useState<TrainingEnvironment | ''>('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        if (existingWindow) {
            setDate(existingWindow.date);
            setStartLocal(existingWindow.startLocal);
            setEndLocal(existingWindow.endLocal);
            setLabel(existingWindow.label ?? '');
            setEnvironment(existingWindow.environment ?? '');
        } else {
            setDate(defaultDate ?? today);
            setStartLocal('07:00');
            setEndLocal('08:00');
            setLabel('');
            setEnvironment('');
        }
        setError(null);
    }, [isOpen, existingWindow, defaultDate, today]);

    if (!isOpen) return null;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!date) {
            setError('Please choose a date.');
            return;
        }
        if (!startLocal || !endLocal || startLocal >= endLocal) {
            setError('End time must be after start time.');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                date,
                startLocal,
                endLocal,
                ...(label.trim() ? { label: label.trim() } : {}),
                ...(environment ? { environment } : {}),
            };

            if (existingWindow) {
                await scheduleWindowService.updateWindow(userId, existingWindow.date, existingWindow.id, payload);
            } else {
                await scheduleWindowService.createWindow(userId, payload);
            }

            onSaved();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save schedule window');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!existingWindow) return;
        setSaving(true);
        setError(null);
        try {
            await scheduleWindowService.deleteWindow(userId, existingWindow.date, existingWindow.id);
            onSaved();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete schedule window');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
            <div className="schedule-window-modal-card" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h3>{existingWindow ? 'Edit Training Window' : 'Add Training Window'}</h3>
                        <p className="modal-subtitle">
                            A window is a real block of clock time on one day, such as an AM slot before
                            work and a PM slot after. Training twice in a day only becomes possible once
                            both windows exist here.
                        </p>
                    </div>
                    <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close">
                        &times;
                    </button>
                </div>

                <form onSubmit={handleSave} className="window-form">
                    <div className="form-group">
                        <label htmlFor="window-date">Date</label>
                        <input
                            id="window-date"
                            type="date"
                            className="text-input"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label htmlFor="window-start">Start Time</label>
                            <input
                                id="window-start"
                                type="time"
                                className="text-input"
                                value={startLocal}
                                onChange={e => setStartLocal(e.target.value)}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="window-end">End Time</label>
                            <input
                                id="window-end"
                                type="time"
                                className="text-input"
                                value={endLocal}
                                onChange={e => setEndLocal(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label htmlFor="window-label">Label (optional)</label>
                        <input
                            id="window-label"
                            type="text"
                            className="text-input"
                            placeholder="e.g., AM, PM, Before work"
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            maxLength={100}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="window-environment">Environment (optional)</label>
                        <select
                            id="window-environment"
                            className="select-input"
                            value={environment}
                            onChange={e => setEnvironment(e.target.value as TrainingEnvironment | '')}
                        >
                            {ENVIRONMENT_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        <span className="field-hint">Only set this when the window itself restricts where you can train (e.g. a hotel gym).</span>
                    </div>

                    {error && <div className="modal-error-banner">{error}</div>}

                    <div className="modal-actions">
                        {existingWindow && (
                            <button type="button" className="btn-delete" onClick={handleDelete} disabled={saving}>
                                Delete
                            </button>
                        )}
                        <div className="actions-right">
                            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
                                Cancel
                            </button>
                            <button type="submit" className="btn-primary" disabled={saving}>
                                {saving ? 'Saving...' : existingWindow ? 'Save Changes' : 'Add Window'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
});
