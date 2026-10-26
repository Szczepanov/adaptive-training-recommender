import type { FlagEvaluation } from '../flagEvaluation.ts';
import type { PhysiologicalAnomalyAssessment, PhysiologicalAnomalyState } from './healthAnomalyModels';

export const ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION = 'illness_anomaly-v1';

const ASSESSMENT_SOURCE = 'health_anomaly_assessment';

/**
 * Owner decision Q3 (#962, 2026-10-25): only the strongest anomaly state raises the flag.
 * `watch_unexplained` and `symptoms_reported` stay visible in the assessment itself.
 */
const ACTIVE_STATES: ReadonlySet<PhysiologicalAnomalyState> = new Set(['possible_illness_or_systemic_stress']);

/**
 * D-FLAGS illness/physiological anomaly (ADR-0025): a pure mapping of an existing assessment.
 * It does not apply the HA7 (#641) release gate: `assessment_mode` is recorded as an input so
 * whoever surfaces the flag can tell a shadow assessment from a released one.
 */
export function evaluateIllnessAnomalyFlag(assessment: PhysiologicalAnomalyAssessment | null): FlagEvaluation {
    if (assessment === null) {
        return {
            id: 'illness_anomaly',
            active: null,
            state: 'missing',
            reasonCode: 'no_assessment',
            definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION,
            inputs: [{ name: 'anomaly_state', value: { value: null, source: ASSESSMENT_SOURCE, state: 'missing' } }],
            threshold: null,
        };
    }
    // The evaluator reports 'normal' when every core signal is unavailable; that is "nothing
    // measured", not "measured and clear", so it must not read as a negative (D-EXPORT).
    const availableCoreSignals = assessment.coreSignals.filter(signal => signal.status !== 'unavailable').length;
    const inputs: FlagEvaluation['inputs'] = [
        { name: 'anomaly_state', value: { value: assessment.state, source: ASSESSMENT_SOURCE, state: 'measured' } },
        { name: 'assessment_mode', value: { value: assessment.mode, source: ASSESSMENT_SOURCE, state: 'measured' } },
        { name: 'available_core_signals', value: { value: availableCoreSignals, source: ASSESSMENT_SOURCE, state: 'measured' } },
    ];
    const definitionVersion = `${ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION}+${assessment.thresholdPolicyVersion}`;
    const threshold = 'Active when the physiological anomaly state is possible_illness_or_systemic_stress '
        + `(persistent unexplained multi-signal anomaly) under ${assessment.thresholdPolicyVersion}`;
    if (availableCoreSignals === 0) {
        return {
            id: 'illness_anomaly',
            active: null,
            state: 'missing',
            reasonCode: 'no_core_signals',
            definitionVersion,
            inputs,
            threshold,
        };
    }
    return {
        id: 'illness_anomaly',
        active: ACTIVE_STATES.has(assessment.state),
        state: 'measured',
        reasonCode: assessment.state,
        definitionVersion,
        inputs,
        threshold,
    };
}
