import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type {
    SubjectiveInput,
    EngineObjectiveInput,
    UserContext,
    ExternalPlanHeader,
} from '../engine/models';
import type { BundlePlacementProposal } from '../engine/intradayBundlePlacement';
import type { LedgerCeilings } from '../engine/dailyLedger';
import { EXTERNAL_PLAN_SCHEMA_V4, type ExternalPlanSessionV4, type ExternalTrainingPlanV4 } from '../sessions/externalPlanV4';
import type { SessionDefinition } from '../sessions/models';
import fixture01 from '../sessions/fixtures/01-full-body-maintenance.json';
import type { ActiveExternalPlan } from './activeExternalPlanService';
import { resolvePlacement } from '../engine/externalPlacement';
import {
    sessionOccurrenceService,
    windowReservationId,
    deterministicExternalPlanOccurrenceId,
} from './sessionOccurrenceService';
import {
    dailyLedgerAggregateService,
    type DailyLedgerAggregate,
} from './dailyLedgerAggregateService';
import { sessionResponseService } from './sessionResponseService';
import { sessionExecutionService } from './sessionExecutionService';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import {
    getIntradayDecisionDocPath,
} from './intradayDecisionService';
import {
    adjudicateIntradayBundleMembers,
    type AdjudicateIntradayBundleMembersParams,
} from './intradayBundleMemberAdjudication';
import type {
    ExternalPlanSessionOccurrence,
} from '../sessions/models';
import type { SessionResponse } from '../responses/models';
import type { IntradayDecisionRecord } from '../engine/intradayDecision';

const store = new Map<string, unknown>();

function mockDocRef(path: string) {
    return { path };
}

vi.mock('firebase/firestore', () => {
    return {
        doc: vi.fn((_db: unknown, ...parts: string[]) => {
            const path = parts.filter(p => typeof p === 'string').join('/');
            return mockDocRef(path);
        }),
        collection: vi.fn((_db: unknown, ...parts: string[]) => {
            const path = parts.filter(p => typeof p === 'string').join('/');
            return { path };
        }),
        query: vi.fn((c: unknown) => c),
        where: vi.fn(() => ({})),
        orderBy: vi.fn(() => ({})),
        limit: vi.fn(() => ({})),
        getDocs: vi.fn(async () => ({ docs: [] })),
        getDoc: vi.fn(async (ref: { path: string }) => {
            const val = store.get(ref.path);
            return {
                ref,
                exists: () => val !== undefined,
                data: () => (val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined),
            };
        }),
        runTransaction: vi.fn(async (_db: unknown, callback: (t: {
            get: (ref: { path: string }) => Promise<{ ref: { path: string }; exists: () => boolean; data: () => unknown }>;
            set: (ref: { path: string }, data: unknown) => void;
            delete: (ref: { path: string }) => void;
        }) => Promise<unknown>) => {
            const fakeTransaction = {
                get: vi.fn(async (ref: { path: string }) => {
                    const val = store.get(ref.path);
                    return {
                        ref,
                        exists: () => val !== undefined,
                        data: () => (val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined),
                    };
                }),
                set: vi.fn((ref: { path: string }, data: unknown) => {
                    store.set(ref.path, JSON.parse(JSON.stringify(data)));
                }),
                delete: vi.fn((ref: { path: string }) => {
                    store.delete(ref.path);
                }),
            };
            return callback(fakeTransaction);
        }),
    };
});

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({} as Firestore)),
}));

const DATE = '2026-09-07';
const USER_ID = 'user-bundle-test';

const ceilings: LedgerCeilings = {
    dailyMinuteCeiling: 120,
    dailySystemicCostCeiling: 1.0,
};

const mockSubjective: SubjectiveInput = {
    readiness: 4,
    sleepQuality: 4,
    fatigue: 2,
    soreness: 2,
    stress: 2,
    motivation: 4,
    timeAvailable: 120,
    painFlag: false,
    alreadyTrainedToday: false,
    preferredModalityToday: null,
};

