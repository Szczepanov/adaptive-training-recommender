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
    {
        id: 'strength_1rm_kg',
        displayName: 'One-repetition maximum',
        domain: 'strength',
        unit: 'kg',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'One-repetition maximum load for a canonical strength exercise, in kilograms. Tested and estimated 1RM remain distinguishable via ObservationValidity/source rather than this metric definition.',
    },
    {
        id: 'sprint_elapsed_time_s',
        displayName: 'Sprint elapsed time',
        domain: 'field',
        unit: 's',
        direction: 'lower_is_better',
        valueKind: 'scalar',
        description: 'Elapsed time for a protocol-locked sprint distance/start convention. Not comparable across different PerformanceTestDefinition subjects (e.g. standing vs flying start) even when the distance matches.',
    },
    {
        id: 'cycling_5s_peak_power_w',
        displayName: 'Cycling 5-second peak power',
        domain: 'cycling',
        unit: 'W',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'Peak power sustained for a protocol-locked 5-second maximal cycling sprint effort.',
    },
    {
        id: 'standing_broad_jump_distance_cm',
        displayName: 'Standing broad jump distance',
        domain: 'field',
        unit: 'cm',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'Best valid standing broad jump distance under a protocol-locked take-off and landing convention.',
    },
    {
        id: 'wall_touch_cmj_height_cm',
        displayName: 'Wall-touch countermovement jump height',
        domain: 'field',
        unit: 'cm',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'Best valid wall-touch countermovement jump height (touch height minus standing reach). Not comparable with contact-mat or force-plate jump heights.',
    },
    {
        id: 'seated_medball_throw_distance_m',
        displayName: 'Seated medicine-ball chest throw distance',
        domain: 'field',
        unit: 'm',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'Best valid seated chest-throw distance; ball mass is fixed by the protocol revision.',
    },
    {
        id: 'cycling_sprint_1s_peak_power_w',
        displayName: 'Cycling sprint 1-second peak power',
        domain: 'cycling',
        unit: 'W',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'Best valid 1-second peak power across a protocol-locked set of short maximal cycling sprints.',
    },
    {
        id: 'cycling_sprint_5s_mean_power_w',
        displayName: 'Cycling sprint 5-second mean power',
        domain: 'cycling',
        unit: 'W',
        direction: 'higher_is_better',
        valueKind: 'scalar',
        description: 'Best valid 5-second mean power across a protocol-locked set of short maximal cycling sprints.',
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
