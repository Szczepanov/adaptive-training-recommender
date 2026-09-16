import { useState, useEffect, useCallback, memo } from 'react';
import { scheduleWindowService, type ScheduleWindowWithId } from '../../services/scheduleWindowService';
import { ScheduleWindowModal } from './ScheduleWindowModal';
import { dateLabel, groupByDate } from './scheduleWindowsCardHelpers';
import { getLocalDateString } from '../../utils/localDate';
import './ScheduleWindowsCard.css';

interface ScheduleWindowsCardProps {
    userId: string;
    onChanged?: () => void;
}

/**
 * Authoring UI for `ScheduleWindow` (ADR-0036 D-WINDOW). The engine's intraday bundle
 * placement (`engine/intradayBundlePlacement.ts`) and the AM/PM launch pipeline it feeds
 * have been live since H4 shipped, but nothing in the app let an athlete actually create
 * the windows that placement resolves an authored same-day bundle against -- the only
 * prior path was pasting hand-authored JSON through `ExternalPlanImport.tsx`. This card
 * closes that gap: an athlete can add, edit, and delete their own dated AM/PM (or any
 * other) windows directly, the same way `ScheduleOverlayCard` already does for planned
 * absences.
 */
export const ScheduleWindowsCard = memo(function ScheduleWindowsCard({
    userId,
    onChanged,
}: ScheduleWindowsCardProps) {
    const [windows, setWindows] = useState<ScheduleWindowWithId[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedWindow, setSelectedWindow] = useState<ScheduleWindowWithId | null>(null);
    const [modalDefaultDate, setModalDefaultDate] = useState<string | undefined>(undefined);

    const loadWindows = useCallback(async () => {
        try {
            setLoading(true);
            setLoadError(null);
            const list = await scheduleWindowService.listAll(userId);
            setWindows(list);
        } catch (err) {
            console.error('Failed to load schedule windows:', err);
            setLoadError('Training windows could not be loaded. Retry before relying on same-day placement.');
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        void loadWindows();
    }, [loadWindows]);

    const handleOpenCreate = (defaultDate?: string) => {
        setSelectedWindow(null);
        setModalDefaultDate(defaultDate);
        setIsModalOpen(true);
    };

    const handleOpenEdit = (window: ScheduleWindowWithId) => {
        setSelectedWindow(window);
        setModalDefaultDate(undefined);
        setIsModalOpen(true);
    };

    const handleSaved = () => {
        void loadWindows();
        onChanged?.();
    };

    const today = getLocalDateString();
    const upcoming = groupByDate(windows.filter(window => window.date >= today));
    const past = groupByDate(windows.filter(window => window.date < today));

    return (
        <section className="schedule-windows-card">
            <div className="card-header">
                <div>
                    <h3 className="card-title">Training Windows</h3>
                    <p className="card-description">
                        Real blocks of clock time on a given day, such as an AM slot before work and a
                        PM slot after. A second session is only ever placed against a window that
                        exists here -- add one to make training twice in a day possible.
                    </p>
                </div>
                <button type="button" className="btn-add-window" onClick={() => handleOpenCreate(today)}>
                    + Add Window
                </button>
            </div>

            {loading ? (
                <div className="window-loading">Loading training windows...</div>
            ) : loadError ? (
                <div className="window-empty-state" role="alert">
                    <span className="empty-icon">⚠️</span>
                    <p>{loadError}</p>
                    <button type="button" className="btn-add-window" onClick={() => void loadWindows()}>
                        Retry
                    </button>
                </div>
            ) : upcoming.length === 0 ? (
                <div className="window-empty-state">
                    <span className="empty-icon">🕒</span>
                    <p>No upcoming training windows.</p>
                    <span className="empty-hint">
                        Add a window for a day you plan to train twice, then author or import a
                        same-day session plan to place against it.
                    </span>
                </div>
            ) : (
                <div className="window-date-groups">
                    {upcoming.map(group => {
                        const isToday = group.date === today;
                        return (
                            <div key={group.date} className={`window-date-group ${isToday ? 'is-today' : ''}`}>
                                <div className="date-group-header">
                                    <span className="date-group-label">
                                        {dateLabel(group.date)}
                                        {isToday && <span className="status-live-pill">Today</span>}
                                    </span>
                                    {group.windows.length < 8 && (
                                        <button
                                            type="button"
                                            className="btn-add-window-inline"
                                            onClick={() => handleOpenCreate(group.date)}
                                        >
                                            + window
                                        </button>
                                    )}
                                </div>
                                <div className="window-list">
                                    {group.windows.map(window => (
                                        <div
                                            key={window.id}
                                            className="window-item"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => handleOpenEdit(window)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    handleOpenEdit(window);
                                                }
                                            }}
                                        >
                                            <div className="item-main">
                                                <span className="item-time">{window.startLocal}–{window.endLocal}</span>
                                                {window.label && <span className="item-label">{window.label}</span>}
                                                {window.environment && <span className="item-env-tag">{window.environment}</span>}
                                            </div>
                                            <button
                                                type="button"
                                                className="btn-edit-item"
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    handleOpenEdit(window);
                                                }}
                                            >
                                                Edit
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {past.length > 0 && !loadError && (
                <details className="past-windows-accordion">
                    <summary className="past-summary">Past Training Windows ({past.reduce((sum, group) => sum + group.windows.length, 0)})</summary>
                    <div className="past-list">
                        {past.map(group => group.windows.map(window => (
                            <button key={window.id} type="button" className="past-item" onClick={() => handleOpenEdit(window)}>
                                <span>{dateLabel(group.date)}</span>
                                <span className="past-dates">{window.startLocal}–{window.endLocal}{window.label ? ` · ${window.label}` : ''}</span>
                            </button>
                        )))}
                    </div>
                </details>
            )}

            <ScheduleWindowModal
                userId={userId}
                existingWindow={selectedWindow}
                defaultDate={modalDefaultDate}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSaved={handleSaved}
            />
        </section>
    );
});
