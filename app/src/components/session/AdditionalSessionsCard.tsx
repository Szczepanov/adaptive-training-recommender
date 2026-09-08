import React, { useState } from 'react';
import type { SessionReferenceBinding } from '../../sessions/models';
import type { IntradayBundleMemberStatus } from '../../services/intradayBundleMemberAdjudication';
import { isMemberLaunchable } from './additionalSessionLaunchability';
import './AdditionalSessionsCard.css';

export interface AdditionalSessionsCardProps {
    members: readonly IntradayBundleMemberStatus[];
    /** Claims capacity and launches. Rejecting with a `StaleDecisionError` is expected, not
     * exceptional: the caller surfaces its `athleteMessage` and refreshes the dashboard. */
    onStartMember?: (binding: SessionReferenceBinding, member: IntradayBundleMemberStatus) => void | Promise<void>;
}

/**
 * ADR-0036 (H4), plan step 10: renders a v4 intraday bundle's non-primary members.
 *
 * Separate from `MorningDecisionCard`, which is large and primary-session specific. The
 * governing rule here is that a Start control appears **only** for a member the adjudication
 * loop actually bound (`status === 'proceed'` with a `binding`). A `scale` or `pending`
 * verdict must never be launchable -- ADR-0036 D-REASSESS treats an unconfirmed or
 * capacity-reduced PM member as not yet approved, and rendering a button for one would route
 * around the very check that produced the verdict. `reject` shows why and offers nothing.
 *
 * A member with no window bounds still renders: the fields are presentation-only and absent
 * ones are simply omitted rather than filled with a plausible-looking default.
 */
export const AdditionalSessionsCard: React.FC<AdditionalSessionsCardProps> = ({ members, onStartMember }) => {
    const [startingSessionId, setStartingSessionId] = useState<string | null>(null);

    if (members.length === 0) return null;

    const start = async (member: IntradayBundleMemberStatus) => {
        if (!member.binding || !onStartMember) return;
        setStartingSessionId(member.sessionId);
        try {
            await onStartMember(member.binding, member);
        } finally {
            setStartingSessionId(null);
        }
    };

    return (
        <section className="additional-sessions-card dashboard-card" aria-label="Additional sessions today">
            <h3>Later today</h3>
            <ul className="additional-sessions-list">
                {members.map(member => {
                    const launchable = isMemberLaunchable(member);
                    const window = member.boundStartLocal && member.boundEndLocal
                        ? `${member.boundStartLocal}–${member.boundEndLocal}`
                        : null;
                    return (
                        <li key={member.sessionId} className={`additional-session additional-session--${member.status}`}>
                            <div className="additional-session-detail">
                                <strong>{member.title ?? member.sessionId}</strong>
                                <span className="additional-session-meta">
                                    {window && <span className="additional-session-window">{window}</span>}
                                    {member.orderInBundle !== undefined && (
                                        <span className="additional-session-order">Session {member.orderInBundle} today</span>
                                    )}
                                </span>
                                {!launchable && (
                                    <span className="additional-session-reason" role="note">{member.reason}</span>
                                )}
                            </div>
                            {launchable && (
                                <button
                                    type="button"
                                    className="additional-session-start"
                                    disabled={startingSessionId !== null}
                                    onClick={() => void start(member)}
                                >
                                    {startingSessionId === member.sessionId ? 'Checking…' : 'Start'}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};
