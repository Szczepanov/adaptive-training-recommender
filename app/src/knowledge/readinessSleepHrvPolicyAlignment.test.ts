import { describe, expect, it } from 'vitest';
import { computeInternalResponseStrain } from '../engine/fatigue';
import { evaluateReadinessAndSafetyEnvelope } from '../engine/rules';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from '../engine/models';
import {
    classifyRecoveryMetric,
    RECOVERY_VARIABILITY_FLOORS,
    SLEEP_SCORE_ABSOLUTE_FLOOR,
    type RecoveryMetric,
} from '../derived/flags/recoveryBeyondBaseline';
import { ENGINE_KNOWLEDGE_COVERAGE } from './knowledgeCoverage';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false,
        },
    };
}

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 9, sleepQuality: 9, fatigue: 2, soreness: 2, stress: 3, motivation: 9,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        ...overrides,
    };
}

function objective(overrides: Partial<EngineObjectiveInput> = {}): EngineObjectiveInput {
    return {
        total_steps: 8000,
        sleep_score: 85,
        sleep_duration_min: 450,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 50,
        hrv_last_night: 50,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 85,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: null,
        today_training: null,
        sleep_score_delta_7d: 0,
        rhr_delta_28d: 0,
        hrv_delta_28d: 0,
        sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5,
        rhr_stdev_28d: 3.5,
        sleep_score_stdev_28d: 7.8,
        respiration_delta: 0,
        respiration_delta_28d: 0,
        respiration_mad_28d: 1,
        ...overrides,
    };
}

function readiness(objectiveOverrides: Partial<EngineObjectiveInput> = {}, subjectiveOverrides: Partial<SubjectiveInput> = {}): DailyReadiness {
    return { subjective: subjective(subjectiveOverrides), objective: objective(objectiveOverrides) };
}

