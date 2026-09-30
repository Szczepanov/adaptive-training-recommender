import { describe, expect, it } from 'vitest';
import {
    assertAssessmentTrialWriteAllowed,
    assertValidAssessmentTrial,
    assertValidAssessmentTrialSet,
    assessmentTrialIdFor,
    resolveActiveAssessmentTrials,
} from './assessmentTrials';
import { makeTrial, TRIAL_ATTEMPT_ID, trialAttempt } from './fixtures/assessmentTrialFixtures';
import { getPerformanceTestDefinition } from './performanceTestingCatalog';
import { BENCH_PRESS_1RM_PROTOCOL, STANDING_BROAD_JUMP_PROTOCOL } from './physicalCapitalProtocols';

const jump = STANDING_BROAD_JUMP_PROTOCOL;

describe('ADR-0046 raw trial validation', () => {
    it('derives deterministic ids from ordinal and correction index', () => {
        expect(assessmentTrialIdFor(2)).toBe('trial-2');
        expect(assessmentTrialIdFor(2, 1)).toBe('trial-2-c1');
        expect(() => assertValidAssessmentTrial(makeTrial(1, { distance_cm: 230 }, { id: 'trial-9' }), jump)).toThrow(/Trial id must equal trial-1/);
    });

    it('rejects trials for summary-only protocols', () => {
        const summaryOnly = getPerformanceTestDefinition('cycling-20m-tt-r1').protocol;
        expect(() => assertValidAssessmentTrial(makeTrial(1, {}), summaryOnly)).toThrow(/does not declare trial capture/);
    });

    it('bounds ordinal by the protocol maxTrials', () => {
        expect(() => assertValidAssessmentTrial(makeTrial(0, { distance_cm: 230 }), jump)).toThrow(/ordinal must be an integer from 1 to 6/);
        expect(() => assertValidAssessmentTrial(makeTrial(7, { distance_cm: 230 }), jump)).toThrow(/ordinal must be an integer from 1 to 6/);
    });

    it('fails closed on undeclared fields, wrong types, non-finite and out-of-range values', () => {
        expect(() => assertValidAssessmentTrial(makeTrial(1, { distance_cm: 230, height_cm: 50 }), jump)).toThrow(/height_cm is not declared/);
        expect(() => assertValidAssessmentTrial(makeTrial(1, { distance_cm: '230' as never }), jump)).toThrow(/requires a finite number in cm/);
        expect(() => assertValidAssessmentTrial(makeTrial(1, { distance_cm: Number.NaN }), jump)).toThrow(/requires a finite number/);
        expect(() => assertValidAssessmentTrial(makeTrial(1, { distance_cm: 900 }), jump)).toThrow(/within 1-400 cm/);
        expect(() => assertValidAssessmentTrial(makeTrial(1, { load_kg: 100, successful: 'yes' as never }), BENCH_PRESS_1RM_PROTOCOL)).toThrow(/requires a boolean/);
    });

    it('requires measured fields only on usable (valid/questionable) trials', () => {
        expect(() => assertValidAssessmentTrial(makeTrial(1, {}), jump)).toThrow(/requires field distance_cm/);
        expect(() => assertValidAssessmentTrial(makeTrial(1, {}, { validity: 'questionable' }), jump)).toThrow(/requires field distance_cm/);
        expect(() => assertValidAssessmentTrial(makeTrial(1, {}, { validity: 'invalid', invalidReason: 'Stepped back' }), jump)).not.toThrow();
        expect(() => assertValidAssessmentTrial(makeTrial(1, {}, { validity: 'practice' }), jump)).not.toThrow();
    });

    it('requires a reason for invalid trials', () => {
        expect(() => assertValidAssessmentTrial(makeTrial(1, { distance_cm: 230 }, { validity: 'invalid' }), jump)).toThrow(/invalidReason is required/);
    });

    it('rejects non-scalar context', () => {
        expect(() => assertValidAssessmentTrial(makeTrial(1, { distance_cm: 230 }, { context: { surface: { nested: true } as never } }), jump))
            .toThrow(/must be a scalar or null/);
    });

    it('requires supersession to point at the previous correction of the same ordinal with a reason', () => {
        const correction = makeTrial(1, { distance_cm: 231 }, { correctionIndex: 1 });
        expect(() => assertValidAssessmentTrial(correction, jump)).not.toThrow();
        expect(() => assertValidAssessmentTrial({ ...correction, supersedesTrialId: 'trial-2' }, jump)).toThrow(/must supersede trial-1/);
        expect(() => assertValidAssessmentTrial({ ...correction, correctionReason: ' ' }, jump)).toThrow(/correctionReason is required/);
        expect(() => assertValidAssessmentTrial(makeTrial(1, { distance_cm: 230 }, { supersedesTrialId: 'trial-1' }), jump))
            .toThrow(/original trial cannot declare/);
    });
});

