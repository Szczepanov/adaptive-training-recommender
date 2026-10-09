import {
    collection,
    doc,
    getDoc,
    getDocs,
    runTransaction,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import { assertFixedLoadComparisonContext, assertFixedLoadObservationEvidence, FIXED_LOAD_VELOCITY_METRIC_ID, isFixedLoadVelocityProtocol } from '../observations/fixedLoadVelocity';
import {
    assertAssessmentTrialWriteAllowed,
    assertValidAssessmentTrial,
    assertValidAssessmentTrialSet,
} from '../observations/assessmentTrials';
import type {
    AssessmentAttempt,
    AssessmentTrial,
    MeasurementProtocol,
    MetricObservationHead,
    MetricObservationRevision,
} from '../observations/models';
import {
    sameCanonicalAssessmentTrial,
    sameCanonicalObservationRevision,
} from '../observations/observationCanonical';
import {
    assertValidAssessmentAttempt,
    assertValidMetricObservationHead,
    assertValidMetricObservationRevision,
} from '../observations/validation';

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

    private observationHeadRef(userId: string, observationKey: string) {
        return doc(this.db, 'users', userId, 'metric_observations', observationKey);
    }

    private observationRevisionRef(userId: string, observationKey: string, revision: number) {
        return doc(this.db, 'users', userId, 'metric_observations', observationKey, 'revisions', String(revision));
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
        assertFixedLoadComparisonContext(protocol, trials, trials[0].context);
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

    /**
     * ADR-0046 correction commit boundary. The superseding raw trial and every canonical
     * observation revision affected by it commit in one Firestore transaction. A stale
     * concurrent head or interrupted request therefore cannot leave raw evidence ahead of
     * only some of its derived benchmark heads.
     */
    async commitCorrection(
        userId: string,
        protocol: MeasurementProtocol,
        trial: AssessmentTrial,
        observationRevisions: readonly MetricObservationRevision[],
    ): Promise<void> {
        assertValidAssessmentTrial(trial, protocol);
        if (trial.correctionIndex < 1 || !trial.supersedesTrialId || !trial.correctionReason) {
            throw new Error('Atomic correction commit requires a superseding trial with a correction reason');
        }

        const seenObservationKeys = new Set<string>();
        for (const revision of observationRevisions) {
            assertValidMetricObservationRevision(revision);
            if (revision.assessmentAttemptId !== trial.assessmentAttemptId) {
                throw new Error(`Observation ${revision.observationKey} belongs to another assessment attempt`);
            }
            if (revision.protocolRef.id !== protocol.id || revision.protocolRef.revision !== protocol.revision) {
                throw new Error(`Observation ${revision.observationKey} is bound to another protocol revision`);
            }
            if (seenObservationKeys.has(revision.observationKey)) {
                throw new Error(`Duplicate observation correction in commit: ${revision.observationKey}`);
            }
            seenObservationKeys.add(revision.observationKey);
        }

        await runTransaction(this.db, async transaction => {
            const attemptRef = this.attemptRef(userId, trial.assessmentAttemptId);
            const trialRef = this.trialRef(userId, trial.assessmentAttemptId, trial.id);
            const supersededRef = this.trialRef(userId, trial.assessmentAttemptId, trial.supersedesTrialId!);

            const attemptSnapshot = await transaction.get(attemptRef);
            if (!attemptSnapshot.exists()) {
                throw new Error(`Assessment attempt ${trial.assessmentAttemptId} does not exist`);
            }
            const attempt = attemptSnapshot.data() as AssessmentAttempt;
            this.assertAttemptBinding(attempt, trial.assessmentAttemptId, protocol);
            assertAssessmentTrialWriteAllowed(attempt, trial);

            // Firestore transactions require reads before writes and retry when a read changes.
            const trialSnapshot = await transaction.get(trialRef);
            const supersededSnapshot = await transaction.get(supersededRef);
            const observationSnapshots = await Promise.all(observationRevisions.map(async revision => {
                const headRef = this.observationHeadRef(userId, revision.observationKey);
                const revisionRef = this.observationRevisionRef(userId, revision.observationKey, revision.revision);
                const headSnapshot = await transaction.get(headRef);
                const revisionSnapshot = await transaction.get(revisionRef);
                return { revision, headRef, revisionRef, headSnapshot, revisionSnapshot };
            }));

            if (!supersededSnapshot.exists()) {
                throw new Error(`Superseded trial ${trial.supersedesTrialId} does not exist`);
            }
            if (isFixedLoadVelocityProtocol(protocol)) {
                assertFixedLoadComparisonContext(protocol, [trial], (supersededSnapshot.data() as AssessmentTrial).context);
                for (const { revision } of observationSnapshots) {
                    if (revision.metricId !== FIXED_LOAD_VELOCITY_METRIC_ID) continue;
                    const sourceId = revision.derivedFromEvidenceRefs![0].trialId;
                    const source = sourceId === trial.id ? trial : (await transaction.get(this.trialRef(userId, trial.assessmentAttemptId, sourceId))).data() as AssessmentTrial | undefined;
                    if (!source) throw new Error('Fixed-load source trial does not exist');
                    assertFixedLoadObservationEvidence(revision, source);
                }
            }

            let shouldWriteTrial = true;
            if (trialSnapshot.exists()) {
                const existingTrial = trialSnapshot.data() as AssessmentTrial;
                if (!sameCanonicalAssessmentTrial(existingTrial, trial)) {
                    throw new Error(`Trial ${trial.id} already exists with different content; correction chain diverged`);
                }
                shouldWriteTrial = false;
            }

            const initialWrites: Array<{
                revision: MetricObservationRevision;
                head: MetricObservationHead;
                headRef: ReturnType<AssessmentTrialService['observationHeadRef']>;
                revisionRef: ReturnType<AssessmentTrialService['observationRevisionRef']>;
            }> = [];
            const correctionWrites: Array<{
                revision: MetricObservationRevision;
                headRef: ReturnType<AssessmentTrialService['observationHeadRef']>;
                revisionRef: ReturnType<AssessmentTrialService['observationRevisionRef']>;
            }> = [];

            for (const entry of observationSnapshots) {
                const { revision, headRef, revisionRef, headSnapshot, revisionSnapshot } = entry;

                if (revision.revision === 1) {
                    if (revision.supersedesRevision !== undefined) {
                        throw new Error('Initial observation correction commit cannot declare supersedesRevision');
                    }
                    if (headSnapshot.exists() || revisionSnapshot.exists()) {
                        if (!headSnapshot.exists() || !revisionSnapshot.exists()) {
                            throw new Error(`Observation ${revision.observationKey} has an incomplete head/revision chain`);
                        }
                        const head = headSnapshot.data() as MetricObservationHead;
                        const existingRevision = revisionSnapshot.data() as MetricObservationRevision;
                        assertValidMetricObservationHead(head);
                        assertValidMetricObservationRevision(existingRevision);
                        if (
                            head.headRevision !== 1
                            || head.observationKey !== revision.observationKey
                            || head.metricId !== revision.metricId
                            || head.assessmentAttemptId !== revision.assessmentAttemptId
                            || !sameCanonicalObservationRevision(existingRevision, revision)
                        ) {
                            throw new Error(`Observation ${revision.observationKey} already exists with different or newer content`);
                        }
                        continue;
                    }

                    const head: MetricObservationHead = {
                        observationKey: revision.observationKey,
                        assessmentAttemptId: revision.assessmentAttemptId,
                        metricId: revision.metricId,
                        headRevision: 1,
                        createdAt: revision.createdAt,
                        updatedAt: revision.createdAt,
                    };
                    assertValidMetricObservationHead(head);
                    initialWrites.push({ revision, head, headRef, revisionRef });
                    continue;
                }

                if (revision.supersedesRevision === undefined || !revision.correctionReason) {
                    throw new Error('Observation correction requires supersedesRevision and correctionReason');
                }
                if (!headSnapshot.exists()) {
                    throw new Error(`Observation ${revision.observationKey} does not exist`);
                }
                const head = headSnapshot.data() as MetricObservationHead;
                assertValidMetricObservationHead(head);
                if (
                    head.observationKey !== revision.observationKey
                    || head.metricId !== revision.metricId
                    || head.assessmentAttemptId !== revision.assessmentAttemptId
                ) {
                    throw new Error('Correction cannot change logical observation identity');
                }

                if (revisionSnapshot.exists()) {
                    const existingRevision = revisionSnapshot.data() as MetricObservationRevision;
                    assertValidMetricObservationRevision(existingRevision);
                    if (
                        head.headRevision !== revision.revision
                        || !sameCanonicalObservationRevision(existingRevision, revision)
                    ) {
                        throw new Error(`Observation revision ${revision.revision} already exists with different or newer content`);
                    }
                    continue;
                }

                const expectedRevision = head.headRevision + 1;
                if (revision.revision !== expectedRevision || revision.supersedesRevision !== head.headRevision) {
                    throw new Error(`Stale correction: expected revision ${expectedRevision} superseding ${head.headRevision}`);
                }
                correctionWrites.push({ revision, headRef, revisionRef });
            }

            if (shouldWriteTrial) transaction.set(trialRef, trial);
            for (const write of initialWrites) {
                transaction.set(write.revisionRef, write.revision);
                transaction.set(write.headRef, write.head);
            }
            for (const write of correctionWrites) {
                transaction.set(write.revisionRef, write.revision);
                transaction.update(write.headRef, {
                    headRevision: write.revision.revision,
                    updatedAt: write.revision.createdAt,
                });
            }
        });
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
