import { describe, expect, it } from 'vitest';
import { deriveCarriedRegionRestrictions, deriveTissueSeverity, resolveEffectiveInjuryConstraintsWithRecheck, resolveInjuryRestrictions } from '../engine/injuryPolicy';
import { evaluateEnvelopes, evaluateTraining } from '../engine/rules';
import { INJURY_PAIN_POLICY_DESCRIPTOR } from './injuryPainKnowledge';

const TODAY = '2026-09-01';

type RegionMappingFamilyKey = keyof typeof INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings;

const REGION_ALIGNMENT_CASES = (
    Object.entries(INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings) as [
        RegionMappingFamilyKey,
        (typeof INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings)[RegionMappingFamilyKey],
    ][]
).flatMap(([family, descriptor]) =>
    descriptor.regions.map((region) => [family, region] as const),
);

describe('injury and clinical-symptom policy alignment', () => {
    it.each(REGION_ALIGNMENT_CASES)('pins %s (%s) restrictions for limit and exclude', (family, region) => {
        const descriptor = INJURY_PAIN_POLICY_DESCRIPTOR.regionMappings[family];
        const limit = resolveInjuryRestrictions([{ region, severity: 'limit' }], TODAY);
        const exclude = resolveInjuryRestrictions([{ region, severity: 'exclude' }], TODAY);

        expect(limit).toEqual(descriptor.limit);
        expect(exclude).toEqual(descriptor.exclude);
    });

    it('pins monitor as explicit-modality pass-through without a region-derived mapping', () => {
        expect(resolveInjuryRestrictions([{ region: 'knee', severity: 'monitor', restrictedModalities: ['Cycling'] }], TODAY)).toEqual({
            restrictedModalities: ['Cycling'], impliedGuardrails: [], restrictedCategories: [],
        });
    });

    it("pins expiry and today's scope as separate from region policy", () => {
        expect(resolveInjuryRestrictions([{ region: 'knee', severity: 'exclude', reviewBy: '2026-08-31' }], TODAY)).toEqual({
            restrictedModalities: [], impliedGuardrails: [], restrictedCategories: [],
        });
    });

    it('pins 24-hour latency-aware tissue response severity mapping', () => {
        // Severe at any signal -> exclude
        expect(deriveTissueSeverity({ region: 'knee', morningState: 'severe' })).toBe('exclude');
        expect(deriveTissueSeverity({ region: 'knee', morningState: 'normal', painDuringTraining: 'severe' })).toBe('exclude');
        expect(deriveTissueSeverity({ region: 'knee', morningState: 'normal', nextMorningReaction: 'severe' })).toBe('exclude');

        // Persistent / delayed moderate -> limit
        expect(deriveTissueSeverity({ region: 'knee', morningState: 'moderate' })).toBe('limit');
        expect(deriveTissueSeverity({ region: 'knee', morningState: 'normal', afterTrainingState: 'moderate' })).toBe('limit');
        expect(deriveTissueSeverity({ region: 'knee', morningState: 'normal', nextMorningReaction: 'moderate' })).toBe('limit');

        // Transient moderate loading discomfort settled post-session & next morning -> monitor (tolerable loading)
        expect(deriveTissueSeverity({
            region: 'achilles', morningState: 'normal', painDuringTraining: 'moderate',
            afterTrainingState: 'normal', nextMorningReaction: 'normal',
        })).toBe('monitor');
        expect(deriveTissueSeverity({
            region: 'achilles', morningState: 'normal', painDuringTraining: 'moderate',
            afterTrainingState: 'mild', nextMorningReaction: 'normal',
        })).toBe('monitor');

        // Mild -> monitor
        expect(deriveTissueSeverity({ region: 'ankle', morningState: 'mild' })).toBe('monitor');

        // Normal -> null
        expect(deriveTissueSeverity({ region: 'knee', morningState: 'normal' })).toBeNull();
    });

    it('pins clinical escalation protocol against descriptor', () => {
        const descriptor = INJURY_PAIN_POLICY_DESCRIPTOR.clinicalEscalationProtocol;
        const readiness = {
            subjective: {
                painFlag: true,
                clinicalEnvelopeSources: ['red_flag' as const],
                redFlagFindings: [{
                    category: 'neurological' as const,
                    source: 'explicit_checkin' as const,
                    description: 'Numbness',
                }],
                alreadyTrainedToday: false,
                fatigue: 3,
                soreness: 3,
                readiness: 7,
                sleepQuality: 7,
                stress: 3,
                mood: 7,
                motivation: 7,
                timeAvailable: 60,
                preferredModalityToday: null,
            },
            objective: {
                total_steps: 8000,
                sleep_score: 80,
                sleep_duration_min: 480,
                rhr: 50,
                rhr_7d_avg: 50,
                rhr_delta: 0,
                hrv_weekly_avg: 60,
                hrv_last_night: 60,
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
            },
        };
        const context = {
            goals: { shortTerm: '', midTerm: '', longTerm: '' },
            preferences: {
                preferredModalities: ['Running'],
                deprioritizedModalities: [],
                avoidedModalities: [],
                conservativeBias: false,
            },
            constraints: {
                hasCableMachine: false,
                hasFreeWeights: true,
                hasTreadmill: false,
                hasIndoorBike: false,
                restrictedModalities: [],
                impliedGuardrails: [],
                restrictedCategories: [],
                maxTimeMinutes: 60,
            },
        };

        const envelopes = evaluateEnvelopes(readiness, context);
        expect(envelopes.plan.maxAllowableTier).toBe(descriptor.maxTierWhenRedFlag);
        expect(envelopes.safety.clinicalEscalationRequired).toBe(descriptor.requiresMedicalReferral);
        expect(envelopes.safety.redFlagActive).toBe(true);

        const rec = evaluateTraining(readiness, context, TODAY);
        expect(rec.mode).toBe(descriptor.enforceMode);
        expect(rec.template.category).toBe('Rest');
        expect(rec.template.systemicCost).toBe(0);
    });

    it('pins the one-day tissue pending-recheck carry policy (issue #680)', () => {
        const descriptor = INJURY_PAIN_POLICY_DESCRIPTOR.tissueRecheckCarry;
        const D0 = '2026-09-01';
        const D1 = '2026-09-02';
        const D2 = '2026-09-03';

        // carryDurationDays: 1 -- derived fresh from D0's raw response, applied on D1, and
        // not carried again into D2 when D1 itself reports nothing.
        const carriedIntoD1 = deriveCarriedRegionRestrictions(undefined, { shoulder: { region: 'shoulder', morningState: 'moderate' } }, D0);
        expect(carriedIntoD1).toEqual([{ region: 'shoulder', severity: 'limit' }]);
        expect(resolveEffectiveInjuryConstraintsWithRecheck(undefined, undefined, D1, carriedIntoD1)[0]?.severity).toBe('limit');

        const carriedIntoD2 = deriveCarriedRegionRestrictions(undefined, undefined, D1);
        expect(carriedIntoD2).toEqual([]);
        expect(carriedIntoD2.length).toBeLessThanOrEqual(descriptor.carryDurationDays);
        expect(resolveEffectiveInjuryConstraintsWithRecheck(undefined, undefined, D2, carriedIntoD2)).toEqual([]);

        // appliesToSeverities: ['limit', 'exclude'] -- 'monitor' is not a qualifying carry candidate.
        const monitorOnly = deriveCarriedRegionRestrictions(undefined, { ankle: { region: 'ankle', morningState: 'mild' } }, D0);
        expect(monitorOnly).toEqual([]);
        expect(descriptor.appliesToSeverities).not.toContain('monitor');

        // clearedBy: today's own response for the region always governs.
        const clearedByTodaysResponse = resolveEffectiveInjuryConstraintsWithRecheck(
            undefined, { shoulder: { region: 'shoulder', morningState: 'normal' } }, D1, [{ region: 'shoulder', severity: 'limit' }],
        );
        expect(clearedByTodaysResponse).toEqual([]);

        // clearedBy: a standing injury already covering the region takes precedence.
        const clearedByStandingInjury = resolveEffectiveInjuryConstraintsWithRecheck(
            [{ region: 'shoulder', severity: 'monitor' }], undefined, D1, [{ region: 'shoulder', severity: 'limit' }],
        );
        expect(clearedByStandingInjury).toEqual([{ region: 'shoulder', severity: 'monitor' }]);
    });
});
