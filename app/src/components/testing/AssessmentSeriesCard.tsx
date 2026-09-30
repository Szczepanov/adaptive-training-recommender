import React from 'react';
import type { AssessmentAttempt } from '../../observations/models';
import type { AssessmentHistoryRow, AssessmentTestHistory } from '../../observations/assessmentHistory';
import {
    formatBodyMassRelativeContext,
    isBodyMassRelativeMetric,
    type BodyMassRelativeContext,
} from '../../anthropometry/bodyMass';

export interface AssessmentSeriesCardProps {
    test: AssessmentTestHistory;
    onSelectAttempt: (attempt: AssessmentAttempt, relativeContextMap: Record<string, BodyMassRelativeContext>) => void;
}

function progressStatusLabel(status: string, reasons: readonly string[]): string {
    if (status === 'insufficient_evidence') {
        if (reasons.includes('no_reliability_estimate')) {
            return 'raw change, no reliability estimate';
        }
        if (reasons.includes('post_baseline_observation_not_found')) {
            return 'no comparable repeat yet';
        }
        return 'insufficient evidence';
    }
    if (status === 'unclear_within_noise') return 'unclear within noise';
    if (status === 'possible_improvement') return 'possible improvement';
    if (status === 'meaningful_improvement') return 'meaningful improvement';
    if (status === 'possible_decline') return 'possible decline';
    if (status === 'meaningful_decline') return 'meaningful decline';
    if (status === 'non_comparable') return 'non-comparable';
    return status;
}

