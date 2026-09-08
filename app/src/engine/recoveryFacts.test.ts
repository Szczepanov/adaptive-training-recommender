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
import { resolveRecoveryAuthority, resolveRecoveryPlacementState } from './recoveryPlacement';
import { computeContentHash } from './externalPlanHash';
import { POLICY_VERSION } from './policy';
import type { PerformedTrainingOccurrence } from '../training-occurrence/models';
import type { CoverageCreditFact, PerformedExposureFact } from './performedTrainingFacts';
import { EXTERNAL_PLAN_SCHEMA, type DailyRecommendation, type ExternalTrainingPlan } from './models';

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

function coveragePair(): { credit: CoverageCreditFact; exposure: PerformedExposureFact } {
    return {
        credit: {
            performedOccurrenceId: 'occ_credit_01',
            coverageSetId: 'evergreen_general',
            coverageKey: 'recovery_or_rest',
            workoutId: 'recovery_mobility_tissue_01',
            creditKind: 'exact',
            confidence: 1,
            reasonCode: 'exact_workout_identity',
            sourceKinds: ['structured_execution'],
        },
        exposure: {
            performedOccurrenceId: 'occ_credit_01',
            localDate: '2026-09-08',
            modality: 'Mobility',
            confidence: 'exact',
            sourceKinds: ['structured_execution'],
            evidenceTier: 'completedStructuredWorkout',
            workoutId: 'recovery_mobility_tissue_01',
        },
    };
}

const PLAN_ID = 'autumn-block';
const DIRECTIVE_ID = 'w1-tue-rest';

function restPlan(overrides: Partial<ExternalTrainingPlan> = {}): ExternalTrainingPlan {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: PLAN_ID,
        revision: 1,
        title: '4-week block',
        startDate: '2026-08-17',
        weekCount: 4,
        sessions: [{
            id: 'w1-threshold',
            title: 'Threshold 3x12',
            priority: 'key',
            placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: { summary: '3x12 at threshold.' },
        }],
        restDays: [{ id: DIRECTIVE_ID, week: 1, day: 'tuesday' }],
        ...overrides,
    } as ExternalTrainingPlan;
}

async function authoredRestRecommendation(plan: ExternalTrainingPlan): Promise<DailyRecommendation> {
    return {
        userId: 'u1',
        date: '2026-08-18',
        templateId: 'rest_01',
        templateTitle: 'Rest',
        category: 'Rest',
        modality: 'None',
        mode: 'recover',
        rationale: 'protected rest',
        schemaVersion: 3,
        createdAt: '',
        updatedAt: '',
        adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        recommendationAudit: {
            policyVersion: POLICY_VERSION,
            evaluatedAt: '2026-08-18T08:00:00Z',
            decisionContextRevision: 'history-v1:2026-08-18:7:none:none',
            safetyStatus: 'complete',
            history: { completedEventCount: 1, unmatchedEventCount: 0, sourceStatuses: { activities: 'AVAILABLE', recommendations: 'AVAILABLE', manualTraining: 'MISSING' } },
            envelope: { safetyRestrictedModalityCount: 0, planMaxAllowableTier: 'Rest' },
            candidateScores: [],
            droppedContributorObjectives: [],
            externalRest: {
                planId: PLAN_ID,
                revision: 1,
                contentHash: await computeContentHash(plan),
                restDirectiveId: DIRECTIVE_ID,
                date: '2026-08-18',
            },
        },
    };
}

