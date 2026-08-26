import { describe, it, expect } from 'vitest';
import { checkProperty } from '../../testing/propertyTesting';
import {
    generateAdversarialReadiness,
    generateAdversarialUserContext,
    generateAdversarialSessionDefinition,
    generateAdversarialInjury,
} from '../../testing/adversarialGenerators';
import { evaluateReadinessAndSafetyEnvelope, evaluateTraining, getCanonicalRestTemplate } from '../../rules';
import { evaluateTemplateEligibility } from '../../eligibility';
import { resolveExecutionDose } from '../../dose';
import {
    adjudicateAuthoredSession,
    AUTHORED_PLAN_TIER_SYSTEMIC_COST_CEILING,
    createAuthoredSessionTemplate,
} from '../../authoredSessionGates';
import { resolveAvailability } from '../../schedule';
import type { PlanEnvelope, SessionTemplate } from '../../models';

const FORBIDDEN_DIAGNOSTIC_REGEX = /\b(diagnos(is|ed|tic)?|patholog(y|ical)|infection|infectious|covid|influenza|disease|prescribe medicine|cure)\b/i;

const EXECUTION_VOLUME_CEILING_BY_TIER: Record<PlanEnvelope['maxAllowableTier'], number> = {
    Rest: 0,
    Mobility: 0.2,
    Easy: 0.5,
    Moderate: 0.8,
    Hard: 1,
};

const PLAN_TIER_RANK: Record<PlanEnvelope['maxAllowableTier'], number> = {
    Rest: 0,
    Mobility: 1,
    Easy: 2,
    Moderate: 3,
    Hard: 4,
};

const MODE_RANK = { recover: 0, modify: 1, train: 2 } as const;

const RESTRICTABLE_MODALITIES: readonly Exclude<SessionTemplate['modality'], 'None'>[] = [
    'Running', 'Cycling', 'Strength', 'Field', 'Mobility',
];

