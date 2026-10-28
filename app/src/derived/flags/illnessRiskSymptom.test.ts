import { describe, expect, it } from 'vitest';
import { resolveClinicalEnvelopeSources } from '../../engine/adapters';
import { HEALTH_SYMPTOM_TYPES } from '../../engine/healthContextValidation';
import type { DailySubjectiveCheckin, HealthSymptomsCheckin, HealthSymptomType } from '../../ledger/models';
import {
    ALLERGY_COMPATIBLE_SYMPTOM_TYPES,
    evaluateIllnessRiskSymptom,
    ILLNESS_RISK_SYMPTOM_FLAG_DEFINITION_VERSION,
    isAllergyLikeSymptomDay,
} from './illnessRiskSymptom';

const DATE = '2026-10-28';

function checkin(overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'athlete', date: DATE,
        readiness: 8, sleepQuality: 8, fatigue: 3, soreness: 3, mentalStress: 3, motivation: 8,
        painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null, submittedAt: `${DATE}T07:00:00.000Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1, createdAt: `${DATE}T07:00:00.000Z`, updatedAt: `${DATE}T07:00:00.000Z`,
        ...overrides,
    };
}

const nasalAllergy: HealthSymptomsCheckin = {
    present: true, severity: 'mild', suspectedCause: 'allergy', types: ['congestion', 'sneezing'],
};

describe('illness_risk_symptom constants', () => {
    it('keeps the ADR-0032 nasal allow-list unchanged', () => {
        expect(ALLERGY_COMPATIBLE_SYMPTOM_TYPES).toEqual(['congestion', 'runny_nose', 'sneezing']);
    });

    it('covers ten symptom types, so the exhaustive test below sees every type', () => {
        expect(HEALTH_SYMPTOM_TYPES).toHaveLength(10);
    });
});

describe('isAllergyLikeSymptomDay', () => {
    it('accepts a mild or moderate allergy day with only nasal types', () => {
        expect(isAllergyLikeSymptomDay(checkin({ healthContext: { symptoms: nasalAllergy } }))).toBe(true);
        expect(isAllergyLikeSymptomDay(checkin({ healthContext: { symptoms: { ...nasalAllergy, severity: 'moderate' } } }))).toBe(true);
    });

    it('fails closed on missing detail, severe symptoms, non-allergy cause and broad types', () => {
        expect(isAllergyLikeSymptomDay(checkin())).toBe(false);
        expect(isAllergyLikeSymptomDay(checkin({ healthContext: { symptoms: { ...nasalAllergy, present: false } } }))).toBe(false);
        expect(isAllergyLikeSymptomDay(checkin({ healthContext: { symptoms: { ...nasalAllergy, severity: null } } }))).toBe(false);
        expect(isAllergyLikeSymptomDay(checkin({ healthContext: { symptoms: { ...nasalAllergy, severity: 'severe' } } }))).toBe(false);
        expect(isAllergyLikeSymptomDay(checkin({ healthContext: { symptoms: { ...nasalAllergy, suspectedCause: 'unsure' } } }))).toBe(false);
        expect(isAllergyLikeSymptomDay(checkin({ healthContext: { symptoms: { ...nasalAllergy, types: [] } } }))).toBe(false);
        expect(isAllergyLikeSymptomDay(checkin({ healthContext: { symptoms: { ...nasalAllergy, types: ['congestion', 'cough'] } } }))).toBe(false);
    });
});

describe('evaluateIllnessRiskSymptom', () => {
    it('cannot evaluate without a check-in', () => {
        const flag = evaluateIllnessRiskSymptom(null);
        expect(flag).toMatchObject({ id: 'illness_risk_symptom', active: null, state: 'missing', reasonCode: 'no_checkin' });
        expect(flag.definitionVersion).toBe(ILLNESS_RISK_SYMPTOM_FLAG_DEFINITION_VERSION);
        expect(flag.inputs).toEqual([{ name: 'illness_symptoms', value: { value: null, source: 'daily_subjective_checkin', state: 'missing' } }]);
        // The engine reads no check-in as no envelope source; the flag reports "cannot judge" instead.
        expect(resolveClinicalEnvelopeSources(null)).toEqual([]);
    });

    it('is a measured negative when no illness symptoms are reported', () => {
        expect(evaluateIllnessRiskSymptom(checkin())).toMatchObject({
            active: false, state: 'measured', reasonCode: 'no_illness_symptoms',
        });
    });

    it('is active for undifferentiated illness symptoms', () => {
        const flag = evaluateIllnessRiskSymptom(checkin({ illnessSymptoms: true }));
        expect(flag).toMatchObject({ active: true, state: 'measured', reasonCode: 'non_allergy_illness' });
        expect(flag.inputs).toEqual([
            { name: 'illness_symptoms', value: { value: true, source: 'daily_subjective_checkin', state: 'measured', observedOn: DATE } },
            { name: 'allergy_like_symptom_day', value: { value: false, source: 'daily_subjective_checkin', state: 'measured', observedOn: DATE } },
        ]);
    });

    it('is not active on an explicit nasal allergy day, and says why', () => {
        expect(evaluateIllnessRiskSymptom(checkin({ illnessSymptoms: true, healthContext: { symptoms: nasalAllergy } })))
            .toMatchObject({ active: false, state: 'measured', reasonCode: 'allergy_like_symptom_day' });
    });

    it('names the allow-list in its threshold and never exports raw symptom detail', () => {
        const flag = evaluateIllnessRiskSymptom(checkin({ illnessSymptoms: true, healthContext: { symptoms: { ...nasalAllergy, types: ['cough'] } } }));
        expect(flag.threshold).toContain('congestion, runny_nose, sneezing');
        expect(flag.threshold).toContain('mild or moderate');
        expect(JSON.stringify(flag.inputs)).not.toContain('cough');
    });
});

type Severity = HealthSymptomsCheckin['severity'] | 'absent';
type Cause = HealthSymptomsCheckin['suspectedCause'] | 'absent';
type Types = HealthSymptomType[] | null | 'absent';

const SEVERITIES: readonly Severity[] = ['mild', 'moderate', 'severe', null, 'absent'];
const CAUSES: readonly Cause[] = ['infectious', 'allergy', 'unsure', null, 'absent'];

/** All 2^10 subsets of the symptom vocabulary (including empty), plus explicit null and absent types. */
function typeVariants(): Types[] {
    const subsets: Types[] = [];
    for (let mask = 0; mask < 1 << HEALTH_SYMPTOM_TYPES.length; mask += 1) {
        subsets.push(HEALTH_SYMPTOM_TYPES.filter((_, index) => (mask & (1 << index)) !== 0));
    }
    return [...subsets, null, 'absent'];
}

function symptomsOf(present: boolean, severity: Severity, cause: Cause, types: Types): HealthSymptomsCheckin {
    return {
        present,
        ...(severity === 'absent' ? {} : { severity }),
        ...(cause === 'absent' ? {} : { suspectedCause: cause }),
        ...(types === 'absent' ? {} : { types }),
    };
}

describe('illness_risk_symptom parity with the engine envelope source (ADR-0032)', () => {
    it('matches resolveClinicalEnvelopeSources non_allergy_illness on every non-null check-in', () => {
        const variants = typeVariants();
        expect(variants).toHaveLength((1 << 10) + 2);
        let cases = 0;
        const mismatches: string[] = [];
        for (const illnessSymptoms of [true, false]) {
            for (const present of [true, false]) {
                for (const severity of SEVERITIES) {
                    for (const cause of CAUSES) {
                        for (const types of variants) {
                            const input = checkin({ illnessSymptoms, healthContext: { symptoms: symptomsOf(present, severity, cause, types) } });
                            const flag = evaluateIllnessRiskSymptom(input);
                            const expected = resolveClinicalEnvelopeSources(input).includes('non_allergy_illness');
                            cases += 1;
                            if (flag.active !== expected || flag.state !== 'measured') {
                                mismatches.push(JSON.stringify({ illnessSymptoms, present, severity, cause, types, active: flag.active }));
                            }
                        }
                    }
                }
            }
        }
        expect(mismatches).toEqual([]);
        expect(cases).toBe(2 * 2 * SEVERITIES.length * CAUSES.length * variants.length);
    });

    it('matches when the check-in carries no symptom block or no health context at all', () => {
        for (const illnessSymptoms of [true, false]) {
            for (const input of [checkin({ illnessSymptoms }), checkin({ illnessSymptoms, healthContext: {} })]) {
                expect(evaluateIllnessRiskSymptom(input).active)
                    .toBe(resolveClinicalEnvelopeSources(input).includes('non_allergy_illness'));
            }
        }
    });
});
