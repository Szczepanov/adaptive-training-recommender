import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
    claimIntradayMemberLaunch,
    releaseIntradayMemberClaim,
    StaleDecisionError,
} from './intradayLaunchClaim';
import type { ExternalPlanSessionOccurrence } from '../sessions/models';
import type { DailyLedgerAggregate } from './dailyLedgerAggregateService';
import type { IntradayDecisionRecord } from '../engine/intradayDecision';
import type { SessionResponse } from '../responses/models';
import { sessionResponseDocId } from './sessionResponseService';
import { getIntradayDecisionDocPath } from './intradayDecisionService';
import { SessionExecutionService } from './sessionExecutionService';

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
const USER_ID = 'user-claim-test';
const OCC_ID = 'occ-target-123';
const DECISION_ID = 'dec-123';
const PRED_OCC_ID = 'occ-pred-456';
const PRED_EXEC_ID = 'exec-pred-789';

function setupValidClaimState(overrides: {
    occurrence?: Partial<ExternalPlanSessionOccurrence>;
    aggregate?: Partial<DailyLedgerAggregate>;
    decision?: Partial<IntradayDecisionRecord>;
    checkinDoc?: unknown;
    predecessorOcc?: Partial<ExternalPlanSessionOccurrence>;
    predecessorResponse?: Partial<SessionResponse>;
} = {}) {
    const occ: ExternalPlanSessionOccurrence = {
        userId: USER_ID,
        occurrenceId: OCC_ID,
        date: DATE,
        authority: 'external_plan',
        externalPlanRef: { planId: 'p-1', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-1' },
        state: 'scheduled',
        createdAt: '2026-09-07T05:00:00.000Z',
        updatedAt: '2026-09-07T05:00:00.000Z',
        ...overrides.occurrence,
    };
    store.set(`users/${USER_ID}/session_occurrences/${OCC_ID}`, occ);

    const agg: DailyLedgerAggregate = {
        userId: USER_ID,
        date: DATE,
        revision: 2,
        ceilings: { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 1.0 },
        reservations: {
            [OCC_ID]: {
                minutes: 45,
                systemicCost: 0.4,
                state: 'reserved',
                decisionId: DECISION_ID,
                postReservationLedgerRevision: '2',
            },
        },
        seededAt: '2026-09-07T05:00:00.000Z',
        createdAt: '2026-09-07T05:00:00.000Z',
        updatedAt: '2026-09-07T05:00:00.000Z',
        ...overrides.aggregate,
    };
    store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

    const dec: IntradayDecisionRecord = {
        schemaVersion: 1,
        id: DECISION_ID,
        userId: USER_ID,
        occurrenceId: OCC_ID,
        date: DATE,
        asOf: '2026-09-07T05:05:00.000Z',
        policyVersion: '1.0',
        status: 'provisional',
        supersededDecisionId: null,
        sessionId: 'pm-strength',
        windowId: 'w-pm',
        bundleId: 'b-double',
        orderInBundle: 1,
        predecessorExecutionId: null,
        predecessorOccurrenceId: null,
        bundlePlacement: {
            bundleId: 'b-double',
            outcome: 'placed',
            bindings: [
                {
                    sessionId: 'pm-strength',
                    windowId: 'w-pm',
                    boundStartLocal: '16:00',
                    boundEndLocal: '17:00',
                    startInstant: '2026-09-07T14:00:00.000Z',
                    endInstant: '2026-09-07T15:00:00.000Z',
                },
            ],
        },
        verdict: { decision: 'proceed', reasons: ['Capacity and separation verified'] },
        reassessmentInputRevision: {
            availabilityRevision: 'avail-rev-1',
            completedFactsRevision: 'facts-rev-1',
            checkinRevision: 'checkin-missing',
            placementRevision: 'place-rev-1',
            ledgerRevision: '2',
        },
        postReservationLedgerRevision: '2',
        ledgerSnapshot: {
            ceilings: { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 1.0 },
            entries: [],
        },
        ...overrides.decision,
    };
    store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), dec);

    if (overrides.checkinDoc !== undefined) {
        store.set(`users/${USER_ID}/daily_subjective_checkins/${DATE}`, overrides.checkinDoc);
    }

    if (overrides.predecessorOcc) {
        const predOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: PRED_OCC_ID,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-1', revision: 1, sessionId: 'am-run', contentHash: 'hash-1' },
            state: 'completed',
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
            ...overrides.predecessorOcc,
        };
        store.set(`users/${USER_ID}/session_occurrences/${PRED_OCC_ID}`, predOcc);
    }

    if (overrides.predecessorResponse) {
        const respId = sessionResponseDocId({ kind: 'execution', id: PRED_EXEC_ID }, 'immediate');
        const resp: SessionResponse = {
            userId: USER_ID,
            responseId: 'resp-1',
            sourceSession: { kind: 'execution', id: PRED_EXEC_ID, date: DATE },
            occurrenceId: PRED_OCC_ID,
            window: 'immediate',
            date: DATE,
            checkinRef: { date: DATE },
            sessionRpe: 4,
            createdAt: '2026-09-07T06:05:00.000Z',
            updatedAt: '2026-09-07T06:05:00.000Z',
            ...overrides.predecessorResponse,
        };
        store.set(`users/${USER_ID}/session_responses/${respId}`, resp);
    }
}

