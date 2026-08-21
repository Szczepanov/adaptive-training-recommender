import {
    collection,
    doc,
    getDoc,
    getDocs,
    runTransaction,
    setDoc,
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
     * Resume seam for OV3. There is intentionally at most one active structured execution in
     * the current product, so the newest scheduled/in-progress assessment is the only candidate
     * a testing screen may recover after background/reload.
     */
    async findOpenAttempt(userId: string): Promise<AssessmentAttempt | null> {
        const snapshots = await getDocs(collection(this.db, 'users', userId, 'assessment_attempts'));
        const candidates: AssessmentAttempt[] = [];
        for (const snapshot of snapshots.docs) {
            const attempt = snapshot.data() as AssessmentAttempt;
            try {
                assertValidAssessmentAttempt(attempt);
            } catch {
                continue;
            }
            if (attempt.id !== snapshot.id) continue;
            if (attempt.state === 'scheduled' || attempt.state === 'in_progress') candidates.push(attempt);
        }
        const rank = (attempt: AssessmentAttempt): string => attempt.startedAt ?? `${attempt.scheduledDate ?? ''}T00:00:00`;
        return candidates.sort((a, b) => rank(b).localeCompare(rank(a)))[0] ?? null;
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
