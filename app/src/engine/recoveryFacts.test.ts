import { describe, expect, it } from 'vitest';
import {
    buildRecoveryHistorySnapshot,
    deriveRecoveryFactFromAuthoredRest,
    deriveRecoveryFactFromCoverageCreditFact,
    deriveRecoveryFactFromPerformedOccurrence,
    reconcileGeneratedRestOutcome,
    resolveBootstrapDate,
    validatePerformedRecoveryFact,
    type RecoveryPlacementFact,
} from './recoveryFacts';
import {
    resolveRecoveryAuthority,
    resolveRecoveryPlacementState,
} from './recoveryPlacement';
import type { PerformedTrainingOccurrence } from '../training-occurrence/models';
import type { CoverageCreditFact, PerformedExposureFact } from './performedTrainingFacts';
import type { ExternalRestProvenance } from './models';
import type { ExternalRestDecisionProvenance } from './externalRestProvenance';

function mockOccurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        performedOccurrenceId: 'occ_rec_01',
        userId: 'u1',
        schemaVersion: 1,
        status: 'active',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec_01' }],
        localDate: '2026-09-08',
        startedAt: '2026-09-08T09:00:00.000Z',
        endedAt: '2026-09-08T09:30:00.000Z',
        modality: 'Mobility',
        reconciliation: { state: 'single_source' },
        createdAt: '2026-09-08T09:30:00.000Z',
        updatedAt: '2026-09-08T09:30:00.000Z',
        ...overrides,
    };
}