describe('claimIntradayMemberLaunch', () => {
    beforeEach(() => {
        store.clear();
        vi.restoreAllMocks();
    });

    it('successfully claims a scheduled occurrence and updates ledger reservation state to in_progress', async () => {
        setupValidClaimState();

        const claimed = await claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        });

        expect(claimed.state).toBe('active');

        // Check store occurrence document state
        const storedOcc = store.get(`users/${USER_ID}/session_occurrences/${OCC_ID}`) as ExternalPlanSessionOccurrence;
        expect(storedOcc.state).toBe('active');

        // Check store aggregate document reservation state
        const storedAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        expect(storedAgg.reservations[OCC_ID].state).toBe('in_progress');
        expect(storedAgg.revision).toBe(3);
    });

    it('successfully claims launch when predecessor occurrence & response match decision', async () => {
        const confirmationTs = '2026-09-07T06:05:00.000Z';
        setupValidClaimState({
            decision: {
                predecessorOccurrenceId: PRED_OCC_ID,
                predecessorExecutionId: PRED_EXEC_ID,
                reassessmentInputRevision: {
                    availabilityRevision: 'avail-rev-1',
                    completedFactsRevision: 'facts-rev-1',
                    checkinRevision: 'checkin-missing',
                    placementRevision: 'place-rev-1',
                    ledgerRevision: '2',
                    postPredecessorConfirmationRevision: confirmationTs,
                },
            },
            predecessorOcc: { state: 'completed' },
            predecessorResponse: { updatedAt: confirmationTs },
        });

        const claimed = await claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        });

        expect(claimed.state).toBe('active');
    });

    it('successfully claims when checkin document exists and matches checkinRevision', async () => {
        const checkinTs = '2026-09-07T07:00:00.000Z';
        setupValidClaimState({
            decision: {
                reassessmentInputRevision: {
                    availabilityRevision: 'avail-rev-1',
                    completedFactsRevision: 'facts-rev-1',
                    checkinRevision: checkinTs,
                    placementRevision: 'place-rev-1',
                    ledgerRevision: '2',
                },
            },
            checkinDoc: {
                userId: USER_ID,
                date: DATE,
                readiness: 4,
                sleepQuality: 4,
                fatigue: 2,
                soreness: 2,
                mentalStress: 2,
                motivation: 4,
                painOrInjury: false,
                illnessSymptoms: false,
                unusuallyLimitedTime: false,
                alreadyTrainedToday: false,
                availability: { timeAvailableMin: 120, preferredModalityToday: null, indoorOnly: false },
                dataQuality: { isComplete: true, missingFields: [] },
                revision: checkinTs,
                createdAt: checkinTs,
                updatedAt: checkinTs,
            },
        });

        const claimed = await claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
            dashboardInputRevision: {
                availabilityRevision: 'avail-rev-1',
                completedFactsRevision: 'facts-rev-1',
                checkinRevision: checkinTs,
                placementRevision: 'place-rev-1',
            },
        });

        expect(claimed.state).toBe('active');
    });

    it('refuses claim if date in params does not match occurrence date', async () => {
        setupValidClaimState();

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: '2026-09-08',
            occurrenceId: OCC_ID,
        })).rejects.toThrowError(StaleDecisionError);

        try {
            await claimIntradayMemberLaunch({ userId: USER_ID, date: '2026-09-08', occurrenceId: OCC_ID });
        } catch (err) {
            expect((err as StaleDecisionError).code).toBe('decision-mismatch');
        }
    });

    it('refuses claim if daily ledger aggregate is unseeded', async () => {
        setupValidClaimState({ aggregate: { seededAt: undefined } as unknown as Partial<DailyLedgerAggregate> });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'ledger-unseeded' });
    });

    it('refuses claim if reservation is missing in aggregate', async () => {
        setupValidClaimState({ aggregate: { reservations: {} } });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'no-reservation' });
    });

    it('refuses claim if reservation state is not reserved (e.g. in_progress)', async () => {
        setupValidClaimState({
            aggregate: {
                reservations: {
                    [OCC_ID]: {
                        minutes: 45,
                        systemicCost: 0.4,
                        state: 'in_progress',
                        decisionId: DECISION_ID,
                        postReservationLedgerRevision: '2',
                    },
                },
            },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'reservation-not-reserved' });
    });

    it('refuses claim if reservation carries no decisionPointer', async () => {
        setupValidClaimState({
            aggregate: {
                reservations: {
                    [OCC_ID]: {
                        minutes: 45,
                        systemicCost: 0.4,
                        state: 'reserved',
                        postReservationLedgerRevision: '2',
                    },
                },
            },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'no-decision-pointer' });
    });

    it('refuses claim if decision record does not exist', async () => {
        setupValidClaimState();
        store.delete(getIntradayDecisionDocPath(USER_ID, DECISION_ID));

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'decision-missing' });
    });

    it('refuses claim if decision record fails validation', async () => {
        setupValidClaimState();
        // Set invalid status
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), { invalidDoc: true });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'decision-invalid' });
    });

    it('refuses claim if decision record does not describe the target occurrence or user', async () => {
        setupValidClaimState({
            decision: { occurrenceId: 'occ-other' },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'decision-mismatch' });
    });

    it('refuses claim if decision record status is not provisional', async () => {
        setupValidClaimState({
            decision: { status: 'confirmed' },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'decision-mismatch' });
    });

    it('refuses claim if decision verdict decision is not proceed', async () => {
        setupValidClaimState({
            decision: { verdict: { decision: 'skip', reasons: ['no room'] } },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'decision-not-proceed' });
    });

    it('refuses claim if postReservationLedgerRevision mismatches between reservation and decision', async () => {
        setupValidClaimState({
            decision: { postReservationLedgerRevision: '3' },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'reservation-changed' });
    });

    it('refuses claim if checkin revision changed since decision', async () => {
        const checkinTs1 = '2026-09-07T07:00:00.000Z';
        const checkinTs2 = '2026-09-07T08:00:00.000Z';
        setupValidClaimState({
            decision: {
                reassessmentInputRevision: {
                    availabilityRevision: 'avail-rev-1',
                    completedFactsRevision: 'facts-rev-1',
                    checkinRevision: checkinTs1,
                    placementRevision: 'place-rev-1',
                    ledgerRevision: '2',
                },
            },
            checkinDoc: {
                userId: USER_ID,
                date: DATE,
                readiness: 4,
                sleepQuality: 4,
                fatigue: 2,
                soreness: 2,
                mentalStress: 2,
                motivation: 4,
                painOrInjury: false,
                illnessSymptoms: false,
                unusuallyLimitedTime: false,
                alreadyTrainedToday: false,
                availability: { timeAvailableMin: 120, preferredModalityToday: null, indoorOnly: false },
                dataQuality: { isComplete: true, missingFields: [] },
                revision: checkinTs2,
                createdAt: checkinTs1,
                updatedAt: checkinTs2,
            },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'input-revision-changed' });
    });

    it('refuses claim if checkin document vanished when decision expected checkin to be present', async () => {
        setupValidClaimState({
            decision: {
                reassessmentInputRevision: {
                    availabilityRevision: 'avail-rev-1',
                    completedFactsRevision: 'facts-rev-1',
                    checkinRevision: '2026-09-07T07:00:00.000Z',
                    placementRevision: 'place-rev-1',
                    ledgerRevision: '2',
                },
            },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'input-revision-changed' });
    });

    it('refuses claim if dashboardInputRevision carries mismatched non-addressable input fields', async () => {
        setupValidClaimState();

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
            dashboardInputRevision: {
                availabilityRevision: 'avail-rev-CHANGED',
                completedFactsRevision: 'facts-rev-1',
                checkinRevision: 'checkin-missing',
                placementRevision: 'place-rev-1',
            },
        })).rejects.toMatchObject({ code: 'input-revision-changed' });
    });

    it('refuses claim if predecessor occurrence is missing or incomplete', async () => {
        setupValidClaimState({
            decision: {
                predecessorOccurrenceId: PRED_OCC_ID,
                predecessorExecutionId: PRED_EXEC_ID,
            },
            // predecessorOcc state is scheduled, not completed
            predecessorOcc: { state: 'scheduled' },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'predecessor-incomplete' });
    });

    it('refuses claim if predecessor confirmation revision is missing on decision', async () => {
        setupValidClaimState({
            decision: {
                predecessorOccurrenceId: PRED_OCC_ID,
                predecessorExecutionId: PRED_EXEC_ID,
                reassessmentInputRevision: {
                    availabilityRevision: 'avail-rev-1',
                    completedFactsRevision: 'facts-rev-1',
                    checkinRevision: 'checkin-missing',
                    placementRevision: 'place-rev-1',
                    ledgerRevision: '2',
                    // postPredecessorConfirmationRevision omitted
                },
            },
            predecessorOcc: { state: 'completed' },
            predecessorResponse: { updatedAt: '2026-09-07T06:05:00.000Z' },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'predecessor-confirmation-missing' });
    });

    it('refuses claim if predecessor response is missing', async () => {
        setupValidClaimState({
            decision: {
                predecessorOccurrenceId: PRED_OCC_ID,
                predecessorExecutionId: PRED_EXEC_ID,
                reassessmentInputRevision: {
                    availabilityRevision: 'avail-rev-1',
                    completedFactsRevision: 'facts-rev-1',
                    checkinRevision: 'checkin-missing',
                    placementRevision: 'place-rev-1',
                    ledgerRevision: '2',
                    postPredecessorConfirmationRevision: '2026-09-07T06:05:00.000Z',
                },
            },
            predecessorOcc: { state: 'completed' },
            // predecessorResponse not provided in store
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'predecessor-confirmation-missing' });
    });

    it('refuses claim if predecessor confirmation timestamp moved', async () => {
        setupValidClaimState({
            decision: {
                predecessorOccurrenceId: PRED_OCC_ID,
                predecessorExecutionId: PRED_EXEC_ID,
                reassessmentInputRevision: {
                    availabilityRevision: 'avail-rev-1',
                    completedFactsRevision: 'facts-rev-1',
                    checkinRevision: 'checkin-missing',
                    placementRevision: 'place-rev-1',
                    ledgerRevision: '2',
                    postPredecessorConfirmationRevision: '2026-09-07T06:05:00.000Z',
                },
            },
            predecessorOcc: { state: 'completed' },
            predecessorResponse: { updatedAt: '2026-09-07T06:10:00.000Z' },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'predecessor-confirmation-changed' });
    });

    it('refuses claim if capacity is exhausted by other committed rows', async () => {
        setupValidClaimState({
            aggregate: {
                ceilings: { dailyMinuteCeiling: 60, dailySystemicCostCeiling: 0.5 },
                reservations: {
                    [OCC_ID]: {
                        minutes: 45,
                        systemicCost: 0.4,
                        state: 'reserved',
                        decisionId: DECISION_ID,
                        postReservationLedgerRevision: '2',
                    },
                    'occ-other-committed': {
                        minutes: 30,
                        systemicCost: 0.3,
                        state: 'in_progress',
                    },
                },
            },
        });

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
        })).rejects.toMatchObject({ code: 'capacity-exhausted' });
    });

    it('translates raw permission-denied firestore error into ledger-contended StaleDecisionError', async () => {
        setupValidClaimState();

        const fakePermissionError = new Error('Rule evaluation failed');
        (fakePermissionError as { code?: string }).code = 'permission-denied';

        const mockService = {
            claimOccurrenceLaunch: vi.fn().mockRejectedValue(fakePermissionError),
        };

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
            services: {
                occurrenceService: mockService as never,
            },
        })).rejects.toMatchObject({ code: 'ledger-contended' });
    });
});

