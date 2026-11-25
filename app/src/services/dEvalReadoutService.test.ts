import { describe, expect, it, vi } from 'vitest';
import { computeContentHash } from '../engine/externalPlanHash';
import type { ExternalTrainingPlanV6 } from '../sessions/externalPlanV6';
import type { PersistedFlagEvaluation } from '../ledger/flagEvaluation';
import { LEDGER_FLAG_IDS } from '../ledger/export/schema';
import { addDaysToLocalDateString } from '../utils/localDate';
import {
    ASSESSMENT_ATTEMPT_MAX_RECORDS,
    DEvalReadoutService,
    EXECUTION_HEADER_MAX_RECORDS,
    HEALTH_ANOMALY_OUTCOME_MAX_RECORDS,
    OBSERVATION_HISTORY_READ_CONCURRENCY,
    type DEvalReadoutDependencies,
} from './dEvalReadoutService';

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
            getPlacementHistoryState: vi.fn(async () => ({
                status: 'AVAILABLE' as const,
                data: [{
                    userId: 'u1',
                    planId: 'p1',
                    revision: 1,
                    changedOn: BASELINE_START,
                    recordedAt: `${BASELINE_START}T08:00:00.000Z`,
                    previous: [],
                    assignments: dates.map((d, i) => ({ sessionId: `s${i}`, date: d, status: 'completed' as const })),
                    successors: {},
                }],
                revision: '1',
            })),
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
            listRevisionsForObservationWithDiagnostics: vi.fn(async () => ({ revisions: [], unreadableCount: 0 })),
        },
        ...overrides,
    };

    return { deps, planHash };
}

