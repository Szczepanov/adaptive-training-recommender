import type { MetricDefinition, OutcomeRole } from './models';

const METRICS = [
    {
        id: 'cycling_tt_20m_mean_power_w',
        displayName: '20-minute TT mean power',
        domain: 'cycling',
        unit: 'W',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'Raw mean power from a protocol-locked 20-minute cycling time trial. This is not FTP.',
    },
    {
        id: 'cycling_tt_4m_mean_power_w',
        displayName: '4-minute TT mean power',
        domain: 'cycling',
        unit: 'W',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'Raw mean power from a protocol-locked 4-minute cycling time trial.',
    },
    {
        id: 'cycling_submax_mean_hr_bpm',
        displayName: 'Submaximal mean heart rate',
        domain: 'cycling',
        unit: 'bpm',
        direction: 'context_only',
        valueKind: 'scalar',
        description: 'Mean heart rate from a declared submaximal cycling protocol; contextual evidence in v1.',
    },
    {
        id: 'cycling_submax_rpe',
        displayName: 'Submaximal RPE',
        domain: 'cycling',
        unit: 'rpe',
        direction: 'context_only',
        valueKind: 'scalar',
        description: 'Session/perceived exertion recorded for a declared submaximal cycling protocol; contextual evidence in v1.',
    },
] as const satisfies readonly MetricDefinition[];

const METRIC_BY_ID = new Map<string, MetricDefinition>(METRICS.map(metric => [metric.id, metric] as const));

export function listMetricDefinitions(): readonly MetricDefinition[] {
    return METRICS;
}

export function getMetricDefinition(metricId: string): MetricDefinition {
    const metric = METRIC_BY_ID.get(metricId);
    if (!metric) throw new Error(`Unsupported metric id: ${metricId}`);
    return metric;
}

export function assertMetricUnit(metricId: string, unit: string): MetricDefinition {
    const metric = getMetricDefinition(metricId);
    if (metric.unit !== unit) {
        throw new Error(`Metric ${metricId} requires unit ${metric.unit}; received ${unit}`);
    }
    return metric;
}

/**
 * OV1 boundary used by later OutcomeEvaluationSpec validation. Context metrics remain useful
 * evidence, but they cannot silently become primary/secondary performance outcomes.
 */
export function assertMetricAllowedForOutcomeRole(metricId: string, role: OutcomeRole): MetricDefinition {
    const metric = getMetricDefinition(metricId);
    if (role !== 'context' && metric.direction === 'context_only') {
        throw new Error(`Context-only metric ${metricId} cannot be bound as ${role}`);
    }
    return metric;
}
