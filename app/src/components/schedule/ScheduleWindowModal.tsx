import { useEffect, useRef, useState, memo } from 'react';
import { scheduleWindowService, type ScheduleWindowWithId } from '../../services/scheduleWindowService';
import { getLocalDateString } from '../../utils/localDate';
import { useOverlayFocusVisibility, useOverlayScrollLock } from '../useOverlayDialog';
import '../overlayContract.css';
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

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

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
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const initialFocusRef = useRef<HTMLInputElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    const savingRef = useRef(saving);
    useOverlayScrollLock(isOpen);
    useOverlayFocusVisibility(isOpen, dialogRef);

    const requestClose = () => {
        if (savingRef.current) return;
        onCloseRef.current();
    };

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        savingRef.current = saving;
    }, [saving]);

    useEffect(() => {
        if (!isOpen) return;
        if (existingWindow) {
            setDate(existingWindow.date);
            setStartLocal(existingWindow.startLocal);
            setEndLocal(existingWindow.endLocal);
            setLabel(existingWindow.label ?? '');
        } else {
            setDate(defaultDate ?? today);
            setStartLocal('07:00');
            setEndLocal('08:00');
            setLabel('');
        }
        setError(null);
    }, [isOpen, existingWindow, defaultDate, today]);

    useEffect(() => {
        if (!isOpen) return;

        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        const frame = window.requestAnimationFrame(() => {
            initialFocusRef.current?.focus();
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                requestClose();
                return;
            }
            if (event.key !== 'Tab') return;

            const dialog = dialogRef.current;
            if (!dialog) return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
                .filter(element => !element.hasAttribute('hidden') && element.tabIndex !== -1);
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKeyDown);
            const previous = previousFocusRef.current;
            if (previous?.isConnected) previous.focus();
            previousFocusRef.current = null;
        };
    }, [isOpen]);

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
            // Keep `label` present in the partial update even when the field was cleared.
            // Firestore is configured with `ignoreUndefinedProperties`, so `undefined`
            // removes the optional nested field instead of preserving the old label.
            const payload = {
                date,
                startLocal,
                endLocal,
                label: label.trim() || undefined,
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
        <div className="modal-backdrop overlay-viewport" onClick={requestClose}>
            <div
                ref={dialogRef}
                className="schedule-window-modal-card overlay-panel"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="schedule-window-modal-title"
                aria-describedby="schedule-window-modal-description"
                tabIndex={-1}
            >
                <div className="modal-header">
                    <div>
                        <h3 id="schedule-window-modal-title">{existingWindow ? 'Edit Training Window' : 'Add Training Window'}</h3>
                        <p id="schedule-window-modal-description" className="modal-subtitle">
                            A window is a real block of clock time on one day, such as an AM slot before
                            work and a PM slot after. Training twice in a day only becomes possible once
                            both windows exist here.
                        </p>
                    </div>
                    <button type="button" className="btn-close-modal" onClick={requestClose} disabled={saving} aria-label="Close">
                        &times;
                    </button>
                </div>

                <form onSubmit={handleSave} className="window-form">
                    <div className="form-group">
                        <label htmlFor="window-date">Date</label>
                        <input
                            ref={initialFocusRef}
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

                    {error && <div className="modal-error-banner" role="alert">{error}</div>}

                    <div className="modal-actions">
                        {existingWindow && (
                            <button type="button" className="btn-delete" onClick={handleDelete} disabled={saving}>
                                Delete
                            </button>
                        )}
                        <div className="actions-right">
                            <button type="button" className="btn-secondary" onClick={requestClose} disabled={saving}>
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
