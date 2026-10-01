import { assessmentTrialIdFor } from '../assessmentTrials';
import type { AssessmentAttempt, AssessmentTrial, AssessmentTrialScalar } from '../models';

/** Synthetic test-only builders for ADR-0046 raw assessment trials. */

export const TRIAL_ATTEMPT_ID = 'assessment-field-standing-broad-jump-r1-attempt';

export function trialAttempt(overrides: Partial<AssessmentAttempt> = {}): AssessmentAttempt {
    return {
        id: TRIAL_ATTEMPT_ID,
        protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
        scheduledDate: '2026-10-19',
        startedAt: '2026-10-19T07:00:00.000Z',
        state: 'in_progress',
        purpose: 'baseline',
        ...overrides,
    };
}

export function makeTrial(
    ordinal: number,
    values: Readonly<Record<string, AssessmentTrialScalar>>,
    overrides: Partial<AssessmentTrial> = {},
): AssessmentTrial {
    const correctionIndex = overrides.correctionIndex ?? 0;
    return {
        id: assessmentTrialIdFor(ordinal, correctionIndex),
        assessmentAttemptId: TRIAL_ATTEMPT_ID,
        ordinal,
        correctionIndex,
        ...(correctionIndex > 0 ? {
            supersedesTrialId: assessmentTrialIdFor(ordinal, correctionIndex - 1),
            correctionReason: 'Tape read incorrectly',
        } : {}),
        validity: 'valid',
        values,
        context: {},
        createdAt: '2026-10-19T07:30:00.000Z',
        ...overrides,
    };
}
