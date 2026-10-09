import { reduceAssessmentTrials } from './assessmentReducers';
import { assertFixedLoadComparisonContext } from './fixedLoadVelocity';
import { buildComparisonSeries } from './comparability';
import type { ObservationRevisionIdentity } from './manualAdapter';
import type {
    AssessmentAttempt,
    AssessmentTrial,
    ComparisonContext,
    MeasurementProtocol,
    MetricObservationDevice,
    MetricObservationRevision,
} from './models';
import { assertValidMetricObservationRevision, observationKeyFor } from './validation';

export interface TrialDerivedObservationInput {
    protocol: MeasurementProtocol;
    attempt: AssessmentAttempt;
    trials: readonly AssessmentTrial[];
    context: ComparisonContext;
    observedAt: string;
    sourceRef?: string;
    /** Attempt-level default device; a source trial's own device takes precedence. */
    device?: MetricObservationDevice;
    /** Per-metric revision identity; omitted metrics are written as revision 1. */
    identityByMetric?: Readonly<Record<string, ObservationRevisionIdentity>>;
}

export interface TrialDerivedObservations {
    observations: readonly MetricObservationRevision[];
    /** Protocol metrics with no valid trial: no canonical benchmark may be claimed for them. */
    missingMetricIds: readonly string[];
}

function assertDerivableAttempt(protocol: MeasurementProtocol, attempt: AssessmentAttempt): void {
    if (attempt.protocolRef.id !== protocol.id || attempt.protocolRef.revision !== protocol.revision) {
        throw new Error(`Attempt ${attempt.id} is bound to a different protocol revision`);
    }
    if (attempt.state !== 'in_progress' && attempt.state !== 'completed') {
        // ADR-0046 D-AT-CORRECTION: trials on an abandoned attempt are never reduced.
        throw new Error(`Cannot derive canonical observations from a ${attempt.state} attempt`);
    }
}

/**
 * WP3.2: turn validated current trials into canonical `source: 'derived'` observation
 * revisions carrying typed trial evidence references and the reducer version. The result is
 * the existing benchmark layer; raw trials never enter progress derivation directly.
 */
export async function deriveTrialObservationRevisions(
    input: TrialDerivedObservationInput,
): Promise<TrialDerivedObservations> {
    const { protocol, attempt } = input;
    assertDerivableAttempt(protocol, attempt);
    assertFixedLoadComparisonContext(protocol, input.trials, input.context);
    const outcomes = reduceAssessmentTrials(protocol, attempt.id, input.trials);
    const trialsById = new Map(input.trials.map(trial => [trial.id, trial] as const));

    const observations: MetricObservationRevision[] = [];
    const missingMetricIds: string[] = [];
    for (const outcome of outcomes) {
        if (outcome.status === 'no_valid_trial') {
            missingMetricIds.push(outcome.metricId);
            continue;
        }
        const { result } = outcome;
        const identity = input.identityByMetric?.[result.metricId] ?? { revision: 1 };
        const series = await buildComparisonSeries(result.metricId, result.unit, protocol, input.context);
        const device = trialsById.get(result.sourceTrialIds[0])?.device ?? input.device;
        const revision: MetricObservationRevision = {
            observationKey: observationKeyFor(attempt.id, result.metricId),
            revision: identity.revision,
            ...(identity.supersedesRevision === undefined ? {} : { supersedesRevision: identity.supersedesRevision }),
            metricId: result.metricId,
            value: result.value,
            unit: result.unit,
            observedAt: input.observedAt,
            source: 'derived',
            ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
            ...(device === undefined ? {} : { device }),
            protocolRef: { id: protocol.id, revision: protocol.revision },
            comparisonSeriesKey: series.key,
            comparisonCanonicalizationVersion: series.canonicalizationVersion,
            assessmentAttemptId: attempt.id,
            validity: 'valid',
            context: { ...input.context },
            derivedFromEvidenceRefs: result.sourceTrialIds.map(trialId => ({
                kind: 'assessment_trial' as const,
                assessmentAttemptId: attempt.id,
                trialId,
            })),
            algorithmVersion: result.reducerVersion,
            ...(identity.correctionReason === undefined ? {} : { correctionReason: identity.correctionReason }),
            createdAt: identity.createdAt ?? new Date().toISOString(),
        };
        assertValidMetricObservationRevision(revision);
        observations.push(revision);
    }
    return { observations, missingMetricIds };
}
