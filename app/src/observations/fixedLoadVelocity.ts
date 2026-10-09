import type { AssessmentTrial, MeasurementProtocol, MetricObservationRevision, ObservationContext } from './models';
import { velocityMeasurementMethodId } from './openBarAnalysisImport';
import { assertComparisonDimensionValue } from './protocols';

export const FIXED_LOAD_VELOCITY_METRIC_ID = 'strength_fixed_load_mean_velocity_mps';
export const FIXED_LOAD_VELOCITY_DIMENSIONS = ['test_load_kg', 'measurement_method_id', 'equipment_setup_id'] as const;

export function isFixedLoadVelocityProtocol(protocol: MeasurementProtocol): boolean {
    return protocol.metricIds.includes(FIXED_LOAD_VELOCITY_METRIC_ID);
}

export function assertFixedLoadContext(context: ObservationContext): void {
    for (const dimension of FIXED_LOAD_VELOCITY_DIMENSIONS) {
        const value = context[dimension];
        if (value === undefined || value === null) throw new Error(`Fixed-load context requires ${dimension}`);
        assertComparisonDimensionValue(dimension, value);
    }
}

/** Context belongs to the physical trial; callers cannot relabel it at save/correction time. */
export function assertFixedLoadComparisonContext(protocol: MeasurementProtocol, trials: readonly AssessmentTrial[], context: ObservationContext): void {
    if (!isFixedLoadVelocityProtocol(protocol)) return;
    assertFixedLoadContext(context);
    for (const trial of trials) {
        for (const dimension of FIXED_LOAD_VELOCITY_DIMENSIONS) {
            if (trial.context[dimension] !== context[dimension]) {
                throw new Error(`Trial ${trial.id} context ${dimension} differs from the locked comparison context`);
            }
        }
    }
}

export function assertFixedLoadTrialEligibility(trial: AssessmentTrial, protocol: MeasurementProtocol): void {
    if (!isFixedLoadVelocityProtocol(protocol)) return;
    assertFixedLoadContext(trial.context);
    assertFixedLoadSourceProvenance(trial);
    if (trial.validity !== 'valid') return;
    if (trial.values.load_kg !== trial.context.test_load_kg) {
        throw new Error(`Trial ${trial.id}: load must equal the locked test load; mark off-load repetitions as practice or invalid.`);
    }
    if (trial.values.successful !== true) {
        throw new Error(`Trial ${trial.id}: benchmark repetitions must be successful; mark failed lifts as practice or invalid.`);
    }
    const actualMethod = fixedLoadTrialMethod(trial);
    if (trial.context.measurement_method_id !== actualMethod) {
        throw new Error(`Trial ${trial.id}: actual velocity method ${actualMethod} differs from the locked measurement method. Use a separate attempt for a different method.`);
    }
}

function assertFixedLoadSourceProvenance(trial: AssessmentTrial): void {
    const wl = trial.context.wl_parser_version !== undefined;
    const openbar = trial.context.openbar_parser_version !== undefined;
    if ((wl && (openbar || !/^wl-analysis-csv:sha256:[a-f0-9]{64}$/.test(trial.sourceRef ?? '')))
        || (openbar && !/^openbar-analysis:sha256:[a-f0-9]{64}$/.test(trial.sourceRef ?? ''))
        || (!wl && !openbar && /^(wl-analysis-csv|openbar-analysis):/.test(trial.sourceRef ?? ''))) {
        throw new Error(`Trial ${trial.id}: imported velocity method provenance is incomplete or mixed`);
    }
}

