import { getMetricDefinition } from '../observations/registry';

export type OutcomeEvaluationStatus = 'draft' | 'active' | 'completed' | 'archived';
export type OutcomeRole = 'primary' | 'secondary' | 'context';

export type PracticalThreshold =
    | { kind: 'absolute'; value: number; unit: string }
    | { kind: 'percent'; value: number }
    | { kind: 'target'; value: number; unit: string };

export type OutcomeDirection =
    | { kind: 'higher_is_better' }
    | { kind: 'lower_is_better' }
    | { kind: 'target_range'; lowerBound: number; upperBound: number; unit: string };

export type BaselineSelection =
    | { kind: 'declared_observation'; observationId: string }
    | {
        kind: 'first_valid_in_window';
        window: { startDate: string; endDate: string };
        selection: 'earliest_valid';
    };

export interface OutcomeEvaluationSourceRef {
    kind: 'event' | 'authored_plan' | 'manual_block';
    id: string;
}

export interface OutcomeEvaluationSpecRevision {
    id: string;
    revision: number;
    title: string;
    startDate: string;
    endDate: string;
    sourceRef?: OutcomeEvaluationSourceRef;
    status: OutcomeEvaluationStatus;
    activatedAt?: string;
    contentHash: string;
    createdAt: string;
}

export interface OutcomeMetricBindingBase {
    id: string;
    metricId: string;
    protocolRef?: { id: string; revision: number };
    baseline: BaselineSelection;
    targetObservationWindow?: { startDate: string; endDate: string };
    rationale: string;
}

export type OutcomeMetricBinding =
    | (OutcomeMetricBindingBase & {
        role: 'primary' | 'secondary';
        expectedDirection: OutcomeDirection;
        practicalThreshold?: PracticalThreshold;
    })
    | (OutcomeMetricBindingBase & {
        role: 'context';
        expectedDirection?: never;
        practicalThreshold?: never;
    });

export interface OutcomeEvaluationSnapshot {
    revision: OutcomeEvaluationSpecRevision;
    bindings: readonly OutcomeMetricBinding[];
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
}

