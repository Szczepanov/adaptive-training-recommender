import type { DailySubjectiveCheckin, HealthSymptomType } from '../../ledger/models.ts';
import type { FlagEvaluation } from './flagEvaluation.ts';

/*
 * D-FLAGS reported symptom with an illness-risk cause (ADR-0052, ADR-0032), #1144 PR1-4.
 *
 * One flag, `illness_risk_symptom`, active exactly when the check-in reports illness symptoms
 * that are not an explicit, narrow allergy presentation. This is the same predicate that makes
 * `engine/adapters.ts` `resolveClinicalEnvelopeSources` emit `non_allergy_illness`; the engine
 * imports the allow-list and the predicate from here, so the two cannot drift.
 *
 * Pure: reads only the already-fetched check-in. The inputs record the decision branch only,
 * never raw symptom types, severity or free text (same minimization as the envelope sources).
 */

export const ILLNESS_RISK_SYMPTOM_FLAG_DEFINITION_VERSION = 'illness_risk_symptom-v1';

/**
 * Deliberately narrow presentation for which an athlete's self-attributed allergy cause may
 * soften the legacy illness gate. Broader respiratory or systemic symptoms stay conservative:
 * the check-in does not diagnose allergy or rule out infection/EIB/asthma.
 */
export const ALLERGY_COMPATIBLE_SYMPTOM_TYPES: readonly HealthSymptomType[] = [
    'congestion',
    'runny_nose',
    'sneezing',
];

/**
 * Explicit mild/moderate nasal allergy symptoms don't get the same clinical restriction as an
 * injury or undifferentiated illness. This is intentionally fail-closed: unknown severity,
 * absent symptom detail, any non-nasal symptom type, an uncertain/infectious cause, or severe
 * symptoms keep today's conservative `painFlag` behavior unchanged.
 */
export function isAllergyLikeSymptomDay(checkin: DailySubjectiveCheckin): boolean {
    const symptoms = checkin.healthContext?.symptoms;
    if (!symptoms?.present || symptoms.suspectedCause !== 'allergy') return false;
    if (symptoms.severity !== 'mild' && symptoms.severity !== 'moderate') return false;
    if (!symptoms.types || symptoms.types.length === 0) return false;
    if (!symptoms.types.every(type => ALLERGY_COMPATIBLE_SYMPTOM_TYPES.includes(type))) return false;
    return true;
}

const CHECKIN_SOURCE = 'daily_subjective_checkin';

const THRESHOLD = 'Active when the check-in reports illness symptoms, unless the day is an explicit '
    + 'allergy presentation: present symptoms, self-attributed cause allergy, severity mild or moderate, '
    + `and a non-empty symptom list drawn only from ${ALLERGY_COMPATIBLE_SYMPTOM_TYPES.join(', ')} (ADR-0032)`;

/**
 * Pure. Evaluates `illness_risk_symptom` for one check-in. No check-in cannot be judged
 * (`active: null`, state `missing`); otherwise the flag is measured and active exactly when
 * `illnessSymptoms` is set and the day is not allergy-like.
 */
export function evaluateIllnessRiskSymptom(checkin: DailySubjectiveCheckin | null): FlagEvaluation {
    if (checkin === null) {
        return {
            id: 'illness_risk_symptom',
            active: null,
            state: 'missing',
            reasonCode: 'no_checkin',
            definitionVersion: ILLNESS_RISK_SYMPTOM_FLAG_DEFINITION_VERSION,
            inputs: [{ name: 'illness_symptoms', value: { value: null, source: CHECKIN_SOURCE, state: 'missing' } }],
            threshold: THRESHOLD,
        };
    }
    const illnessSymptoms = Boolean(checkin.illnessSymptoms);
    const allergyLike = isAllergyLikeSymptomDay(checkin);
    const active = illnessSymptoms && !allergyLike;
    const reasonCode = !illnessSymptoms
        ? 'no_illness_symptoms'
        : allergyLike ? 'allergy_like_symptom_day' : 'non_allergy_illness';
    const observed = { source: CHECKIN_SOURCE, state: 'measured' as const, observedOn: checkin.date };
    return {
        id: 'illness_risk_symptom',
        active,
        state: 'measured',
        reasonCode,
        definitionVersion: ILLNESS_RISK_SYMPTOM_FLAG_DEFINITION_VERSION,
        inputs: [
            { name: 'illness_symptoms', value: { value: illnessSymptoms, ...observed } },
            { name: 'allergy_like_symptom_day', value: { value: allergyLike, ...observed } },
        ],
        threshold: THRESHOLD,
    };
}
