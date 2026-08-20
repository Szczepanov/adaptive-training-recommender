/**
 * M5.3: deterministic report/export over `SessionOutcome[]`.
 *
 * Per the 2026-08-19 cutline review, M5.3 ships "a deterministic report/export and a compact
 * inspectable view using existing data surfaces" -- explicitly NOT a dedicated cross-session
 * response dashboard. `components/session/ResponseHistory.tsx` stays unbuilt until the
 * athlete repeatedly opens/exports this and has a specific question a dedicated surface would
 * answer better (see `docs/plans/multidomain-session-authoring-execution-and-evidence.md`
 * M5.3). This module is the report: a flat, sorted, injury-prediction-free row set plus a
 * pure CSV serializer, both directly testable without a UI.
 */
import type { SessionOutcome } from './outcome';

export interface SessionOutcomeReportRow {
    date: string;
    sourceKind: SessionOutcome['sourceSession']['kind'];
    sourceId: string;
    status: SessionOutcome['status'];
    hasFollowUpData: boolean;
    responseCount: number;
    tissueRegions: string;
    overrideReason: string;
    note: string;
    completedStepsCount: string;
    missingRequiredStepsCount: string;
    totalPlannedSteps: string;
    policyVersion: string;
}

/** Chronological, then by source id -- stable and independent of Firestore query order, so
 * the same underlying data always produces byte-identical report/export output. */
export function buildSessionOutcomeReport(outcomes: readonly SessionOutcome[]): SessionOutcomeReportRow[] {
    return [...outcomes]
        .sort((a, b) => (
            a.sourceSession.date.localeCompare(b.sourceSession.date)
            || a.sourceSession.id.localeCompare(b.sourceSession.id)
        ))
        .map(outcome => ({
            date: outcome.sourceSession.date,
            sourceKind: outcome.sourceSession.kind,
            sourceId: outcome.sourceSession.id,
            status: outcome.status,
            hasFollowUpData: outcome.hasFollowUpData,
            responseCount: outcome.sourceFacts.responseIds.length,
            tissueRegions: outcome.sourceFacts.tissueRegions.join(';'),
            overrideReason: outcome.override.reason ?? '',
            note: outcome.override.note ?? '',
            completedStepsCount: outcome.override.completedStepsCount?.toString() ?? '',
            missingRequiredStepsCount: outcome.override.missingRequiredStepsCount?.toString() ?? '',
            totalPlannedSteps: outcome.override.totalPlannedSteps?.toString() ?? '',
            policyVersion: outcome.policyVersion,
        }));
}

const CSV_COLUMNS: (keyof SessionOutcomeReportRow)[] = [
    'date', 'sourceKind', 'sourceId', 'status', 'hasFollowUpData', 'responseCount',
    'tissueRegions', 'overrideReason', 'note', 'completedStepsCount',
    'missingRequiredStepsCount', 'totalPlannedSteps', 'policyVersion',
];

function csvField(value: string | number | boolean): string {
    const text = String(value);
    if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
}

/** RFC 4180-shaped, deterministic (same row order as `buildSessionOutcomeReport`, same
 * column order every time) -- an athlete-facing export, not a persisted document. */
export function sessionOutcomeReportToCsv(rows: readonly SessionOutcomeReportRow[]): string {
    const lines = [CSV_COLUMNS.join(',')];
    for (const row of rows) {
        lines.push(CSV_COLUMNS.map(column => csvField(row[column])).join(','));
    }
    return lines.join('\n');
}