describe('readiness evidence pack aligns with current decision policy', () => {
    it('does not treat a modest isolated HRV dip inside personal variability as a hard stop', () => {
        const state = evaluateReadinessAndSafetyEnvelope(readiness({ hrv_delta: -6, hrv_delta_28d: -6 }), context());
        expect(state.mode).toBe('train');
        expect(state.telemetry.metricStrain.acuteDeviation).toBeLessThan(1);
    });

    it('keeps a small RHR elevation contextual when it remains inside personal variability', () => {
        const state = evaluateReadinessAndSafetyEnvelope(readiness({ rhr_delta: 2, rhr_delta_28d: 2, rhr_stdev_28d: 3.5 }), context());
        expect(state.mode).toBe('train');
        expect(state.telemetry.metricStrain.acuteDeviation).toBeCloseTo(0.17, 2);
    });

    it('pins the current RHR and HRV acute modify floors as product policy', () => {
        const elevatedRhr = evaluateReadinessAndSafetyEnvelope(readiness({ rhr_delta: 6, rhr_delta_28d: 6, rhr_stdev_28d: 3 }), context());
        expect(elevatedRhr.telemetry.metricStrain.acuteDeviation).toBe(0.6);
        expect(elevatedRhr.mode).toBe('modify');

        const depressedHrv = evaluateReadinessAndSafetyEnvelope(readiness({ hrv_delta: -15, hrv_delta_28d: -15, hrv_stdev_28d: 7.5 }), context());
        expect(depressedHrv.telemetry.metricStrain.acuteDeviation).toBe(1);
        expect(depressedHrv.mode).toBe('modify');
    });

    it('pins respiration as a bounded contextual contribution rather than a standalone hard stop', () => {
        const elevatedRespiration = evaluateReadinessAndSafetyEnvelope(readiness({
            respiration_delta: 2,
            respiration_delta_28d: 2,
            respiration_mad_28d: 1,
        }), context());
        expect(elevatedRespiration.telemetry.metricStrain.acuteDeviation).toBe(0.6);
        expect(elevatedRespiration.mode).toBe('train');
    });

    it('pins the absolute sleep-score penalty boundary without claiming it is a clinical threshold', () => {
        const below = evaluateReadinessAndSafetyEnvelope(readiness({ sleep_score: 49 }), context());
        const at = evaluateReadinessAndSafetyEnvelope(readiness({ sleep_score: 50 }), context());
        expect(below.telemetry.contextPenalties.sleepFloorPenalty).toBe(0.5);
        expect(at.telemetry.contextPenalties.sleepFloorPenalty).toBe(0);
    });

    it('pins the current Body Battery hard recover threshold', () => {
        const atThreshold = evaluateReadinessAndSafetyEnvelope(readiness({ body_battery_wake: 20 }), context());
        const justAbove = evaluateReadinessAndSafetyEnvelope(readiness({ body_battery_wake: 21 }), context());
        expect(atThreshold.mode).toBe('recover');
        expect(justAbove.mode).toBe('train');
    });

    it('pins the internal-response normalization and fusion coefficients', () => {
        const strain = computeInternalResponseStrain(readiness(
            { hrv_delta: -15, rhr_delta: 10, sleep_score: 25, body_battery_wake: 20 },
            { fatigue: 10, soreness: 1, motivation: 10 },
        ));
        expect(strain).toEqual({
            systemic: 1,
            cardiovascular: 1,
            lowerBody: 0,
            upperBody: 0,
            impactTissue: 0,
            neuromuscular: 0.5,
        });
    });

    it('pins each unsaturated systemic fusion weight so the registered weights cannot drift', () => {
        // fatigue 1 zeroes the subjective term, leaving each objective signal isolated.
        const systemic = (objectiveOverrides: Partial<EngineObjectiveInput>, subjectiveOverrides: Partial<SubjectiveInput> = {}) =>
            computeInternalResponseStrain(readiness(objectiveOverrides, { fatigue: 1, ...subjectiveOverrides })).systemic;

        expect(systemic({})).toBe(0);
        expect(systemic({}, { fatigue: 7 })).toBeCloseTo(0.3 * (6 / 9), 10);
        expect(systemic({ hrv_delta: -15 })).toBeCloseTo(0.25, 10);
        expect(systemic({ sleep_score: 25 })).toBeCloseTo(0.25, 10);
        expect(systemic({ body_battery_wake: 20 })).toBeCloseTo(0.2, 10);
        expect(systemic({ hrv_delta: -15, sleep_score: 25, body_battery_wake: 20 }, { fatigue: 7 })).toBeCloseTo(0.9, 10);

        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.internalResponseStrainModel);
        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'fatigue.internal_response_model');
        expect(claim.statement).toContain('0.3 subjective fatigue + 0.25 HRV + 0.25 sleep + 0.2 Body Battery');
        expect(coverage?.currentRule).toContain('0.3 subjective fatigue +0.25 HRV +0.25 sleep +0.2 Body Battery');
    });

    it('pins the non-diluted internal-response floors and their cut-points', () => {
        const strain = (objectiveOverrides: Partial<EngineObjectiveInput>, subjectiveOverrides: Partial<SubjectiveInput> = {}) =>
            computeInternalResponseStrain(readiness(objectiveOverrides, subjectiveOverrides));

        expect(strain({}, { fatigue: 8 }).systemic).toBe(0.60);
        expect(strain({}, { fatigue: 8, readiness: 4 }).systemic).toBe(0.65);
        expect(strain({}, { fatigue: 8, stress: 8 }).systemic).toBe(0.65);
        expect(strain({}, { readiness: 3, stress: 8 }).systemic).toBe(0.65);
        expect(strain({}, { stress: 9 }).systemic).toBe(0.60);
        expect(strain({}, { stress: 8 }).systemic).toBeLessThan(0.60);

        const concordant = strain({ hrv_delta: -10, rhr_delta: 5, body_battery_wake: 35 });
        expect(concordant.systemic).toBe(0.80);
        expect(concordant.cardiovascular).toBe(0.80);
        expect(strain({ hrv_delta: -9, rhr_delta: 5, body_battery_wake: 35 }).cardiovascular).toBeLessThan(0.80);

        const sore = strain({}, { soreness: 8 });
        expect(sore.lowerBody).toBe(0.88);
        expect(sore.impactTissue).toBe(0.88);
        expect(sore.upperBody).toBeCloseTo(0.88 * 0.7, 10);
        expect(strain({}, { soreness: 7 }).lowerBody).toBeCloseTo(6 / 9, 10);
    });
});