const mockObjective: EngineObjectiveInput = {
    sleep_score: 80,
    sleep_duration_min: 480,
    rhr: 50,
    rhr_7d_avg: 50,
    rhr_delta: 0,
    hrv_weekly_avg: 55,
    hrv_last_night: 55,
    hrv_delta: 0,
    hrv_stdev_28d: null,
    rhr_stdev_28d: null,
    sleep_score_stdev_28d: null,
    respiration: 14,
    respiration_delta: 0,
    respiration_delta_28d: 0,
    respiration_mad_28d: null,
    body_battery_wake: 80,
    last_3_days_hard_sessions_count: 0,
    yesterday_training: null,
    today_training: null,
    sleep_score_delta_7d: 0,
    rhr_delta_28d: 0,
    hrv_delta_28d: 0,
    sleep_score_delta_28d: 0,
    total_steps: 8000,
    steps_7d_avg: 8000,
};

const mockUserContext: UserContext = {
    goals: { shortTerm: 'general_fitness', midTerm: 'strength', longTerm: 'endurance' },
    constraints: {
        hasCableMachine: true,
        hasFreeWeights: true,
        hasTreadmill: true,
        hasIndoorBike: true,
        maxTimeMinutes: 120,
        restrictedModalities: [],
    },
    preferences: {
        avoidedModalities: [],
        deprioritizedModalities: [],
        preferredModalities: ['Strength', 'Running'],
        conservativeBias: false,
    },
};

const mockAvailability: import('../engine/schedule').ResolvedAvailability = {
    date: DATE,
    maxTimeMinutes: 120,
    availableEquipment: ['free_weights', 'barbell', 'dumbbell'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

function createPlan(amSessionOverrides: Partial<ExternalPlanSessionV4> = {}, pmSessionOverrides: Partial<ExternalPlanSessionV4> = {}): ActiveExternalPlan {
    const am: ExternalPlanSessionV4 = {
        id: 'am-run',
        title: 'Morning Easy Run',
        priority: 'key',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'running', intensity: 'easy', durationMin: 45, durationMax: 50, environment: 'either', equipment: [] },
        definition: fixture01 as unknown as SessionDefinition,
        intraday: { window: { startLocal: '07:00', endLocal: '08:00' }, bundleId: 'b-double', order: 0 },
        ...amSessionOverrides,
    };
    const pm: ExternalPlanSessionV4 = {
        id: 'pm-strength',
        title: 'Afternoon Strength',
        priority: 'supporting',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: ['free_weights'] },
        definition: fixture01 as unknown as SessionDefinition,
        intraday: {
            window: { startLocal: '16:00', endLocal: '17:00' },
            bundleId: 'b-double',
            order: 1,
            afterSessionId: 'am-run',
            minimumSeparationMinutes: 240,
        },
        ...pmSessionOverrides,
    };
    const plan: ExternalTrainingPlanV4 = {
        schema: EXTERNAL_PLAN_SCHEMA_V4,
        planId: 'p-v4',
        revision: 1,
        title: 'Intraday Double Plan',
        startDate: DATE,
        weekCount: 1,
        sessions: [am, pm],
        restDays: [],
    };
    const header: ExternalPlanHeader = {
        userId: USER_ID,
        planId: 'p-v4',
        revision: 1,
        title: 'Intraday Double Plan',
        startDate: DATE,
        weekCount: 1,
        contentHash: 'hash-bundle-v4',
        importedAt: '2026-09-01T00:00:00Z',
        supersededFrom: null,
        updatedAt: '2026-09-01T00:00:00Z',
    };
    return {
        header,
        plan,
        placement: null,
        placed: resolvePlacement(plan, null, {}),
    };
}

function createBundlePlacement(): BundlePlacementProposal {
    return {
        bundleId: 'b-double',
        outcome: 'placed',
        bindings: [
            {
                sessionId: 'am-run',
                windowId: 'w-am',
                boundStartLocal: '07:00',
                boundEndLocal: '08:00',
                startInstant: '2026-09-07T05:00:00.000Z',
                endInstant: '2026-09-07T06:00:00.000Z',
            },
            {
                sessionId: 'pm-strength',
                windowId: 'w-pm',
                boundStartLocal: '16:00',
                boundEndLocal: '17:00',
                startInstant: '2026-09-07T14:00:00.000Z',
                endInstant: '2026-09-07T15:00:00.000Z',
            },
        ],
    };
}

