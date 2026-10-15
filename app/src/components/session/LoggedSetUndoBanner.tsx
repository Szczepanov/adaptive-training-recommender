import React from 'react';

interface LoggedSetUndoBannerProps {
    /** Human label of the set just logged, e.g. "Set 3". */
    label: string;
    onUndo: () => void;
}

/** Short-lived confirmation offered right after logging a set (#724). It disappears on its own
 * after `LOGGED_SET_UNDO_WINDOW_MS`; the owner of the timer is `useSessionRunner`. */
export const LoggedSetUndoBanner: React.FC<LoggedSetUndoBannerProps> = ({ label, onUndo }) => (
    <div className="undo-toast-banner logged-set-undo-banner" role="status">
        <span>{label} logged</span>
        <button type="button" className="undo-action-btn" onClick={onUndo}>
            Undo {label.toLowerCase()}
        </button>
    </div>
);