describe('ADR-0046 trial sets and active-trial resolution', () => {
    it('uses the latest unsuperseded record for each ordinal', () => {
        const trials = [
            makeTrial(2, { distance_cm: 240 }),
            makeTrial(1, { distance_cm: 230 }),
            makeTrial(1, { distance_cm: 232 }, { correctionIndex: 1 }),
            makeTrial(1, { distance_cm: 233 }, { correctionIndex: 2, supersedesTrialId: 'trial-1-c1' }),
        ];
        expect(resolveActiveAssessmentTrials(trials, jump, TRIAL_ATTEMPT_ID).map(trial => trial.id)).toEqual(['trial-1-c2', 'trial-2']);
    });

    it('rejects a broken correction chain, duplicates and foreign-attempt trials', () => {
        expect(() => assertValidAssessmentTrialSet([makeTrial(1, { distance_cm: 232 }, { correctionIndex: 1 })], jump, TRIAL_ATTEMPT_ID))
            .toThrow(/supersedes missing trial trial-1/);
        expect(() => assertValidAssessmentTrialSet([makeTrial(1, { distance_cm: 230 }), makeTrial(1, { distance_cm: 230 })], jump, TRIAL_ATTEMPT_ID))
            .toThrow(/Duplicate trial id/);
        expect(() => assertValidAssessmentTrialSet([makeTrial(1, { distance_cm: 230 }, { assessmentAttemptId: 'other' })], jump, TRIAL_ATTEMPT_ID))
            .toThrow(/belongs to attempt other/);
    });
});

describe('ADR-0046 D-AT-CORRECTION trial write lifecycle', () => {
    const original = makeTrial(1, { distance_cm: 230 });
    const correction = makeTrial(1, { distance_cm: 231 }, { correctionIndex: 1 });

    it('admits new ordinals and corrections while in progress', () => {
        expect(() => assertAssessmentTrialWriteAllowed(trialAttempt(), original)).not.toThrow();
        expect(() => assertAssessmentTrialWriteAllowed(trialAttempt(), correction)).not.toThrow();
    });

    it('admits only corrections after completion', () => {
        const completed = trialAttempt({ state: 'completed', completedAt: '2026-10-19T08:00:00.000Z' });
        expect(() => assertAssessmentTrialWriteAllowed(completed, original)).toThrow(/only accepts supersession/);
        expect(() => assertAssessmentTrialWriteAllowed(completed, correction)).not.toThrow();
    });

    it('admits nothing on scheduled or abandoned attempts', () => {
        const scheduled = trialAttempt({ state: 'scheduled', startedAt: undefined });
        expect(() => assertAssessmentTrialWriteAllowed(scheduled, original)).toThrow(/scheduled attempt/);
        expect(() => assertAssessmentTrialWriteAllowed(trialAttempt({ state: 'abandoned' }), correction)).toThrow(/abandoned attempt/);
    });

    it('rejects a trial addressed to another attempt', () => {
        expect(() => assertAssessmentTrialWriteAllowed(trialAttempt({ id: 'other' }), original)).toThrow(/does not belong to attempt other/);
    });
});
