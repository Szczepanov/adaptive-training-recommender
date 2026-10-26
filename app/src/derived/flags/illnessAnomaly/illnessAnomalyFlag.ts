import type { FlagEvaluation } from '../flagEvaluation.ts';
import type { PhysiologicalAnomalyAssessment, PhysiologicalAnomalyState } from './healthAnomalyModels';

export const ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION = 'illness_anomaly-v1';

/**
 * Owner decision Q3 (#962, 2026-10-25): only the strongest anomaly state raises the flag.
 * `watch_unexplained` and `symptoms_reported` stay visible in the assessment itself.
 */
const ACTIVE_STATES: ReadonlySet<PhysiologicalAnomalyState> = new Set(['possible_illness_or_systemic_stress']);

/** D-FLAGS illness/physiological anomaly (ADR-0025): a pure mapping of an existing assessment. */
export function evaluateIllnessAnomalyFlag(assessment: PhysiologicalAnomalyAssessment | null): FlagEvaluation {
    if (assessment === null) {
        return {
            id: 'illness_anomaly',
            active: null,
            state: 'missing',
            reasonCode: 'no_assessment',
            definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION,
        };
    }
    return {
        id: 'illness_anomaly',
        active: ACTIVE_STATES.has(assessment.state),
        state: 'measured',
        reasonCode: assessment.state,
        definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION,
    };
}