describe('ADR-0038 historical recovery truth (RP2)', () => {
    describe('Work A: performed active recovery facts', () => {
        it('derives a RecoveryPlacementFact for exact active recovery with workoutId and qualification authority', () => {
            const occurrence = mockOccurrence();
            const hydrated = {
                structured: {
                    executionId: 'exec_01',
                    workoutId: 'recovery_mobility_tissue_01',
                    templateId: 'mobility_recovery',
                    modality: 'Mobility' as const,
                },
            };
            const authority = resolveRecoveryAuthority(null);

            const fact = deriveRecoveryFactFromPerformedOccurrence(occurrence, hydrated, authority);
            expect(fact).not.toBeNull();
            expect(fact?.date).toBe('2026-09-08');
            expect(fact?.source.kind).toBe('performed_recovery');
            if (fact?.source.kind === 'performed_recovery') {
                expect(fact.source.performedOccurrenceId).toBe('occ_rec_01');
                expect(fact.source.workoutId).toBe('recovery_mobility_tissue_01');
                expect(fact.source.qualification).toEqual({
                    coverageSetId: 'evergreen_general',
                    phase: 'general',
                    coverageKey: 'recovery_or_rest',
                });
                expect(fact.source.templateId).toBe('mobility_recovery');
            }
        });

        it('derives a fact for cycling recovery spin and breathwork under active recovery identities', () => {
            const spinOccurrence = mockOccurrence({ performedOccurrenceId: 'occ_spin' });
            const spinHydrated = {
                structured: {
                    executionId: 'exec_spin',
                    workoutId: 'cycling_recovery_spin_01',
                    modality: 'Cycling' as const,
                },
            };
            const breathOccurrence = mockOccurrence({ performedOccurrenceId: 'occ_breath' });
            const breathHydrated = {
                structured: {
                    executionId: 'exec_breath',
                    workoutId: 'recovery_breathwork_01',
                    modality: 'Mobility' as const,
                },
            };
            const authority = resolveRecoveryAuthority(null);

            const spinFact = deriveRecoveryFactFromPerformedOccurrence(spinOccurrence, spinHydrated, authority);
            expect(spinFact).not.toBeNull();
            expect(spinFact?.source.kind).toBe('performed_recovery');
            if (spinFact?.source.kind === 'performed_recovery') {
                expect(spinFact.source.workoutId).toBe('cycling_recovery_spin_01');
            }

            const breathFact = deriveRecoveryFactFromPerformedOccurrence(breathOccurrence, breathHydrated, authority);
            expect(breathFact).not.toBeNull();
            expect(breathFact?.source.kind).toBe('performed_recovery');
            if (breathFact?.source.kind === 'performed_recovery') {
                expect(breathFact.source.workoutId).toBe('recovery_breathwork_01');
            }
        });

        it('fails closed when modality is generic mobility without exact catalog workout identity', () => {
            const occurrence = mockOccurrence();
            const hydrated = {
                provider: {
                    activityId: 'garmin_act_01',
                    provider: 'garmin',
                    modality: 'Mobility' as const,
                },
            };
            const authority = resolveRecoveryAuthority(null);

            const fact = deriveRecoveryFactFromPerformedOccurrence(occurrence, hydrated, authority);
            expect(fact).toBeNull();
        });

        it('fails closed when workoutId is legacy_strength or non-recovery workout', () => {
            const occurrence = mockOccurrence();
            const hydratedStrength = {
                structured: {
                    executionId: 'exec_legacy',
                    workoutId: 'legacy_strength',
                    modality: 'Strength' as const,
                },
            };
            const hydratedNonRecovery = {
                structured: {
                    executionId: 'exec_run',
                    workoutId: 'running_aerobic_base_01',
                    modality: 'Running' as const,
                },
            };
            const authority = resolveRecoveryAuthority(null);

            expect(deriveRecoveryFactFromPerformedOccurrence(occurrence, hydratedStrength, authority)).toBeNull();
            expect(deriveRecoveryFactFromPerformedOccurrence(occurrence, hydratedNonRecovery, authority)).toBeNull();
        });

        it('derives a fact from CoverageCreditFact when coverageKey is recovery_or_rest and creditKind is exact', () => {
            const credit: CoverageCreditFact = {
                performedOccurrenceId: 'occ_credit_01',
                coverageSetId: 'evergreen_general',
                coverageKey: 'recovery_or_rest',
                workoutId: 'recovery_mobility_tissue_01',
                creditKind: 'exact',
                confidence: 1.0,
                reasonCode: 'exact_workout_identity',
                sourceKinds: ['structured_execution'],
            };
            const exposure: PerformedExposureFact = {
                performedOccurrenceId: 'occ_credit_01',
                localDate: '2026-09-08',
                modality: 'Mobility',
                confidence: 'exact',
                sourceKinds: ['structured_execution'],
                evidenceTier: 'completedStructuredWorkout',
                workoutId: 'recovery_mobility_tissue_01',
            };
            const authority = resolveRecoveryAuthority(null);

            const fact = deriveRecoveryFactFromCoverageCreditFact(credit, exposure, authority);
            expect(fact).not.toBeNull();
            expect(fact?.source.kind).toBe('performed_recovery');
            if (fact?.source.kind === 'performed_recovery') {
                expect(fact.source.workoutId).toBe('recovery_mobility_tissue_01');
                expect(fact.source.qualification.coverageKey).toBe('recovery_or_rest');
            }
        });

        it('pure validator confirms qualifying workoutId under authority and rejects altered/unmapped workoutId', () => {
            const authority = resolveRecoveryAuthority(null);
            const validFact: RecoveryPlacementFact = {
                date: '2026-09-08',
                source: {
                    kind: 'performed_recovery',
                    performedOccurrenceId: 'occ_01',
                    workoutId: 'recovery_mobility_tissue_01',
                    qualification: {
                        coverageSetId: 'evergreen_general',
                        phase: 'general',
                        coverageKey: 'recovery_or_rest',
                    },
                },
            };
            expect(validatePerformedRecoveryFact(validFact, authority)).toBe(true);

            // Mutated workoutId that does not qualify under authority
            const invalidFact: RecoveryPlacementFact = {
                date: '2026-09-08',
                source: {
                    kind: 'performed_recovery',
                    performedOccurrenceId: 'occ_01',
                    workoutId: 'cycling_vo2_intervals_01',
                    qualification: {
                        coverageSetId: 'evergreen_general',
                        phase: 'general',
                        coverageKey: 'recovery_or_rest',
                    },
                },
            };
            expect(validatePerformedRecoveryFact(invalidFact, authority)).toBe(false);

            // Mismatched phase/coverageSetId
            const mismatchedAuthorityFact: RecoveryPlacementFact = {
                date: '2026-09-08',
                source: {
                    kind: 'performed_recovery',
                    performedOccurrenceId: 'occ_01',
                    workoutId: 'recovery_mobility_tissue_01',
                    qualification: {
                        coverageSetId: 'september_cycling_event',
                        phase: 'taper',
                        coverageKey: 'recovery_or_rest',
                    },
                },
            };
            expect(validatePerformedRecoveryFact(mismatchedAuthorityFact, authority)).toBe(false);
        });
    });

    describe('Work B: ADR-0035 authored Rest bridge', () => {
        const baseProvenance: ExternalRestProvenance = {
            planId: 'plan_ext_01',
            revision: 2,
            contentHash: 'hash_abc123',
            restDirectiveId: 'directive_rest_01',
            date: '2026-09-08',
        };

        it('credits valid authored Rest with canonical ExternalRestProvenance', () => {
            const result = deriveRecoveryFactFromAuthoredRest(baseProvenance);
            expect(result.reason).toBeUndefined();
            expect(result.fact).not.toBeNull();
            expect(result.fact?.date).toBe('2026-09-08');
            expect(result.fact?.source.kind).toBe('authored_rest');
            if (result.fact?.source.kind === 'authored_rest') {
                expect(result.fact.source.planId).toBe('plan_ext_01');
                expect(result.fact.source.restDirectiveId).toBe('directive_rest_01');
                expect(result.fact.source.contentHash).toBe('hash_abc123');
            }
        });

        it('suppresses recovery credit when provenance reports overridden: true while preserving base fields', () => {
            const overriddenProvenance: ExternalRestDecisionProvenance = {
                ...baseProvenance,
                overridden: true,
            };

            const result = deriveRecoveryFactFromAuthoredRest(overriddenProvenance);
            expect(result.fact).toBeNull();
            expect(result.reason).toBe('overridden');
        });

        it('decision gate: suppresses recovery credit when unrecorded contradictory training occurred on that date', () => {
            const result = deriveRecoveryFactFromAuthoredRest(baseProvenance, {
                hasContradictoryTraining: true,
            });
            expect(result.fact).toBeNull();
            expect(result.reason).toBe('contradictory_training');
        });

        it('rejects invalid or malformed provenance without minting fake facts', () => {
            const invalidProvenance: ExternalRestProvenance = {
                planId: '',
                revision: 0,
                contentHash: '',
                restDirectiveId: '',
                date: 'not-a-date',
            };
            const result = deriveRecoveryFactFromAuthoredRest(invalidProvenance);
            expect(result.fact).toBeNull();
            expect(result.reason).toBe('invalid_provenance');
        });
    });

    describe('Work C: generated complete-Rest day outcome reconciliation', () => {
        const baseRecommendation = {
            date: '2026-09-08',
            category: 'Rest' as const,
            templateId: 'rest_day',
            recommendationAudit: {
                policyVersion: '2026-09-adr-0038-recovery-identity-v1',
                decisionContextRevision: 'audit_rev_123',
            },
        };

        it('refuses to mint a historical fact from recommendation alone when day reconciliation is incomplete', () => {
            const result = reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState: { status: 'incomplete' },
            });
            expect(result.status).toBe('unreconciled');
            expect(result.fact).toBeNull();
        });

        it('explicitly refuses "provider returned nothing" as day closure', () => {
            const result = reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState: { status: 'provider_empty_unverified' },
            });
            expect(result.status).toBe('unreconciled');
            expect(result.fact).toBeNull();
        });

        it('mints an engine_rest_day_outcome fact when day reconciliation has authoritative clean closure and no contradictions', () => {
            const result = reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState: { status: 'authoritative_clean_closure', closedAt: '2026-09-09T03:00:00.000Z' },
                contradictoryOccurrences: [],
            });
            expect(result.status).toBe('credited');
            expect(result.fact).not.toBeNull();
            expect(result.fact?.date).toBe('2026-09-08');
            expect(result.fact?.source.kind).toBe('engine_rest_day_outcome');
            if (result.fact?.source.kind === 'engine_rest_day_outcome') {
                expect(result.fact.source.recommendationAuditId).toBe('audit_rev_123');
                expect(result.fact.source.policyVersion).toBe('2026-09-adr-0038-recovery-identity-v1');
                expect(result.fact.source.reconciliationStatus).toBe('authoritative_clean_closure');
            }
        });

        it('mints an engine_rest_day_outcome fact when athlete confirmed adherence to rest', () => {
            const result = reconcileGeneratedRestOutcome({
                recommendation: {
                    ...baseRecommendation,
                    adherence: {
                        respondedAt: '2026-09-08T20:00:00.000Z',
                        followed: true,
                        actualModality: null,
                        actualDurationMin: null,
                        skipped: false,
                        notes: null,
                    },
                },
                closureState: { status: 'adherence_confirmed' },
            });
            expect(result.status).toBe('credited');
            expect(result.fact?.source.kind).toBe('engine_rest_day_outcome');
        });

        it('suppresses fact when contradictory performed training occurred on the rest date', () => {
            const result = reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState: { status: 'authoritative_clean_closure', closedAt: '2026-09-09T03:00:00.000Z' },
                contradictoryOccurrences: [
                    {
                        performedOccurrenceId: 'occ_contra_01',
                        localDate: '2026-09-08',
                        modality: 'Running',
                    },
                ],
            });
            expect(result.status).toBe('contradicted');
            expect(result.fact).toBeNull();
        });

        it('rejects non-rest recommendations and un-audited recommendations', () => {
            const nonRestResult = reconcileGeneratedRestOutcome({
                recommendation: {
                    ...baseRecommendation,
                    category: 'Hard Endurance',
                    templateId: 'tempo_run',
                },
                closureState: { status: 'authoritative_clean_closure', closedAt: '2026-09-09T03:00:00.000Z' },
            });
            expect(nonRestResult.status).toBe('not_rest');
            expect(nonRestResult.fact).toBeNull();

            const unAuditedResult = reconcileGeneratedRestOutcome({
                recommendation: {
                    ...baseRecommendation,
                    recommendationAudit: undefined,
                },
                closureState: { status: 'authoritative_clean_closure', closedAt: '2026-09-09T03:00:00.000Z' },
            });
            expect(unAuditedResult.status).toBe('unreconciled');
            expect(unAuditedResult.fact).toBeNull();
        });
    });

    describe('Work D: durable bootstrap resolver and recovery history snapshot', () => {
        it('reuses stored bootstrap date B on repeated daily planning without sliding', () => {
            const storedB = '2026-09-01';

            const day1 = resolveBootstrapDate({
                storedBootstrapDate: storedB,
                asOfDate: '2026-09-02',
            });
            const day2 = resolveBootstrapDate({
                storedBootstrapDate: storedB,
                asOfDate: '2026-09-03',
            });
            const day8 = resolveBootstrapDate({
                storedBootstrapDate: storedB,
                asOfDate: '2026-09-08',
            });

            expect(day1.bootstrapDate).toBe('2026-09-01');
            expect(day1.isNewlyGenerated).toBe(false);
            expect(day2.bootstrapDate).toBe('2026-09-01');
            expect(day2.isNewlyGenerated).toBe(false);
            expect(day8.bootstrapDate).toBe('2026-09-01');
            expect(day8.isNewlyGenerated).toBe(false);
        });

        it('initializes bootstrap date once when no stored date exists', () => {
            const init = resolveBootstrapDate({
                asOfDate: '2026-09-01',
            });
            expect(init.bootstrapDate).toBe('2026-09-01');
            expect(init.isNewlyGenerated).toBe(true);
        });

        it('builds a RecoveryHistorySnapshot deduplicating dates and resolving latestQualifyingRecoveryDate', () => {
            const facts: RecoveryPlacementFact[] = [
                {
                    date: '2026-09-03',
                    source: {
                        kind: 'authored_rest',
                        planId: 'p1',
                        revision: 1,
                        contentHash: 'h1',
                        restDirectiveId: 'd1',
                        date: '2026-09-03',
                    },
                },
                {
                    date: '2026-09-06',
                    source: {
                        kind: 'performed_recovery',
                        performedOccurrenceId: 'occ_1',
                        workoutId: 'recovery_mobility_tissue_01',
                        qualification: {
                            coverageSetId: 'evergreen_general',
                            phase: 'general',
                            coverageKey: 'recovery_or_rest',
                        },
                    },
                },
                {
                    date: '2026-09-06', // duplicate date
                    source: {
                        kind: 'engine_rest_day_outcome',
                        recommendationAuditId: 'audit_1',
                        policyVersion: 'v1',
                        reconciliationStatus: 'authoritative_clean_closure',
                    },
                },
            ];

            const snapshot = buildRecoveryHistorySnapshot({
                asOfDate: '2026-09-08',
                facts,
                bootstrapDate: '2026-09-01',
            });

            expect(snapshot.asOfDate).toBe('2026-09-08');
            expect(snapshot.qualifyingRecoveryDates).toEqual(['2026-09-03', '2026-09-06']);
            expect(snapshot.latestQualifyingRecoveryDate).toBe('2026-09-06');
            expect(snapshot.bootstrapDate).toBe('2026-09-01');

            // Resolving placement state with snapshot output gives R + 7 = 2026-09-13
            const state = resolveRecoveryPlacementState({
                asOfDate: snapshot.asOfDate,
                latestQualifyingRecoveryDate: snapshot.latestQualifyingRecoveryDate,
                bootstrapDate: snapshot.bootstrapDate,
            });
            expect(state.historicalState).toBe('known');
            expect(state.referenceDate).toBe('2026-09-06');
            expect(state.dueByDate).toBe('2026-09-13');
            expect(state.isDueToday).toBe(false);
            expect(state.daysUntilDue).toBe(5);
        });
    });
});