describe('Safety and Adversarial Invariants (Property-Based Suite)', () => {
    it('Invariant 1: Explicit safety restrictions dominate athlete modality preferences', () => {
        const result = checkProperty(
            (prng) => {
                const restrictedModality = prng.choice(RESTRICTABLE_MODALITIES);
                const injury = generateAdversarialInjury(prng, {
                    severity: 'exclude',
                    restrictedModalities: [restrictedModality],
                });
                const context = generateAdversarialUserContext(prng);
                context.trainingSettings!.injuries = [injury];
                context.constraints.restrictedModalities = [restrictedModality];

                // Deliberately ask for exactly the modality that the safety context excludes.
                context.preferences.preferredModalities = [restrictedModality];
                context.preferences.deprioritizedModalities = [];
                context.preferences.avoidedModalities = [];

                // Keep the generic pain gate off so this property cannot pass merely because
                // pain forces the whole recommendation into recovery mode.
                const readiness = generateAdversarialReadiness(prng, {
                    subjective: { painFlag: false },
                });
                return { context, readiness, restrictedModality };
            },
            ({ context, readiness, restrictedModality }) => {
                const rec = evaluateTraining(readiness, context, '2026-08-26');
                expect(rec.template.modality).not.toBe(restrictedModality);
            },
            { iterations: 1000, seed: 1001 },
        );

        expect(result.passed, `Invariant 1 failed on iteration ${result.iterations}: ${result.error?.message}`).toBe(true);
    });

    it('Invariant 2: No adjustment path can bypass eligibility or the active dose/systemic-cost ceiling', () => {
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

                // A user request for "harder" can never lift volume above the independent
                // readiness/clinical execution ceiling.
                const doseHarder = resolveExecutionDose(plannedDose, safety, 'harder');
                if (doseHarder) {
                    expect(doseHarder.volume).toBeLessThanOrEqual(
                        EXECUTION_VOLUME_CEILING_BY_TIER[safety.maxAllowableTier] + 1e-6,
                    );
                }

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
                    // Test the exact projection used by production adjudication rather than
                    // reconstructing a looser test-only SessionTemplate.
                    const syntheticTemplate = createAuthoredSessionTemplate(sessionDef);
                    const eligibility = evaluateTemplateEligibility(
                        syntheticTemplate,
                        context,
                        availability.maxTimeMinutes,
                        date,
                    );
                    expect(eligibility.eligible).toBe(true);

                    expect(verdict.executionDose).toBeDefined();
                    expect(verdict.executionDose!.volume).toBeLessThanOrEqual(
                        EXECUTION_VOLUME_CEILING_BY_TIER[envelopeState.envelopes.plan.maxAllowableTier] + 1e-6,
                    );

                    // Recovery-intent work is the one documented exception to the zero-cost
                    // Rest ceiling. All other accepted authored work must fit the active
                    // systemic-cost budget.
                    const recoveryWithinRecoverEnvelope = envelopeState.mode === 'recover'
                        && sessionDef.intent === 'recovery';
                    if (!recoveryWithinRecoverEnvelope) {
                        expect(verdict.acceptedSystemicCost ?? 0).toBeLessThanOrEqual(
                            AUTHORED_PLAN_TIER_SYSTEMIC_COST_CEILING[envelopeState.envelopes.plan.maxAllowableTier] + 1e-6,
                        );
                    }
                }
            },
            { iterations: 1000, seed: 2002 },
        );

        expect(result.passed, `Invariant 2 failed on iteration ${result.iterations}: ${result.error?.message}`).toBe(true);
    });

    it('Invariant 3: The safest fallback is deterministic and valid', () => {
        const canonicalRest = getCanonicalRestTemplate();
        expect(canonicalRest.id).toBe('rest_01');
        expect(canonicalRest.category).toBe('Rest');
        expect(canonicalRest.modality).toBe('None');
        expect(canonicalRest.durationMin).toBe(0);
        expect(canonicalRest.durationMax).toBe(0);
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
                expect(rec.template.id).toBe('rest_01');
                expect(rec.template.category).toBe('Rest');
                expect(rec.template.durationMin).toBe(0);
                expect(rec.template.durationMax).toBe(0);
                expect(rec.template.systemicCost).toBe(0);
                expect(rec.rationale).toBeTruthy();
                expect(typeof rec.rationale).toBe('string');
                expect(rec.rationale.length).toBeGreaterThan(5);
                expect(Number.isFinite(rec.telemetry?.totalDecisionScore)).toBe(true);
            },
            { iterations: 500, seed: 3003 },
        );

        expect(result.passed, `Invariant 3 failed on iteration ${result.iterations}: ${result.error?.message}`).toBe(true);
    });

    it('Invariant 4: Missing long-baseline data cannot make the recommendation more aggressive than a neutral known baseline', () => {
        const result = checkProperty(
            (prng) => {
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
                const neutralReference = {
                    ...readiness,
                    objective: {
                        ...readiness.objective,
                        hrv_delta_28d: 0,
                        hrv_stdev_28d: 5,
                        rhr_delta_28d: 0,
                        rhr_stdev_28d: 2,
                        sleep_score_delta_28d: 0,
                        sleep_score_stdev_28d: 5,
                        respiration_delta_28d: 0,
                        respiration_mad_28d: 1,
                    },
                };
                const context = generateAdversarialUserContext(prng);
                return { readiness, neutralReference, context };
            },
            ({ readiness, neutralReference, context }) => {
                const date = '2026-08-26';
                const missingBaseline = evaluateReadinessAndSafetyEnvelope(readiness, context, date);
                const neutralBaseline = evaluateReadinessAndSafetyEnvelope(neutralReference, context, date);

                // No fabricated chronic drift is allowed when there is no 28-day reference.
                expect(missingBaseline.telemetry.metricStrain.multiDayDrift).toBe(0);
                expect(Number.isFinite(missingBaseline.telemetry.totalDecisionScore)).toBe(true);

                // Metamorphic check: removing neutral long-baseline evidence must not unlock
                // a more permissive mode or plan tier.
                expect(MODE_RANK[missingBaseline.mode]).toBeLessThanOrEqual(MODE_RANK[neutralBaseline.mode]);
                expect(PLAN_TIER_RANK[missingBaseline.envelopes.plan.maxAllowableTier]).toBeLessThanOrEqual(
                    PLAN_TIER_RANK[neutralBaseline.envelopes.plan.maxAllowableTier],
                );
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
