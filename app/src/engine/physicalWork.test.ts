import { describe, expect, it } from 'vitest';
import { computeInternalResponseStrain } from './fatigue';
import { evaluateReadinessAndSafetyEnvelope } from './rules';
import type {
    DailyReadiness,
    EngineObjectiveInput,
    PhysicalWorkCheckin,
    SubjectiveInput,
    UserContext,
} from './models';

const BASE_OBJECTIVE: EngineObjectiveInput = {
    total_steps: 7000,
    sleep_score: 85,
    sleep_duration_min: 480,
    rhr: 50,
    rhr_7d_avg: 50,
    rhr_delta: 0,
    hrv_weekly_avg: 55,
    hrv_last_night: 55,
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
    hrv_stdev_28d: 8,
    rhr_stdev_28d: 3,
    sleep_score_stdev_28d: 7,
};

function baseSubjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 7,
        sleepQuality: 7,
        fatigue: 3,
        soreness: 3,
        stress: 3,
        motivation: 8,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        ...overrides,
    };
}

function makeReadiness(subjective: SubjectiveInput): DailyReadiness {
    return {
        subjective,
        objective: BASE_OBJECTIVE,
    };
}

function baseContext(): UserContext {
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
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
    };
}

describe('Unlogged Physical Work: computeInternalResponseStrain', () => {
    it('returns standard subjective strain when physicalWork is absent or not performed', () => {
        const subWithout = baseSubjective();
        const subNotPerformed = baseSubjective({ physicalWork: { performed: false } });

        const strainWithout = computeInternalResponseStrain(makeReadiness(subWithout));
        const strainNotPerformed = computeInternalResponseStrain(makeReadiness(subNotPerformed));

        expect(strainWithout).toEqual(strainNotPerformed);
        expect(strainWithout.upperBody).toBeLessThan(0.3);
        expect(strainWithout.neuromuscular).toBeLessThan(0.3);
    });

    it('elevates upperBody and neuromuscular strain when grip and upper body work is reported', () => {
        const physicalWork: PhysicalWorkCheckin = {
            performed: true,
            duration: 'medium', // 1.0 factor
            intensity: 'hard', // 0.70 base
            loadAreas: ['grip_forearms', 'upper_body'],
        };
        const strain = computeInternalResponseStrain(makeReadiness(baseSubjective({ physicalWork })));

        // hard medium work gives workStrainMagnitude = 0.70
        // upper_body load area gives 0.70 * 0.85 = 0.595
        expect(strain.upperBody).toBeGreaterThanOrEqual(0.58);
        expect(strain.neuromuscular).toBeGreaterThanOrEqual(0.45);
        expect(strain.systemic).toBeGreaterThanOrEqual(0.35);
        // Lower body should remain at baseline low level
        expect(strain.lowerBody).toBeLessThan(0.35);
    });

    it('elevates lowerBody, impactTissue, neuromuscular, and systemic when spine and legs carrying is reported', () => {
        const physicalWork: PhysicalWorkCheckin = {
            performed: true,
            duration: 'extended', // 1.25 factor
            intensity: 'exhausting', // 0.88 base -> 1.0 magnitude
            loadAreas: ['lower_back_spine', 'legs_carrying'],
        };
        const strain = computeInternalResponseStrain(makeReadiness(baseSubjective({ physicalWork })));

        expect(strain.lowerBody).toBeGreaterThanOrEqual(0.65);
        expect(strain.neuromuscular).toBeGreaterThanOrEqual(0.60);
        expect(strain.systemic).toBeGreaterThanOrEqual(0.55);
        expect(strain.impactTissue).toBeGreaterThanOrEqual(0.35);
    });

    it('scales strain conservatively for short moderate work', () => {
        const physicalWork: PhysicalWorkCheckin = {
            performed: true,
            duration: 'short', // 0.65 factor
            intensity: 'moderate', // 0.45 base -> magnitude ~0.29
            loadAreas: ['upper_body'],
        };
        const strain = computeInternalResponseStrain(makeReadiness(baseSubjective({ physicalWork })));

        // Short moderate work should have a modest footprint
        expect(strain.upperBody).toBeLessThan(0.35);
        expect(strain.systemic).toBeLessThan(0.30);
    });
});

describe('Unlogged Physical Work: evaluateReadinessAndSafetyEnvelope mode determination', () => {
    it('forces mode to modify on hard 1-3h physical work even with green biometrics', () => {
        const physicalWork: PhysicalWorkCheckin = {
            performed: true,
            duration: 'medium',
            intensity: 'hard', // workStrain = 0.70 >= 0.65 -> physicalWorkModify = true
            loadAreas: ['upper_body', 'grip_forearms'],
        };
        const readiness = makeReadiness(baseSubjective({ physicalWork }));
        const envelope = evaluateReadinessAndSafetyEnvelope(readiness, baseContext());

        expect(envelope.mode).toBe('modify');
    });

    it('forces mode to recover on exhausting work with moderate fatigue or soreness', () => {
        const physicalWork: PhysicalWorkCheckin = {
            performed: true,
            duration: 'medium',
            intensity: 'exhausting', // workStrain = 0.88 >= 0.85
            loadAreas: ['lower_back_spine', 'legs_carrying'],
        };
        // athlete reports fatigue: 6 (threshold is >= 6)
        const readiness = makeReadiness(baseSubjective({ fatigue: 6, soreness: 5, physicalWork }));
        const envelope = evaluateReadinessAndSafetyEnvelope(readiness, baseContext());

        expect(envelope.mode).toBe('recover');
    });

    it('keeps mode as train on short moderate physical work when athlete is fresh', () => {
        const physicalWork: PhysicalWorkCheckin = {
            performed: true,
            duration: 'short',
            intensity: 'moderate', // workStrain = 0.45 * 0.65 = 0.29 < 0.65
            loadAreas: ['upper_body'],
        };
        const readiness = makeReadiness(baseSubjective({ physicalWork }));
        const envelope = evaluateReadinessAndSafetyEnvelope(readiness, baseContext());

        expect(envelope.mode).toBe('train');
    });
});
