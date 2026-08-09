import { doc, getDoc, setDoc, deleteDoc, deleteField, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DailySubjectiveCheckin } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { validateCheckin } from '../engine/validation';
import { getLocalDateString } from '../utils/localDate';
import { isPermissionDeniedError } from '../utils/errors';
import { parseSubjectiveCheckin } from '../persistence/parsers/decisionInputs';

export class CheckinService {
    private readonly collectionPath = 'daily_subjective_checkins';

    /**
     * Get a specific daily check-in for a user
     */
    async getCheckinState(userId: string, date: string): Promise<DataState<DailySubjectiveCheckin>> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) return { status: 'MISSING' };
            return parseSubjectiveCheckin(docSnap.data(), `users/${userId}/${this.collectionPath}/${date}`, userId, date);
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read subjective check-in',
                retryable: !isPermissionDeniedError(error),
            };
        }
    }

    async getCheckin(userId: string, date: string): Promise<DailySubjectiveCheckin | null> {
        const state = await this.getCheckinState(userId, date);
        return state.status === 'AVAILABLE' ? state.data : null;
    }

    // Canonical Phase 4 alias
    async upsertTodayCheckin(userId: string, checkinData: Partial<DailySubjectiveCheckin>): Promise<DailySubjectiveCheckin> {
        const today = getLocalDateString();
        return this.upsertCheckin(userId, {
            ...checkinData,
            date: checkinData.date ?? today
        });
    }

    // Canonical Phase 4 alias
    async getCheckinByDate(userId: string, date: string): Promise<DailySubjectiveCheckin | null> {
        return this.getCheckin(userId, date);
    }

    /**
     * Get today's check-in for a user
     */
    async getTodayCheckin(userId: string): Promise<DailySubjectiveCheckin | null> {
        const today = getLocalDateString();
        return this.getCheckin(userId, today);
    }

    /**
     * Create or update a daily check-in
     */
    async upsertCheckin(userId: string, checkinData: Partial<DailySubjectiveCheckin>): Promise<DailySubjectiveCheckin> {
        try {
            // Prepare data for validation
            const rawData = {
                userId,
                date: checkinData.date || getLocalDateString(),
                ...checkinData
            };

            // Validate the data
            const validation = validateCheckin(rawData);
            if (!validation.isValid) {
                const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
                throw new Error(`Validation failed: ${errorMessages}`);
            }

            const validatedCheckin = validation.data!;

            // Save to Firestore. validateCheckin omits `tissueResponses` from its result
            // entirely whenever it's absent -- with `merge: true`, an omitted key leaves
            // whatever was already stored untouched, it does NOT clear it. So a day that
            // previously had tissueResponses and now reports painOrInjury: false would
            // otherwise keep the stale region data live in Firestore even though the UI
            // (DailyCheckin's handleBooleanToggle) already cleared it locally --
            // mapContextFromGoalsAndTrainingSettings consumes tissueResponses regardless of
            // painOrInjury, so a stale value would keep restricting the athlete after they
            // explicitly reported no pain/injury. Explicitly delete the field whenever this
            // write's own painOrInjury is false, covering every upsert path (including
            // MinimumSafetyCheckin's partial safety-subset save), not just DailyCheckin's.
            const payload: Record<string, unknown> = { ...validatedCheckin };
            if (!validatedCheckin.painOrInjury) {
                payload.tissueResponses = deleteField();
            }
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, validatedCheckin.date);
            await setDoc(docRef, payload, { merge: true });

            return validatedCheckin;
        } catch (error) {
            console.error('Error upserting check-in:', error);
            throw error;
        }
    }

    /**
     * Delete a specific check-in
     */
    async deleteCheckin(userId: string, date: string): Promise<void> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
            await deleteDoc(docRef);
        } catch (error) {
            console.error('Error deleting check-in:', error);
            throw error;
        }
    }

    /**
     * Get recent check-ins for a user
     */
    async getRecentCheckins(userId: string, days: number = 30): Promise<DailySubjectiveCheckin[]> {
        try {
            const collRef = collection(getDb(), 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('userId', '==', userId),
                orderBy('date', 'desc'),
                limit(days)
            );
            
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => doc.data() as DailySubjectiveCheckin);
        } catch (error) {
            console.error('Error fetching recent check-ins:', error);
            throw error;
        }
    }

    /**
     * Get check-ins for a date range
     */
    async getCheckinsInRange(
        userId: string, 
        startDate: string, 
        endDate: string
    ): Promise<DailySubjectiveCheckin[]> {
        try {
            const collRef = collection(getDb(), 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('userId', '==', userId),
                where('date', '>=', startDate),
                where('date', '<=', endDate),
                orderBy('date', 'asc')
            );
            
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => doc.data() as DailySubjectiveCheckin);
        } catch (error) {
            console.error('Error fetching check-ins in range:', error);
            throw error;
        }
    }

    /**
     * Check if a check-in exists for a specific date
     */
    async checkinExists(userId: string, date: string): Promise<boolean> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, date);
            const docSnap = await getDoc(docRef);
            return docSnap.exists();
        } catch (error) {
            console.error('Error checking if check-in exists:', error);
            throw error;
        }
    }

    /**
     * Get completion statistics for the last N days
     */
    async getCompletionStats(userId: string, days: number = 30): Promise<{
        totalDays: number;
        completedDays: number;
        completionRate: number;
        streak: number;
    }> {
        try {
            const checkins = await this.getRecentCheckins(userId, days);
            const completedDays = checkins.filter(c => c.dataQuality.isComplete).length;
            const completionRate = days > 0 ? (completedDays / days) * 100 : 0;

            // Calculate current streak
            let streak = 0;
            const sortedCheckins = checkins.sort((a, b) => b.date.localeCompare(a.date));
            
            for (const checkin of sortedCheckins) {
                if (checkin.dataQuality.isComplete) {
                    streak++;
                } else {
                    break;
                }
            }

            return {
                totalDays: days,
                completedDays,
                completionRate: Math.round(completionRate * 100) / 100,
                streak
            };
        } catch (error) {
            console.error('Error calculating completion stats:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const checkinService = new CheckinService();
