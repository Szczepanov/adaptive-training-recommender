import type { AssessmentReducer, AssessmentTrial, MeasurementProtocol } from './models';
import { getMetricDefinition } from './registry';
import { resolveActiveAssessmentTrials } from './assessmentTrials';

export interface AssessmentReducerResult {
    metricId: string;
    value: number;
    unit: string;
    /** Active trial(s) that produced the value; one metric may come from a different trial than another. */
    sourceTrialIds: readonly string[];
    reducerVersion: string;
}

export type AssessmentReductionOutcome =
    | { status: 'derived'; result: AssessmentReducerResult }
    | { status: 'no_valid_trial'; metricId: string };

interface Candidate {
    trial: AssessmentTrial;
    value: number;
}

// Derived differences are rounded to remove binary floating-point noise (e.g. 250.3 - 230.1)
// from an otherwise exact tape-measure subtraction.
const DIFFERENCE_DECIMALS = 1e6;

function numericValue(trial: AssessmentTrial, fieldId: string): number {
    const value = trial.values[fieldId];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Valid trial ${trial.id} is missing numeric field ${fieldId}`);
    }
    return value;
}

function candidateFor(reducer: AssessmentReducer, trial: AssessmentTrial): Candidate | null {
    switch (reducer.kind) {
        case 'max_valid':
            return { trial, value: numericValue(trial, reducer.fieldId) };
        case 'max_valid_difference': {
            const raw = numericValue(trial, reducer.minuendFieldId) - numericValue(trial, reducer.subtrahendFieldId);
            const value = Math.round(raw * DIFFERENCE_DECIMALS) / DIFFERENCE_DECIMALS;
            if (value <= 0) {
                throw new Error(`Valid trial ${trial.id} yields a non-positive ${reducer.metricId}; correct or invalidate it`);
            }
            return { trial, value };
        }
        case 'highest_successful_load': {
            const successful = trial.values[reducer.successFieldId];
            if (typeof successful !== 'boolean') {
                throw new Error(`Valid trial ${trial.id} is missing boolean field ${reducer.successFieldId}`);
            }
            // A missed heavier attempt stays raw evidence but can never become the canonical 1RM.
            return successful ? { trial, value: numericValue(trial, reducer.loadFieldId) } : null;
        }
    }
}

/** Highest value wins; ties go to the earliest ordinal so the source trial is deterministic. */
function best(candidates: readonly Candidate[]): Candidate | null {
    return candidates.reduce<Candidate | null>((winner, candidate) => {
        if (!winner || candidate.value > winner.value) return candidate;
        if (candidate.value === winner.value && candidate.trial.ordinal < winner.trial.ordinal) return candidate;
        return winner;
    }, null);
}

/**
 * ADR-0046 D-AT-REDUCE: reduce the attempt's current (unsuperseded) trials to one canonical
 * value per protocol metric. Only `valid` trials count: practice, questionable and invalid
 * trials remain audit evidence. Outcomes are returned in protocol metric order.
 */
export function reduceAssessmentTrials(
    protocol: MeasurementProtocol,
    assessmentAttemptId: string,
    trials: readonly AssessmentTrial[],
): AssessmentReductionOutcome[] {
    const active = resolveActiveAssessmentTrials(trials, protocol, assessmentAttemptId);
    const capture = protocol.capture!;
    const validTrials = active.filter(trial => trial.validity === 'valid');

    return protocol.metricIds.map(metricId => {
        const reducer = capture.reducers.find(candidate => candidate.metricId === metricId)!;
        const winner = best(validTrials.flatMap(trial => candidateFor(reducer, trial) ?? []));
        if (!winner) return { status: 'no_valid_trial', metricId };
        return {
            status: 'derived',
            result: {
                metricId,
                value: winner.value,
                unit: getMetricDefinition(metricId).unit,
                sourceTrialIds: [winner.trial.id],
                reducerVersion: capture.reducerVersion,
            },
        };
    });
}
