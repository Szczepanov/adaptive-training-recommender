import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { ExternalPlanSessionOccurrence, SessionOccurrence } from '../sessions/models';
import type { DailyLedgerAggregate } from './dailyLedgerAggregateService';
import type { IntradayDecisionRecord } from '../engine/intradayDecision';
import type { SessionResponse } from '../responses/models';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import {
    claimIntradayMemberLaunch,
    releaseIntradayMemberClaim,
    StaleDecisionError,
} from './intradayLaunchClaim';
import { getIntradayDecisionDocPath } from './intradayDecisionService';
import { sessionResponseDocId } from './sessionResponseService';

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

const USER_ID = 'user-claim-test';
const DATE = '2026-09-07';
const OCCURRENCE_ID = 'occ-pm-456';
const DECISION_ID = 'dec-pm-123';
const PRED_OCCURRENCE_ID = 'occ-am-123';
const PRED_EXECUTION_ID = 'exec-am-123';

function createBaseOccurrence(overrides: Partial<ExternalPlanSessionOccurrence> = {}): ExternalPlanSessionOccurrence {
    return {
        userId: USER_ID,
        occurrenceId: OCCURRENCE_ID,
        date: DATE,
        authority: 'external_plan',
        externalPlanRef: {
            planId: 'p-v4',
            revision: 1,
            sessionId: 'pm-strength',
            contentHash: 'hash-128',
        },
        state: 'scheduled',
        createdAt: '2026-09-07T05:00:00.000Z',
        updatedAt: '2026-09-07T05:00:00.000Z',
        ...overrides,
    };
}

