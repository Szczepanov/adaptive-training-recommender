import React, { useId, useRef, useState } from 'react';
import './SessionHistoryTabs.css';

type SessionsView = 'session' | 'history';

const VIEWS: ReadonlyArray<{ id: SessionsView; label: string }> = [
    { id: 'session', label: 'Session' },
    { id: 'history', label: 'History' },
];

export interface SessionHistoryTabsProps {
    /** True while a structured session is in progress. */
    sessionActive: boolean;
    session: React.ReactNode;
    history: React.ReactNode;
}

/**
 * Issue #726: while a session is in progress, the full overload history must not displace the
 * live logger. The Sessions screen then shows Session | History tabs, defaulting to Session
 * each time a session starts. Both panels stay mounted (`hidden`, not unmounted), so switching
 * to History never resets runner state, rest timers or unsaved input. With no active session,
 * history keeps its place below the session picker.
 */
export const SessionHistoryTabs: React.FC<SessionHistoryTabsProps> = ({ sessionActive, session, history }) => {
    const baseId = useId();
    const [view, setView] = useState<SessionsView>('session');
    const [wasActive, setWasActive] = useState(sessionActive);
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

    // A newly started session always opens on Session (adjusting state during render, not
    // in an effect, so the first active frame already shows the logger).
    if (sessionActive !== wasActive) {
        setWasActive(sessionActive);
        if (sessionActive) setView('session');
    }

    const select = (index: number) => {
        const next = VIEWS[(index + VIEWS.length) % VIEWS.length];
        setView(next.id);
        tabRefs.current[VIEWS.indexOf(next)]?.focus();
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.key === 'ArrowRight') select(index + 1);
        else if (event.key === 'ArrowLeft') select(index - 1);
        else if (event.key === 'Home') select(0);
        else if (event.key === 'End') select(VIEWS.length - 1);
        else return;
        event.preventDefault();
    };

    // One stable element structure for both modes: the session panel keeps its position, so
    // starting a session never remounts the runner it contains.
    return (
        <>
            {sessionActive ? (
                <div className="session-history-tabs" role="tablist" aria-label="Sessions views">
                    {VIEWS.map((item, index) => (
                        <button
                            key={item.id}
                            ref={element => { tabRefs.current[index] = element; }}
                            type="button"
                            role="tab"
                            id={`${baseId}-tab-${item.id}`}
                            aria-selected={view === item.id}
                            aria-controls={`${baseId}-panel-${item.id}`}
                            tabIndex={view === item.id ? 0 : -1}
                            className={`session-history-tab${view === item.id ? ' active' : ''}`}
                            onClick={() => select(index)}
                            onKeyDown={event => onKeyDown(event, index)}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}
            <div
                id={`${baseId}-panel-session`}
                {...(sessionActive ? { role: 'tabpanel', 'aria-labelledby': `${baseId}-tab-session` } : {})}
                hidden={sessionActive && view !== 'session'}
            >
                {session}
            </div>
            <div
                id={`${baseId}-panel-history`}
                {...(sessionActive ? { role: 'tabpanel', 'aria-labelledby': `${baseId}-tab-history` } : {})}
                hidden={sessionActive && view !== 'history'}
                className={`dashboard-card strength-history-card${sessionActive ? ' session-history-panel' : ' session-history-below'}`}
            >
                {history}
            </div>
        </>
    );
};