describe('ADR-0038 historical recovery truth (RP2)', () => {
    describe('performed recovery facts', () => {
        it('derives exact recovery only from an active canonical occurrence', () => {
            const hydrated = {
                structured: {
                    executionId: 'exec_01',
                    workoutId: 'recovery_mobility_tissue_01',
                    templateId: 'mobility_recovery',
                    modality: 'Mobility' as const,
                },
            };
            const authority = resolveRecoveryAuthority(null);

            expect(deriveRecoveryFactFromPerformedOccurrence(mockOccurrence(), hydrated, authority)?.source.kind)
                .toBe('performed_recovery');
            expect(deriveRecoveryFactFromPerformedOccurrence(mockOccurrence({ status: 'merged', mergedIntoOccurrenceId: 'survivor' }), hydrated, authority))
                .toBeNull();
        });

        it('fails closed on generic modality and non-recovery workout identity', () => {
            const authority = resolveRecoveryAuthority(null);
            expect(deriveRecoveryFactFromPerformedOccurrence(mockOccurrence(), {
                provider: { activityId: 'g1', provider: 'garmin', modality: 'Mobility' as const },
            }, authority)).toBeNull();
            expect(deriveRecoveryFactFromPerformedOccurrence(mockOccurrence(), {
                structured: { executionId: 'e2', workoutId: 'running_aerobic_base_01', modality: 'Running' as const },
            }, authority)).toBeNull();
        });

        it('requires coverage credit and exposure to describe the same occurrence/workout/authority', () => {
            const authority = resolveRecoveryAuthority(null);
            const { credit, exposure } = coveragePair();
            expect(deriveRecoveryFactFromCoverageCreditFact(credit, exposure, authority)?.date).toBe('2026-09-08');
            expect(deriveRecoveryFactFromCoverageCreditFact(
                { ...credit, performedOccurrenceId: 'other' }, exposure, authority,
            )).toBeNull();
            expect(deriveRecoveryFactFromCoverageCreditFact(
                credit, { ...exposure, workoutId: 'cycling_recovery_spin_01' }, authority,
            )).toBeNull();
            expect(deriveRecoveryFactFromCoverageCreditFact(
                { ...credit, coverageSetId: 'september_cycling_event' }, exposure, authority,
            )).toBeNull();
            expect(deriveRecoveryFactFromCoverageCreditFact(
                { ...credit, workoutId: undefined }, exposure, authority,
            )).toBeNull();
        });

        it('revalidates persisted exact identity and qualification authority', () => {
            const authority = resolveRecoveryAuthority(null);
            const fact: RecoveryPlacementFact = {
                date: '2026-09-08',
                source: {
                    kind: 'performed_recovery',
                    performedOccurrenceId: 'occ_1',
                    workoutId: 'recovery_mobility_tissue_01',
                    qualification: { coverageSetId: 'evergreen_general', phase: 'general', coverageKey: 'recovery_or_rest' },
                },
            };
            expect(validatePerformedRecoveryFact(fact, authority)).toBe(true);
            expect(validatePerformedRecoveryFact({ ...fact, date: 'bad-date' }, authority)).toBe(false);
            if (fact.source.kind === 'performed_recovery') {
                expect(validatePerformedRecoveryFact({
                    ...fact,
                    source: { ...fact.source, workoutId: 'cycling_vo2_intervals_01' },
                }, authority)).toBe(false);
            }
        });
    });

    describe('ADR-0035 authored Rest bridge', () => {
        it('credits only a recommendation that passes the existing revision replay path', async () => {
            const plan = restPlan();
            const recommendation = await authoredRestRecommendation(plan);
            const result = await deriveRecoveryFactFromAuthoredRest(recommendation, plan);

            expect(result.reason).toBeUndefined();
            expect(result.fact).toMatchObject({
                date: '2026-08-18',
                source: { kind: 'authored_rest', planId: PLAN_ID, revision: 1, restDirectiveId: DIRECTIVE_ID },
            });
        });

        it('fails closed when the supplied immutable revision no longer matches the audit hash', async () => {
            const original = restPlan();
            const recommendation = await authoredRestRecommendation(original);
            const mutated = restPlan({ title: 'mutated revision' });
            const result = await deriveRecoveryFactFromAuthoredRest(recommendation, mutated);

            expect(result.fact).toBeNull();
            expect(result.reason).toBe('invalid_provenance');
            expect(result.replayErrors?.join(' ')).toMatch(/content hash mismatch/i);
        });

        it('suppresses explicit override and contradictory canonical training', async () => {
            const plan = restPlan();
            const overridden = await authoredRestRecommendation(plan);
            const externalRest = overridden.recommendationAudit!.externalRest;
            expect(externalRest).toBeDefined();
            (externalRest as { overridden?: true }).overridden = true;
            expect((await deriveRecoveryFactFromAuthoredRest(overridden, plan)).reason).toBe('overridden');

            const recommendation = await authoredRestRecommendation(plan);
            const contradicted = await deriveRecoveryFactFromAuthoredRest(recommendation, plan, { hasContradictoryTraining: true });
            expect(contradicted.fact).toBeNull();
            expect(contradicted.reason).toBe('contradictory_training');
        });
    });

    describe('generated complete-Rest reconciliation', () => {
        const baseRecommendation = {
            date: '2026-09-08',
            category: 'Rest' as const,
            templateId: 'rest_day',
            recommendationAudit: {
                policyVersion: POLICY_VERSION,
                decisionContextRevision: 'history-v1:2026-09-08:7:none:none',
            },
        };

        it('requires an exact authority-pinned Rest identity and replay identity', () => {
            expect(reconcileGeneratedRestOutcome({
                recommendation: { ...baseRecommendation, templateId: 'easy_01' },
                closureState: { status: 'authoritative_clean_closure', closedAt: '2026-09-09T03:00:00.000Z' },
            }).status).toBe('not_rest');

            expect(reconcileGeneratedRestOutcome({
                recommendation: { ...baseRecommendation, recommendationAudit: { ...baseRecommendation.recommendationAudit, decisionContextRevision: 'synthetic-id' } },
                closureState: { status: 'authoritative_clean_closure', closedAt: '2026-09-09T03:00:00.000Z' },
            }).status).toBe('unreconciled');
        });

        it('requires positive Rest adherence for adherence_confirmed closure', () => {
            expect(reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState: { status: 'adherence_confirmed' },
            }).status).toBe('unreconciled');

            expect(reconcileGeneratedRestOutcome({
                recommendation: {
                    ...baseRecommendation,
                    adherence: { respondedAt: '2026-09-08T20:00:00.000Z', followed: false, actualModality: null, actualDurationMin: null, skipped: true, notes: null },
                },
                closureState: { status: 'adherence_confirmed' },
            }).status).toBe('unreconciled');

            const credited = reconcileGeneratedRestOutcome({
                recommendation: {
                    ...baseRecommendation,
                    adherence: { respondedAt: '2026-09-08T20:00:00.000Z', followed: true, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
                },
                closureState: { status: 'adherence_confirmed' },
            });
            expect(credited.status).toBe('credited');
            expect(credited.fact?.source).toMatchObject({
                kind: 'engine_rest_day_outcome',
                decisionContextRevision: 'history-v1:2026-09-08:7:none:none',
                reconciliationEvidenceAt: '2026-09-08T20:00:00.000Z',
            });
        });

        it('requires parseable authoritative clean closure evidence', () => {
            expect(reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState: { status: 'authoritative_clean_closure', closedAt: 'invalid' },
            }).status).toBe('unreconciled');

            expect(reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState: { status: 'authoritative_clean_closure', closedAt: '2026-09-09T03:00:00.000Z' },
            }).status).toBe('credited');
        });

        it('blocks active contradictory training but ignores merged occurrence tombstones', () => {
            const closureState = { status: 'authoritative_clean_closure' as const, closedAt: '2026-09-09T03:00:00.000Z' };
            expect(reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState,
                contradictoryOccurrences: [{ performedOccurrenceId: 'active', localDate: '2026-09-08', modality: 'Running', status: 'active' }],
            }).status).toBe('contradicted');

            expect(reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState,
                contradictoryOccurrences: [{ performedOccurrenceId: 'merged', localDate: '2026-09-08', modality: 'Running', status: 'merged' }],
            }).status).toBe('credited');
        });

        it('never treats provider-empty state as Rest closure', () => {
            expect(reconcileGeneratedRestOutcome({
                recommendation: baseRecommendation,
                closureState: { status: 'provider_empty_unverified' },
            }).status).toBe('unreconciled');
        });
    });

    describe('stable bootstrap and historical snapshot', () => {
        it('reuses a valid stored B and fails closed on malformed persisted B', () => {
            expect(resolveBootstrapDate({ storedBootstrapDate: '2026-09-01', asOfDate: '2026-09-08' }))
                .toEqual({ bootstrapDate: '2026-09-01', isNewlyGenerated: false });
            expect(() => resolveBootstrapDate({ storedBootstrapDate: 'bad-date', asOfDate: '2026-09-08' }))
                .toThrow(/storedBootstrapDate is invalid/);
        });

        it('excludes the unknown prefix through B plus same-day/future facts, while retaining older post-B history', () => {
            const authoredFact = (date: string, id: string): RecoveryPlacementFact => ({
                date,
                source: { kind: 'authored_rest', planId: 'p', revision: 1, contentHash: 'h', restDirectiveId: id, date },
            });
            const snapshot = buildRecoveryHistorySnapshot({
                asOfDate: '2026-09-12',
                bootstrapDate: '2026-09-01',
                facts: [
                    authoredFact('2026-08-30', 'pre'),
                    authoredFact('2026-09-01', 'bootstrap-day'),
                    authoredFact('2026-09-03', 'old-post-bootstrap'),
                    authoredFact('2026-09-10', 'latest'),
                    authoredFact('2026-09-12', 'same-day'),
                    authoredFact('2026-09-13', 'future'),
                ],
            });

            expect(snapshot.qualifyingRecoveryDates).toEqual(['2026-09-03', '2026-09-10']);
            expect(snapshot.latestQualifyingRecoveryDate).toBe('2026-09-10');
            expect(snapshot.facts.map(fact => fact.date)).toEqual(['2026-09-03', '2026-09-10']);
        });

        it('feeds the latest trustworthy historical fact into the normal R + 7 deadline', () => {
            const snapshot = buildRecoveryHistorySnapshot({
                asOfDate: '2026-09-08',
                bootstrapDate: '2026-09-01',
                facts: [{
                    date: '2026-09-06',
                    source: {
                        kind: 'performed_recovery',
                        performedOccurrenceId: 'occ_1',
                        workoutId: 'recovery_mobility_tissue_01',
                        qualification: { coverageSetId: 'evergreen_general', phase: 'general', coverageKey: 'recovery_or_rest' },
                    },
                }],
            });
            const state = resolveRecoveryPlacementState({
                asOfDate: snapshot.asOfDate,
                latestQualifyingRecoveryDate: snapshot.latestQualifyingRecoveryDate,
                bootstrapDate: snapshot.bootstrapDate,
            });
            expect(state.referenceDate).toBe('2026-09-06');
            expect(state.dueByDate).toBe('2026-09-13');
            expect(state.daysUntilDue).toBe(5);
        });
    });
});
