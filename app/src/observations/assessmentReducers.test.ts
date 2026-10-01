import { describe, expect, it } from 'vitest';
import { reduceAssessmentTrials, type AssessmentReductionOutcome } from './assessmentReducers';
import { makeTrial, TRIAL_ATTEMPT_ID } from './fixtures/assessmentTrialFixtures';
import type { AssessmentTrial, MeasurementProtocol } from './models';
import {
    BENCH_PRESS_1RM_PROTOCOL,
    CYCLING_6S_SEATED_SPRINT_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
    WALL_TOUCH_CMJ_PROTOCOL,
} from './physicalCapitalProtocols';

function reduce(protocol: MeasurementProtocol, trials: readonly AssessmentTrial[]): AssessmentReductionOutcome[] {
    return reduceAssessmentTrials(protocol, TRIAL_ATTEMPT_ID, trials);
}

function derived(outcome: AssessmentReductionOutcome) {
    if (outcome.status !== 'derived') throw new Error(`expected derived, got ${outcome.status}`);
    return outcome.result;
}

describe('ADR-0046 D-AT-REDUCE max_valid (broad jump / throw)', () => {
    it('selects the best valid distance and names its source trial', () => {
        const [outcome] = reduce(STANDING_BROAD_JUMP_PROTOCOL, [
            makeTrial(1, { distance_cm: 231 }),
            makeTrial(2, { distance_cm: 238 }),
            makeTrial(3, { distance_cm: 235 }),
        ]);
        expect(derived(outcome)).toEqual({
            metricId: 'standing_broad_jump_distance_cm',
            value: 238,
            unit: 'cm',
            sourceTrialIds: ['trial-2'],
            reducerVersion: 'assessment-reducer-v1',
        });
    });

    it('ignores an invalid best jump and practice/questionable trials', () => {
        const [outcome] = reduce(STANDING_BROAD_JUMP_PROTOCOL, [
            makeTrial(1, { distance_cm: 250 }, { validity: 'invalid', invalidReason: 'Fell backward' }),
            makeTrial(2, { distance_cm: 260 }, { validity: 'practice' }),
            makeTrial(3, { distance_cm: 255 }, { validity: 'questionable' }),
            makeTrial(4, { distance_cm: 236 }),
        ]);
        expect(derived(outcome)).toMatchObject({ value: 236, sourceTrialIds: ['trial-4'] });
    });

    it('breaks ties toward the earliest ordinal', () => {
        const [outcome] = reduce(STANDING_BROAD_JUMP_PROTOCOL, [
            makeTrial(1, { distance_cm: 238 }),
            makeTrial(2, { distance_cm: 238 }),
        ]);
        expect(derived(outcome).sourceTrialIds).toEqual(['trial-1']);
    });

    it('uses only the corrected (unsuperseded) record of an ordinal', () => {
        const [outcome] = reduce(STANDING_BROAD_JUMP_PROTOCOL, [
            makeTrial(1, { distance_cm: 283 }),
            makeTrial(1, { distance_cm: 238 }, { correctionIndex: 1 }),
            makeTrial(2, { distance_cm: 236 }),
        ]);
        expect(derived(outcome)).toMatchObject({ value: 238, sourceTrialIds: ['trial-1-c1'] });
    });

    it('returns no canonical benchmark when there is no valid trial', () => {
        expect(reduce(STANDING_BROAD_JUMP_PROTOCOL, [
            makeTrial(1, {}, { validity: 'invalid', invalidReason: 'Stepped' }),
            makeTrial(2, { distance_cm: 240 }, { validity: 'practice' }),
        ])).toEqual([{ status: 'no_valid_trial', metricId: 'standing_broad_jump_distance_cm' }]);
        expect(reduce(STANDING_BROAD_JUMP_PROTOCOL, [])).toEqual([{ status: 'no_valid_trial', metricId: 'standing_broad_jump_distance_cm' }]);
    });
});

describe('ADR-0046 D-AT-REDUCE max_valid_difference (wall-touch CMJ)', () => {
    it('derives jump height as touch minus standing reach without floating-point noise', () => {
        const [outcome] = reduce(WALL_TOUCH_CMJ_PROTOCOL, [
            makeTrial(1, { standing_reach_cm: 230.1, touch_height_cm: 280.3 }),
            makeTrial(2, { standing_reach_cm: 230.1, touch_height_cm: 283.4 }),
        ]);
        expect(derived(outcome)).toMatchObject({ value: 53.3, unit: 'cm', sourceTrialIds: ['trial-2'] });
    });

    it('fails closed on a valid trial whose touch height is not above standing reach', () => {
        expect(() => reduce(WALL_TOUCH_CMJ_PROTOCOL, [makeTrial(1, { standing_reach_cm: 230, touch_height_cm: 229 })]))
            .toThrow(/non-positive wall_touch_cmj_height_cm/);
    });
});

describe('ADR-0046 D-AT-REDUCE highest_successful_load (1RM)', () => {
    it('keeps a failed heavier attempt as evidence but never as the canonical 1RM', () => {
        const [outcome] = reduce(BENCH_PRESS_1RM_PROTOCOL, [
            makeTrial(1, { load_kg: 60, successful: true }, { validity: 'practice' }),
            makeTrial(2, { load_kg: 100, successful: true, mean_concentric_velocity_mps: 0.35 }),
            makeTrial(3, { load_kg: 107.5, successful: true, rpe: 9.5 }),
            makeTrial(4, { load_kg: 112.5, successful: false }),
        ]);
        expect(derived(outcome)).toEqual({
            metricId: 'strength_1rm_kg',
            value: 107.5,
            unit: 'kg',
            sourceTrialIds: ['trial-3'],
            reducerVersion: 'assessment-reducer-v1',
        });
    });

    it('excludes a technically invalid successful-looking lift', () => {
        const [outcome] = reduce(BENCH_PRESS_1RM_PROTOCOL, [
            makeTrial(1, { load_kg: 100, successful: true }),
            makeTrial(2, { load_kg: 110, successful: true }, { validity: 'invalid', invalidReason: 'Spotter touched the bar' }),
        ]);
        expect(derived(outcome).value).toBe(100);
    });

    it('returns no benchmark when every attempt missed', () => {
        expect(reduce(BENCH_PRESS_1RM_PROTOCOL, [makeTrial(1, { load_kg: 120, successful: false })]))
            .toEqual([{ status: 'no_valid_trial', metricId: 'strength_1rm_kg' }]);
    });
});

describe('ADR-0046 D-AT-REDUCE multi-metric cycling sprint', () => {
    it('lets the 1 s peak and 5 s mean come from different trials', () => {
        const outcomes = reduce(CYCLING_6S_SEATED_SPRINT_PROTOCOL, [
            makeTrial(1, { peak_power_1s_w: 1310, mean_power_5s_w: 1150, peak_cadence_rpm: 128 }),
            makeTrial(2, { peak_power_1s_w: 1290, mean_power_5s_w: 1195, left_balance_pct: 49 }),
            makeTrial(3, { peak_power_1s_w: 1275, mean_power_5s_w: 1180 }),
        ]);
        expect(outcomes.map(derived).map(({ metricId, value, sourceTrialIds }) => ({ metricId, value, sourceTrialIds }))).toEqual([
            { metricId: 'cycling_sprint_1s_peak_power_w', value: 1310, sourceTrialIds: ['trial-1'] },
            { metricId: 'cycling_sprint_5s_mean_power_w', value: 1195, sourceTrialIds: ['trial-2'] },
        ]);
    });
});