export const AssessmentSeriesCard: React.FC<AssessmentSeriesCardProps> = ({
    test,
    onSelectAttempt,
}) => {
    const { activeSeries, otherSeries, completedWithoutBenchmarkCount, abandonedCount } = test;

    const renderObservationTable = (rows: readonly AssessmentHistoryRow[]) => (
        <div className="history-table-wrapper">
            <table className="testing-table history-attempts-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Purpose</th>
                        <th>Value</th>
                        <th>Validity</th>
                        <th>Source</th>
                        <th>Relative context</th>
                        <th><span className="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => {
                        const relativeStr = isBodyMassRelativeMetric(row.metricId)
                            ? formatBodyMassRelativeContext(row.metricId, row.relativeContext)
                            : null;
                        const isExcludedFromProgress = row.validity !== 'valid' || row.attemptPurpose === 'familiarization';

                        return (
                            <tr
                                key={row.observationKey}
                                className={`history-attempt-row ${isExcludedFromProgress ? 'row-excluded-progress' : ''}`}
                            >
                                <td>{row.localDate}</td>
                                <td>
                                    <span className={`purpose-tag purpose-${row.attemptPurpose}`}>
                                        {row.attemptPurpose}
                                    </span>
                                </td>
                                <td>
                                    <strong>{row.value}</strong> {row.unit}
                                </td>
                                <td>
                                    <span className={`validity-tag val-${row.validity}`}>
                                        {row.validity}
                                    </span>
                                </td>
                                <td>
                                    <small className="source-kind-label">{row.sourceKind}</small>
                                </td>
                                <td>
                                    {relativeStr ? <small className="relative-context-text">{relativeStr}</small> : <span className="testing-muted">—</span>}
                                </td>
                                <td>
                                    <button
                                        type="button"
                                        className="testing-secondary btn-compact"
                                        onClick={() => onSelectAttempt(row.attempt, { [row.metricId]: row.relativeContext })}
                                        aria-label={`View attempt ${row.attemptId} details`}
                                    >
                                        Details
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );

    return (
        <article className="testing-card assessment-series-card" aria-labelledby={`test-title-${test.definitionId}`}>
            <header className="series-card-header">
                <div>
                    <span className={`family-badge family-${test.family}`}>{test.family}</span>
                    <h3 id={`test-title-${test.definitionId}`}>{test.title}</h3>
                </div>
                <small className="testing-muted">{test.definitionId}</small>
            </header>

            {!activeSeries && (
                <div className="series-empty-state">
                    <p className="testing-muted">No assessment attempts recorded yet for this test.</p>
                </div>
            )}

            {activeSeries && (
                <section className="active-series-section">
                    <div className="series-meta-bar">
                        <span><strong>Protocol revision:</strong> rev {activeSeries.protocolRevision}</span>
                        <span><strong>Series key:</strong> <code>{activeSeries.comparisonSeriesKey.slice(0, 12)}…</code></span>
                    </div>

                    <div className="series-headline-grid">
                        <div className="headline-stat">
                            <span className="stat-label">Baseline</span>
                            <span className="stat-value">
                                {activeSeries.baseline ? `${activeSeries.baseline.value} ${activeSeries.baseline.unit}` : '—'}
                            </span>
                            {activeSeries.baseline && (
                                <small className="stat-sub">{activeSeries.baseline.localDate} · {activeSeries.baseline.attemptPurpose}</small>
                            )}
                        </div>

                        <div className="headline-stat">
                            <span className="stat-label">Latest</span>
                            <span className="stat-value">
                                {activeSeries.latest ? `${activeSeries.latest.value} ${activeSeries.latest.unit}` : '—'}
                            </span>
                            {activeSeries.latest && (
                                <small className="stat-sub">{activeSeries.latest.localDate} · {activeSeries.latest.attemptPurpose}</small>
                            )}
                        </div>

                        <div className="headline-stat delta-stat">
                            <span className="stat-label">Longitudinal change</span>
                            <span className="stat-value">
                                {activeSeries.progress.comparable && activeSeries.progress.absoluteChange !== undefined ? (
                                    <>
                                        {activeSeries.progress.absoluteChange > 0 ? '+' : ''}
                                        {activeSeries.progress.absoluteChange} {activeSeries.baseline?.unit}
                                        {activeSeries.progress.percentChange !== undefined && (
                                            <span className="pct-badge">
                                                {' '}({activeSeries.progress.percentChange > 0 ? '+' : ''}
                                                {activeSeries.progress.percentChange.toFixed(1)}%)
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <span className="testing-muted">no comparable repeat yet</span>
                                )}
                            </span>
                            <span className="status-label-badge">
                                {progressStatusLabel(activeSeries.progress.status, activeSeries.progress.reasons)}
                            </span>
                        </div>
                    </div>

                    <div className="series-attempts-list">
                        <h4>Recorded attempts ({activeSeries.observations.length})</h4>
                        {renderObservationTable(activeSeries.observations)}
                    </div>
                </section>
            )}

            {otherSeries.length > 0 && (
                <details className="other-series-disclosure">
                    <summary>
                        <strong>Other comparison series ({otherSeries.length})</strong>
                        <span className="other-series-hint">
                            {otherSeries.map(s => `not comparable: ${s.nonComparableReason}`).join('; ')}
                        </span>
                    </summary>
                    <div className="other-series-content">
                        {otherSeries.map((series, idx) => (
                            <div key={`${series.protocolRevision}-${series.comparisonSeriesKey}-${idx}`} className="other-series-box">
                                <div className="other-series-header">
                                    <div>
                                        <strong>Protocol rev {series.protocolRevision}</strong> · <code>{series.comparisonSeriesKey.slice(0, 12)}…</code>
                                    </div>
                                    <span className="not-comparable-marker">
                                        not comparable: {series.nonComparableReason}
                                    </span>
                                </div>
                                <div className="other-series-stats">
                                    <span>Baseline: {series.baseline ? `${series.baseline.value} ${series.baseline.unit}` : '—'}</span>
                                    <span>Latest: {series.latest ? `${series.latest.value} ${series.latest.unit}` : '—'}</span>
                                </div>
                                {renderObservationTable(series.observations)}
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {(completedWithoutBenchmarkCount > 0 || abandonedCount > 0) && (
                <footer className="series-card-footer">
                    {completedWithoutBenchmarkCount > 0 && (
                        <span className="notice-chip">{completedWithoutBenchmarkCount} completed without benchmark</span>
                    )}
                    {abandonedCount > 0 && (
                        <span className="notice-chip notice-abandoned">{abandonedCount} abandoned attempt{abandonedCount > 1 ? 's' : ''}</span>
                    )}
                </footer>
            )}
        </article>
    );
};
