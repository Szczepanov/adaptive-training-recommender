/**
 * Normalized CSV export for assessment history (WP7.1).
 *
 * Governed by ADR-0046, Issue #897 WP7.1, and Decisions D1-D8.
 * Deterministic ordering: test, protocol revision, series, observedAt, attempt id.
 */

import type { AssessmentHistoryModel, AssessmentHistoryRow } from './assessmentHistory';
import { formatCsvRow } from '../utils/csv';
import { compareCodeUnits } from '../utils/canonicalJson';

export const ASSESSMENT_CSV_HEADERS: readonly string[] = [
    'observed_at',
    'local_date',
    'attempt_id',
    'purpose',
    'protocol_id',
    'protocol_revision',
    'metric_id',
    'display_name',
    'value',
    'unit',
    'validity',
    'comparison_series_key',
    'baseline_value',
    'absolute_change',
    'percent_change',
    'progress_status',
    'device_provider',
    'device_model',
    'body_mass_kg',
    'body_mass_source',
    'body_mass_reference',
    'body_mass_date',
    'relative_value',
    'relative_unit',
];

interface CsvExportRowItem {
    definitionId: string;
    metricId: string;
    protocolRevision: number;
    comparisonSeriesKey: string;
    row: AssessmentHistoryRow;
}

function compareCsvRows(a: CsvExportRowItem, b: CsvExportRowItem): number {
    return compareCodeUnits(a.definitionId, b.definitionId)
        || compareCodeUnits(a.metricId, b.metricId)
        || a.protocolRevision - b.protocolRevision
        || compareCodeUnits(a.comparisonSeriesKey, b.comparisonSeriesKey)
        || a.row.observedAt.localeCompare(b.row.observedAt)
        || compareCodeUnits(a.row.attemptId, b.row.attemptId)
        || compareCodeUnits(a.row.metricId, b.row.metricId);
}

/**
 * Builds the normalized assessment history CSV from the AssessmentHistoryModel.
 */
export function buildAssessmentHistoryCsv(historyModel: AssessmentHistoryModel): string {
    const items: CsvExportRowItem[] = [];

    for (const test of historyModel.tests) {
        for (const metric of test.metrics) {
            const allSeries = [
                ...(metric.activeSeries ? [metric.activeSeries] : []),
                ...metric.otherSeries,
            ];

            for (const series of allSeries) {
                for (const row of series.observations) {
                    items.push({
                        definitionId: test.definitionId,
                        metricId: metric.metricId,
                        protocolRevision: series.protocolRevision,
                        comparisonSeriesKey: series.comparisonSeriesKey,
                        row,
                    });
                }
            }
        }
    }

    items.sort(compareCsvRows);

    const lines: string[] = [
        formatCsvRow(ASSESSMENT_CSV_HEADERS),
    ];

    for (const { protocolRevision, comparisonSeriesKey, row } of items) {
        const line = formatCsvRow([
            row.observedAt,
            row.localDate,
            row.attemptId,
            row.attemptPurpose,
            row.revision.protocolRef.id,
            protocolRevision,
            row.metricId,
            row.displayName,
            row.value,
            row.unit,
            row.validity,
            comparisonSeriesKey,
            row.rowProgress.baselineValue !== undefined ? row.rowProgress.baselineValue : '',
            row.rowProgress.absoluteChange !== undefined ? row.rowProgress.absoluteChange : '',
            row.rowProgress.percentChange !== undefined ? row.rowProgress.percentChange : '',
            row.rowProgress.status,
            row.revision.device?.provider ?? '',
            row.revision.device?.model ?? '',
            row.relativeContext.bodyMassKg !== undefined ? row.relativeContext.bodyMassKg : '',
            row.relativeContext.bodyMassSource ?? '',
            row.relativeContext.bodyMassReference ?? '',
            row.relativeContext.bodyMassDate ?? '',
            row.relativeContext.relativeValue !== undefined ? row.relativeContext.relativeValue : '',
            row.relativeContext.relativeUnit ?? '',
        ]);
        lines.push(line);
    }

    return lines.join('\n');
}
