import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    setDoc,
    where,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { AssessmentAttempt } from '../observations/models';
import { assertValidAssessmentAttempt } from '../observations/validation';

export class AssessmentAttemptService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private attemptRef(userId: string, attemptId: string) {
        return doc(this.db, 'users', userId, 'assessment_attempts', attemptId);
    }

    async createAttempt(userId: string, attempt: AssessmentAttempt): Promise<AssessmentAttempt> {
        assertValidAssessmentAttempt(attempt);
        const ref = this.attemptRef(userId, attempt.id);
        const existing = await getDoc(ref);
        if (existing.exists()) throw new Error(`Assessment attempt ${attempt.id} already exists`);
        await setDoc(ref, attempt);
        return attempt;
    }

    async getAttempt(userId: string, attemptId: string): Promise<AssessmentAttempt | null> {
        const snapshot = await getDoc(this.attemptRef(userId, attemptId));
        if (!snapshot.exists()) return null;
        const attempt = snapshot.data() as AssessmentAttempt;
        assertValidAssessmentAttempt(attempt);
        if (attempt.id !== attemptId) throw new Error(`Assessment attempt path mismatch for ${attemptId}`);
        return attempt;
    }

    /**
     * Resume seam for OV3. A running attempt always takes precedence over a newer scheduled
     * attempt; scheduled attempts are only recovery candidates when no attempt is in progress.
    */
    async findOpenAttempt(userId: string, sourceSessionRef?: string): Promise<AssessmentAttempt | null> {
        const attemptsRef = collection(this.db, 'users', userId, 'assessment_attempts');
        const attempts = sourceSessionRef
            ? query(attemptsRef, where('sourceSessionRef', '==', sourceSessionRef))
            : attemptsRef;
        const snapshots = await getDocs(attempts);
        const candidates: AssessmentAttempt[] = [];
        for (const snapshot of snapshots.docs) {
            const attempt = snapshot.data() as AssessmentAttempt;
            try {
                assertValidAssessmentAttempt(attempt);
            } catch {
                continue;
            }
            if (attempt.id !== snapshot.id) continue;
            if (
                (attempt.state === 'scheduled' || attempt.state === 'in_progress')
                && (!sourceSessionRef || attempt.sourceSessionRef === sourceSessionRef)
            ) {
                candidates.push(attempt);
            }
        }
        const rank = (attempt: AssessmentAttempt): string => attempt.startedAt ?? `${attempt.scheduledDate ?? ''}T00:00:00`;
        return candidates.sort((a, b) => {
            const runningFirst = Number(b.state === 'in_progress') - Number(a.state === 'in_progress');
            return runningFirst || rank(b).localeCompare(rank(a));
        })[0] ?? null;
    }

    /** Find the running assessment attempt bound to one exact structured execution. */
    async findInProgressAttempt(userId: string, sourceSessionRef: string): Promise<AssessmentAttempt | null> {
        const attempts = query(
            collection(this.db, 'users', userId, 'assessment_attempts'),
            where('sourceSessionRef', '==', sourceSessionRef),
        );
        const snapshots = await getDocs(attempts);
        for (const snapshot of snapshots.docs) {
            const attempt = snapshot.data() as AssessmentAttempt;
            try {
                assertValidAssessmentAttempt(attempt);
            } catch {
                continue;
            }
            if (
                attempt.id === snapshot.id
                && attempt.state === 'in_progress'
                && attempt.sourceSessionRef === sourceSessionRef
            ) {
                return attempt;
            }
        }
        return null;
    }

    async startAttempt(userId: string, attemptId: string, startedAt: string): Promise<void> {
        await this.transitionAttempt(userId, attemptId, current => {
            if (current.state !== 'scheduled') throw new Error(`Cannot start assessment from ${current.state}`);
            return { ...current, state: 'in_progress', startedAt };
        });
    }

    async completeAttempt(userId: string, attemptId: string, completedAt: string, notes?: string): Promise<void> {
        await this.transitionAttempt(userId, attemptId, current => {
            if (current.state !== 'in_progress') throw new Error(`Cannot complete assessment from ${current.state}`);
            return {
                ...current,
                state: 'completed',
                completedAt,
                ...(notes !== undefined ? { notes } : {}),
            };
        });
    }

    async abandonAttempt(userId: string, attemptId: string, notes?: string): Promise<void> {
        await this.transitionAttempt(userId, attemptId, current => {
            if (current.state !== 'scheduled' && current.state !== 'in_progress') {
                throw new Error(`Cannot abandon assessment from ${current.state}`);
            }
            return { ...current, state: 'abandoned', ...(notes !== undefined ? { notes } : {}) };
        });
    }

    /**
     * Reads and rewrites the attempt inside a transaction so two concurrent transitions on the
     * same attempt (e.g. two starts racing) can't both observe the pre-transition state and
     * silently clobber each other's fields; the loser fails/retries via Firestore's transaction
     * conflict handling instead.
     */
    private async transitionAttempt(
        userId: string,
        attemptId: string,
        transition: (current: AssessmentAttempt) => AssessmentAttempt,
    ): Promise<void> {
        const ref = this.attemptRef(userId, attemptId);
        await runTransaction(this.db, async transaction => {
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists()) throw new Error(`Assessment attempt ${attemptId} does not exist`);
            const current = snapshot.data() as AssessmentAttempt;
            assertValidAssessmentAttempt(current);
            if (current.id !== attemptId) throw new Error(`Assessment attempt path mismatch for ${attemptId}`);

            const next = transition(current);
            assertValidAssessmentAttempt(next);
            transaction.set(ref, next);
        });
    }
}

export const assessmentAttemptService = new AssessmentAttemptService();
