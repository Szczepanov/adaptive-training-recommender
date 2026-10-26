import { describe, expect, it } from 'vitest';
import type { PhysiologicalAnomalyAssessment, PhysiologicalAnomalyState } from './healthAnomalyModels';
import { evaluateIllnessAnomalyFlag, ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION } from './illnessAnomalyFlag';

function assessmentIn(state: PhysiologicalAnomalyState): PhysiologicalAnomalyAssessment {
    return { state } as PhysiologicalAnomalyAssessment;
}

describe('evaluateIllnessAnomalyFlag', () => {
    it('cannot evaluate without an assessment', () => {
        expect(evaluateIllnessAnomalyFlag(null)).toEqual({
            id: 'illness_anomaly',
            active: null,
            state: 'missing',
            reasonCode: 'no_assessment',
            definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION,
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
        });
    });
});
