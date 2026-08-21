import { buildComparisonSeries } from './comparability';
import type {
    ComparisonContext,
    MeasurementProtocol,
    MetricObservationDevice,
    MetricObservationRevision,
    ObservationValidity,
} from './models';
import { assertValidMeasurementProtocol } from './protocols';
import { assertMetricUnit } from './registry';
import { assertValidMetricObservationRevision, observationKeyFor } from './validation';

export interface ManualObservationInput {
    assessmentAttemptId: string;
    metricId: string;
    value: number;
    unit: string;
    observedAt: string;
    protocol: MeasurementProtocol;
    context: ComparisonContext;
    validity: ObservationValidity;
    invalidReason?: string;
    validityNote?: string;
    sourceRef?: string;
    device?: MetricObservationDevice;
}

export interface ObservationRevisionIdentity {
    revision: number;
    supersedesRevision?: number;
    correctionReason?: string;
    createdAt?: string;
}

/**
 * Manual entry is deliberately the first adapter. It proves the observation/protocol model
 * without interpreting an ordinary Garmin activity as a formal benchmark.
 */
export async function adaptManualObservation(
    input: ManualObservationInput,
    identity: ObservationRevisionIdentity = { revision: 1 },
): Promise<MetricObservationRevision> {
    assertValidMeasurementProtocol(input.protocol);
    assertMetricUnit(input.metricId, input.unit);
    if (!input.protocol.metricIds.includes(input.metricId)) {
        throw new Error(`Metric ${input.metricId} is not declared by protocol ${input.protocol.id}@${input.protocol.revision}`);
    }
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
        throw new Error('Manual observation value must be finite');
    }

    const series = await buildComparisonSeries(input.metricId, input.unit, input.protocol, input.context);
    const revision: MetricObservationRevision = {
        observationKey: observationKeyFor(input.assessmentAttemptId, input.metricId),
        revision: identity.revision,
        ...(identity.supersedesRevision === undefined ? {} : { supersedesRevision: identity.supersedesRevision }),
        metricId: input.metricId,
        value: input.value,
        unit: input.unit,
        observedAt: input.observedAt,
        source: 'manual',
        ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
        ...(input.device === undefined ? {} : { device: input.device }),
        protocolRef: { id: input.protocol.id, revision: input.protocol.revision },
        comparisonSeriesKey: series.key,
        comparisonCanonicalizationVersion: series.canonicalizationVersion,
        assessmentAttemptId: input.assessmentAttemptId,
        validity: input.validity,
        ...(input.invalidReason === undefined ? {} : { invalidReason: input.invalidReason }),
        ...(input.validityNote === undefined ? {} : { validityNote: input.validityNote }),
        context: { ...input.context },
        ...(identity.correctionReason === undefined ? {} : { correctionReason: identity.correctionReason }),
        createdAt: identity.createdAt ?? new Date().toISOString(),
    };
    assertValidMetricObservationRevision(revision);
    return revision;
}
