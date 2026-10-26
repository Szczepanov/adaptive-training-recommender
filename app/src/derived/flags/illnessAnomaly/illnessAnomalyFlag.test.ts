import { describe, expect, it } from 'vitest';
import type { CoreSignalEvidence, PhysiologicalAnomalyAssessment, PhysiologicalAnomalyState } from './healthAnomalyModels';
import { evaluateIllnessAnomalyFlag, ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION } from './illnessAnomalyFlag';

const THRESHOLD_POLICY = 'health-anomaly-thresholds/shadow-candidate-v1';
const SOURCE = 'health_anomaly_assessment';
const VERSIONED = `${ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION}+${THRESHOLD_POLICY}`;

function coreSignals(available: number): CoreSignalEvidence[] {
    return (['rhr', 'hrv', 'respiration'] as const).map((signal, index) => ({
        signal,
        status: index < available ? 'normal' : 'unavailable',
    }) as CoreSignalEvidence);
}

function assessmentIn(state: PhysiologicalAnomalyState, available = 3): PhysiologicalAnomalyAssessment {
    return {
        state,
        mode: 'shadow-v1',
        thresholdPolicyVersion: THRESHOLD_POLICY,
        coreSignals: coreSignals(available),
    } as PhysiologicalAnomalyAssessment;
}

function inputsFor(state: PhysiologicalAnomalyState, available: number) {
    return [
        { name: 'anomaly_state', value: { value: state, source: SOURCE, state: 'measured' } },
        { name: 'assessment_mode', value: { value: 'shadow-v1', source: SOURCE, state: 'measured' } },
        { name: 'available_core_signals', value: { value: available, source: SOURCE, state: 'measured' } },
    ];
}

describe('evaluateIllnessAnomalyFlag', () => {
    it('cannot evaluate without an assessment', () => {
        expect(evaluateIllnessAnomalyFlag(null)).toEqual({
            id: 'illness_anomaly',
            active: null,
            state: 'missing',
            reasonCode: 'no_assessment',
            definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION,
            inputs: [{ name: 'anomaly_state', value: { value: null, source: SOURCE, state: 'missing' } }],
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
        const result = evaluateIllnessAnomalyFlag(assessmentIn(state));
        expect(result).toEqual({
            id: 'illness_anomaly',
            active,
            state: 'measured',
            reasonCode: state,
            definitionVersion: VERSIONED,
            inputs: inputsFor(state, 3),
            threshold: expect.stringContaining(THRESHOLD_POLICY),
        });
    });

    it.each<PhysiologicalAnomalyState>(['normal', 'symptoms_reported'])(
        'reports %s with no core signal as missing, never as a measured negative',
        state => {
            expect(evaluateIllnessAnomalyFlag(assessmentIn(state, 0))).toMatchObject({
                active: null,
                state: 'missing',
                reasonCode: 'no_core_signals',
                definitionVersion: VERSIONED,
                inputs: inputsFor(state, 0),
            });
        },
    );

    it('records partial core-signal coverage on a measured result', () => {
        expect(evaluateIllnessAnomalyFlag(assessmentIn('normal', 1))).toMatchObject({
            active: false,
            state: 'measured',
            inputs: inputsFor('normal', 1),
        });
    });
});
