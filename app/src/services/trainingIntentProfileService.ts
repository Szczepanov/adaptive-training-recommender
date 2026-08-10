import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { TrainingIntentProfile } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { validateTrainingIntentProfile } from '../engine/validation';
import { getErrorCode } from '../utils/errors';

const COLLECTION = 'training_intent';
const DOC_ID = 'profile';

export class TrainingIntentProfileService {
    async getProfileState(userId: string): Promise<DataState<TrainingIntentProfile>> {
        try {
            const snapshot = await getDoc(doc(getDb(), 'users', userId, COLLECTION, DOC_ID));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const parsed = validateTrainingIntentProfile(snapshot.data());
            if (!parsed.isValid || !parsed.data || parsed.data.userId !== userId) {
                return { status: 'INVALID', issues: [{ code: 'schema-validation-failed', documentPath: `users/${userId}/${COLLECTION}/${DOC_ID}` }] };
            }
            return { status: 'AVAILABLE', data: parsed.data, revision: parsed.data.updatedAt };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read training intent profile', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async upsert(userId: string, profile: Omit<TrainingIntentProfile, 'userId' | 'createdAt' | 'updatedAt'> & Partial<Pick<TrainingIntentProfile, 'createdAt'>>): Promise<TrainingIntentProfile> {
        const existing = await this.getProfileState(userId);
        const now = new Date().toISOString();
        const raw = {
            ...profile,
            userId,
            createdAt: existing.status === 'AVAILABLE' ? existing.data.createdAt : (profile.createdAt ?? now),
            updatedAt: now,
        };
        const parsed = validateTrainingIntentProfile(raw);
        if (!parsed.isValid || !parsed.data) throw new Error(`Validation failed: ${parsed.errors.map(error => error.message).join('; ')}`);
        await setDoc(doc(getDb(), 'users', userId, COLLECTION, DOC_ID), parsed.data, { merge: true });
        return parsed.data;
    }
}

export const trainingIntentProfileService = new TrainingIntentProfileService();