describe('derived recovery_beyond_baseline floors match rules.ts (#1144 PR1-5)', () => {
    // rules.ts keeps a private copy of these floors until ADR-0052 Phase 3. Each derived floor
    // must still be exactly one engine z-unit: with no 28-day stdev, a floor-sized adverse
    // delta yields acuteDeviation = weight, and 90% of it stays below. 7d and 28d deltas are
    // equal so the multi-day drift term is zero.
    const cases: Array<[RecoveryMetric, number, -1 | 1, (delta: number) => Partial<EngineObjectiveInput>]> = [
        ['hrv', 0.5, -1, delta => ({ hrv_delta: delta, hrv_delta_28d: delta })],
        ['rhr', 0.3, 1, delta => ({ rhr_delta: delta, rhr_delta_28d: delta })],
        ['sleep', 0.2, -1, delta => ({ sleep_score_delta_7d: delta, sleep_score_delta_28d: delta })],
    ];
    const noStdev: Partial<EngineObjectiveInput> = { hrv_stdev_28d: null, rhr_stdev_28d: null, sleep_score_stdev_28d: null };
    const acute = (overrides: Partial<EngineObjectiveInput>) =>
        evaluateReadinessAndSafetyEnvelope(readiness({ ...noStdev, ...overrides }), context()).telemetry.metricStrain.acuteDeviation;

    it.each(cases)('%s: a floor-sized adverse delta is one engine z-unit and adverse in the derived flag', (metric, weight, sign, engineDelta) => {
        const floor = RECOVERY_VARIABILITY_FLOORS[metric];
        expect(acute(engineDelta(sign * floor))).toBeCloseTo(weight, 2);
        expect(acute(engineDelta(sign * floor * 0.9))).toBeLessThan(weight);
        const derived = (delta: number) =>
            classifyRecoveryMetric(metric, { current: metric === 'sleep' ? 78 : 60, delta7d: delta, sd28d: null, metricDate: '2026-09-25' }, '2026-09-25');
        expect(derived(sign * floor)).toMatchObject({ reasonCode: 'adverse_vs_baseline', band: floor });
        expect(derived(sign * floor * 0.9).reasonCode).toBe('at_baseline');
    });

    it('sleep absolute floor: engine penalty and derived adverse verdict share the same boundary', () => {
        const engine = (sleepScore: number) =>
            evaluateReadinessAndSafetyEnvelope(readiness({ sleep_score: sleepScore }), context()).telemetry.contextPenalties.sleepFloorPenalty;
        const derived = (sleepScore: number) =>
            classifyRecoveryMetric('sleep', { current: sleepScore, delta7d: 0, sd28d: null, metricDate: '2026-09-25' }, '2026-09-25').reasonCode;
        expect(engine(SLEEP_SCORE_ABSOLUTE_FLOOR - 1)).toBe(0.5);
        expect(engine(SLEEP_SCORE_ABSOLUTE_FLOOR)).toBe(0);
        expect(derived(SLEEP_SCORE_ABSOLUTE_FLOOR - 1)).toBe('below_absolute_floor');
        expect(derived(SLEEP_SCORE_ABSOLUTE_FLOOR)).toBe('at_baseline');
    });

    it('lists the derived evaluator on the physiological strain coverage item', () => {
        const coverage = ENGINE_KNOWLEDGE_COVERAGE.find(item => item.id === 'readiness.physiological_strain_model');
        expect(coverage?.codeRefs).toContain('derived/flags/recoveryBeyondBaseline.ts:RECOVERY_VARIABILITY_FLOORS');
        expect(coverage?.currentRule).toContain('variability floors 3 ms/1.5 bpm/4 points');
    });
});
