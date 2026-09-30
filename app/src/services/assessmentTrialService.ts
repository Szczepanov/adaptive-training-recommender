import {
    collection,
    doc,
    getDoc,
    getDocs,
    runTransaction,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import {
    assertAssessmentTrialWriteAllowed,
    assertValidAssessmentTrial,
    assertValidAssessmentTrialSet,
} from '../observations/assessmentTrials';
import type { AssessmentAttempt, AssessmentTrial, MeasurementProtocol } from '../observations/models';
import { sameCanonicalAssessmentTrial } from '../observations/observationCanonical';
import { assertValidAssessmentAttempt } from '../observations/validation';

function compareTrials(a: AssessmentTrial, b: AssessmentTrial): number {
    return a.ordinal - b.ordinal || a.correctionIndex - b.correctionIndex;
}

/**
 * ADR-0046 raw assessment trials under `users/{uid}/assessment_attempts/{attemptId}/trials`.
 * Records are immutable: corrections are new supersession records, never rewrites. Reads are
 * always scoped to one attempt; there is deliberately no cross-attempt scan.
 */
export class AssessmentTrialService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private attemptRef(userId: string, attemptId: string) {
        return doc(this.db, 'users', userId, 'assessment_attempts', attemptId);
    }

    private trialRef(userId: string, attemptId: string, trialId: string) {
        return doc(this.db, 'users', userId, 'assessment_attempts', attemptId, 'trials', trialId);
    }

    private assertAttemptBinding(attempt: AssessmentAttempt, attemptId: string, protocol: MeasurementProtocol): void {
        assertValidAssessmentAttempt(attempt);
        if (attempt.id !== attemptId) throw new Error(`Assessment attempt path mismatch for ${attemptId}`);
        if (attempt.protocolRef.id !== protocol.id || attempt.protocolRef.revision !== protocol.revision) {
            throw new Error(`Attempt ${attemptId} is bound to ${attempt.protocolRef.id}@${attempt.protocolRef.revision}, not ${protocol.id}@${protocol.revision}`);
        }
    }

    /**
     * Atomically append trials for one attempt. An exact semantic retry of an existing record
     * is idempotent; a different payload at an existing id fails closed. A correction whose
     * superseded record is neither stored nor in the same write is rejected.
     */
    async createTrials(
        userId: string,
        protocol: MeasurementProtocol,
        attemptId: string,
        trials: readonly AssessmentTrial[],
    ): Promise<AssessmentTrial[]> {
        if (trials.length === 0) return [];
        const ids = new Set<string>();
        for (const trial of trials) {
            assertValidAssessmentTrial(trial, protocol);
            if (trial.assessmentAttemptId !== attemptId) {
                throw new Error(`Trial ${trial.id} belongs to attempt ${trial.assessmentAttemptId}, not ${attemptId}`);
            }
            if (ids.has(trial.id)) throw new Error(`Duplicate trial id in write: ${trial.id}`);
            ids.add(trial.id);
        }
        const supersededOutsideWrite = [...new Set(trials
            .flatMap(trial => trial.supersedesTrialId ?? [])
            .filter(trialId => !ids.has(trialId)))];

        return runTransaction(this.db, async transaction => {
            const attemptSnapshot = await transaction.get(this.attemptRef(userId, attemptId));
            if (!attemptSnapshot.exists()) throw new Error(`Assessment attempt ${attemptId} does not exist`);
            const attempt = attemptSnapshot.data() as AssessmentAttempt;
            this.assertAttemptBinding(attempt, attemptId, protocol);

            const [existing, superseded] = await Promise.all([
                Promise.all(trials.map(trial => transaction.get(this.trialRef(userId, attemptId, trial.id)))),
                Promise.all(supersededOutsideWrite.map(trialId => transaction.get(this.trialRef(userId, attemptId, trialId)))),
            ]);
            superseded.forEach((snapshot, index) => {
                if (!snapshot.exists()) throw new Error(`Superseded trial ${supersededOutsideWrite[index]} does not exist`);
            });

            const stored: AssessmentTrial[] = [];
            trials.forEach((trial, index) => {
                const snapshot = existing[index];
                if (snapshot.exists()) {
                    const current = snapshot.data() as AssessmentTrial;
                    if (!sameCanonicalAssessmentTrial(current, trial)) {
                        throw new Error(`Trial ${trial.id} already exists with different content; append a correction instead`);
                    }
                    stored.push(current);
                    return;
                }
                assertAssessmentTrialWriteAllowed(attempt, trial);
                transaction.set(this.trialRef(userId, attemptId, trial.id), trial);
                stored.push(trial);
            });
            return stored;
        });
    }

    async createTrial(userId: string, protocol: MeasurementProtocol, trial: AssessmentTrial): Promise<AssessmentTrial> {
        const [stored] = await this.createTrials(userId, protocol, trial.assessmentAttemptId, [trial]);
        return stored;
    }

    async getTrial(
        userId: string,
        protocol: MeasurementProtocol,
        attemptId: string,
        trialId: string,
    ): Promise<AssessmentTrial | null> {
        const snapshot = await getDoc(this.trialRef(userId, attemptId, trialId));
        if (!snapshot.exists()) return null;
        const trial = snapshot.data() as AssessmentTrial;
        assertValidAssessmentTrial(trial, protocol);
        if (trial.id !== trialId || trial.assessmentAttemptId !== attemptId) {
            throw new Error(`Assessment trial path mismatch for ${attemptId}/${trialId}`);
        }
        return trial;
    }

    /** Every stored record for one attempt (including superseded ones), validated as a set. */
    async listTrialsForAttempt(
        userId: string,
        protocol: MeasurementProtocol,
        attemptId: string,
    ): Promise<AssessmentTrial[]> {
        const snapshots = await getDocs(collection(this.db, 'users', userId, 'assessment_attempts', attemptId, 'trials'));
        const trials = snapshots.docs.map(snapshot => {
            const trial = snapshot.data() as AssessmentTrial;
            if (trial.id !== snapshot.id) throw new Error(`Assessment trial path mismatch for ${attemptId}/${snapshot.id}`);
            return trial;
        });
        assertValidAssessmentTrialSet(trials, protocol, attemptId);
        return trials.sort(compareTrials);
    }
}

export const assessmentTrialService = new AssessmentTrialService();
