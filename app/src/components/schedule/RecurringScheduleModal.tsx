import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { scheduleWindowService } from '../../services/scheduleWindowService';
import {
    expandRecurringSchedule,
    MAX_RECURRING_SCHEDULE_RULES,
    validateRecurringSchedule,
    WEEKDAY_NUMBERS,
    type RecurringScheduleInput,
    type RecurringScheduleRule,
} from '../../engine/scheduleWindowRecurrence';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate';
import './RecurringScheduleModal.css';

interface RecurringScheduleModalProps {
    userId: string;
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

interface RuleDraft extends RecurringScheduleRule {
    label: string;
}

const WEEKDAY_OPTIONS = [
    { value: 1, label: 'Monday', shortLabel: 'Mon' },
    { value: 2, label: 'Tuesday', shortLabel: 'Tue' },
    { value: 3, label: 'Wednesday', shortLabel: 'Wed' },
    { value: 4, label: 'Thursday', shortLabel: 'Thu' },
    { value: 5, label: 'Friday', shortLabel: 'Fri' },
    { value: 6, label: 'Saturday', shortLabel: 'Sat' },
    { value: 7, label: 'Sunday', shortLabel: 'Sun' },
] as const;

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function newRule(): RuleDraft {
    return { weekdays: [...WEEKDAY_NUMBERS.slice(0, 5)], startLocal: '07:00', endLocal: '08:00', label: '' };
}

function buildInput(startDate: string, endDate: string, rules: readonly RuleDraft[]): RecurringScheduleInput {
    return {
        startDate,
        endDate,
        rules: rules.map(rule => ({
            weekdays: rule.weekdays,
            startLocal: rule.startLocal,
            endLocal: rule.endLocal,
            ...(rule.label.trim() ? { label: rule.label.trim() } : {}),
        })),
    };
}

export const RecurringScheduleModal = memo(function RecurringScheduleModal({
    userId,
    isOpen,
    onClose,
    onSaved,
}: RecurringScheduleModalProps) {
    const today = getLocalDateString();
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(addDaysToLocalDateString(today, 90));
    const [rules, setRules] = useState<RuleDraft[]>([newRule()]);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const dialogRef = useRef<HTMLDivElement>(null);
    const initialFocusRef = useRef<HTMLInputElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    const savingRef = useRef(saving);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        savingRef.current = saving;
    }, [saving]);

    const requestClose = () => {
        if (savingRef.current) return;
        onCloseRef.current();
    };

    useEffect(() => {
        if (!isOpen) return;
        setStartDate(today);
        setEndDate(addDaysToLocalDateString(today, 90));
        setRules([newRule()]);
        setErrors([]);
    }, [isOpen, today]);

