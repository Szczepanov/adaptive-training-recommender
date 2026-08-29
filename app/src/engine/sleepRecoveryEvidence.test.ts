import { describe, it, expect } from 'vitest';
import { evaluateSleepRecoveryEvidence } from './sleepRecoveryEvidence';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput } from './models';

function baseObjective(overrides?: Partial<EngineObjectiveInput>): EngineObjectiveInput {
    return {
        total_steps: 8000,
        sleep_score: 80,
        sleep_duration_min: 460,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 60,
        hrv_last_night: 60,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 80,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: null,
        today_training: null,
        sleep_score_delta_7d: 0,
        rhr_delta_28d: 0,
        hrv_delta_28d: 0,
        sleep_score_delta_28d: 0,
        hrv_stdev_28d: 5,
        rhr_stdev_28d: 3,
        sleep_score_stdev_28d: 5,
        // No Phase 2 fields by default -- most tests set these explicitly per case.
        ...overrides,
    };
}

function baseSubjective(overrides?: Partial<SubjectiveInput>): SubjectiveInput {
    return {
        readiness: 7,
        sleepQuality: 7,
        fatigue: 4,
        soreness: 3,
        stress: 3,
        motivation: 7,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        ...overrides,
    };
}

function readiness(
    objectiveOverrides?: Partial<EngineObjectiveInput>,
    subjectiveOverrides?: Partial<SubjectiveInput>,
): DailyReadiness {
    return {
        objective: baseObjective(objectiveOverrides),
        subjective: baseSubjective(subjectiveOverrides),
    };
}

describe('evaluateSleepRecoveryEvidence', () => {
    it('is uncertain with low confidence when no sleep-duration baseline exists yet', () => {
        const result = evaluateSleepRecoveryEvidence(readiness({ sleep_duration_delta_7d_min: null }));
        expect(result.state).toBe('uncertain');
        expect(result.confidence).toBe('low');
        expect(result.acuteDurationDeficitMin).toBeNull();
        expect(result.subjectiveConcordance).toBeNull();
        expect(result.physiologicalConcordance).toBeNull();
        expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('is normal when sleep duration is at or above baseline', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: 10 }), // 10 min ABOVE baseline
        );
        expect(result.state).toBe('normal');
        expect(result.acuteDurationDeficitMin).toBe(-10); // negative = surplus
    });

    it('is minor_disruption for a small acute deficit', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: -30 }), // 30 min short
        );
        expect(result.state).toBe('minor_disruption');
        expect(result.acuteDurationDeficitMin).toBe(30);
    });

    it('is meaningful_sleep_deficit for a large acute deficit', () => {
        const result = evaluateSleepRecoveryEvidence(readiness({ sleep_duration_delta_7d_min: -75 }));
        expect(result.state).toBe('meaningful_sleep_deficit');
    });

    it('is meaningful_sleep_deficit when the 2-day accumulated deficit is large even if tonight alone is not', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({
                sleep_duration_delta_7d_min: -25, // below the meaningful acute threshold alone
                sleep_duration_accumulated_2d_deficit_min: 90,
            }),
        );
        expect(result.state).toBe('meaningful_sleep_deficit');
    });

    it('is persistent_sleep_deficit only when the 3-day accumulated deficit is large AND tonight is also short', () => {
        const persistent = evaluateSleepRecoveryEvidence(
            readiness({
                sleep_duration_delta_7d_min: -20,
                sleep_duration_accumulated_3d_deficit_min: 120,
            }),
        );
        expect(persistent.state).toBe('persistent_sleep_deficit');

        // A large 3-day accumulated deficit does NOT classify as persistent if tonight
        // itself was a recovery/surplus night -- a genuinely different situation.
        const recovered = evaluateSleepRecoveryEvidence(
            readiness({
                sleep_duration_delta_7d_min: 15, // tonight was a surplus night
                sleep_duration_accumulated_3d_deficit_min: 120,
            }),
        );
        expect(recovered.state).not.toBe('persistent_sleep_deficit');
    });

    it('accumulated deficit fields pass through unchanged (same sign convention)', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({
                sleep_duration_delta_7d_min: -40,
                sleep_duration_accumulated_2d_deficit_min: 55,
                sleep_duration_accumulated_3d_deficit_min: 70,
            }),
        );
        expect(result.accumulated2dDeficitMin).toBe(55);
        expect(result.accumulated3dDeficitMin).toBe(70);
    });

    it('confidence is high only with a mature 28d baseline and a 3d accumulated deficit', () => {
        const high = evaluateSleepRecoveryEvidence(
            readiness({
                sleep_duration_delta_7d_min: -10,
                sleep_duration_delta_28d_min: -5,
                sleep_duration_accumulated_3d_deficit_min: 30,
            }),
        );
        expect(high.confidence).toBe('high');

        const moderate = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: -10, sleep_duration_delta_28d_min: null }),
        );
        expect(moderate.confidence).toBe('moderate');
    });

    it('subjectiveConcordance agrees when low sleep quality accompanies an objective deficit', () => {
        const agree = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: -75 }, { sleepQuality: 3 }),
        );
        expect(agree.subjectiveConcordance).toBe(true);

        const disagree = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: -75 }, { sleepQuality: 9 }),
        );
        expect(disagree.subjectiveConcordance).toBe(false);
    });

    it('subjectiveConcordance is null when state is uncertain', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: null }, { sleepQuality: 2 }),
        );
        expect(result.subjectiveConcordance).toBeNull();
    });

    it('physiologicalConcordance agrees when HRV is suppressed alongside an objective deficit', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: -75, hrv_delta: -8, rhr_delta: 0 }),
        );
        expect(result.physiologicalConcordance).toBe(true);
    });

    it('physiologicalConcordance agrees when RHR is elevated alongside an objective deficit', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: -75, hrv_delta: 0, rhr_delta: 4 }),
        );
        expect(result.physiologicalConcordance).toBe(true);
    });

    it('physiologicalConcordance disagrees when neither HRV nor RHR moves in the expected direction', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: -75, hrv_delta: 5, rhr_delta: -2 }),
        );
        expect(result.physiologicalConcordance).toBe(false);
    });

    it('physiologicalConcordance is null when neither HRV nor RHR delta is available', () => {
        const result = evaluateSleepRecoveryEvidence(
            readiness({ sleep_duration_delta_7d_min: -75, hrv_delta: null, rhr_delta: null }),
        );
        expect(result.physiologicalConcordance).toBeNull();
    });

    it('evidence is always non-empty', () => {
        const normal = evaluateSleepRecoveryEvidence(readiness({ sleep_duration_delta_7d_min: 0 }));
        expect(normal.evidence.length).toBeGreaterThan(0);
        const uncertain = evaluateSleepRecoveryEvidence(readiness({ sleep_duration_delta_7d_min: null }));
        expect(uncertain.evidence.length).toBeGreaterThan(0);
    });
});
