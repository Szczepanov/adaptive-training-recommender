import type { BlockOutcomeReport } from './blockOutcome';
import { canonicalizeJson, compareCodeUnits } from '../utils/canonicalJson';
import { formatCsvRow, spreadsheetSafeText } from '../utils/csv';

export interface BlockMetricProgressRow {
    evaluationId: string;
    evaluationRevision: number;
    evaluationContentHash: string;
    metricId: string;
    baselineObservationId: string;
    latestObservationId: string;
    absoluteChange: string;
    percentChange: string;
    comparable: boolean;
    status: string;
    progressPolicyVersion: string;
    blockVerdictPolicyVersion: string;
    reasons: string;
    bindingId: string;
    protocolId: string;
    protocolRevision: string;
    comparisonSeriesKey: string;
    readerVersion: string;
    reportVersion: string;
    sourceStates: string;
    limitations: string;
    reviewProvenance: string;
}

const CSV_COLUMNS: (keyof BlockMetricProgressRow)[] = [
    'evaluationId',
    'evaluationRevision',
    'evaluationContentHash',
    'metricId',
    'baselineObservationId',
    'latestObservationId',
    'absoluteChange',
    'percentChange',
    'comparable',
    'status',
    'progressPolicyVersion',
    'blockVerdictPolicyVersion',
    'reasons',
    'bindingId', 'protocolId', 'protocolRevision', 'comparisonSeriesKey', 'readerVersion', 'reportVersion', 'sourceStates', 'limitations', 'reviewProvenance',
];

export function buildBlockMetricProgressRows(report: BlockOutcomeReport): BlockMetricProgressRow[] {
    const entries = report.reviewProvenance?.bindings.map(binding => ({ progress: binding.progress, binding }))
        ?? report.metricProgress.map(progress => ({ progress, binding: undefined }));
    return entries
        .sort((a, b) => compareCodeUnits(a.progress.metricId, b.progress.metricId)
            || compareCodeUnits(a.binding?.bindingId ?? '', b.binding?.bindingId ?? '')
            || compareCodeUnits(a.progress.baselineObservationId ?? '', b.progress.baselineObservationId ?? '')
            || compareCodeUnits(a.progress.latestObservationId ?? '', b.progress.latestObservationId ?? ''))
        .map(({ progress, binding }) => ({
            evaluationId: report.evaluationRef.id,
            evaluationRevision: report.evaluationRef.revision,
            evaluationContentHash: report.evaluationRef.contentHash,
            metricId: progress.metricId,
            baselineObservationId: progress.baselineObservationId ?? '',
            latestObservationId: progress.latestObservationId ?? '',
            absoluteChange: progress.absoluteChange === undefined ? '' : String(progress.absoluteChange),
            percentChange: progress.percentChange === undefined ? '' : String(progress.percentChange),
            comparable: progress.comparable,
            status: progress.status,
            progressPolicyVersion: progress.progressPolicyVersion,
            blockVerdictPolicyVersion: report.blockVerdictPolicyVersion,
            reasons: [...progress.reasons].sort(compareCodeUnits).join(';'),
            bindingId: binding?.bindingId ?? '',
            protocolId: binding?.protocolRef?.id ?? '',
            protocolRevision: binding?.protocolRef ? String(binding.protocolRef.revision) : '',
            comparisonSeriesKey: progress.comparisonSeriesKey ?? '',
            readerVersion: report.reviewProvenance?.readerVersion ?? '',
            reportVersion: report.reviewProvenance?.reportVersion ?? '',
            sourceStates: [...(report.reviewProvenance?.sources ?? [])].sort((a, b) => compareCodeUnits(a.source, b.source))
                .map(source => `${source.source}:${source.status}:${source.recordCount}:${source.unreadableCount ?? 0}`).join(';'),
            limitations: [...(report.reviewProvenance?.limitations ?? [])].sort(compareCodeUnits).join(';'),
            reviewProvenance: report.reviewProvenance ? JSON.stringify(canonicalizeJson({
                readerVersion: report.reviewProvenance.readerVersion,
                reportVersion: report.reviewProvenance.reportVersion,
                asOfDate: report.reviewProvenance.asOfDate,
                blockRef: report.reviewProvenance.blockRef,
                binding: binding?.frozenBinding,
                sources: report.reviewProvenance.sources,
                limitations: report.reviewProvenance.limitations,
                policySegments: report.policySegments,
                observations: report.reviewProvenance.observations.filter(o => o.observationId === progress.baselineObservationId
                    || o.observationId === progress.latestObservationId),
                assessmentAttempts: report.reviewProvenance.assessmentAttempts.filter(attempt =>
                    report.reviewProvenance!.observations.some(o => o.assessmentAttemptId === attempt.id
                        && (o.observationId === progress.baselineObservationId || o.observationId === progress.latestObservationId))),
            })) : '',
        }));
}

/** Metric-level deterministic CSV. The nested report remains available through JSON. */
export function blockOutcomeReportToCsv(report: BlockOutcomeReport): string {
    const rows = buildBlockMetricProgressRows(report);
    return [
        CSV_COLUMNS.join(','),
        ...rows.map(row => formatCsvRow(CSV_COLUMNS.map(column => {
            const value = row[column];
            return typeof value === 'string' && column !== 'absoluteChange' && column !== 'percentChange'
                ? spreadsheetSafeText(value) : value;
        }))),
    ].join('\n');
}

/**
 * OV6.1 byte-stable nested export. Object keys are canonicalized recursively while array
 * ordering remains the report's deterministic evidence ordering.
 */
export function blockOutcomeReportToJson(report: BlockOutcomeReport): string {
    return JSON.stringify(canonicalizeJson(report));
}
