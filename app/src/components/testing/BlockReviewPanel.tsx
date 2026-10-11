import { useState } from 'react';
import { blockReviewService, type BlockReviewResult, type BlockReviewSelection } from '../../services/blockReviewService';
import { blockOutcomeReportToCsv, blockOutcomeReportToJson } from '../../outcomes/blockOutcomeReport';
import { downloadCsvFile, downloadDiagnosticExportFile } from '../../services/assessmentExportService';
import { getLocalDateString } from '../../utils/localDate';
import { getMetricDefinition } from '../../observations/registry';
import { PHYSICAL_CAPITAL_PROTOCOL_REVISIONS } from '../../observations/physicalCapitalProtocols';
import './TestingWorkflow.css';

const verdictLabels = {
    on_track: 'On track', mixed: 'Mixed evidence', off_track: 'Off track',
    insufficient_evidence: 'Insufficient evidence',
};
const progressLabels = {
    meaningful_improvement: 'Meaningful improvement', possible_improvement: 'Possible improvement',
    unclear_within_noise: 'Within measurement noise', possible_decline: 'Possible decline',
    meaningful_decline: 'Meaningful decline', non_comparable: 'Not comparable',
    insufficient_evidence: 'Insufficient evidence',
};

export function BlockReviewPanel({ userId }: { userId: string }) {
    const [selections, setSelections] = useState<BlockReviewSelection[] | null>(null);
    const [result, setResult] = useState<BlockReviewResult | null>(null);
    const [limitations, setLimitations] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function listReviews() {
        setBusy(true);
        setError(null);
        setResult(null);
        setSelections(null);
        setLimitations([]);
        try {
            const list = await blockReviewService.listReviews(userId, getLocalDateString());
            setSelections(list.selections);
            setLimitations(list.limitations);
        } catch {
            setError('Block reviews could not be loaded. Retry when connected.');
        } finally { setBusy(false); }
    }

    async function loadReview(selection: BlockReviewSelection) {
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            setResult(await blockReviewService.loadReview(userId, selection, getLocalDateString()));
        } catch {
            setError('This block review could not be loaded. Select the review again to retry.');
        } finally { setBusy(false); }
    }

    function exportReport(format: 'csv' | 'json') {
        if (!result?.report) return;
        setError(null);
        try {
            const filename = `block-report-r${result.report.evaluationRef.revision}`;
            if (format === 'csv') downloadCsvFile(`${filename}.csv`, blockOutcomeReportToCsv(result.report));
            else downloadDiagnosticExportFile(`${filename}.json`, blockOutcomeReportToJson(result.report));
        } catch {
            setError('The export failed. Try the export again.');
        }
    }

    const report = result?.report;
    return (
        <section className="testing-card block-review-panel" aria-labelledby="block-review-title">
            <h3 id="block-review-title">Block evidence review</h3>
            <p>Review measured outcomes against the criteria declared for a training block. No training changes or causal claims.</p>
            <button type="button" className="testing-secondary" disabled={busy} onClick={() => void listReviews()}>
                {busy ? 'Loading block evidence…' : 'Review block evidence'}
            </button>
            {busy && <p role="status">Loading the declared evaluation and available evidence…</p>}
            {error && <p className="testing-error" role="alert">{error}</p>}
            {limitations.length > 0 && (
                <div className="testing-warning-banner">
                    <p>Some linked evaluations or block records could not be fully loaded. The list may be incomplete.</p>
                    <details><summary>List read details</summary><ul>{limitations.map(note => <li key={note}>{note}</li>)}</ul></details>
                </div>
            )}
            {selections?.length === 0 && <p>No explicitly linked block evaluations were found in the loaded sample.</p>}
            {selections && selections.length > 0 && (
                <div className="block-review-list">
                    {selections.map(selection => (
                        <button key={`${selection.blockId}@${selection.blockRevision}:${selection.evaluationId}@${selection.evaluationRevision}`}
                            type="button" className="testing-secondary" disabled={busy} onClick={() => void loadReview(selection)}>
                            Review {selection.title ?? 'Linked block'} · {selection.startDate} – {selection.endDate}
                        </button>
                    ))}
                </div>
            )}
            {result && (
                <div className="block-review-result" aria-live="polite">
                    <h4>{result.evaluation?.revision.title ?? result.selection.title}</h4>
                    <p>Evidence through {result.asOfDate} (Europe/Warsaw).</p>
                    {result.limitations.length > 0 && (
                        <div className="testing-warning-banner">
                            <strong>Evidence limitations</strong>
                            <p>Read limits and missing measurement reliability can prevent a complete comparison or block verdict. Exported reports retain these limitations.</p>
                            <details><summary>Read limitation details</summary><ul>{result.limitations.map(note => <li key={note}>{note}</li>)}</ul></details>
                        </div>
                    )}
                    {!report && <p>A verified frozen evaluation is unavailable. A report cannot be exported.</p>}
                    {report && (
                        <>
                            <p><strong>{verdictLabels[report.verdict]}</strong> · {report.period.startDate} – {report.period.endDate}</p>
                            {(report.reviewProvenance?.bindings ?? report.metricProgress.map((progress, index) => ({
                                bindingId: String(index), metricId: progress.metricId, protocolRef: undefined, progress,
                            }))).map(({ bindingId, protocolRef, progress }) => (
                                <div className="testing-card" key={bindingId}>
                                    <strong>{PHYSICAL_CAPITAL_PROTOCOL_REVISIONS.find(protocol => protocol.id === protocolRef?.id
                                        && protocol.revision === protocolRef.revision)?.title ?? getMetricDefinition(progress.metricId).displayName}</strong>
                                    <p>{progressLabels[progress.status]}</p>
                                    {progress.absoluteChange !== undefined && (
                                        <p>Raw comparable change: {progress.absoluteChange > 0 ? '+' : ''}{progress.absoluteChange.toFixed(2)} {getMetricDefinition(progress.metricId).unit}.
                                            {!progress.reliability && ' No reliability estimate; this does not establish improvement or decline.'}</p>
                                    )}
                                    <details>
                                        <summary>Comparison evidence</summary>
                                        {protocolRef && <p>Protocol: {protocolRef.id} · revision {protocolRef.revision}.</p>}
                                        <p>Baseline: {progress.baselineObservationId ?? 'Unavailable'}; repeat: {progress.latestObservationId ?? 'Unavailable'}.</p>
                                        <ul>{progress.reasons.map(reason => <li key={reason}>{reason.replaceAll('_', ' ')}</li>)}</ul>
                                    </details>
                                </div>
                            ))}
                            <details>
                                <summary>Sources and policy context</summary>
                                <ul>{result.sources.map(source => <li key={source.source}>{source.source}: {source.status}; {source.recordCount} records.</li>)}</ul>
                                <ul>{report.policySegments.map(({ startDate, endDate, policyVersion, planningMode }, index) => <li key={index}>{startDate} – {endDate}: {policyVersion}, {planningMode}</li>)}</ul>
                            </details>
                            <div className="block-review-list">
                                <button type="button" className="testing-secondary" onClick={() => exportReport('csv')}>Export block report (CSV)</button>
                                <button type="button" className="testing-secondary" onClick={() => exportReport('json')}>Export block report (JSON)</button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </section>
    );
}
