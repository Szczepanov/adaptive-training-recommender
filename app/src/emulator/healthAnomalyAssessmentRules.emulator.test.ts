import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-health-anomaly';
const otherId = 'other-health-anomaly-athlete';
const date = '2026-08-21';
const revisionId = 'ha-1234567890abcdef';
const revisionPath = `users/${ownerId}/health_anomaly_assessments/${date}/revisions/${revisionId}`;

function revision() {
    return {
        userId: ownerId,
        date,
        revisionId,
        idempotencyKey: `${date}:1234567890abcdef`,
        computedAt: '2026-08-21T06:30:00.000Z',
        policyVersion: 'health-anomaly/ha3-v1',
        thresholdPolicy: {
            policyVersion: 'health-anomaly-thresholds/shadow-candidate-v1',
            moderateDeviation: 1.5,
            strongDeviation: 2.5,
            minimumCoreSignalsForMultiSignal: 2,
            persistenceDaysForEscalation: 2,
            minimumHistoryCount: 14,
            minimumRecentDayCoverage: 4 / 7,
            maxBaselineAgeDays: 3,
            estimatorBySignal: {
                rhr: 'mean-stdev-28d',
                respiration: 'median-mad-28d',
                hrv: 'log-mean-stdev-28d',
            },
        },
        mode: 'shadow-v1',
        source: {
            timezone: 'Europe/Warsaw',
            recoverySnapshotRevision: '2026-08-21:sync-1:5',
            checkinRevision: '2026-08-21:checkin-1',
            historyWindowStart: '2026-07-24',
            historyWindowEndExclusive: date,
            historySnapshotRevisions: [
                { date: '2026-08-20', revision: '2026-08-20:sync-1:5' },
            ],
            travelContextRevision: null,
            persistenceLookbackStart: '2026-08-20',
        },
        assessment: {
            state: 'watch_unexplained',
            evidenceLevel: 'moderate',
            coreSignals: [
                { signal: 'rhr', status: 'moderate_anomaly', direction: 'high', currentValue: 55, baselineValue: 50, scaleValue: 2, standardizedDeviation: 2.5, estimator: 'mean-stdev-28d', baselineVersion: 5 },
                { signal: 'respiration', status: 'normal', direction: null, currentValue: 14, baselineValue: 14, scaleValue: 0.5, standardizedDeviation: 0, estimator: 'median-mad-28d', baselineVersion: 5 },
                { signal: 'hrv', status: 'normal', direction: null, currentValue: 4, baselineValue: 4, scaleValue: 0.1, standardizedDeviation: 0, estimator: 'log-mean-stdev-28d', baselineVersion: 5 },
            ],
            supportingSignals: [],
            explanations: [],
            unexplainedEvidence: ['rhr:moderate_anomaly:high'],
            persistenceDays: 1,
            episodeId: `health-anomaly:${date}`,
            episodeDay: 1,
            dataQuality: [],
            rationale: { facts: [], explanations: [], cautions: ['NOT_A_DIAGNOSIS'] },
            respirationElevation: {
                status: 'elevated',
                currentValue: 14,
                baseline7dValue: 13.5,
                baseline28dValue: 13,
                deltaVs7d: 0.5,
                deltaVs28d: 1,
                baselineVersion: 5,
                historyCount: 28,
                recentDayCoverage: 1,
                reasonCodes: ['ABOVE_ELEVATED_PERSONAL_DELTAS'],
                policyVersion: 'respiration-elevation/shadow-e2-s1-v1',
            },
            policyVersion: 'health-anomaly/ha3-v1',
            thresholdPolicyVersion: 'health-anomaly-thresholds/shadow-candidate-v1',
            mode: 'shadow-v1',
        },
        schemaVersion: 1,
    };
}

emulatorDescribe('Health anomaly assessment revision rules (HA4)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-health-anomaly-assessments',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows the owner to create and read an immutable assessment revision', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, revisionPath), revision()));
        await assertSucceeds(getDoc(doc(db, revisionPath)));
    });

    it('rejects cross-user reads and writes', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, revisionPath), revision()));

        const otherDb = testEnvironment.authenticatedContext(otherId).firestore();
        await assertFails(getDoc(doc(otherDb, revisionPath)));
        await assertFails(setDoc(doc(otherDb, revisionPath), revision()));
    });

    it('rejects updates and deletes after revision creation', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, revisionPath), revision()));
        await assertFails(updateDoc(doc(db, revisionPath), { computedAt: '2026-08-21T07:00:00.000Z' }));
        await assertFails(deleteDoc(doc(db, revisionPath)));
    });

    it('rejects malformed mode, state, threshold policy, path identity and oversized source history', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const base = revision();

        await assertFails(setDoc(doc(db, revisionPath), { ...base, mode: 'off' }));
        await assertFails(setDoc(doc(db, revisionPath), {
            ...base,
            assessment: { ...base.assessment, state: 'diagnosed_flu' },
        }));
        await assertFails(setDoc(doc(db, revisionPath), {
            ...base,
            assessment: {
                ...base.assessment,
                respirationElevation: { ...base.assessment.respirationElevation, unexpected: true },
            },
        }));
        await assertFails(setDoc(doc(db, revisionPath), {
            ...base,
            thresholdPolicy: { ...base.thresholdPolicy, strongDeviation: 1 },
        }));
        await assertFails(setDoc(doc(db, revisionPath), { ...base, revisionId: 'ha-other' }));
        await assertFails(setDoc(doc(db, revisionPath), {
            ...base,
            source: {
                ...base.source,
                historySnapshotRevisions: Array.from({ length: 29 }, (_, index) => ({
                    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
                    revision: `r${index}`,
                })),
            },
        }));
    });
});