describe('DEvalReadoutService', () => {
    it('reads user-scoped records with bounded queries, verifies plan hashes, and renders the §7 report', async () => {
        const { deps } = await createDeps();
        const service = new DEvalReadoutService(deps, () => AS_OF_POST);

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
        expect(deps.executions.getExecutionHeadersInRange).toHaveBeenCalledWith('u1', '2026-10-26', '2026-12-26', EXECUTION_HEADER_MAX_RECORDS);
        expect(deps.activityOverrides.getOverridesSinceState).toHaveBeenCalledWith('u1', BLOCK_START, BLOCK_END);
        expect(deps.healthAnomalyOutcomes.listForUserWithDiagnostics).toHaveBeenCalledWith('u1', HEALTH_ANOMALY_OUTCOME_MAX_RECORDS);
        expect(deps.attempts.listAttemptsForProtocolWithDiagnostics).toHaveBeenCalledWith('u1', 'field-standing-broad-jump', ASSESSMENT_ATTEMPT_MAX_RECORDS);
    });

    it('rejects invalid user ids and invalid date ranges', async () => {
        const { deps } = await createDeps();
        const service = new DEvalReadoutService(deps, () => AS_OF_POST);

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

        // A future as-of date would call sessions missed and close windows that have not happened yet.
        await expect(service.run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2026-12-27',
            rollbackState: 'unused',
        })).rejects.toThrow('future');
        expect(deps.flags.getInRangeState).not.toHaveBeenCalled();
    });

    it('reports authored sessions the overlay never recorded as unknown', async () => {
        const { deps } = await createDeps();
        const service = new DEvalReadoutService({
            ...deps,
            externalPlans: {
                ...deps.externalPlans,
                getPlacementState: vi.fn(async () => ({ status: 'MISSING' as const })),
                getPlacementHistoryState: vi.fn(async () => ({ status: 'MISSING' as const })),
            },
        }, () => AS_OF_POST);
        const out = await service.run('u1', {
            blockStartDate: '2026-11-03',
            blockEndDate: '2026-11-30',
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        });
        // s3..s5, s6..s8 and s9 are authored on the first day of plan weeks 2, 3 and 4.
        expect(out.result.c1.block).toMatchObject({ planned: 7, unknown: 7 });
        expect(out.result.c1.status).toBe('inconclusive');
    });

    it('treats skipped invalid activity overrides as an unreadable source', async () => {
        const flagDay = '2026-11-28';
        const base = (await createDeps()).deps;
        const { deps } = await createDeps({
            flags: {
                getInRangeState: vi.fn(async () => ({
                    status: 'AVAILABLE' as const,
                    data: makeAllFlags(BASELINE_START, BLOCK_END).map(flag => (
                        flag.observedOn === flagDay && flag.id === 'illness_anomaly' ? { ...flag, active: true } : flag
                    )),
                    revision: '1',
                })),
            },
            occurrences: {
                queryActiveInDateWindow: vi.fn(async () => (await base.occurrences.queryActiveInDateWindow('u1', '', ''))
                    .filter(item => item.localDate === flagDay)
                    .map(item => ({
                        ...item,
                        sourceRefs: [{ kind: 'provider_activity' as const, provider: 'garmin' as const, activityId: 'g-1' }],
                    }))),
            },
            activities: {
                getActivitiesInRange: vi.fn(async () => ({
                    status: 'AVAILABLE' as const,
                    data: [{ activityId: 'g-1', date: flagDay, intensityTag: 'easy' }] as never,
                    revision: null,
                })),
            },
            activityOverrides: {
                getOverridesSinceState: vi.fn(async () => ({
                    status: 'AVAILABLE' as const,
                    data: {},
                    revision: null,
                    issues: [{ code: 'invalid-activity-override', documentPath: 'users/u1/activity_overrides/g-1' }],
                })),
            },
        });
        const out = await new DEvalReadoutService(deps, () => AS_OF_POST).run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        });
        expect(out.result.c3.incompleteFollowUps).toContain('unknown_intensity:occ-2');
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

        const service = new DEvalReadoutService(deps, () => AS_OF_POST);
        const out = await service.run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        });

        expect(out.input.c2.attemptRecords).toBeUndefined();
        expect(out.input.c3.followUpSourceStates?.checkins).toBe('invalid');
        expect(out.input.c3.followUpSourceStates?.healthAnomalyOutcomes).toBe('invalid');
        expect(out.input.c3.followUpSourcesComplete).toBe(false);
        expect(out.result.c1.block.unknown).toBe(1);
        expect(out.result.c2.status).toBe('inconclusive');
        expect(out.result.c2.reasons).toContain('attempt_records_unavailable');
        expect(out.result.c3.status).toBe('inconclusive');
        expect(out.result.overall).toBe('EXTEND');
    });

    it('marks affected C2 metrics inconclusive when a metric observation read is incomplete while preserving complete metrics', async () => {
        const base = (await createDeps()).deps;
        const { deps } = await createDeps({
            observations: {
                ...base.observations,
                listCurrentObservationsForMetricWithDiagnostics: vi.fn(async (uid, metricId) => {
                    const res = await base.observations.listCurrentObservationsForMetricWithDiagnostics(uid, metricId);
                    if (metricId === 'standing_broad_jump_distance_cm') {
                        return { observations: res.observations, unreadableCount: 1 };
                    }
                    return res;
                }),
            },
        });

        const out = await new DEvalReadoutService(deps, () => AS_OF_POST).run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        });

        expect(out.input.c2.incompleteObservationMetricIds).toEqual(['standing_broad_jump_distance_cm']);
        const broadJump = out.result.c2.protocols.find(p => p.protocolId === 'field-standing-broad-jump');
        const squat = out.result.c2.protocols.find(p => p.protocolId === 'strength-back-squat-1rm');
        expect(broadJump?.status).toBe('inconclusive');
        expect(broadJump?.reasons).toContain('observation_records_incomplete');
        expect(squat?.status).toBe('pending');
        expect(out.result.c2.status).toBe('inconclusive');
        expect(out.result.overall).toBe('EXTEND');
    });

    it('treats a plan header with an unparseable importedAt as an unverified revision', async () => {
        const { deps, planHash } = await createDeps();
        const service = new DEvalReadoutService({
            ...deps,
            externalPlans: {
                ...deps.externalPlans,
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
                        importedAt: 'not-an-iso-timestamp',
                        supersededFrom: BASELINE_START,
                        updatedAt: '2026-10-26T08:00:00.000Z',
                    },
                    revision: planHash,
                })),
            },
        }, () => AS_OF_POST);

        const out = await service.run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        });

        expect(out.result.c1.block.unknown).toBe(10);
        expect(out.result.c1.status).toBe('inconclusive');
    });

    it('reconstructs the pre-cutoff observation revision when head was corrected after asOfDate', async () => {
        const base = (await createDeps()).deps;
        const afterAtt = {
            id: 'att-after-jump',
            protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
            state: 'completed' as const,
            purpose: 'post_block' as const,
            completedAt: '2027-01-15T10:00:00.000Z',
        };
        const rev1 = {
            observationKey: 'att-after-jump:standing_broad_jump_distance_cm',
            revision: 1,
            metricId: 'standing_broad_jump_distance_cm',
            value: 220,
            unit: 'cm',
            protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
            assessmentAttemptId: 'att-after-jump',
            source: 'manual' as const,
            validity: 'valid' as const,
            observedAt: '2027-01-15T10:00:00.000Z',
            comparisonSeriesKey: 'field-standing-broad-jump:series-1',
            comparisonCanonicalizationVersion: '1',
            context: {},
            createdAt: '2027-01-15T10:00:00.000Z',
        };
        const rev2 = {
            ...rev1,
            revision: 2,
            supersedesRevision: 1,
            value: 252,
            correctionReason: 'Re-measured after cutoff',
            createdAt: '2027-01-25T10:00:00.000Z',
        };
        const head = {
            observationKey: rev1.observationKey,
            assessmentAttemptId: 'att-after-jump',
            metricId: 'standing_broad_jump_distance_cm',
            headRevision: 2,
            createdAt: rev1.createdAt,
            updatedAt: rev2.createdAt,
        };

        const listRevisions = vi.fn(async () => ({ revisions: [rev1, rev2], unreadableCount: 0 }));
        const { deps } = await createDeps({
            attempts: {
                listAttemptsForProtocolWithDiagnostics: vi.fn(async (uid, protocolId) => {
                    const res = await base.attempts.listAttemptsForProtocolWithDiagnostics(uid, protocolId);
                    if (protocolId === 'field-standing-broad-jump') {
                        return { ...res, attempts: [...res.attempts, afterAtt] };
                    }
                    return res;
                }),
            },
            observations: {
                listCurrentObservationsForMetricWithDiagnostics: vi.fn(async (uid, metricId) => {
                    const res = await base.observations.listCurrentObservationsForMetricWithDiagnostics(uid, metricId);
                    if (metricId === 'standing_broad_jump_distance_cm') {
                        return { ...res, observations: [...res.observations, { head, revision: rev2 }] };
                    }
                    return res;
                }),
                listRevisionsForObservationWithDiagnostics: listRevisions,
            },
        });

        const atJan20 = await new DEvalReadoutService(deps, () => '2027-01-30').run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
            rollbackState: 'unused',
        });
        expect(listRevisions).toHaveBeenCalledWith('u1', rev1.observationKey);
        expect(atJan20.result.c2.protocols.find(p => p.protocolId === 'field-standing-broad-jump')).toMatchObject({
            status: 'fail',
        });
        expect(atJan20.result.c2.status).toBe('fail');
        expect(atJan20.result.overall).toBe('NO_GO');

        listRevisions.mockClear();
        const atJan25 = await new DEvalReadoutService(deps, () => '2027-01-30').run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-25',
            rollbackState: 'unused',
        });
        expect(listRevisions).not.toHaveBeenCalled();
        expect(atJan25.result.c2.protocols.find(p => p.protocolId === 'field-standing-broad-jump')).toMatchObject({
            status: 'pass',
        });
    });

    it('keeps pre-cutoff invalid rev 1 excluded and omits observations whose entire revision history is post-cutoff', async () => {
        const base = (await createDeps()).deps;
        const invalidEarlyAtt = {
            id: 'att-after-invalid',
            protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
            state: 'completed' as const,
            purpose: 'post_block' as const,
            completedAt: '2027-01-15T10:00:00.000Z',
        };
        const invalidRev1 = {
            observationKey: 'att-after-invalid:standing_broad_jump_distance_cm',
            revision: 1,
            metricId: 'standing_broad_jump_distance_cm',
            value: 255,
            unit: 'cm',
            protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
            assessmentAttemptId: 'att-after-invalid',
            source: 'manual' as const,
            validity: 'invalid' as const,
            invalidReason: 'Foot fault',
            observedAt: '2027-01-15T10:00:00.000Z',
            comparisonSeriesKey: 'field-standing-broad-jump:series-1',
            comparisonCanonicalizationVersion: '1',
            context: {},
            createdAt: '2027-01-15T10:00:00.000Z',
        };
        const validRev2 = {
            ...invalidRev1,
            revision: 2,
            supersedesRevision: 1,
            validity: 'valid' as const,
            invalidReason: undefined,
            correctionReason: 'Cleared on review',
            createdAt: '2027-01-25T10:00:00.000Z',
        };
        const invalidHead = {
            observationKey: invalidRev1.observationKey,
            assessmentAttemptId: 'att-after-invalid',
            metricId: 'standing_broad_jump_distance_cm',
            headRevision: 2,
            createdAt: invalidRev1.createdAt,
            updatedAt: validRev2.createdAt,
        };

        const postOnlyRev1 = {
            ...invalidRev1,
            observationKey: 'att-after-post:standing_broad_jump_distance_cm',
            assessmentAttemptId: 'att-after-post',
            validity: 'valid' as const,
            invalidReason: undefined,
            createdAt: '2027-01-22T10:00:00.000Z',
        };
        const postOnlyRev2 = {
            ...postOnlyRev1,
            revision: 2,
            supersedesRevision: 1,
            value: 260,
            correctionReason: 'Updated post-cutoff',
            createdAt: '2027-01-25T10:00:00.000Z',
        };
        const postOnlyHead = {
            observationKey: postOnlyRev1.observationKey,
            assessmentAttemptId: 'att-after-post',
            metricId: 'standing_broad_jump_distance_cm',
            headRevision: 2,
            createdAt: postOnlyRev1.createdAt,
            updatedAt: postOnlyRev2.createdAt,
        };
        const postOnlyAtt = {
            ...invalidEarlyAtt,
            id: 'att-after-post',
        };

        const { deps } = await createDeps({
            attempts: {
                listAttemptsForProtocolWithDiagnostics: vi.fn(async (uid, protocolId) => {
                    const res = await base.attempts.listAttemptsForProtocolWithDiagnostics(uid, protocolId);
                    if (protocolId === 'field-standing-broad-jump') {
                        return { ...res, attempts: [...res.attempts, invalidEarlyAtt, postOnlyAtt] };
                    }
                    return res;
                }),
            },
            observations: {
                listCurrentObservationsForMetricWithDiagnostics: vi.fn(async (uid, metricId) => {
                    const res = await base.observations.listCurrentObservationsForMetricWithDiagnostics(uid, metricId);
                    if (metricId === 'standing_broad_jump_distance_cm') {
                        return {
                            ...res,
                            observations: [
                                ...res.observations,
                                { head: invalidHead, revision: validRev2 },
                                { head: postOnlyHead, revision: postOnlyRev2 },
                            ],
                        };
                    }
                    return res;
                }),
                listRevisionsForObservationWithDiagnostics: vi.fn(async (_uid, key) => {
                    if (key === invalidHead.observationKey) {
                        return { revisions: [invalidRev1, validRev2], unreadableCount: 0 };
                    }
                    if (key === postOnlyHead.observationKey) {
                        return { revisions: [postOnlyRev1, postOnlyRev2], unreadableCount: 0 };
                    }
                    return { revisions: [], unreadableCount: 0 };
                }),
            },
        });

        const out = await new DEvalReadoutService(deps, () => '2027-01-30').run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
            rollbackState: 'unused',
        });
        expect(out.result.c2.protocols.find(p => p.protocolId === 'field-standing-broad-jump')?.status).toBe('pending');
        expect(out.result.c2.status).toBe('pending');
    });

    it('fails closed on affected C2 metrics when pre-cutoff observation revision history cannot be reconstructed', async () => {
        const base = (await createDeps()).deps;
        const afterAtt = {
            id: 'att-after-jump',
            protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
            state: 'completed' as const,
            purpose: 'post_block' as const,
            completedAt: '2027-01-15T10:00:00.000Z',
        };
        const rev1 = {
            observationKey: 'att-after-jump:standing_broad_jump_distance_cm',
            revision: 1,
            metricId: 'standing_broad_jump_distance_cm',
            value: 252,
            unit: 'cm',
            protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
            assessmentAttemptId: 'att-after-jump',
            source: 'manual' as const,
            validity: 'valid' as const,
            observedAt: '2027-01-15T10:00:00.000Z',
            comparisonSeriesKey: 'field-standing-broad-jump:series-1',
            comparisonCanonicalizationVersion: '1',
            context: {},
            createdAt: '2027-01-15T10:00:00.000Z',
        };
        const rev2 = {
            ...rev1,
            revision: 2,
            supersedesRevision: 1,
            value: 254,
            correctionReason: 'Updated after cutoff',
            createdAt: '2027-01-25T10:00:00.000Z',
        };
        const head = {
            observationKey: rev1.observationKey,
            assessmentAttemptId: 'att-after-jump',
            metricId: 'standing_broad_jump_distance_cm',
            headRevision: 2,
            createdAt: rev1.createdAt,
            updatedAt: rev2.createdAt,
        };

        const runWithHistoryReader = async (
            listRevisionsForObservationWithDiagnostics: DEvalReadoutDependencies['observations']['listRevisionsForObservationWithDiagnostics'],
        ) => {
            const { deps } = await createDeps({
                attempts: {
                    listAttemptsForProtocolWithDiagnostics: vi.fn(async (uid, protocolId) => {
                        const res = await base.attempts.listAttemptsForProtocolWithDiagnostics(uid, protocolId);
                        return protocolId === 'field-standing-broad-jump'
                            ? { ...res, attempts: [...res.attempts, afterAtt] }
                            : res;
                    }),
                },
                observations: {
                    listCurrentObservationsForMetricWithDiagnostics: vi.fn(async (uid, metricId) => {
                        const res = await base.observations.listCurrentObservationsForMetricWithDiagnostics(uid, metricId);
                        return metricId === 'standing_broad_jump_distance_cm'
                            ? { ...res, observations: [...res.observations, { head, revision: rev2 }] }
                            : res;
                    }),
                    listRevisionsForObservationWithDiagnostics,
                },
            });
            return new DEvalReadoutService(deps, () => '2027-01-30').run('u1', {
                blockStartDate: BLOCK_START,
                blockEndDate: BLOCK_END,
                asOfDate: '2027-01-20',
                rollbackState: 'unused',
            });
        };

        for (const reader of [
            vi.fn(async () => { throw new Error('network error'); }),
            vi.fn(async () => ({ revisions: [rev1, rev2], unreadableCount: 1 })),
            vi.fn(async () => ({ revisions: [rev2], unreadableCount: 0 })),
            vi.fn(async () => ({ revisions: [{ ...rev1, createdAt: '2027-01-26T10:00:00.000Z' }, rev2], unreadableCount: 0 })),
        ]) {
            const out = await runWithHistoryReader(reader);
            const broadJump = out.result.c2.protocols.find(p => p.protocolId === 'field-standing-broad-jump');
            const squat = out.result.c2.protocols.find(p => p.protocolId === 'strength-back-squat-1rm');
            expect(broadJump?.status).toBe('inconclusive');
            expect(broadJump?.reasons).toContain('observation_records_incomplete');
            expect(squat?.status).toBe('pending');
            expect(out.result.c2.status).toBe('inconclusive');
            expect(out.result.overall).toBe('EXTEND');
        }
    });

    it('rejects malformed or date-mismatched asOfTimestamp before starting Firestore reads', async () => {
        const { deps } = await createDeps();
        const service = new DEvalReadoutService(deps, () => AS_OF_POST);

        await expect(service.run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            asOfTimestamp: 'not-a-timestamp',
            rollbackState: 'unused',
        })).rejects.toThrow(/asOfTimestamp/);
        expect(deps.flags.getInRangeState).not.toHaveBeenCalled();

        await expect(service.run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            asOfTimestamp: '2026-12-26T23:30:00.000Z', // 2026-12-27 in Europe/Warsaw
            rollbackState: 'unused',
        })).rejects.toThrow(/Europe\/Warsaw/);
        expect(deps.flags.getInRangeState).not.toHaveBeenCalled();

        const valid = await service.run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            asOfTimestamp: '2026-12-26T12:00:00.000Z',
            rollbackState: 'unused',
        });
        expect(valid.result.c1.status).toBe('pass');
    });

    it('fails C4 as inconclusive when engine preference read is unavailable or invalid, and marks truncated outcomes unavailable', async () => {
        const { deps } = await createDeps({
            preferences: {
                getPreferencesState: vi.fn(async () => ({ status: 'UNAVAILABLE' as const, operation: 'read preferences', retryable: true })),
            },
            healthAnomalyOutcomes: {
                listForUserWithDiagnostics: vi.fn(async () => ({ outcomes: [], unreadableCount: 0, truncated: true })),
            },
        });
        const out = await new DEvalReadoutService(deps, () => AS_OF_POST).run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        });

        expect(out.result.c4.status).toBe('inconclusive');
        expect(out.result.c4.reason).toContain('engineRecommendationsEnabled');
        expect(out.markdown).toContain('rollback used=unverified');
        expect(out.input.c3.followUpSourceStates?.healthAnomalyOutcomes).toBe('unavailable');
        expect(out.input.c3.followUpSourcesComplete).toBe(false);
        expect(out.result.overall).toBe('EXTEND');
    });

    it('caps concurrent observation revision-history reads when reconstructing post-cutoff corrections', async () => {
        const base = (await createDeps()).deps;
        const postCutoffObs = Array.from({ length: 6 }, (_, i) => {
            const key = `att-cap-${i}:standing_broad_jump_distance_cm`;
            return {
                head: {
                    observationKey: key,
                    assessmentAttemptId: `att-cap-${i}`,
                    metricId: 'standing_broad_jump_distance_cm',
                    headRevision: 2,
                    createdAt: '2027-01-15T10:00:00.000Z',
                    updatedAt: '2027-01-25T10:00:00.000Z',
                },
                revision: {
                    observationKey: key,
                    revision: 2,
                    supersedesRevision: 1,
                    metricId: 'standing_broad_jump_distance_cm',
                    value: 252,
                    unit: 'cm',
                    protocolRef: { id: 'field-standing-broad-jump', revision: 1 },
                    assessmentAttemptId: `att-cap-${i}`,
                    source: 'manual' as const,
                    validity: 'valid' as const,
                    observedAt: '2027-01-15T10:00:00.000Z',
                    comparisonSeriesKey: 'field-standing-broad-jump:series-1',
                    comparisonCanonicalizationVersion: '1',
                    context: {},
                    correctionReason: 'Updated after cutoff',
                    createdAt: '2027-01-25T10:00:00.000Z',
                },
            };
        });

        let active = 0;
        let peak = 0;
        const { deps } = await createDeps({
            observations: {
                listCurrentObservationsForMetricWithDiagnostics: vi.fn(async (uid, metricId) => {
                    const res = await base.observations.listCurrentObservationsForMetricWithDiagnostics(uid, metricId);
                    if (metricId === 'standing_broad_jump_distance_cm') {
                        return { ...res, observations: [...res.observations, ...postCutoffObs] };
                    }
                    return res;
                }),
                listRevisionsForObservationWithDiagnostics: vi.fn(async (_uid, key) => {
                    active += 1;
                    peak = Math.max(peak, active);
                    await new Promise(resolve => setTimeout(resolve, 10));
                    active -= 1;
                    const entry = postCutoffObs.find(item => item.head.observationKey === key)!;
                    return {
                        revisions: [
                            { ...entry.revision, revision: 1, supersedesRevision: undefined, correctionReason: undefined, createdAt: '2027-01-15T10:00:00.000Z' },
                            entry.revision,
                        ],
                        unreadableCount: 0,
                    };
                }),
            },
        });

        await new DEvalReadoutService(deps, () => '2027-01-30').run('u1', {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
            rollbackState: 'unused',
        });
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(OBSERVATION_HISTORY_READ_CONCURRENCY);
    });
});
