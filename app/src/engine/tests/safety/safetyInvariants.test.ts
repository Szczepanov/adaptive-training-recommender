import { describe, it, expect } from 'vitest';
import { checkProperty } from '../../testing/propertyTesting';
import {
    generateAdversarialReadiness,
    generateAdversarialUserContext,
    generateAdversarialEvent,
    generateAdversarialSessionDefinition,
    generateAdversarialInjury,
} from '../../testing/adversarialGenerators';
import { evaluateReadinessAndSafetyEnvelope, evaluateTraining, getCanonicalRestTemplate } from '../../rules';
import { evaluateTemplateEligibility } from '../../eligibility';
import { resolveExecutionDose } from '../../dose';
import { adjudicateAuthoredSession } from '../../authoredSessionGates';
import { resolveAvailability } from '../../schedule';
import type { PlanEnvelope, SessionTemplate } from '../../models';

const FORBIDDEN_DIAGNOSTIC_REGEX = /\b(diagnos(is|ed|tic)?|patholog(y|ical)|infection|infectious|covid|influenza|disease|prescribe medicine|cure)\b/i;

describe('Safety and Adversarial Invariants (Property-Based Suite)', () => {
    it('Invariant 1: Safety gates dominate preferences and event goals unconditionally', () => {
        const result = checkProperty(
            (prng) => {
                const injury = generateAdversarialInjury(prng, { severity: 'exclude' });
                const context = generateAdversarialUserContext(prng);
                context.trainingSettings!.injuries = [injury];
                context.constraints.restrictedModalities = injury.restrictedModalities ?? [];
                // Force user preference for the restricted modality
                if (injury.restrictedModalities && injury.restrictedModalities.length > 0) {
                    context.preferences.preferredModalities = [...injury.restrictedModalities];
                    context.preferences.avoidedModalities = [];
                }
                const readiness = generateAdversarialReadiness(prng, {
                    subjective: { painFlag: injury.severity === 'exclude' },
                });
                const event = generateAdversarialEvent(prng, '2026-08-30', 'A');
                return { context, readiness, event, injury };
            },
            ({ context, readiness, injury }) => {
                const date = '2026-08-26';
                const rec = evaluateTraining(readiness, context, date);

                // If painFlag is true, mode must be recover
                if (readiness.subjective.painFlag) {
                    expect(rec.mode).toBe('recover');
                }

                // Prescribed template must NEVER be in restricted modalities
                const restrictedMods = (injury.restrictedModalities ?? []).map(m => m.toLowerCase());
                if (restrictedMods.length > 0) {
                    expect(restrictedMods).not.toContain(rec.template.modality.toLowerCase());
                }

                // If region is knee/achilles/ankle/calf with exclude, Running is restricted
                if (['knee', 'achilles', 'ankle', 'calf'].includes(injury.region ?? '')) {
                    expect(rec.template.modality).not.toBe('Running');
                }

                // If region is lower body with exclude, lower-body / full-body strength is restricted
                if (['hamstring', 'quadriceps', 'adductor_groin', 'hip'].includes(injury.region ?? '')) {
                    expect(rec.template.category).not.toBe('Lower-body Strength');
                    expect(rec.template.category).not.toBe('Full-body Strength');
                }
            },
            { iterations: 1000, seed: 1001 },
        );

        expect(result.passed, `Invariant 1 failed on iteration ${result.iterations}: ${result.error?.message}`).toBe(true);
    });

    it('Invariant 2: No adjustment path can bypass eligibility or clinical ceiling', () => {
        const result = checkProperty(
            (prng) => {
                const context = generateAdversarialUserContext(prng);
                const readiness = generateAdversarialReadiness(prng);
                const sessionDef = generateAdversarialSessionDefinition(prng);
                const safetyTier: PlanEnvelope['maxAllowableTier'] = prng.choice(['Rest', 'Mobility', 'Easy', 'Moderate', 'Hard']);
                const safety: PlanEnvelope = {
                    maxAllowableTier: safetyTier,
                    taperActive: false,
                    reason: 'Safety test envelope',
                };
                const plannedDose = {
                    volume: prng.float(0, 1),
                    intensity: prng.float(0, 1.2),
                };
                return { context, readiness, sessionDef, safety, plannedDose };
            },
            ({ context, readiness, sessionDef, safety, plannedDose }) => {
                const date = '2026-08-26';
                const envelopeState = evaluateReadinessAndSafetyEnvelope(readiness, context, date);
                const availability = resolveAvailability(date, readiness.subjective, [], context);

                // Test 1: userAdjustment harder can never exceed MAX_EXECUTION_DOSE_BY_TIER
                const doseHarder = resolveExecutionDose(plannedDose, safety, 'harder');
                if (doseHarder) {
                    const maxTierVolume = safety.maxAllowableTier === 'Rest' ? 0
                        : safety.maxAllowableTier === 'Mobility' ? 0.2
                            : safety.maxAllowableTier === 'Easy' ? 0.5
                                : safety.maxAllowableTier === 'Moderate' ? 0.8
                                    : 1.0;
                    expect(doseHarder.volume).toBeLessThanOrEqual(maxTierVolume + 1e-6);
                }

                // Test 2: Authored session adjudication enforces eligibility
                const verdict = adjudicateAuthoredSession(
                    sessionDef,
                    readiness,
                    context,
                    envelopeState,
                    plannedDose,
                    date,
                    availability,
                );

                if (verdict.decision === 'proceed' || verdict.decision === 'scale') {
                    // If accepted, it MUST satisfy template eligibility
                    const syntheticTemplate = {
                        durationMin: sessionDef.duration?.min ?? 45,
                        durationMax: sessionDef.duration?.max ?? 45,
                        requiredEquipment: [],
                        environment: 'either' as const,
                        safetyTags: [],
                        modality: (sessionDef.dominantModality ?? 'Running') as SessionTemplate['modality'],
                        category: (sessionDef.intent === 'recovery' ? 'Mobility/Recovery' : 'Easy Endurance') as SessionTemplate['category'],
                        systemicCost: 0.3,
                    };
                    const eligibility = evaluateTemplateEligibility(syntheticTemplate, context, availability.maxTimeMinutes, date);
                    expect(eligibility.eligible).toBe(true);
                }
            },
            { iterations: 1000, seed: 2002 },
        );

        expect(result.passed, `Invariant 2 failed on iteration ${result.iterations}: ${result.error?.message}`).toBe(true);
    });

    it('Invariant 3: The safest fallback is deterministic and valid', () => {
        const canonicalRest = getCanonicalRestTemplate();
        expect(canonicalRest.category).toBe('Rest');
        expect(canonicalRest.modality).toBe('None');
        expect(canonicalRest.durationMin).toBe(0);
        expect(canonicalRest.systemicCost).toBe(0);

        const result = checkProperty(
            (prng) => {
                // Extreme impossible context: 0 minutes available, all equipment false, all modalities restricted
                const context = generateAdversarialUserContext(prng, {
                    constraints: {
                        hasCableMachine: false,
                        hasFreeWeights: false,
                        hasTreadmill: false,
                        hasIndoorBike: false,
                        maxTimeMinutes: 0,
                        restrictedModalities: ['Running', 'Cycling', 'Strength', 'Field', 'Mobility'],
                    },
                });
                const readiness = generateAdversarialReadiness(prng, {
                    subjective: { timeAvailable: 0 },
                });
                return { context, readiness };
            },
            ({ context, readiness }) => {
                const date = '2026-08-26';
                const rec = evaluateTraining(readiness, context, date);

                expect(rec).toBeDefined();
                expect(rec.template).toBeDefined();
                expect(rec.template.category).toBe('Rest');
                expect(rec.template.durationMin).toBe(0);
                expect(rec.rationale).toBeTruthy();
                expect(typeof rec.rationale).toBe('string');
                expect(rec.rationale.length).toBeGreaterThan(5);
                expect(Number.isFinite(rec.telemetry?.totalDecisionScore)).toBe(true);
            },
            { iterations: 500, seed: 3003 },
        );

        expect(result.passed, `Invariant 3 failed on iteration ${result.iterations}: ${result.error?.message}`).toBe(true);
    });

    it('Invariant 4: Uncertainty never causes unjustified escalation', () => {
        const result = checkProperty(
            (prng) => {
                // Generate a baseline with missing 28d standard deviations or sparse coverage
                const readiness = generateAdversarialReadiness(prng, {
                    objective: {
                        hrv_delta_28d: null,
                        hrv_stdev_28d: null,
                        rhr_delta_28d: null,
                        rhr_stdev_28d: null,
                        sleep_score_delta_28d: null,
                        sleep_score_stdev_28d: null,
                        respiration_delta_28d: null,
                        respiration_mad_28d: null,
                    },
                });
                const context = generateAdversarialUserContext(prng);
                return { readiness, context };
            },
            ({ readiness, context }) => {
                const date = '2026-08-26';
                const envelope = evaluateReadinessAndSafetyEnvelope(readiness, context, date);

                // Chronic multi-day drift must be 0 when 28d baseline is unavailable (no fabricated penalty or escalation)
                expect(envelope.telemetry.metricStrain.multiDayDrift).toBe(0);
                // Decision score must be non-negative and finite
                expect(envelope.telemetry.totalDecisionScore).toBeGreaterThanOrEqual(0);
                expect(Number.isFinite(envelope.telemetry.totalDecisionScore)).toBe(true);
            },
            { iterations: 500, seed: 4004 },
        );

        expect(result.passed, `Invariant 4 failed on iteration ${result.iterations}: ${result.error?.message}`).toBe(true);
    });

    it('Invariant 5: Warnings use appropriate wellness language and do not imply medical diagnosis', () => {
        const result = checkProperty(
            (prng) => {
                const context = generateAdversarialUserContext(prng);
                const readiness = generateAdversarialReadiness(prng);
                return { context, readiness };
            },
            ({ context, readiness }) => {
                const date = '2026-08-26';
                const rec = evaluateTraining(readiness, context, date);

                expect(rec.rationale).not.toMatch(FORBIDDEN_DIAGNOSTIC_REGEX);
                if (rec.envelopes?.safety?.clinicalReason) {
                    expect(rec.envelopes.safety.clinicalReason).not.toMatch(FORBIDDEN_DIAGNOSTIC_REGEX);
                }
                if (rec.envelopes?.plan?.reason) {
                    expect(rec.envelopes.plan.reason).not.toMatch(FORBIDDEN_DIAGNOSTIC_REGEX);
                }
            },
            { iterations: 500, seed: 5005 },
        );

        expect(result.passed, `Invariant 5 failed on iteration ${result.iterations}: ${result.error?.message}`).toBe(true);
    });
});
