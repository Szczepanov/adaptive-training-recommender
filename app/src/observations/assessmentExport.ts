import type {
    AssessmentAttempt,
    AssessmentTrial,
    ComparisonContext,
    MeasurementProtocol,
    MetricObservationHead,
    MetricObservationRevision,
} from './models';
import {
    deriveProgress,
    type CurrentObservation,
    type ProgressResult,
    type SeriesReliabilityEstimate,
} from './progress';
import { getMetricDefinition } from './registry';
import type { OutcomeDirection, OutcomeMetricBinding } from '../outcomes/evaluationSpec';
import { canonicalizeJson, compareCodeUnits } from '../utils/canonicalJson';

export const ASSESSMENT_DIAGNOSTIC_EXPORT_SCHEMA_VERSION = 'assessment_diagnostic_export_v1' as const;

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

function computeProgressForExport(
    protocols: readonly MeasurementProtocol[],
    attempts: readonly AssessmentAttempt[],
    canonicalObservations: readonly CanonicalObservationExport[],
    reliabilityEstimates: readonly SeriesReliabilityEstimate[] = [],
): ProgressResult[] {
    const attemptsById = new Map(attempts.map(a => [a.id, a] as const));
    const results: ProgressResult[] = [];

    for (const protocol of protocols) {
        for (const metricId of protocol.metricIds) {
            const metricDef = getMetricDefinition(metricId);
            // Collect current observations for this metric and protocol
            const currentObservations: CurrentObservation[] = [];
            for (const obs of canonicalObservations) {
                if (obs.head.metricId !== metricId) continue;
                const headRev = obs.revisions.find(r => r.revision === obs.head.headRevision);
                if (!headRev) continue;
                if (headRev.protocolRef.id !== protocol.id || headRev.protocolRef.revision !== protocol.revision) continue;
                currentObservations.push({ head: obs.head, revision: headRev });
            }

            if (currentObservations.length === 0) continue;

            // Pick baseline: the chronologically first 'baseline'-purpose attempt, else the
            // earliest valid observation. Ties break on observationKey for byte stability.
            const validCandidates = currentObservations
                .filter(c => c.revision.validity === 'valid')
                .sort((a, b) => a.revision.observedAt.localeCompare(b.revision.observedAt)
                    || compareCodeUnits(a.revision.observationKey, b.revision.observationKey));
            if (validCandidates.length === 0) continue;

            // Familiarization is practice exposure, never an implicit longitudinal baseline.
            // Prefer an explicit baseline-purpose attempt; otherwise fall back only to a valid
            // non-familiarization attempt (e.g. a checkpoint imported without a baseline label).
            const baselineEligible = validCandidates.filter(c => {
                const att = attemptsById.get(c.head.assessmentAttemptId);
                return att !== undefined && att.purpose !== 'familiarization';
            });
            if (baselineEligible.length === 0) continue;

            const baselineCandidate = baselineEligible.find(c => {
                const att = attemptsById.get(c.head.assessmentAttemptId);
                return att?.purpose === 'baseline';
            }) ?? baselineEligible[0];

            const expectedDirection: OutcomeDirection = metricDef.direction === 'lower_is_better'
                ? { kind: 'lower_is_better' }
                : { kind: 'higher_is_better' };

            const binding: OutcomeMetricBinding = metricDef.direction === 'context_only'
                ? {
                    id: `binding-${protocol.id}-${metricId}`,
                    metricId,
                    protocolRef: { id: protocol.id, revision: protocol.revision },
                    role: 'context',
                    baseline: {
                        kind: 'declared_observation',
                        observationId: baselineCandidate.revision.observationKey,
                    },
                    rationale: `Diagnostic export progress for ${metricId}`,
                }
                : {
                    id: `binding-${protocol.id}-${metricId}`,
                    metricId,
                    protocolRef: { id: protocol.id, revision: protocol.revision },
                    role: 'primary',
                    expectedDirection,
                    baseline: {
                        kind: 'declared_observation',
                        observationId: baselineCandidate.revision.observationKey,
                    },
                    rationale: `Diagnostic export progress for ${metricId}`,
                };

            const progress = deriveProgress(binding, currentObservations, reliabilityEstimates);
            results.push(progress);
        }
    }

    return results.sort((a, b) => compareCodeUnits(a.metricId, b.metricId)
        || compareCodeUnits(a.comparisonSeriesKey ?? '', b.comparisonSeriesKey ?? ''));
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