    useEffect(() => {
        if (!isOpen) return;

        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const frame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                requestClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const dialog = dialogRef.current;
            if (!dialog) return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKeyDown);
            if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
            previousFocusRef.current = null;
        };
    }, [isOpen]);

    const input = useMemo(() => buildInput(startDate, endDate, rules), [startDate, endDate, rules]);
    const preview = useMemo(() => {
        if (validateRecurringSchedule(input).length > 0) return null;
        const expanded = expandRecurringSchedule(input);
        return `${expanded.length} window${expanded.length === 1 ? '' : 's'} across ${new Set(expanded.map(window => window.date)).size} day${new Set(expanded.map(window => window.date)).size === 1 ? '' : 's'}`;
    }, [input]);

    const updateRule = (index: number, updates: Partial<RuleDraft>) => {
        setRules(current => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...updates } : rule));
        setErrors([]);
    };

    const toggleWeekday = (index: number, weekday: number) => {
        const rule = rules[index];
        if (!rule) return;
        const weekdays = rule.weekdays.includes(weekday)
            ? rule.weekdays.filter(value => value !== weekday)
            : [...rule.weekdays, weekday].sort((left, right) => left - right);
        updateRule(index, { weekdays });
    };

    const handleSave = async (event: React.FormEvent) => {
        event.preventDefault();
        const validationErrors = validateRecurringSchedule(input);
        if (validationErrors.length > 0) {
            setErrors(validationErrors.map(error => error.message));
            return;
        }

        setSaving(true);
        setErrors([]);
        try {
            await scheduleWindowService.createRecurringWindows(userId, input);
            onSaved();
            onClose();
        } catch (error) {
            setErrors([error instanceof Error ? error.message : 'Failed to apply repeating schedule']);
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-backdrop" onClick={requestClose}>
            <div
                ref={dialogRef}
                className="recurring-schedule-modal-card"
                onClick={event => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="recurring-schedule-modal-title"
                aria-describedby="recurring-schedule-modal-description"
                tabIndex={-1}
            >
                <div className="modal-header">
                    <div>
                        <h3 id="recurring-schedule-modal-title">Repeat Training Schedule</h3>
                        <p id="recurring-schedule-modal-description" className="modal-subtitle">
                            Add one or more time blocks and choose the weekdays they repeat on. This creates dated windows for the selected period.
                        </p>
                    </div>
                    <button type="button" className="btn-close-modal" onClick={requestClose} disabled={saving} aria-label="Close">&times;</button>
                </div>

                <form onSubmit={handleSave} className="recurring-schedule-form">
                    <div className="form-row">
                        <div className="form-group">
                            <label htmlFor="recurring-start-date">Repeat from</label>
                            <input ref={initialFocusRef} id="recurring-start-date" type="date" className="text-input" value={startDate} onChange={event => { setStartDate(event.target.value); setErrors([]); }} required />
                        </div>
                        <div className="form-group">
                            <label htmlFor="recurring-end-date">Repeat until</label>
                            <input id="recurring-end-date" type="date" className="text-input" value={endDate} onChange={event => { setEndDate(event.target.value); setErrors([]); }} required />
                        </div>
                    </div>

                    <div className="recurring-blocks-header">
                        <div>
                            <h4>Time blocks</h4>
                            <p>Each block can repeat on a different set of weekdays.</p>
                        </div>
                        {rules.length < MAX_RECURRING_SCHEDULE_RULES && (
                            <button type="button" className="btn-add-block" onClick={() => { setRules(current => [...current, newRule()]); setErrors([]); }}>
                                + Add time block
                            </button>
                        )}
                    </div>

                    <div className="recurring-block-list">
                        {rules.map((rule, index) => (
                            <fieldset key={index} className="recurring-block" aria-label={`Time block ${index + 1}`}>
                                <legend>Time block {index + 1}</legend>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label htmlFor={`recurring-start-${index}`}>Start time</label>
                                        <input id={`recurring-start-${index}`} aria-label="Start time" type="time" className="text-input" value={rule.startLocal} onChange={event => updateRule(index, { startLocal: event.target.value })} required />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor={`recurring-end-${index}`}>End time</label>
                                        <input id={`recurring-end-${index}`} aria-label="End time" type="time" className="text-input" value={rule.endLocal} onChange={event => updateRule(index, { endLocal: event.target.value })} required />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <span className="form-label">Repeats on</span>
                                    <div className="weekday-picker" role="group" aria-label={`Weekdays for time block ${index + 1}`}>
                                        {WEEKDAY_OPTIONS.map(option => {
                                            const selected = rule.weekdays.includes(option.value);
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    className={`weekday-button ${selected ? 'selected' : ''}`}
                                                    aria-label={option.label}
                                                    aria-pressed={selected}
                                                    onClick={() => toggleWeekday(index, option.value)}
                                                >
                                                    <span className="weekday-long-label">{option.label}</span>
                                                    <span className="weekday-short-label">{option.shortLabel}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="recurring-block-footer">
                                    <div className="form-group recurring-label-field">
                                        <label htmlFor={`recurring-label-${index}`}>Label (optional)</label>
                                        <input id={`recurring-label-${index}`} type="text" className="text-input" placeholder="e.g., Before work" value={rule.label} onChange={event => updateRule(index, { label: event.target.value })} maxLength={100} />
                                    </div>
                                    {rules.length > 1 && (
                                        <button type="button" className="btn-remove-block" onClick={() => { setRules(current => current.filter((_, ruleIndex) => ruleIndex !== index)); setErrors([]); }}>
                                            Remove block
                                        </button>
                                    )}
                                </div>
                            </fieldset>
                        ))}
                    </div>

                    {preview && <div className="recurring-preview" role="status">{preview} will be added.</div>}
                    {errors.length > 0 && (
                        <div className="modal-error-banner" role="alert">
                            {errors.length === 1 ? errors[0] : <ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
                        </div>
                    )}

                    <div className="modal-actions">
                        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Applying...' : 'Apply Schedule'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
});
