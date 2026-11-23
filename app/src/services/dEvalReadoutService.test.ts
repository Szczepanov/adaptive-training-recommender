import { describe, expect, it, vi } from 'vitest';
import { computeContentHash } from '../engine/externalPlanHash';
import type { ExternalTrainingPlanV6 } from '../sessions/externalPlanV6';
import type { PersistedFlagEvaluation } from '../ledger/flagEvaluation';
import { LEDGER_FLAG_IDS } from '../ledger/export/schema';
import { addDaysToLocalDateString } from '../utils/localDate';
import { DEvalReadoutService, type DEvalReadoutDependencies } from './dEvalReadoutService';

const BLOCK_START = '2026-11-24';
const BLOCK_END = '2026-12-21';
const BASELINE_START = '2026-10-27';
const AS_OF_POST = '2026-12-26';

function samplePlan(revision = 1): ExternalTrainingPlanV6 {
    return {
        schema: 'adaptive-training-recommender/external-plan@6',
        planId: 'p1',
        revision,
        title: 'Winter Block',
        startDate: BASELINE_START,
        weekCount: 8,
        restDays: [],
        sessions: Array.from({ length: 10 }, (_, idx) => ({
            id: `s${idx}`,
            title: `Session ${idx}`,
            priority: 'key' as const,
            placement: { week: Math.floor(idx / 3) + 1, flexibility: 'preferred' as const, ifMissed: 'drop' as const },
            gating: { modality: 'cycling' as const, intensity: 'easy' as const, durationMin: 45, durationMax: 60, environment: 'indoor' as const, equipment: [] },
            definition: {
                schemaVersion: 1,
                revision: 1,
                id: `def-${idx}`,
                title: `Session ${idx}`,
                intent: 'training' as const,
                modalities: ['cycling'],
                dominantModality: 'cycling',
                blocks: [{ id: 'b1', role: 'main' as const, executionMode: 'sequential' as const, name: 'Main', steps: [] }],
            },
        })),
    };
}

function makeAllFlags(fromDate: string, toDate: string): PersistedFlagEvaluation[] {
    const out: PersistedFlagEvaluation[] = [];
    for (let d = fromDate; d <= toDate; d = addDaysToLocalDateString(d, 1)) {
        LEDGER_FLAG_IDS.forEach((id, idx) => {
            out.push({
                schemaVersion: 1,
                userId: 'u1',
                revisionId: `flag-${d.replaceAll('-', '')}${String(idx).padStart(56, '0')}`,
                idempotencyKey: `flag-${d.replaceAll('-', '')}${String(idx).padStart(56, '0')}`,
                id,
                observedOn: d,
                evaluatedAt: `${d}T06:00:00.000Z`,
                active: false,
                state: 'measured',
                reasonCode: 'clear',
                definitionVersion: `${id}-v1`,
                threshold: 'threshold',
                inputs: [{ name: 'signal', value: { value: 1, source: 'test', state: 'measured' } }],
            });
        });
    }
    return out;
}