describe('releaseIntradayMemberClaim', () => {
    beforeEach(() => {
        store.clear();
        vi.restoreAllMocks();
    });

    function setupClaimedState() {
        const occ: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: OCC_ID,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-1', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-1' },
            state: 'active',
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T05:10:00.000Z',
        };
        store.set(`users/${USER_ID}/session_occurrences/${OCC_ID}`, occ);

        const agg: DailyLedgerAggregate = {
            userId: USER_ID,
            date: DATE,
            revision: 3,
            ceilings: { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 1.0 },
            reservations: {
                [OCC_ID]: {
                    minutes: 45,
                    systemicCost: 0.4,
                    state: 'in_progress',
                    decisionId: DECISION_ID,
                    postReservationLedgerRevision: '2',
                },
            },
            seededAt: '2026-09-07T05:00:00.000Z',
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T05:10:00.000Z',
        };
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);
    }

    it('successfully rolls back active occurrence to scheduled and ledger reservation to reserved', async () => {
        setupClaimedState();

        const mockExecService = {
            findExecutionByOccurrenceId: vi.fn().mockResolvedValue(null),
        } as unknown as SessionExecutionService;

        const res = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
            services: {
                executionService: mockExecService,
            },
        });

        expect(res.released).toBe(true);

        const storedOcc = store.get(`users/${USER_ID}/session_occurrences/${OCC_ID}`) as ExternalPlanSessionOccurrence;
        expect(storedOcc.state).toBe('scheduled');

        const storedAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        expect(storedAgg.reservations[OCC_ID].state).toBe('reserved');
    });

    it('refuses release if an execution already references the occurrence', async () => {
        setupClaimedState();

        const mockExecService = {
            findExecutionByOccurrenceId: vi.fn().mockResolvedValue({ executionId: 'exec-existing' }),
        } as unknown as SessionExecutionService;

        const res = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
            services: { executionService: mockExecService },
        });

        expect(res.released).toBe(false);
        expect(res.reason).toContain('execution exec-existing already references this occurrence');

        // Verify state remains active / in_progress
        const storedOcc = store.get(`users/${USER_ID}/session_occurrences/${OCC_ID}`) as ExternalPlanSessionOccurrence;
        expect(storedOcc.state).toBe('active');
    });

    it('returns released false if daily ledger aggregate is unseeded or missing', async () => {
        setupClaimedState();
        store.delete(`users/${USER_ID}/daily_ledgers/${DATE}`);

        const mockExecService = {
            findExecutionByOccurrenceId: vi.fn().mockResolvedValue(null),
        } as unknown as SessionExecutionService;

        const res = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
            services: { executionService: mockExecService },
        });

        expect(res.released).toBe(false);
        expect(res.reason).toContain('no seeded daily ledger');
    });

    it('returns released false if reservation state is not in_progress (e.g. completed)', async () => {
        setupClaimedState();
        const agg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        agg.reservations[OCC_ID].state = 'completed';
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        const mockExecService = {
            findExecutionByOccurrenceId: vi.fn().mockResolvedValue(null),
        } as unknown as SessionExecutionService;

        const res = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
            services: { executionService: mockExecService },
        });

        expect(res.released).toBe(false);
        expect(res.reason).toContain("reservation is 'completed', expected 'in_progress'");
    });

    it('returns released false if occurrence is not found', async () => {
        setupClaimedState();
        store.delete(`users/${USER_ID}/session_occurrences/${OCC_ID}`);

        const mockExecService = {
            findExecutionByOccurrenceId: vi.fn().mockResolvedValue(null),
        } as unknown as SessionExecutionService;

        const res = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCC_ID,
            services: { executionService: mockExecService },
        });

        expect(res.released).toBe(false);
        expect(res.reason).toBe('occurrence not found');
    });
});