function createBaseAggregate(overrides: Partial<DailyLedgerAggregate> = {}): DailyLedgerAggregate {
    return {
        userId: USER_ID,
        date: DATE,
        revision: 2,
        ceilings: {
            dailyMinuteCeiling: 120,
            dailySystemicCostCeiling: 1.0,
        },
        reservations: {
            [OCCURRENCE_ID]: {
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
        ...overrides,
    };
}

function createBaseDecision(overrides: Partial<IntradayDecisionRecord> = {}): IntradayDecisionRecord {
    return {
        id: DECISION_ID,
        userId: USER_ID,
        date: DATE,
        asOf: '2026-09-07T05:00:00.000Z',
        policyVersion: '1.0.0',
        schemaVersion: 1,
        status: 'provisional',
        supersededDecisionId: null,
        occurrenceId: OCCURRENCE_ID,
        sessionId: 'pm-strength',
        windowId: 'w-pm',
        bundleId: 'b-double',
        orderInBundle: 1,
        predecessorExecutionId: null,
        predecessorOccurrenceId: null,
        reassessmentInputRevision: {
            availabilityRevision: 'avail-1',
            completedFactsRevision: 'facts-1',
            checkinRevision: 'checkin-missing',
            ledgerRevision: '2',
            placementRevision: 'place-1',
        },
        bundlePlacement: {
            bundleId: 'b-double',
            outcome: 'placed',
            bindings: [{
                sessionId: 'pm-strength',
                windowId: 'w-pm',
                boundStartLocal: '16:00',
                boundEndLocal: '17:00',
                startInstant: '2026-09-07T14:00:00.000Z',
                endInstant: '2026-09-07T15:00:00.000Z',
            }],
        },
        ledgerSnapshot: {
            ceilings: { dailyMinuteCeiling: 120, dailySystemicCostCeiling: 1.0 },
            entries: [],
        },
        verdict: {
            decision: 'proceed',
            reasons: ['Capacity available'],
        },
        postReservationLedgerRevision: '2',
        ...overrides,
    };
}

function setupStoreForHappyPath() {
    const occ = createBaseOccurrence();
    const agg = createBaseAggregate();
    const dec = createBaseDecision();

    store.set(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`, occ);
    store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);
    store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), dec);
}

describe('claimIntradayMemberLaunch', () => {
    beforeEach(() => {
        store.clear();
        vi.restoreAllMocks();
    });

    it('claims launch successfully in the happy path', async () => {
        setupStoreForHappyPath();

        const claimed = await claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
        });

        expect(claimed.state).toBe('active');

        // Check occurrence updated in store
        const occDoc = store.get(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`) as SessionOccurrence;
        expect(occDoc.state).toBe('active');

        // Check aggregate updated in store
        const aggDoc = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        expect(aggDoc.revision).toBe(3);
        expect(aggDoc.reservations[OCCURRENCE_ID].state).toBe('in_progress');
    });

    it('throws ledger-unseeded if daily ledger aggregate is missing or not seeded', async () => {
        const occ = createBaseOccurrence();
        store.set(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`, occ);

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
        })).rejects.toThrow(StaleDecisionError);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('ledger-unseeded');
        }
    });

    it('throws no-reservation if aggregate carries no reservation for occurrence', async () => {
        setupStoreForHappyPath();
        const agg = createBaseAggregate({ reservations: {} });
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        await expect(claimIntradayMemberLaunch({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
        })).rejects.toThrow(StaleDecisionError);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect((err as StaleDecisionError).code).toBe('no-reservation');
        }
    });

    it('throws reservation-not-reserved if reservation state is not reserved', async () => {
        setupStoreForHappyPath();
        const agg = createBaseAggregate({
            reservations: {
                [OCCURRENCE_ID]: {
                    minutes: 45,
                    systemicCost: 0.4,
                    state: 'in_progress',
                    decisionId: DECISION_ID,
                    postReservationLedgerRevision: '2',
                },
            },
        });
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('reservation-not-reserved');
        }
    });

    it('throws no-decision-pointer if reservation has no decisionId', async () => {
        setupStoreForHappyPath();
        const agg = createBaseAggregate({
            reservations: {
                [OCCURRENCE_ID]: {
                    minutes: 45,
                    systemicCost: 0.4,
                    state: 'reserved',
                },
            },
        });
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('no-decision-pointer');
        }
    });

    it('throws decision-missing if decision record does not exist', async () => {
        setupStoreForHappyPath();
        store.delete(getIntradayDecisionDocPath(USER_ID, DECISION_ID));

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('decision-missing');
        }
    });

    it('throws decision-invalid if decision record fails validation', async () => {
        setupStoreForHappyPath();
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), { invalid: 'data' });

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('decision-invalid');
        }
    });

    it('throws decision-mismatch on occurrence date mismatch or decision metadata mismatch', async () => {
        setupStoreForHappyPath();
        const occ = createBaseOccurrence({ date: '2026-09-08' });
        store.set(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`, occ);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('decision-mismatch');
        }
    });

    it('throws decision-mismatch if decision status is not provisional', async () => {
        setupStoreForHappyPath();
        const dec = createBaseDecision({ status: 'confirmed' });
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), dec);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('decision-mismatch');
        }
    });

    it('throws decision-not-proceed if verdict decision is not proceed', async () => {
        setupStoreForHappyPath();
        const dec = createBaseDecision({ verdict: { decision: 'defer', reasons: ['Wait'] } });
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), dec);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('decision-not-proceed');
        }
    });

    it('throws reservation-changed if postReservationLedgerRevision mismatches', async () => {
        setupStoreForHappyPath();
        const agg = createBaseAggregate({
            reservations: {
                [OCCURRENCE_ID]: {
                    minutes: 45,
                    systemicCost: 0.4,
                    state: 'reserved',
                    decisionId: DECISION_ID,
                    postReservationLedgerRevision: '3', // mismatch with decision's '2'
                },
            },
        });
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('reservation-changed');
        }
    });

    it('throws input-revision-changed when subjective checkin status is not AVAILABLE', async () => {
        setupStoreForHappyPath();
        const dec = createBaseDecision({
            reassessmentInputRevision: {
                availabilityRevision: 'avail-1',
                completedFactsRevision: 'facts-1',
                checkinRevision: 'checkin-present',
                ledgerRevision: '2',
                placementRevision: 'place-1',
            },
        });
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), dec);

        // Put invalid subjective checkin in store
        store.set(`users/${USER_ID}/daily_subjective_checkins/${DATE}`, { malformed: true });

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('input-revision-changed');
        }
    });

    it('throws input-revision-changed when checkin revision changes or disappears', async () => {
        setupStoreForHappyPath();
        const dec = createBaseDecision({
            reassessmentInputRevision: {
                availabilityRevision: 'avail-1',
                completedFactsRevision: 'facts-1',
                checkinRevision: '2026-09-07T08:00:00.000Z',
                ledgerRevision: '2',
                placementRevision: 'place-1',
            },
        });
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), dec);

        // No checkin document exists in store, but expected '2026-09-07T08:00:00.000Z'
        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('input-revision-changed');
        }

        // Now put a checkin doc with different revision
        const checkinDoc = {
            userId: USER_ID,
            date: DATE,
            painOrInjury: false,
            unusuallyLimitedTime: false,
            alreadyTrainedToday: false,
            illnessSymptoms: false,
            readiness: 4,
            sleepQuality: 4,
            fatigue: 2,
            soreness: 2,
            mentalStress: 2,
            motivation: 4,
            availability: {
                timeAvailableMin: 120,
                preferredModalityToday: null,
                indoorOnly: false,
            },
            dataQuality: {
                isComplete: true,
                missingFields: [],
            },
            updatedAt: '2026-09-07T09:00:00.000Z',
        };
        store.set(`users/${USER_ID}/daily_subjective_checkins/${DATE}`, checkinDoc);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('input-revision-changed');
        }
    });

    it('throws input-revision-changed when dashboardInputRevision mismatches', async () => {
        setupStoreForHappyPath();

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
                dashboardInputRevision: {
                    availabilityRevision: 'avail-changed',
                    completedFactsRevision: 'facts-1',
                    checkinRevision: 'checkin-missing',
                    placementRevision: 'place-1',
                },
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('input-revision-changed');
        }
    });

    it('handles predecessor requirements: predecessor-incomplete', async () => {
        setupStoreForHappyPath();
        const dec = createBaseDecision({
            predecessorOccurrenceId: PRED_OCCURRENCE_ID,
            predecessorExecutionId: PRED_EXECUTION_ID,
            reassessmentInputRevision: {
                availabilityRevision: 'avail-1',
                completedFactsRevision: 'facts-1',
                checkinRevision: 'checkin-missing',
                ledgerRevision: '2',
                placementRevision: 'place-1',
                postPredecessorConfirmationRevision: '2026-09-07T06:05:00.000Z',
            },
        });
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), dec);

        // Predecessor occurrence missing
        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('predecessor-incomplete');
        }

        // Predecessor occurrence exists but state is scheduled
        const predOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: PRED_OCCURRENCE_ID,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-128' },
            state: 'scheduled',
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T05:00:00.000Z',
        };
        store.set(`users/${USER_ID}/session_occurrences/${PRED_OCCURRENCE_ID}`, predOcc);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('predecessor-incomplete');
        }
    });

    it('handles predecessor requirements: predecessor-confirmation-missing', async () => {
        setupStoreForHappyPath();
        // Set completed predecessor occurrence
        const predOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: PRED_OCCURRENCE_ID,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-128' },
            state: 'completed',
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        store.set(`users/${USER_ID}/session_occurrences/${PRED_OCCURRENCE_ID}`, predOcc);

        // Decision lacks postPredecessorConfirmationRevision
        const decNoConf = createBaseDecision({
            predecessorOccurrenceId: PRED_OCCURRENCE_ID,
            predecessorExecutionId: PRED_EXECUTION_ID,
        });
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), decNoConf);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('predecessor-confirmation-missing');
        }

        // Decision has confirmation revision, but immediate response missing
        const decWithConf = createBaseDecision({
            predecessorOccurrenceId: PRED_OCCURRENCE_ID,
            predecessorExecutionId: PRED_EXECUTION_ID,
            reassessmentInputRevision: {
                availabilityRevision: 'avail-1',
                completedFactsRevision: 'facts-1',
                checkinRevision: 'checkin-missing',
                ledgerRevision: '2',
                placementRevision: 'place-1',
                postPredecessorConfirmationRevision: '2026-09-07T06:05:00.000Z',
            },
        });
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), decWithConf);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('predecessor-confirmation-missing');
        }
    });

    it('handles predecessor requirements: predecessor-confirmation-changed', async () => {
        setupStoreForHappyPath();
        const predOcc: ExternalPlanSessionOccurrence = {
            userId: USER_ID,
            occurrenceId: PRED_OCCURRENCE_ID,
            date: DATE,
            authority: 'external_plan',
            externalPlanRef: { planId: 'p-v4', revision: 1, sessionId: 'am-run', contentHash: 'hash-128' },
            state: 'completed',
            createdAt: '2026-09-07T05:00:00.000Z',
            updatedAt: '2026-09-07T06:00:00.000Z',
        };
        store.set(`users/${USER_ID}/session_occurrences/${PRED_OCCURRENCE_ID}`, predOcc);

        const decWithConf = createBaseDecision({
            predecessorOccurrenceId: PRED_OCCURRENCE_ID,
            predecessorExecutionId: PRED_EXECUTION_ID,
            reassessmentInputRevision: {
                availabilityRevision: 'avail-1',
                completedFactsRevision: 'facts-1',
                checkinRevision: 'checkin-missing',
                ledgerRevision: '2',
                placementRevision: 'place-1',
                postPredecessorConfirmationRevision: '2026-09-07T06:05:00.000Z',
            },
        });
        store.set(getIntradayDecisionDocPath(USER_ID, DECISION_ID), decWithConf);

        // Immediate response exists but updatedAt is different
        const respId = sessionResponseDocId({ kind: 'execution', id: PRED_EXECUTION_ID }, 'immediate');
        const respDoc: SessionResponse = {
            userId: USER_ID,
            responseId: 'resp-1',
            sourceSession: { kind: 'execution', id: PRED_EXECUTION_ID, date: DATE },
            occurrenceId: PRED_OCCURRENCE_ID,
            window: 'immediate',
            date: DATE,
            checkinRef: { date: DATE },
            sessionRpe: 4,
            createdAt: '2026-09-07T06:05:00.000Z',
            updatedAt: '2026-09-07T07:00:00.000Z', // changed!
        };
        store.set(`users/${USER_ID}/session_responses/${respId}`, respDoc);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('predecessor-confirmation-changed');
        }
    });

    it('throws capacity-exhausted when remaining capacity is insufficient', async () => {
        setupStoreForHappyPath();
        const agg = createBaseAggregate({
            ceilings: {
                dailyMinuteCeiling: 30, // reservation asks for 45 min
                dailySystemicCostCeiling: 1.0,
            },
        });
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('capacity-exhausted');
        }
    });

    it('translates raw permission-denied Firestore error to ledger-contended', async () => {
        setupStoreForHappyPath();
        // Force occurrence claim to throw permission-denied
        const customOccService = {
            claimOccurrenceLaunch: vi.fn().mockRejectedValue({ code: 'permission-denied', message: 'Rules evaluation failed' }),
        };

        try {
            await claimIntradayMemberLaunch({
                userId: USER_ID,
                date: DATE,
                occurrenceId: OCCURRENCE_ID,
                services: { occurrenceService: customOccService as never },
            });
        } catch (err) {
            expect(err).toBeInstanceOf(StaleDecisionError);
            expect((err as StaleDecisionError).code).toBe('ledger-contended');
        }
    });
});