async function createDeps(overrides: Partial<DEvalReadoutDependencies> = {}): Promise<{
    deps: DEvalReadoutDependencies;
    planHash: string;
}> {
    const plan = samplePlan(1);
    const planHash = await computeContentHash(plan);
    const dates = Array.from({ length: 10 }, (_, i) => addDaysToLocalDateString(BLOCK_START, i * 2));

    const deps: DEvalReadoutDependencies = {
        flags: {
            getInRangeState: vi.fn(async () => ({
                status: 'AVAILABLE' as const,
                data: makeAllFlags(BASELINE_START, BLOCK_END),
                revision: '1',
            })),
        },
        checkins: {
            getCheckinsInRangeState: vi.fn(async () => ({ status: 'MISSING' as const })),
        },
        occurrences: {
            queryActiveInDateWindow: vi.fn(async () => dates.map((d, i) => ({
                schemaVersion: 1,
                performedOccurrenceId: `occ-${i}`,
                userId: 'u1',
                status: 'active' as const,
                localDate: d,
                startedAt: `${d}T09:00:00.000Z`,
                endedAt: `${d}T10:00:00.000Z`,
                sourceRefs: [{ kind: 'structured_execution' as const, executionId: `exec-${i}` }],
                reconciliation: { state: 'single_source' as const },
                createdAt: `${d}T10:00:00.000Z`,
                updatedAt: `${d}T10:00:00.000Z`,
            }))),
        },
        executions: {
            getExecutionHeadersInRange: vi.fn(async () => ({
                executions: dates.map((d, i) => ({
                    userId: 'u1',
                    executionId: `exec-${i}`,
                    sessionSource: { kind: 'external_plan' as const, planId: 'p1', revision: 1, sessionId: `s${i}`, contentHash: planHash },
                    executedDefinition: 'authored' as const,
                    date: d,
                    startedAt: `${d}T09:00:00.000Z`,
                    completedAt: `${d}T10:00:00.000Z`,
                    updatedAt: `${d}T10:00:00.000Z`,
                    state: 'completed' as const,
                    completionEvidence: { submittedAt: `${d}T10:00:00.000Z`, completedFraction: 1 },
                    schemaVersion: 1,
                })),
                invalidRecords: 0,
                truncated: false,
            })),
        },
        responses: {
            getResponsesInRangeState: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: [], revision: null })),
        },
        activities: {
            getActivitiesInRange: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: [], revision: null })),
        },
        activityOverrides: {
            getOverridesSinceState: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: {}, revision: null })),
        },
        trainingSettings: {
            peekTrainingSettingsState: vi.fn(async () => ({
                status: 'AVAILABLE' as const,
                data: { injuries: [], injuryHistory: [] } as never,
                revision: '1',
            })),
        },
        preferences: {
            getPreferencesState: vi.fn(async () => ({
                status: 'AVAILABLE' as const,
                data: { engineRecommendationsEnabled: false } as never,
                revision: '1',
            })),
        },
        healthAnomalyOutcomes: {
            listForUserWithDiagnostics: vi.fn(async () => ({ outcomes: [], unreadableCount: 0 })),
        },
        externalPlans: {
            listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: ['p1'], revision: null })),
            getHeaderState: vi.fn(async () => ({
                status: 'AVAILABLE' as const,
                data: {
                    userId: 'u1',
                    planId: 'p1',
                    revision: 1,
                    title: 'Winter Block',
                    startDate: BASELINE_START,
                    weekCount: 8,
                    contentHash: planHash,
                    importedAt: '2026-10-26T08:00:00.000Z',
                    supersededFrom: BASELINE_START,
                    updatedAt: '2026-10-26T08:00:00.000Z',
                },
                revision: planHash,
            })),
            getActivationState: vi.fn(async () => ({
                status: 'AVAILABLE' as const,
                data: [{
                    userId: 'u1',
                    planId: 'p1',
                    revision: 1,
                    contentHash: planHash,
                    effectiveFrom: BASELINE_START,
                    activatedAt: '2026-10-26T08:00:00.000Z',
                }],
                revision: '1',
            })),
            getPlacementState: vi.fn(async () => ({
                status: 'AVAILABLE' as const,
                data: {
                    userId: 'u1',
                    planId: 'p1',
                    revision: 1,
                    assignments: dates.map((d, i) => ({ sessionId: `s${i}`, date: d, status: 'completed' as const })),
                    updatedAt: '2026-12-20T10:00:00.000Z',
                },
                revision: '2026-12-20T10:00:00.000Z',
            })),
            getPlacementHistoryState: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: [], revision: '0' })),
            getRevisionState: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: plan, revision: '1' })),
        },
        attempts: {
            listAttemptsForProtocolWithDiagnostics: vi.fn(async (_uid, protocolId) => ({
                attempts: [{
                    id: `att-${protocolId}`,
                    protocolRef: { id: protocolId, revision: 1 },
                    state: 'completed' as const,
                    purpose: 'baseline' as const,
                    completedAt: '2026-10-22T10:00:00.000Z',
                }],
                unreadableCount: 0,
            })),
        },
        observations: {
            listCurrentObservationsForMetricWithDiagnostics: vi.fn(async (_uid, metricId) => ({
                observations: ([
                    ['strength-back-squat-1rm', 'strength_1rm_kg', 'kg', 140],
                    ['strength-bench-press-1rm', 'strength_1rm_kg', 'kg', 100],
                    ['field-standing-broad-jump', 'standing_broad_jump_distance_cm', 'cm', 250],
                    ['field-wall-touch-cmj', 'wall_touch_cmj_height_cm', 'cm', 55],
                    ['field-seated-medball-chest-throw-3kg', 'seated_medball_throw_distance_m', 'm', 5.5],
                    ['cycling-6s-seated-sprint', 'cycling_sprint_1s_peak_power_w', 'W', 1100],
                    ['cycling-6s-seated-sprint', 'cycling_sprint_5s_mean_power_w', 'W', 950],
                ] as const)
                    .filter(([, m]) => m === metricId)
                    .map(([pid, m, unit, value]) => ({
                        head: {
                            observationKey: `att-${pid}:${m}`,
                            assessmentAttemptId: `att-${pid}`,
                            metricId: m,
                            headRevision: 1,
                            createdAt: '2026-10-22T10:00:00.000Z',
                            updatedAt: '2026-10-22T10:00:00.000Z',
                        },
                        revision: {
                            observationKey: `att-${pid}:${m}`,
                            revision: 1,
                            metricId: m,
                            value,
                            unit,
                            protocolRef: { id: pid, revision: 1 },
                            assessmentAttemptId: `att-${pid}`,
                            source: 'manual' as const,
                            validity: 'valid' as const,
                            observedAt: '2026-10-22T10:00:00.000Z',
                            comparisonSeriesKey: `${pid}:series-1`,
                            comparisonCanonicalizationVersion: '1',
                            context: {},
                            createdAt: '2026-10-22T10:00:00.000Z',
                        },
                    })),
                unreadableCount: 0,
            })),
        },
        ...overrides,
    };

    return { deps, planHash };
}