function createMockSessionResponse(amOccId: string): SessionResponse {
    return {
        userId: USER_ID,
        responseId: 'resp-am-1',
        sourceSession: { kind: 'execution', id: 'exec-am-1', date: DATE },
        occurrenceId: amOccId,
        window: 'immediate',
        date: DATE,
        checkinRef: { date: DATE },
        sessionRpe: 3,
        note: 'felt great',
        createdAt: '2026-09-07T06:05:00.000Z',
        updatedAt: '2026-09-07T06:05:00.000Z',
    };
}

function createMockExecution(amOccId: string): NormalizedExecutionRecord {
    return {
        execution: {
            executionId: 'exec-am-1',
            userId: USER_ID,
            sessionSource: { kind: 'external_plan', planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            occurrenceId: amOccId,
            date: DATE,
            state: 'completed',
            startedAt: '2026-09-07T05:00:00.000Z',
            completedAt: '2026-09-07T06:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
            schemaVersion: 1,
        },
        entries: [],
    };
}

describe('adjudicateIntradayBundleMembers', () => {
    beforeEach(() => {
        store.clear();
        vi.restoreAllMocks();
    });

    it('adjudicates an admitted member with completed predecessor & immediate response (proceed + binding + decision record)', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        // Setup AM predecessor occurrence and completed execution
        const amOccId = 'occ-am-123';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: {
                planId: 'p-v4',
                revision: 1,
                sessionId: 'am-run',
                contentHash: 'hash-bundle-v4',
            },
            state: 'completed',
            placementOrder: 0,
            windowBinding: {
                windowId: 'w-am',
                bundleId: 'b-double',
                order: 0,
                boundStartLocal: '07:00',
                boundEndLocal: '08:00',
                startInstant: '2026-09-07T05:00:00.000Z',
                endInstant: '2026-09-07T06:00:00.000Z',
            },
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };

        const amExec = createMockExecution(amOccId);

        const amResp = createMockSessionResponse(amOccId);

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({
            executions: [amExec],
            invalidRecords: 0,
        });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(amResp);

        const result = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            evaluationInstant: '2026-09-07T12:00:00.000Z', // 6 hours after AM completion (min separation 4h)
        });

        expect(result.bindings).toHaveLength(1);
        expect(result.statuses).toHaveLength(1);
        expect(result.statuses[0].status).toBe('proceed');
        expect(result.statuses[0].sessionId).toBe('pm-strength');
        expect(result.bindings[0].sessionSource.kind).toBe('external_plan');

        // Verify occurrence document was written in transaction
        const pmOccId = result.statuses[0].occurrenceId!;
        const occPath = `users/${USER_ID}/session_occurrences/${pmOccId}`;
        const occData = store.get(occPath) as ExternalPlanSessionOccurrence;
        expect(occData).toBeDefined();
        expect(occData.state).toBe('scheduled');
        expect(occData.windowBinding?.windowId).toBe('w-pm');

        // Verify window reservation document was written
        const winPath = `users/${USER_ID}/session_occurrence_windows/${windowReservationId(DATE, 'w-pm')}`;
        const winData = store.get(winPath) as { occurrenceId: string };
        expect(winData).toBeDefined();
        expect(winData.occurrenceId).toBe(pmOccId);

        // Verify daily ledger aggregate document was updated
        const aggPath = `users/${USER_ID}/daily_ledgers/${DATE}`;
        const aggData = store.get(aggPath) as DailyLedgerAggregate;
        expect(aggData).toBeDefined();
        expect(aggData.reservations[pmOccId]).toBeDefined();
        expect(aggData.reservations[pmOccId].state).toBe('reserved');

        // Verify intraday decision record was written
        const decisionId = aggData.reservations[pmOccId].decisionId!;
        const decPath = getIntradayDecisionDocPath(USER_ID, decisionId);
        const decData = store.get(decPath) as IntradayDecisionRecord;
        expect(decData).toBeDefined();
        expect(decData.status).toBe('provisional');
        expect(decData.verdict.decision).toBe('proceed');
        expect(decData.postReservationLedgerRevision).toBe(String(aggData.revision));
        expect(decData.predecessorExecutionId).toBe('exec-am-1');
        expect(decData.predecessorOccurrenceId).toBe(amOccId);
    });

    it('handles uncompleted predecessor (pending status, occurrence and reservation created, no binding)', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        // AM predecessor occurrence is only scheduled
        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'scheduled',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T05:00:00.000Z',
        };

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(null);

        const result = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            evaluationInstant: '2026-09-07T06:00:00.000Z',
        });

        expect(result.bindings).toHaveLength(0); // No binding on pending
        expect(result.statuses).toHaveLength(1);
        expect(result.statuses[0].status).toBe('pending');
        expect(result.statuses[0].reason).toContain('has not completed');

        // Occurrence and reservation were still created atomically
        const pmOccId = result.statuses[0].occurrenceId!;
        const occPath = `users/${USER_ID}/session_occurrences/${pmOccId}`;
        expect(store.get(occPath)).toBeDefined();

        const aggPath = `users/${USER_ID}/daily_ledgers/${DATE}`;
        const aggData = store.get(aggPath) as DailyLedgerAggregate;
        expect(aggData.reservations[pmOccId]).toBeDefined();
        expect(aggData.reservations[pmOccId].state).toBe('reserved');
    });

    it('handles predecessor awaiting immediate confirmation (pending status, no binding)', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        // AM completed, but NO immediate response yet
        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'completed',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };

        const amExec = createMockExecution(amOccId);

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [amExec], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(null);

        const result = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        });

        expect(result.bindings).toHaveLength(0);
        expect(result.statuses).toHaveLength(1);
        expect(result.statuses[0].status).toBe('pending');
        expect(result.statuses[0].reason).toContain('Awaiting explicit post-predecessor');
    });

    it('excludes target member reservation to prevent self-consumption on consecutive reloads', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'completed',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        const amExec = createMockExecution(amOccId);
        const amResp = createMockSessionResponse(amOccId);

        const targetOccId = await deterministicExternalPlanOccurrenceId(DATE, {
            planId: 'p-v4', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-bundle-v4',
        });

        // First pass: creates PM occurrence and reservation
        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [amExec], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(amResp);

        const firstResult = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        });
        expect(firstResult.statuses[0].status).toBe('proceed');

        // Now PM occurrence exists in DB
        const pmOcc = store.get(`users/${USER_ID}/session_occurrences/${targetOccId}`) as ExternalPlanSessionOccurrence;
        expect(pmOcc).toBeDefined();

        // Second pass: mock returns BOTH AM and PM occurrences
        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc, pmOcc]);

        const secondResult = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        });

        // Target does NOT reject itself by self-consuming capacity
        expect(secondResult.statuses[0].status).toBe('proceed');
        expect(secondResult.bindings).toHaveLength(1);
    });

    it('rejects candidate and atomically transitions scheduled occurrence to skipped and drops reservation', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        const targetOccId = await deterministicExternalPlanOccurrenceId(DATE, {
            planId: 'p-v4', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-bundle-v4',
        });

        // Pre-seed an existing scheduled occurrence and reservation
        const existingOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: targetOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-bundle-v4' },
            state: 'scheduled',
            placementOrder: 1,
            windowBinding: {
                windowId: 'w-pm',
                bundleId: 'b-double',
                order: 1,
                boundStartLocal: '16:00',
                boundEndLocal: '17:00',
                startInstant: '2026-09-07T14:00:00.000Z',
                endInstant: '2026-09-07T15:00:00.000Z',
            },
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T05:00:00.000Z',
        };
        store.set(`users/${USER_ID}/session_occurrences/${targetOccId}`, existingOcc);
        store.set(`users/${USER_ID}/session_occurrence_windows/${windowReservationId(DATE, 'w-pm')}`, {
            userId: USER_ID,
            date: DATE,
            windowId: 'w-pm',
            occurrenceId: targetOccId,
            createdAt: '2026-09-07T05:00:00.000Z',
        });

        const initialAgg: DailyLedgerAggregate = {
            userId: USER_ID,
            date: DATE,
            revision: 1,
            ceilings,
            reservations: {
                [targetOccId]: { minutes: 50, systemicCost: 0.5, state: 'reserved', decisionId: 'dec-prior' },
            },
            seededAt: '2026-09-07T05:00:00.000Z',
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T05:00:00.000Z',
        };
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, initialAgg);

        // Make ceilings zero to force rejection (capacity exhausted)
        const zeroCeilings: LedgerCeilings = {
            dailyMinuteCeiling: 0,
            dailySystemicCostCeiling: 0,
        };

        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'completed',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        const amExec = createMockExecution(amOccId);
        const amResp = createMockSessionResponse(amOccId);

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc, existingOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [amExec], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(amResp);

        const result = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: { ...mockAvailability, maxTimeMinutes: 0 },
            ceilings: zeroCeilings,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        });

        expect(result.statuses[0].status).toBe('reject');
        expect(result.bindings).toHaveLength(0);

        // Occurrence must be atomically transitioned to skipped
        const updatedOcc = store.get(`users/${USER_ID}/session_occurrences/${targetOccId}`) as ExternalPlanSessionOccurrence;
        expect(updatedOcc.state).toBe('skipped');

        // Window reservation must be deleted
        expect(store.get(`users/${USER_ID}/session_occurrence_windows/${windowReservationId(DATE, 'w-pm')}`)).toBeUndefined();

        // Aggregate reservation dropped and generation bumped
        const updatedAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        expect(updatedAgg.reservations[targetOccId]).toBeUndefined();
        expect(dailyLedgerAggregateService.currentGeneration(updatedAgg, 'pm-strength')).toBe(1);
    });

    it('recovers from reject with fresh occurrence identity minted at generation 1', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        const gen0OccId = await deterministicExternalPlanOccurrenceId(DATE, {
            planId: 'p-v4', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-bundle-v4',
        }, 0);

        const gen1OccId = await deterministicExternalPlanOccurrenceId(DATE, {
            planId: 'p-v4', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-bundle-v4',
        }, 1);

        expect(gen1OccId).not.toBe(gen0OccId);

        // Gen 0 occurrence is skipped
        const skippedOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: gen0OccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-bundle-v4' },
            state: 'skipped',
            placementOrder: 1,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        store.set(`users/${USER_ID}/session_occurrences/${gen0OccId}`, skippedOcc);

        // Aggregate has generation: 1 for pm-strength
        const initialAgg: DailyLedgerAggregate = {
            userId: USER_ID,
            date: DATE,
            revision: 2,
            ceilings,
            reservations: {},
            generations: { 'pm-strength': 1 },
            seededAt: '2026-09-07T05:00:00.000Z',
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, initialAgg);

        // Predecessor is completed & healthy
        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'completed',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        const amExec = createMockExecution(amOccId);
        const amResp = createMockSessionResponse(amOccId);

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc, skippedOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [amExec], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(amResp);

        const result = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        });

        expect(result.statuses[0].status).toBe('proceed');
        expect(result.statuses[0].occurrenceId).toBe(gen1OccId);
        expect(result.bindings).toHaveLength(1);

        // Skipped occurrence document was NOT touched
        expect((store.get(`users/${USER_ID}/session_occurrences/${gen0OccId}`) as ExternalPlanSessionOccurrence).state).toBe('skipped');

        // New generation-1 occurrence was created
        const gen1Occ = store.get(`users/${USER_ID}/session_occurrences/${gen1OccId}`) as ExternalPlanSessionOccurrence;
        expect(gen1Occ).toBeDefined();
        expect(gen1Occ.state).toBe('scheduled');

        // Aggregate reservation is registered under gen1OccId
        const updatedAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        expect(updatedAgg.reservations[gen1OccId]).toBeDefined();
        expect(updatedAgg.reservations[gen1OccId].state).toBe('reserved');
    });

    it('enforces maximum 4 additional sessions cap by omitting binding and emitting notice', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'completed',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        const amExec = createMockExecution(amOccId);
        const amResp = createMockSessionResponse(amOccId);

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [amExec], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(amResp);

        // existingAdditionalBindingsCount is already 4
        const result = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            existingAdditionalBindingsCount: 4,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        });

        expect(result.bindings).toHaveLength(0);
        expect(result.notices).toHaveLength(1);
        expect(result.notices[0]).toContain('maximum 4 additional sessions cap reached');
        expect(result.statuses[0].status).toBe('proceed');
        expect(result.statuses[0].binding).toBeUndefined();

        // Ensure no occurrence or reservation was committed for the capped member
        const targetOccId = await deterministicExternalPlanOccurrenceId(DATE, {
            planId: 'p-v4', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-bundle-v4',
        });
        expect(store.get(`users/${USER_ID}/session_occurrences/${targetOccId}`)).toBeUndefined();
        const agg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate | undefined;
        expect(agg?.reservations?.[targetOccId]).toBeUndefined();
    });

    it('admits session at boundary of additional sessions cap (3 existing bindings -> 4th allowed)', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'completed',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        const amExec = createMockExecution(amOccId);
        const amResp = createMockSessionResponse(amOccId);

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [amExec], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(amResp);

        // existingAdditionalBindingsCount is 3, allowing the 4th session
        const result = await adjudicateIntradayBundleMembers({
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            existingAdditionalBindingsCount: 3,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        });

        expect(result.bindings).toHaveLength(1);
        expect(result.notices).toHaveLength(0);
        expect(result.statuses[0].status).toBe('proceed');
        expect(result.statuses[0].binding).toBeDefined();
    });

    it('converges idempotently on ambiguous retry without error', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'completed',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        const amExec = createMockExecution(amOccId);
        const amResp = createMockSessionResponse(amOccId);

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [amExec], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(amResp);

        const params: AdjudicateIntradayBundleMembersParams = {
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        };

        // Run once
        const first = await adjudicateIntradayBundleMembers(params);
        expect(first.statuses[0].status).toBe('proceed');
        const firstAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;

        // Run second time with identical inputs (simulates retry)
        const second = await adjudicateIntradayBundleMembers(params);
        expect(second.statuses[0].status).toBe('proceed');
        expect(second.statuses[0].occurrenceId).toBe(first.statuses[0].occurrenceId);
        expect(second.bindings[0].sessionSource).toEqual(first.bindings[0].sessionSource);
        const secondAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        expect(Object.keys(secondAgg.reservations).length).toBe(Object.keys(firstAgg.reservations).length);
    });

    it('re-reads aggregate atomically with decision and uses current ledger revision when an intervening reservation advances aggregate', async () => {
        const active = createPlan();
        const bundlePlacement = createBundlePlacement();

        const amOccId = 'occ-am-1';
        const amOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: amOccId,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-bundle-v4' },
            state: 'completed',
            placementOrder: 0,
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        const amExec = createMockExecution(amOccId);
        const amResp = createMockSessionResponse(amOccId);

        vi.spyOn(sessionOccurrenceService, 'getOccurrencesForDate').mockResolvedValue([amOcc]);
        vi.spyOn(sessionExecutionService, 'getExecutionsInRange').mockResolvedValue({ executions: [amExec], invalidRecords: 0 });
        vi.spyOn(sessionResponseService, 'getResponseForWindow').mockResolvedValue(amResp);

        const params: AdjudicateIntradayBundleMembersParams = {
            userId: USER_ID,
            date: DATE,
            activePlan: active,
            bundlePlacement,
            subjective: mockSubjective,
            objective: mockObjective,
            userContext: mockUserContext,
            availability: mockAvailability,
            ceilings,
            evaluationInstant: '2026-09-07T12:00:00.000Z',
        };

        // Run once to create first occurrence, reservation, and decision
        const first = await adjudicateIntradayBundleMembers(params);
        expect(first.statuses[0].status).toBe('proceed');
        const firstAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        // seedIfAbsent (rev 1) + applyReservation (rev 2)
        expect(firstAgg.revision).toBe(2);

        // Simulate an intervening reservation advancing the aggregate in Firestore to revision 3
        const advancedAgg: DailyLedgerAggregate = {
            ...firstAgg,
            revision: 3,
            reservations: {
                ...firstAgg.reservations,
                'intervening-occ': {
                    minutes: 30,
                    systemicCost: 0.2,
                    state: 'reserved',
                    postReservationLedgerRevision: '3',
                },
            },
        };
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, advancedAgg);

        // Run adjudication again: atomic read detects fresh aggregate revision 3,
        // so postReservationLedgerRevision "2" does not match revision 3, and the decision
        // is evaluated against current ledger revision "3".
        const second = await adjudicateIntradayBundleMembers(params);
        expect(second.statuses[0].status).toBe('proceed');
        const secondAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        const targetOccId = second.statuses[0].occurrenceId!;
        const decisionId = secondAgg.reservations[targetOccId].decisionId!;
        const secondDecisionDoc = store.get(
            `users/${USER_ID}/intraday_decisions/${decisionId}`,
        ) as IntradayDecisionRecord;
        expect(secondDecisionDoc.reassessmentInputRevision.ledgerRevision).toBe('3');
    });
});