function assertFinite(value: unknown, label: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function assertDate(value: unknown, label: string): asserts value is string {
    assertNonEmptyString(value, label);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a real date`);
}

function assertDateWindow(window: { startDate: string; endDate: string }, label: string): void {
    assertDate(window.startDate, `${label}.startDate`);
    assertDate(window.endDate, `${label}.endDate`);
    if (window.startDate > window.endDate) throw new Error(`${label} startDate cannot exceed endDate`);
}

export function assertValidPracticalThreshold(metricId: string, threshold: PracticalThreshold): void {
    const metric = getMetricDefinition(metricId);
    assertFinite(threshold.value, 'practicalThreshold.value');
    if (threshold.value < 0) throw new Error('practicalThreshold.value cannot be negative');
    if (threshold.kind === 'percent') return;
    if (threshold.unit !== metric.unit) throw new Error(`Practical threshold for ${metricId} requires unit ${metric.unit}`);
}

export function assertValidOutcomeDirection(metricId: string, direction: OutcomeDirection): void {
    const metric = getMetricDefinition(metricId);
    if (metric.direction === 'context_only') throw new Error(`Context-only metric ${metricId} cannot have an outcome direction`);
    if (direction.kind === 'target_range') {
        assertFinite(direction.lowerBound, 'target_range.lowerBound');
        assertFinite(direction.upperBound, 'target_range.upperBound');
        if (direction.lowerBound >= direction.upperBound) throw new Error('target_range requires lowerBound < upperBound');
        if (direction.unit !== metric.unit) throw new Error(`Target range for ${metricId} requires unit ${metric.unit}`);
        return;
    }
    if (metric.direction === 'target_range') {
        throw new Error(`Metric ${metricId} requires an explicit target_range binding`);
    }
}

export function assertValidBaselineSelection(baseline: BaselineSelection): void {
    if (baseline.kind === 'declared_observation') {
        assertNonEmptyString(baseline.observationId, 'baseline.observationId');
        return;
    }
    if (baseline.kind === 'first_valid_in_window') {
        if (baseline.selection !== 'earliest_valid') throw new Error('first_valid_in_window selection must be earliest_valid');
        assertDateWindow(baseline.window, 'baseline.window');
        return;
    }
    const neverBaseline: never = baseline;
    throw new Error(`Unsupported baseline selection: ${String(neverBaseline)}`);
}

export function assertValidOutcomeMetricBinding(binding: OutcomeMetricBinding): void {
    assertNonEmptyString(binding.id, 'binding.id');
    const metric = getMetricDefinition(binding.metricId);
    assertNonEmptyString(binding.rationale, 'binding.rationale');
    if (binding.protocolRef !== undefined) {
        assertNonEmptyString(binding.protocolRef.id, 'binding.protocolRef.id');
        if (!Number.isInteger(binding.protocolRef.revision) || binding.protocolRef.revision < 1) {
            throw new Error('binding.protocolRef.revision must be a positive integer');
        }
    }
    assertValidBaselineSelection(binding.baseline);
    if (binding.targetObservationWindow !== undefined) assertDateWindow(binding.targetObservationWindow, 'binding.targetObservationWindow');

    if (binding.role === 'context') {
        if ('expectedDirection' in binding && binding.expectedDirection !== undefined) throw new Error('Context binding cannot declare expectedDirection');
        if ('practicalThreshold' in binding && binding.practicalThreshold !== undefined) throw new Error('Context binding cannot declare practicalThreshold');
        return;
    }
    if (metric.direction === 'context_only') throw new Error(`Context-only metric ${binding.metricId} cannot be bound as ${binding.role}`);
    assertValidOutcomeDirection(binding.metricId, binding.expectedDirection);
    if (binding.practicalThreshold !== undefined) assertValidPracticalThreshold(binding.metricId, binding.practicalThreshold);
}

export function assertValidOutcomeEvaluationRevision(revision: OutcomeEvaluationSpecRevision): void {
    assertNonEmptyString(revision.id, 'evaluation.id');
    if (!Number.isInteger(revision.revision) || revision.revision < 1) throw new Error('evaluation.revision must be a positive integer');
    assertNonEmptyString(revision.title, 'evaluation.title');
    assertDate(revision.startDate, 'evaluation.startDate');
    assertDate(revision.endDate, 'evaluation.endDate');
    if (revision.startDate > revision.endDate) throw new Error('evaluation startDate cannot exceed endDate');
    if (!['draft', 'active', 'completed', 'archived'].includes(revision.status)) throw new Error(`Unsupported evaluation status: ${revision.status}`);
    if (revision.sourceRef !== undefined) {
        if (!['event', 'authored_plan', 'manual_block'].includes(revision.sourceRef.kind)) throw new Error(`Unsupported evaluation source: ${revision.sourceRef.kind}`);
        assertNonEmptyString(revision.sourceRef.id, 'evaluation.sourceRef.id');
    }
    if (revision.status === 'draft') {
        if (revision.activatedAt !== undefined) throw new Error('Draft evaluation cannot have activatedAt');
        if (revision.contentHash !== '') throw new Error('Draft evaluation contentHash must remain empty until activation');
    } else {
        assertNonEmptyString(revision.activatedAt, 'evaluation.activatedAt');
        assertNonEmptyString(revision.contentHash, 'evaluation.contentHash');
    }
    assertNonEmptyString(revision.createdAt, 'evaluation.createdAt');
    if (!Number.isFinite(Date.parse(revision.createdAt))) throw new Error('evaluation.createdAt must be a timestamp');
    if (revision.activatedAt !== undefined && !Number.isFinite(Date.parse(revision.activatedAt))) throw new Error('evaluation.activatedAt must be a timestamp');
}

export function assertValidOutcomeEvaluationSnapshot(snapshot: OutcomeEvaluationSnapshot): void {
    assertValidOutcomeEvaluationRevision(snapshot.revision);
    if (snapshot.bindings.length === 0) throw new Error('Outcome evaluation requires at least one metric binding');
    if (snapshot.bindings.length > 16) throw new Error('Outcome evaluation supports at most 16 metric bindings');
    const ids = new Set<string>();
    let primaryCount = 0;
    for (const binding of snapshot.bindings) {
        assertValidOutcomeMetricBinding(binding);
        if (ids.has(binding.id)) throw new Error(`Duplicate outcome binding id: ${binding.id}`);
        ids.add(binding.id);
        if (binding.role === 'primary') primaryCount += 1;
    }
    if (primaryCount === 0) throw new Error('Outcome evaluation requires at least one primary metric binding');
}