describe('DEvalReadoutService', () => {
    it('reads user-scoped records with bounded queries, verifies plan hashes, and renders the §7 report', async () => {
        const { deps } = await createDeps();
        const service = new DEvalReadoutService(deps);

        const out = await service.run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
            criteriaCommit: 'bfbf94df',
            phase2Commit: 'e7da517e',
        });

        expect(out.result.c1.status).toBe('pass');
        expect(out.result.c1.block.completed).toBe(10);
        expect(out.result.c2.status).toBe('pending');
        expect(out.result.c3.status).toBe('pass');
        expect(out.result.c4.status).toBe('pass');
        expect(out.result.overall).toBe('PENDING');
        expect(out.markdown).toContain(`# ADR-0052 D-EVAL result: ${BLOCK_START} – ${BLOCK_END}`);
        expect(deps.flags.getInRangeState).toHaveBeenCalledWith('u1', BASELINE_START, BLOCK_END);
        expect(deps.executions.getExecutionHeadersInRange).toHaveBeenCalledWith('u1', '2026-10-26', '2026-12-26', 1000);
    });

    it('rejects invalid user ids and invalid date ranges', async () => {
        const { deps } = await createDeps();
        const service = new DEvalReadoutService(deps);

        await expect(service.run('', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        })).rejects.toThrow();

        await expect(service.run('u1/bad', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        })).rejects.toThrow();

        await expect(service.run('u1', {
            blockStartDate: '2026-12-22',
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        })).rejects.toThrow();
    });

    it('fails closed when check-ins have parse issues, outcomes are unreadable, plan hashes mismatch, or attempts have unreadable rows', async () => {
        const { deps } = await createDeps({
            checkins: {
                getCheckinsInRangeState: vi.fn(async () => ({
                    status: 'AVAILABLE' as const,
                    data: [],
                    revision: null,
                    issues: [{ code: 'corrupt-row', documentPath: 'users/u1/daily_subjective_checkins/2026-12-01' }],
                })),
            },
            healthAnomalyOutcomes: {
                listForUserWithDiagnostics: vi.fn(async () => ({ outcomes: [], unreadableCount: 1 })),
            },
            executions: {
                getExecutionHeadersInRange: vi.fn(async () => ({ executions: [], invalidRecords: 0, truncated: true })),
            },
            externalPlans: {
                listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: ['p1'], revision: null })),
                getHeaderState: vi.fn(async () => ({
                    status: 'AVAILABLE' as const,
                    data: {
                        userId: 'u1',
                        planId: 'p1',
                        revision: 1,
                        title: 'Tampered',
                        startDate: BASELINE_START,
                        weekCount: 8,
                        contentHash: '0'.repeat(64),
                        importedAt: '2026-10-26T08:00:00.000Z',
                        supersededFrom: BASELINE_START,
                        updatedAt: '2026-10-26T08:00:00.000Z',
                    },
                    revision: '0'.repeat(64),
                })),
                getActivationState: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: [], revision: '0' })),
                getPlacementState: vi.fn(async () => ({
                    status: 'AVAILABLE' as const,
                    data: {
                        userId: 'u1',
                        planId: 'p1',
                        revision: 1,
                        assignments: [{ sessionId: 's0', date: BLOCK_START, status: 'planned' as const }],
                        updatedAt: '2026-11-24T00:00:00.000Z',
                    },
                    revision: '1',
                })),
                getPlacementHistoryState: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: [], revision: '0' })),
                getRevisionState: vi.fn(async () => ({ status: 'AVAILABLE' as const, data: samplePlan(1), revision: '1' })),
            },
            attempts: {
                listAttemptsForProtocolWithDiagnostics: vi.fn(async () => ({ attempts: [], unreadableCount: 1 })),
            },
        });

        const service = new DEvalReadoutService(deps);
        const out = await service.run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        });

        expect(out.input.c3.followUpSourceStates?.checkins).toBe('invalid');
        expect(out.input.c3.followUpSourceStates?.healthAnomalyOutcomes).toBe('invalid');
        expect(out.input.c3.followUpSourcesComplete).toBe(false);
        expect(out.result.c1.block.unknown).toBe(1);
        expect(out.result.c2.status).toBe('inconclusive');
        expect(out.result.c3.status).toBe('inconclusive');
        expect(out.result.overall).toBe('EXTEND');
    });
});