function fixedLoadTrialMethod(trial: AssessmentTrial): string {
    assertFixedLoadSourceProvenance(trial);
    const c = trial.context;
    if (c.openbar_parser_version !== undefined) {
        const components = ['openbar_tracker_implementation', 'openbar_tracker_version', 'openbar_kinematics_implementation', 'openbar_kinematics_version',
            ...(c.openbar_kinematics_input === 'filtered' ? ['openbar_filter_implementation', 'openbar_filter_version'] : [])];
        if (components.some(key => typeof c[key] !== 'string' || !/^[a-z0-9_.!~*'()-]+$/i.test((c[key] as string).trim()))
            || typeof c.openbar_calibration_method !== 'string'
            || !/^[a-z0-9_.!~*'()-]+@-?[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/i.test(c.openbar_calibration_method.trim())) {
            throw new Error(`Trial ${trial.id}: fixed-load OpenBar requires canonical ASCII implementation/version and calibration components`);
        }
        const rawFilter = c.openbar_filter_implementation === null && c.openbar_filter_version === null && c.openbar_filter_parameters === null;
        const configuredFilter = typeof c.openbar_filter_implementation === 'string' && !!c.openbar_filter_implementation.trim()
            && typeof c.openbar_filter_version === 'string' && !!c.openbar_filter_version.trim()
            && (c.openbar_filter_parameters === null || isOpenBarParameterSignature(c.openbar_filter_parameters));
        if ((c.openbar_kinematics_input === 'calibrated' ? !rawFilter : !configuredFilter)
            || !isOpenBarParameterSignature(c.openbar_kinematics_parameters)
            || typeof c.openbar_kinematics_max_gap_s !== 'number' || c.openbar_kinematics_max_gap_s <= 0
            || typeof c.openbar_kinematics_min_confidence !== 'number' || c.openbar_kinematics_min_confidence < 0 || c.openbar_kinematics_min_confidence > 1) {
            throw new Error(`Trial ${trial.id}: OpenBar method configuration is invalid`);
        }
    }
    return velocityMeasurementMethodId(trial.device, trial.context);
}

/** The adapter stores canonical key=typed-percent-encoded-scalar parameter signatures. */
function isOpenBarParameterSignature(value: unknown): value is string {
    return typeof value === 'string' && /^[^=&[\];\s]+=[nbs]%3A[^&[\];\s]*(?:&[^=&[\];\s]+=[nbs]%3A[^&[\];\s]*)*$/.test(value);
}

/** Also applies to direct observation-service callers, independent of the capture UI. */
export function assertFixedLoadObservation(revision: MetricObservationRevision): void {
    if (revision.metricId !== FIXED_LOAD_VELOCITY_METRIC_ID) return;
    assertFixedLoadContext(revision.context);
    if (!['strength-bench-press-fixed-load-velocity', 'strength-back-squat-fixed-load-velocity'].includes(revision.protocolRef.id)
        || revision.protocolRef.revision !== 1 || revision.source !== 'derived' || revision.validity !== 'valid'
        || revision.value < 0 || revision.value > 5 || revision.derivedFromEvidenceRefs?.length !== 1
        || revision.derivedFromObservationIds !== undefined || revision.algorithmVersion !== 'assessment-reducer-v1') {
        throw new Error('Fixed-load velocity requires one valid dedicated trial-derived benchmark');
    }
}

export function assertFixedLoadObservationEvidence(revision: MetricObservationRevision, trial: AssessmentTrial): void {
    if (revision.metricId !== FIXED_LOAD_VELOCITY_METRIC_ID) return;
    if (trial.id !== revision.derivedFromEvidenceRefs?.[0].trialId || trial.assessmentAttemptId !== revision.assessmentAttemptId
        || trial.validity !== 'valid' || trial.values.successful !== true
        || trial.values.load_kg !== revision.context.test_load_kg
        || trial.values.mean_concentric_velocity_mps !== revision.value
        || fixedLoadTrialMethod(trial) !== revision.context.measurement_method_id) {
        throw new Error('Fixed-load observation must match its eligible source trial');
    }
    for (const dimension of FIXED_LOAD_VELOCITY_DIMENSIONS) {
        if (trial.context[dimension] !== revision.context[dimension]) throw new Error(`Fixed-load evidence context ${dimension} cannot change`);
    }
}
