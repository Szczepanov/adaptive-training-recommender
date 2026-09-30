import type {
    AssessmentAttempt,
    AssessmentTrial,
    ComparisonContext,
    MeasurementProtocol,
    MetricObservationHead,
    MetricObservationRevision,
} from './models';
import {
    type ProgressResult,
    type SeriesReliabilityEstimate,
} from './progress';
import { canonicalizeJson, compareCodeUnits } from '../utils/canonicalJson';
import { computeProgressForExport } from './assessmentProgress';

export const ASSESSMENT_DIAGNOSTIC_EXPORT_SCHEMA_VERSION = 'assessment_diagnostic_export_v2' as const;

export interface CanonicalObservationExport {
    observationKey: string;
    head: MetricObservationHead;
    revisions: readonly MetricObservationRevision[];
}

export interface ResolvedContextExport {
    attemptId: string;
    protocolId: string;
    protocolRevision: number;
    context: ComparisonContext;
    seriesKeys: Readonly<Record<string, string>>;
}

export interface AssessmentDiagnosticExport {
    schemaVersion: typeof ASSESSMENT_DIAGNOSTIC_EXPORT_SCHEMA_VERSION;
    exportedAt: string;
    protocols: readonly MeasurementProtocol[];
    attempts: readonly AssessmentAttempt[];
    trials: readonly AssessmentTrial[];
    canonicalObservations: readonly CanonicalObservationExport[];
    progress: readonly ProgressResult[];
    resolvedContext: readonly ResolvedContextExport[];
}

export interface BuildAssessmentDiagnosticExportInput {
    exportedAt?: string;
    protocols: readonly MeasurementProtocol[];
    attempts: readonly AssessmentAttempt[];
    trials: readonly AssessmentTrial[];
    canonicalObservations: readonly CanonicalObservationExport[];
    resolvedContext: readonly ResolvedContextExport[];
    reliabilityEstimates?: readonly SeriesReliabilityEstimate[];
}

function compareTrials(a: AssessmentTrial, b: AssessmentTrial): number {
    return compareCodeUnits(a.assessmentAttemptId, b.assessmentAttemptId)
        || a.ordinal - b.ordinal
        || a.correctionIndex - b.correctionIndex;
}


/**
 * Pure builder for WP7.2 diagnostic JSON export.
 * Deterministic ordering on all arrays; no Firebase UID in the payload.
 */
export function buildAssessmentDiagnosticExport(input: BuildAssessmentDiagnosticExportInput): AssessmentDiagnosticExport {
    const exportedAt = input.exportedAt ?? new Date().toISOString();

    const sortedProtocols = [...input.protocols].sort((a, b) =>
        compareCodeUnits(a.id, b.id) || a.revision - b.revision,
    );

    const sortedAttempts = [...input.attempts].sort((a, b) =>
        compareCodeUnits(a.id, b.id),
    );

    const sortedTrials = [...input.trials].sort(compareTrials);

    const sortedCanonicalObservations = [...input.canonicalObservations]
        .sort((a, b) => compareCodeUnits(a.observationKey, b.observationKey))
        .map(obs => ({
            ...obs,
            revisions: [...obs.revisions].sort((a, b) => a.revision - b.revision),
        }));

    const sortedResolvedContext = [...input.resolvedContext].sort((a, b) =>
        compareCodeUnits(a.attemptId, b.attemptId),
    );

    const progress = computeProgressForExport(
        sortedProtocols,
        sortedAttempts,
        sortedCanonicalObservations,
        input.reliabilityEstimates ?? [],
    );

    return {
        schemaVersion: ASSESSMENT_DIAGNOSTIC_EXPORT_SCHEMA_VERSION,
        exportedAt,
        protocols: sortedProtocols,
        attempts: sortedAttempts,
        trials: sortedTrials,
        canonicalObservations: sortedCanonicalObservations,
        progress,
        resolvedContext: sortedResolvedContext,
    };
}

/**
 * Byte-stable JSON serialization of the diagnostic export.
 */
export function assessmentDiagnosticExportToJson(payload: AssessmentDiagnosticExport): string {
    return JSON.stringify(canonicalizeJson(payload), null, 2);
}
