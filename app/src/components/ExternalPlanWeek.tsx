import { useMemo, useState } from 'react';
import type { ExternalCritiqueFinding, ExternalWeekCritique } from '../engine/externalCritique';
import type { PlacedSession, ReplacementProposal } from '../engine/externalPlacement';
import type { FixedActivity } from '../engine/models';
import { addDaysToLocalDateString } from '../utils/localDate';
import './ExternalPlanWeek.css';

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

function weekdayLabel(date: string): string {
    return WEEKDAY_FORMATTER.format(new Date(`${date}T00:00:00Z`));
}

const STATUS_LABEL: Record<PlacedSession['status'], string> = {
    planned: 'Planned',
    moved: 'Moved',
    completed: 'Done',
    dropped: 'Dropped',
    superseded: 'Superseded',
};

const MODALITY_ICON: Record<string, string> = {
    cycling: '🚴', running: '🏃', strength: '🏋️', field: '⚽', mobility: '🧘', cross_training: '🔀',
};

export interface ExternalPlanWeekProps {
    planTitle: string;
    weekStartDate: string;
    placed: readonly PlacedSession[];
    critique: ExternalWeekCritique | null;
    today: string;
    /** Active fixed activities in the week, used to exclude occupied days from the manual day picker. */
    fixedActivities?: readonly FixedActivity[];
    /** Produces a proposal for a session that was not done. Never writes. */
    onProposeReplacement: (sessionId: string, missedDate: string) => ReplacementProposal;
    /** Called only after the athlete confirms; `date` is null for a drop. */
    onConfirmReplacement: (proposal: ReplacementProposal) => void | Promise<void>;
    /** Free days in the same week, offered when the athlete rejects the proposed date. */
    onChooseDate: (sessionId: string, date: string) => void | Promise<void>;
    /** Set when the last write failed. The week below still shows the stored placement,
     * which is accurate — nothing was written. */
    writeError?: string | null;
}

function findingsFor(critique: ExternalWeekCritique | null, date: string): ExternalCritiqueFinding[] {
    return (critique?.findings ?? []).filter(finding => finding.date === date);
}

function weekLevelFindings(critique: ExternalWeekCritique | null): ExternalCritiqueFinding[] {
    return (critique?.findings ?? []).filter(finding => finding.date === null);
}

/**
 * The placed week, with the engine's non-blocking review of it (ADR-0019 D-CRITIQUE).
 *
 * Findings are presented as observations, never as instructions and never as a reason a
 * session cannot be done — the plan's author owns selection, and the athlete owns whether
 * to act on a critique. Rescheduling is always a proposal the athlete confirms; nothing on
 * this screen moves a session on its own.
 */
