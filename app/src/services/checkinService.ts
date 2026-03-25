import { doc, getDoc, setDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { DailySubjectiveCheckin } from '../engine/models';
import { validateCheckin } from '../engine/validation';

export class CheckinService {
    private readonly collectionPath = 'daily_subjective_checkins';

    /**
     * Get a specific daily check-in for a user
     */
    async getCheckin(userId: string, date: string): Promise<DailySubjectiveCheckin | null> {
        try {
            const docRef = doc(db, 'users', userId, this.collectionPath, date);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                return docSnap.data() as DailySubjectiveCheckin;
            }
            return null;
        } catch (error) {
            console.error('Error fetching check-in:', error);
            throw error;
        }
    }

    /**
     * Get today's check-in for a user
     */
    async getTodayCheckin(userId: string): Promise<DailySubjectiveCheckin | null> {
        const today = new Date().toISOString().split('T')[0];
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
                date: checkinData.date || new Date().toISOString().split('T')[0],
                ...checkinData
            };

            // Validate the data
            const validation = validateCheckin(rawData);
            if (!validation.isValid) {
                const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
                throw new Error(`Validation failed: ${errorMessages}`);
            }

            const validatedCheckin = validation.data!;
            
            // Save to Firestore
            const docRef = doc(db, 'users', userId, this.collectionPath, validatedCheckin.date);
            await setDoc(docRef, validatedCheckin, { merge: true });

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
            const docRef = doc(db, 'users', userId, this.collectionPath, date);
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
            const collRef = collection(db, 'users', userId, this.collectionPath);
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
            const collRef = collection(db, 'users', userId, this.collectionPath);
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
            const docRef = doc(db, 'users', userId, this.collectionPath, date);
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
