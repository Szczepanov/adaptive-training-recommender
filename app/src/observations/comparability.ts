import type {
    ComparisonContext,
    ComparisonContextValue,
    ComparisonDimension,
    ComparisonSeries,
    MeasurementProtocol,
} from './models';
import { assertMetricUnit } from './registry';
import {
    assertComparisonDimensionValue,
    assertValidMeasurementProtocol,
    getComparisonDimensionDefinition,
} from './protocols';

export const COMPARISON_CANONICALIZATION_V1 = 'comparison-series-v1';

interface CanonicalDimensionValue {
    id: ComparisonDimension;
    value: string | number | boolean;
}

interface CanonicalComparisonPayload {
    metricId: string;
    protocolId: string;
    protocolRevision: number;
    canonicalizationVersion: string;
    dimensions: readonly CanonicalDimensionValue[];
}

function normalizeDimensionValue(id: ComparisonDimension, value: ComparisonContextValue): string | number | boolean {
    assertComparisonDimensionValue(id, value);
    const definition = getComparisonDimensionDefinition(id);
    if (definition.valueKind === 'identifier') return (value as string).trim().toLowerCase();
    if (definition.valueKind === 'text') return (value as string).trim();
    return value as number | boolean;
}

function assertSupportedCanonicalizationVersion(version: string): void {
    if (version !== COMPARISON_CANONICALIZATION_V1) {
        throw new Error(`Unsupported comparison canonicalization version: ${version}`);
    }
}

function stableDimensionOrder(a: ComparisonDimension, b: ComparisonDimension): number {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

function canonicalPayload(
    metricId: string,
    protocol: MeasurementProtocol,
    context: ComparisonContext,
): CanonicalComparisonPayload {
    assertValidMeasurementProtocol(protocol);
    assertSupportedCanonicalizationVersion(protocol.comparisonContext.canonicalizationVersion);

    if (!protocol.metricIds.includes(metricId)) {
        throw new Error(`Metric ${metricId} is not declared by protocol ${protocol.id}@${protocol.revision}`);
    }

    for (const dimension of protocol.comparisonContext.required) {
        const value = context[dimension];
        if (value === undefined) {
            throw new Error(`Missing required comparison dimension: ${dimension}`);
        }
        assertComparisonDimensionValue(dimension, value);
    }

    const dimensions = [...protocol.comparisonContext.seriesDefining]
        .sort(stableDimensionOrder)
        .map(id => ({ id, value: normalizeDimensionValue(id, context[id]!) }));

    return {
        metricId,
        protocolId: protocol.id,
        protocolRevision: protocol.revision,
        canonicalizationVersion: protocol.comparisonContext.canonicalizationVersion,
        dimensions,
    };
}

export function canonicalComparisonSeriesJson(
    metricId: string,
    unit: string,
    protocol: MeasurementProtocol,
    context: ComparisonContext,
): string {
    assertMetricUnit(metricId, unit);
    return JSON.stringify(canonicalPayload(metricId, protocol, context));
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function buildComparisonSeries(
    metricId: string,
    unit: string,
    protocol: MeasurementProtocol,
    context: ComparisonContext,
): Promise<ComparisonSeries> {
    const payload = canonicalComparisonSeriesJson(metricId, unit, protocol, context);
    return {
        metricId,
        protocolId: protocol.id,
        protocolRevision: protocol.revision,
        canonicalizationVersion: protocol.comparisonContext.canonicalizationVersion,
        key: await sha256Hex(payload),
    };
}

export function areComparisonSeriesComparable(a: ComparisonSeries, b: ComparisonSeries): boolean {
    return a.metricId === b.metricId
        && a.protocolId === b.protocolId
        && a.protocolRevision === b.protocolRevision
        && a.canonicalizationVersion === b.canonicalizationVersion
        && a.key === b.key;
}