export function ExternalPlanWeek({
    planTitle, weekStartDate, placed, critique, today, fixedActivities,
    onProposeReplacement, onConfirmReplacement, onChooseDate, writeError = null,
}: ExternalPlanWeekProps) {
    const [proposal, setProposal] = useState<ReplacementProposal | null>(null);
    const [choosingFor, setChoosingFor] = useState<string | null>(null);

    const days = useMemo(
        () => Array.from({ length: 7 }, (_, offset) => addDaysToLocalDateString(weekStartDate, offset)),
        [weekStartDate],
    );
    const inWeek = useMemo(
        () => placed.filter(item => item.date >= days[0] && item.date <= days[6]),
        [placed, days],
    );
    const occupied = useMemo(() => {
        const inWeekOccupied = inWeek
            .filter(item => item.status !== 'dropped' && item.status !== 'superseded')
            .map(item => item.date);
        const fixedOccupied = (fixedActivities ?? [])
            .filter(activity => !activity.isCompleted && activity.date >= days[0] && activity.date <= days[6])
            .map(activity => activity.date);
        return new Set([...inWeekOccupied, ...fixedOccupied]);
    }, [inWeek, fixedActivities, days]);

    const weekFindings = weekLevelFindings(critique);

    const startProposal = (sessionId: string, missedDate: string) => {
        setChoosingFor(null);
        setProposal(onProposeReplacement(sessionId, missedDate));
    };

    const handleConfirm = async (proposalToConfirm: ReplacementProposal) => {
        try {
            await onConfirmReplacement(proposalToConfirm);
            setProposal(null);
        } catch {
            // Keep proposal open on error so athlete can retry or choose another option
        }
    };

    const handleDateChoice = async (sessionId: string, date: string) => {
        try {
            await onChooseDate(sessionId, date);
            setProposal(null);
            setChoosingFor(null);
        } catch {
            // Keep choice open on error so athlete can retry
        }
    };

    return (
        <div className="dashboard-card external-week-card">
            <div className="card-header">
                <div className="header-title-group">
                    <h3>This week in {planTitle}</h3>
                    <span className="provisional-tag">Your plan&apos;s own schedule — reviewed, never rewritten</span>
                </div>
            </div>

            {writeError && <p className="external-week-error" role="alert">{writeError}</p>}

            <ol className="external-week-list">
                {days.map(date => {
                    const sessions = inWeek.filter(item => item.date === date);
                    const dayFindings = findingsFor(critique, date);
                    return (
                        <li key={date} className={`external-week-day ${date === today ? 'is-today' : ''}`}>
                            <div className="external-week-daylabel">
                                <span className="external-week-weekday">{weekdayLabel(date)}</span>
                                <span className="external-week-date">{date}</span>
                            </div>
                            <div className="external-week-daybody">
                                {sessions.length === 0 && <p className="external-week-empty">Nothing placed</p>}
                                {sessions.map(item => (
                                    <div key={item.session.id} className={`external-week-session status-${item.status}`}>
                                        <span className="external-week-icon">{MODALITY_ICON[item.session.gating.modality] ?? '❔'}</span>
                                        <div className="external-week-sessionbody">
                                            <span className="external-week-title">{item.session.title}</span>
                                            <span className="external-week-meta">
                                                {item.session.gating.intensity} · {item.session.gating.durationMin}–{item.session.gating.durationMax} min
                                                {' · '}{STATUS_LABEL[item.status]}
                                                {item.moved && ' (not where your plan first put it)'}
                                            </span>
                                        </div>
                                        {(item.status === 'planned' || item.status === 'moved') && date <= today && (
                                            <button
                                                type="button"
                                                className="external-week-missed-btn"
                                                onClick={() => startProposal(item.session.id, date)}
                                            >
                                                {date === today ? 'Reschedule' : 'Missed it'}
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {dayFindings.map((finding, index) => (
                                    <p key={`${finding.rule}-${index}`} className="external-week-finding">
                                        ⚠️ {finding.detail}
                                    </p>
                                ))}
                            </div>
                        </li>
                    );
                })}
            </ol>

            {weekFindings.length > 0 && (
                <section className="external-week-review" aria-label="Weekly review">
                    <h4>What this engine notices about the week</h4>
                    <ul>
                        {weekFindings.map((finding, index) => (
                            <li key={`${finding.rule}-${index}`}>{finding.detail}</li>
                        ))}
                    </ul>
                    <p className="external-week-review-caveat">
                        Observations only. Your plan&apos;s author decides what you train; none of this changes a
                        session or its verdict.
                    </p>
                </section>
            )}

            {proposal && (
                <section className="external-week-proposal" aria-label="Missed session proposal">
                    <h4>{proposal.missedDate === today ? 'Reschedule session' : 'Missed session'}</h4>
                    <p>{proposal.rationale}</p>
                    <div className="external-week-proposal-actions">
                        {proposal.outcome !== 'unresolved' && (
                            <button
                                type="button"
                                className="external-week-accept"
                                onClick={() => handleConfirm(proposal)}
                            >
                                {proposal.outcome === 'dropped' ? 'Drop it' : `Move to ${proposal.date}`}
                            </button>
                        )}
                        <button
                            type="button"
                            className="external-week-alt"
                            onClick={() => setChoosingFor(proposal.sessionId)}
                        >
                            Choose another day
                        </button>
                        <button type="button" className="external-week-cancel" onClick={() => { setProposal(null); setChoosingFor(null); }}>
                            Leave it as is
                        </button>
                    </div>
                    {choosingFor === proposal.sessionId && (
                        <div className="external-week-daypicker" role="group" aria-label="Pick a day">
                            {days.filter(date => date >= today && !occupied.has(date)).map(date => (
                                <button
                                    key={date}
                                    type="button"
                                    onClick={() => handleDateChoice(proposal.sessionId, date)}
                                >
                                    {weekdayLabel(date)} {date}
                                </button>
                            ))}
                            {days.filter(date => date >= today && !occupied.has(date)).length === 0 && (
                                <p className="external-week-empty">No free day left this week.</p>
                            )}
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
