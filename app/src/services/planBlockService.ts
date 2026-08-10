import { addDoc, collection, deleteDoc, doc, getDocs, query, setDoc, where, type DocumentData } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { AuthoredPlanBlock } from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateAuthoredPlanBlock } from '../engine/validation';
import { getErrorCode } from '../utils/errors';

type PlanBlockWithId = AuthoredPlanBlock & { id: string };

function storedPlanBlockPayload(block: AuthoredPlanBlock): DocumentData {
    const payload: DocumentData = { ...block };
    delete payload.id;
    return payload;
}

/** User-scoped persistence for explicit plan overlays. This service deliberately does
 * not derive blocks from events or activities; callers must author every travel date. */
export class PlanBlockService {
    private readonly collectionPath = 'plan_blocks';

    async getBlocksInRangeState(userId: string, startDate: string, endDate: string): Promise<DataState<PlanBlockWithId[]>> {
        try {
            const ref = collection(getDb(), 'users', userId, this.collectionPath);
            const snapshot = await getDocs(query(ref, where('startDate', '<=', endDate)));
            const blocks: PlanBlockWithId[] = [];
            const issues: DataIssue[] = [];
            const revisions: string[] = [];
            for (const item of snapshot.docs) {
                const parsed = validateAuthoredPlanBlock({ ...item.data(), id: item.id });
                if (!parsed.isValid || !parsed.data || parsed.data.userId !== userId) {
                    issues.push({ code: 'schema-validation-failed', documentPath: `users/${userId}/${this.collectionPath}/${item.id}` });
                    continue;
                }
                if (parsed.data.endDate >= startDate) blocks.push({ ...parsed.data, id: item.id });
                const updatedAt = item.data().updatedAt;
                if (typeof updatedAt === 'string') revisions.push(`${item.id}:${updatedAt}`);
            }
            if (issues.length > 0) return { status: 'INVALID', issues };
            return { status: 'AVAILABLE', data: blocks.sort((a, b) => a.startDate.localeCompare(b.startDate)), revision: revisions.sort().join('|') || null };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read plan blocks', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async listForRange(userId: string, startDate: string, endDate: string): Promise<PlanBlockWithId[]> {
        const state = await this.getBlocksInRangeState(userId, startDate, endDate);
        return state.status === 'AVAILABLE' ? state.data : [];
    }

    async create(userId: string, input: Omit<AuthoredPlanBlock, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<PlanBlockWithId> {
        const parsed = validateAuthoredPlanBlock({ ...input, userId });
        if (!parsed.isValid || !parsed.data) throw new Error(`Validation failed: ${parsed.errors.map(error => error.message).join('; ')}`);
        const ref = await addDoc(collection(getDb(), 'users', userId, this.collectionPath), storedPlanBlockPayload(parsed.data));
        return { ...parsed.data, id: ref.id };
    }

    async update(userId: string, id: string, input: Omit<AuthoredPlanBlock, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { createdAt: string }): Promise<PlanBlockWithId> {
        const parsed = validateAuthoredPlanBlock({ ...input, id, userId });
        if (!parsed.isValid || !parsed.data) throw new Error(`Validation failed: ${parsed.errors.map(error => error.message).join('; ')}`);
        await setDoc(doc(getDb(), 'users', userId, this.collectionPath, id), storedPlanBlockPayload(parsed.data), { merge: true });
        return { ...parsed.data, id };
    }

    async delete(userId: string, id: string): Promise<void> {
        await deleteDoc(doc(getDb(), 'users', userId, this.collectionPath, id));
    }
}

export const planBlockService = new PlanBlockService();
