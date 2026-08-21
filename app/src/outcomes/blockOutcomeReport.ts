import type { BlockOutcomeReport } from './blockOutcome';

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
];

function compareCodeUnits(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function csvField(value: string | number | boolean): string {
    const text = String(value);
    if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
}

export function buildBlockMetricProgressRows(report: BlockOutcomeReport): BlockMetricProgressRow[] {
    return [...report.metricProgress]
        .sort((a, b) => compareCodeUnits(a.metricId, b.metricId)
            || compareCodeUnits(a.baselineObservationId ?? '', b.baselineObservationId ?? '')
            || compareCodeUnits(a.latestObservationId ?? '', b.latestObservationId ?? ''))
        .map(progress => ({
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
        }));
}

/** Metric-level deterministic CSV. The nested report remains available through JSON. */
export function blockOutcomeReportToCsv(report: BlockOutcomeReport): string {
    const rows = buildBlockMetricProgressRows(report);
    return [
        CSV_COLUMNS.join(','),
        ...rows.map(row => CSV_COLUMNS.map(column => csvField(row[column])).join(',')),
    ].join('\n');
}

type JsonPrimitive = string | number | boolean | null;
type CanonicalJson = JsonPrimitive | CanonicalJson[] | { [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== 'object') throw new Error(`Unsupported report JSON value: ${typeof value}`);

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareCodeUnits(left, right));
    return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]));
}

/**
 * OV6.1 byte-stable nested export. Object keys are canonicalized recursively while array
 * ordering remains the report's deterministic evidence ordering.
 */
export function blockOutcomeReportToJson(report: BlockOutcomeReport): string {
    return JSON.stringify(canonicalize(report));
}
