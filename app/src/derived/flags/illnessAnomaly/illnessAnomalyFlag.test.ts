import { describe, expect, it } from 'vitest';
import type { PhysiologicalAnomalyAssessment, PhysiologicalAnomalyState } from './healthAnomalyModels';
import { evaluateIllnessAnomalyFlag, ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION } from './illnessAnomalyFlag';

const THRESHOLD_POLICY = 'health-anomaly-thresholds/shadow-candidate-v1';

function assessmentIn(state: PhysiologicalAnomalyState): PhysiologicalAnomalyAssessment {
    return { state, mode: 'shadow-v1', thresholdPolicyVersion: THRESHOLD_POLICY } as PhysiologicalAnomalyAssessment;
}

describe('evaluateIllnessAnomalyFlag', () => {
    it('cannot evaluate without an assessment', () => {
        expect(evaluateIllnessAnomalyFlag(null)).toEqual({
            id: 'illness_anomaly',
            active: null,
            state: 'missing',
            reasonCode: 'no_assessment',
            definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION,
            inputs: [{ name: 'anomaly_state', value: { value: null, source: 'health_anomaly_assessment', state: 'missing' } }],
            threshold: null,
        });
    });

    it.each([
        ['possible_illness_or_systemic_stress', true],
        ['watch_unexplained', false],
        ['symptoms_reported', false],
        ['explained_recovery_strain', false],
        ['normal', false],
    ] satisfies Array<[PhysiologicalAnomalyState, boolean]>)('maps %s to active=%s', (state, active) => {
        expect(evaluateIllnessAnomalyFlag(assessmentIn(state))).toEqual({
            id: 'illness_anomaly',
            active,
            state: 'measured',
            reasonCode: state,
            definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION,
            inputs: [
                { name: 'anomaly_state', value: { value: state, source: 'health_anomaly_assessment', state: 'measured' } },
                { name: 'assessment_mode', value: { value: 'shadow-v1', source: 'health_anomaly_assessment', state: 'measured' } },
            ],
            threshold: THRESHOLD_POLICY,
        });
    });
});
