import React, { useEffect, useRef, useState } from 'react';
import type { AssessmentAttempt } from '../../observations/models';
import {
    assessmentHistoryService,
    type AssessmentAttemptDetailData,
} from '../../services/assessmentHistoryService';
import {
    formatBodyMassRelativeContext,
    isBodyMassRelativeMetric,
    type BodyMassRelativeContext,
} from '../../anthropometry/bodyMass';

export interface AssessmentAttemptDetailProps {
    userId: string;
    attempt: AssessmentAttempt;
    relativeContextMap?: Readonly<Record<string, BodyMassRelativeContext>>;
    onClose: () => void;
}

export const AssessmentAttemptDetail: React.FC<AssessmentAttemptDetailProps> = ({
    userId,
    attempt,
    relativeContextMap = {},
    onClose,
}) => {
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<AssessmentAttemptDetailData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };

        closeButtonRef.current?.focus();
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [onClose]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);

        assessmentHistoryService.loadAttemptDetail(userId, attempt)
            .then(data => {
                if (!active) return;
                setDetail(data);
                setLoading(false);
            })
            .catch(err => {
                if (!active) return;
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [userId, attempt]);

    return (
        <div className="testing-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="attempt-detail-title">
            <div className="testing-card testing-detail-dialog">
                <div className="testing-card-header-row">
                    <div>
                        <span className="testing-kicker">Assessment attempt detail</span>
                        <h3 id="attempt-detail-title">
                            {detail?.protocol.title ?? attempt.protocolRef.id} · rev {attempt.protocolRef.revision}
                        </h3>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        className="testing-secondary"
                        onClick={onClose}
                        aria-label="Close detail"
                    >
                        Close
                    </button>
                </div>

                {loading && <p>Loading attempt details, raw trials and revision history…</p>}
                {error && <p className="testing-error" role="alert">{error}</p>}

                {detail && (
                    <div className="attempt-detail-body">
                        <section className="attempt-metadata-grid">
                            <div><strong>Attempt ID:</strong> <code>{attempt.id}</code></div>
                            <div><strong>State:</strong> <span className={`attempt-state-badge state-${attempt.state}`}>{attempt.state}</span></div>
                            <div><strong>Purpose:</strong> {attempt.purpose}</div>
                            <div><strong>Completed:</strong> {attempt.completedAt ?? attempt.startedAt ?? attempt.scheduledDate ?? 'n/a'}</div>
                            {attempt.notes && <div className="detail-full-width"><strong>Notes:</strong> {attempt.notes}</div>}
                        </section>

                        <section className="attempt-detail-section">
                            <h4>Comparison context</h4>
                            {detail.metricRevisions.length > 0 && Object.keys(detail.metricRevisions[0].currentRevision.context).length > 0 ? (
                                <dl className="attempt-context-dl">
                                    {Object.entries(detail.metricRevisions[0].currentRevision.context).map(([k, v]) => (
                                        <div key={k} className="context-item">
                                            <dt>{k}:</dt>
                                            <dd>{String(v)}</dd>
                                        </div>
                                    ))}
                                </dl>
                            ) : (
                                <p className="testing-muted">No comparison context recorded.</p>
                            )}
                        </section>

                        <section className="attempt-detail-section">
                            <h4>Canonical benchmarks ({detail.metricRevisions.length})</h4>
                            {detail.metricRevisions.length === 0 ? (
                                <p className="testing-muted">No benchmark observations saved for this attempt.</p>
                            ) : (
                                <div className="attempt-benchmarks-list">
                                    {detail.metricRevisions.map(item => {
                                        const rev = item.currentRevision;
                                        const relativeCtx = relativeContextMap[item.metricId] ?? {};
                                        const relativeStr = isBodyMassRelativeMetric(item.metricId)
                                            ? formatBodyMassRelativeContext(item.metricId, relativeCtx)
                                            : null;

                                        return (
                                            <div key={item.metricId} className="benchmark-card">
                                                <div className="benchmark-header">
                                                    <strong>{item.metricId}</strong>
                                                    <span>{rev.value} {rev.unit} ({rev.validity})</span>
                                                </div>
                                                {relativeStr && (
                                                    <div className="benchmark-relative">
                                                        <strong>Relative:</strong> {relativeStr}
                                                    </div>
                                                )}
                                                <div className="benchmark-meta">
                                                    <span>Revision: {rev.revision}</span>
                                                    {rev.algorithmVersion && <span>Reducer: <code>{rev.algorithmVersion}</code></span>}
                                                    {rev.device?.provider && (
                                                        <span>Device: {rev.device.provider} {rev.device.model ?? ''}</span>
                                                    )}
                                                </div>
                                                {rev.derivedFromEvidenceRefs && rev.derivedFromEvidenceRefs.length > 0 && (
                                                    <div className="benchmark-sources">
                                                        <small>Source trials: {rev.derivedFromEvidenceRefs.map(r => r.trialId).join(', ')}</small>
                                                    </div>
                                                )}
                                                {item.revisions.length > 1 && (
                                                    <details className="benchmark-history-disclosure">
                                                        <summary>Revision history ({item.revisions.length})</summary>
                                                        <ul className="revision-history-list">
                                                            {item.revisions.map(r => (
                                                                <li key={r.revision}>
                                                                    rev {r.revision}: {r.value} {r.unit} · {r.validity}
                                                                    {r.correctionReason ? ` · reason: "${r.correctionReason}"` : ''}
                                                                    <small> ({r.createdAt})</small>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </details>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                        <section className="attempt-detail-section">
                            <h4>Raw trials ({detail.trials.length})</h4>
                            {detail.trials.length === 0 ? (
                                <p className="testing-muted">No raw trial records (summary-only protocol or no trials captured).</p>
                            ) : (
                                <div className="attempt-trials-table-wrapper">
                                    <table className="testing-table attempt-trials-table">
                                        <thead>
                                            <tr>
                                                <th>Trial #</th>
                                                <th>Corr</th>
                                                <th>Values</th>
                                                <th>Validity</th>
                                                <th>Correction reason</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(() => {
                                                const supersededIds = new Set(
                                                    detail.trials.map(t => t.supersedesTrialId).filter((id): id is string => typeof id === 'string'),
                                                );
                                                return detail.trials.map(t => {
                                                    const isSuperseded = supersededIds.has(t.id);
                                                    return (
                                                        <tr key={t.id} className={isSuperseded ? 'trial-row-superseded' : ''}>
                                                            <td>{t.ordinal}</td>
                                                            <td>{t.correctionIndex}</td>
                                                            <td>
                                                                {Object.entries(t.values).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}
                                                            </td>
                                                            <td>
                                                                <span className={`validity-tag val-${t.validity}`}>{t.validity}</span>
                                                            </td>
                                                            <td>
                                                                {t.correctionReason ?? (isSuperseded ? 'Superseded by later correction' : '—')}
                                                            </td>
                                                        </tr>
                                                    );
                                                });
                                            })()}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
};