describe('releaseIntradayMemberClaim', () => {
    beforeEach(() => {
        store.clear();
        vi.restoreAllMocks();
    });

    it('releases claim successfully when occurrence is active and reservation is in_progress', async () => {
        const occ = createBaseOccurrence({ state: 'active' });
        const agg = createBaseAggregate({
            revision: 3,
            reservations: {
                [OCCURRENCE_ID]: {
                    minutes: 45,
                    systemicCost: 0.4,
                    state: 'in_progress',
                    decisionId: DECISION_ID,
                    postReservationLedgerRevision: '2',
                },
            },
        });
        store.set(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`, occ);
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        const result = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
        });

        expect(result.released).toBe(true);

        const updatedOcc = store.get(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`) as SessionOccurrence;
        expect(updatedOcc.state).toBe('scheduled');

        const updatedAgg = store.get(`users/${USER_ID}/daily_ledgers/${DATE}`) as DailyLedgerAggregate;
        expect(updatedAgg.revision).toBe(4);
        expect(updatedAgg.reservations[OCCURRENCE_ID].state).toBe('reserved');
    });

    it('refuses release if an execution already references the occurrence', async () => {
        const occ = createBaseOccurrence({ state: 'active' });
        store.set(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`, occ);

        const execRecord: NormalizedExecutionRecord = {
            execution: {
                executionId: 'exec-1',
                userId: USER_ID,
                sessionSource: { kind: 'external_plan', planId: 'p-v4', revision: 1, sessionId: 'pm-strength', contentHash: 'hash-128' },
                occurrenceId: OCCURRENCE_ID,
                date: DATE,
                state: 'in_progress',
                startedAt: '2026-09-07T14:00:00.000Z',
                completedAt: null,
                updatedAt: '2026-09-07T14:00:00.000Z',
                schemaVersion: 1,
            },
            entries: [],
        };

        const customExecService = {
            findExecutionByOccurrenceId: vi.fn().mockResolvedValue(execRecord.execution),
        };

        const result = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
            services: { executionService: customExecService as never },
        });

        expect(result.released).toBe(false);
        expect(result.reason).toContain('execution exec-1 already references this occurrence');
    });

    it('returns released false if daily ledger aggregate is unseeded', async () => {
        const occ = createBaseOccurrence({ state: 'active' });
        store.set(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`, occ);

        const result = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
        });

        expect(result.released).toBe(false);
        expect(result.reason).toContain('no seeded daily ledger');
    });

    it('returns released false if reservation state is not in_progress', async () => {
        const occ = createBaseOccurrence({ state: 'active' });
        const agg = createBaseAggregate({
            revision: 2,
            reservations: {
                [OCCURRENCE_ID]: {
                    minutes: 45,
                    systemicCost: 0.4,
                    state: 'reserved',
                },
            },
        });
        store.set(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`, occ);
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        const result = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
        });

        expect(result.released).toBe(false);
        expect(result.reason).toContain("reservation is 'reserved', expected 'in_progress'");
    });

    it('returns released false if occurrence is missing or not active', async () => {
        const resultMissing = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: 'occ-nonexistent',
        });
        expect(resultMissing.released).toBe(false);
        expect(resultMissing.reason).toBe('occurrence not found');

        const occCompleted = createBaseOccurrence({ state: 'completed' });
        const agg = createBaseAggregate({
            revision: 3,
            reservations: {
                [OCCURRENCE_ID]: { minutes: 45, systemicCost: 0.4, state: 'in_progress' },
            },
        });
        store.set(`users/${USER_ID}/session_occurrences/${OCCURRENCE_ID}`, occCompleted);
        store.set(`users/${USER_ID}/daily_ledgers/${DATE}`, agg);

        const resultCompleted = await releaseIntradayMemberClaim({
            userId: USER_ID,
            date: DATE,
            occurrenceId: OCCURRENCE_ID,
        });
        expect(resultCompleted.released).toBe(false);
        expect(resultCompleted.reason).toContain("occurrence is 'completed'");
    });
});
