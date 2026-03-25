import { doc, getDoc, setDoc, deleteDoc, collection, query, where, orderBy, getDocs, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserGoal, GoalCategory } from '../engine/models';

type UserGoalWithId = UserGoal & { id: string };
import { validateGoal } from '../engine/validation';

export class GoalService {
    private readonly collectionPath = 'goals';

    /**
     * List all goals for a user
     */
    async listGoals(userId: string): Promise<UserGoalWithId[]> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('userId', '==', userId),
                orderBy('category', 'asc'),
                orderBy('priority', 'desc'),
                orderBy('createdAt', 'desc')
            );
            
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id
            } as UserGoal & { id: string }));
        } catch (error) {
            console.error('Error listing goals:', error);
            throw error;
        }
    }

    /**
     * Get active goals only
     */
    async getActiveGoals(userId: string): Promise<UserGoalWithId[]> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('status', '==', 'active')
            );
            
            const querySnapshot = await getDocs(q);
            const goals = querySnapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id
            } as UserGoal & { id: string }));

            return goals.sort((a, b) => {
                const categoryCompare = a.category.localeCompare(b.category);
                if (categoryCompare !== 0) {
                    return categoryCompare;
                }

                return b.priority - a.priority;
            });
        } catch (error: any) {
            if (error?.code === 'permission-denied' || (error.message && error.message.includes('Missing or insufficient permissions'))) {
                console.warn('Permission denied accessing goals. User may need to complete first check-in.');
                return [];
            }
            console.error('Error fetching active goals:', error);
            throw error;
        }
    }

    /**
     * Get goals by category
     */
    async getGoalsByCategory(userId: string, category: GoalCategory): Promise<UserGoalWithId[]> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const q = query(
                collRef,
                where('userId', '==', userId),
                where('category', '==', category),
                orderBy('priority', 'desc'),
                orderBy('createdAt', 'desc')
            );
            
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => ({
                ...doc.data(),
                id: doc.id
            } as UserGoalWithId));
        } catch (error) {
            console.error('Error fetching goals by category:', error);
            throw error;
        }
    }

    /**
     * Get a specific goal by ID
     */
    async getGoal(userId: string, goalId: string): Promise<UserGoalWithId | null> {
        try {
            const docRef = doc(db, 'users', userId, this.collectionPath, goalId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                return {
                    ...docSnap.data(),
                    id: docSnap.id
                } as UserGoalWithId;
            }
            return null;
        } catch (error) {
            console.error('Error fetching goal:', error);
            throw error;
        }
    }

    /**
     * Create a new goal
     */
    async createGoal(userId: string, goalData: Omit<UserGoal, 'userId' | 'createdAt' | 'updatedAt'>): Promise<UserGoal> {
        try {
            // Prepare data for validation
            const rawData = {
                userId,
                ...goalData
            };

            // Validate the data
            const validation = validateGoal(rawData);
            if (!validation.isValid) {
                const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
                throw new Error(`Validation failed: ${errorMessages}`);
            }

            const validatedGoal = validation.data!;
            
            // Create new document
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const docRef = await addDoc(collRef, validatedGoal);
            
            // Update with the document ID
            const goalWithId = { ...validatedGoal, id: docRef.id };
            await setDoc(docRef, goalWithId, { merge: true });

            return goalWithId;
        } catch (error) {
            console.error('Error creating goal:', error);
            throw error;
        }
    }

    /**
     * Update an existing goal
     */
    async updateGoal(userId: string, goalId: string, updates: Partial<UserGoal>): Promise<UserGoal> {
        try {
            // Get existing goal
            const existingGoal = await this.getGoal(userId, goalId);
            if (!existingGoal) {
                throw new Error('Goal not found');
            }

            // Merge with updates
            const updatedData = {
                ...existingGoal,
                ...updates,
                updatedAt: new Date().toISOString()
            };

            // Validate the updated data
            const validation = validateGoal(updatedData);
            if (!validation.isValid) {
                const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
                throw new Error(`Validation failed: ${errorMessages}`);
            }

            const validatedGoal = validation.data!;
            
            // Save to Firestore
            const docRef = doc(db, 'users', userId, this.collectionPath, goalId);
            await setDoc(docRef, validatedGoal, { merge: true });

            return validatedGoal;
        } catch (error) {
            console.error('Error updating goal:', error);
            throw error;
        }
    }

    /**
     * Archive a goal (sets status to 'archived')
     */
    async archiveGoal(userId: string, goalId: string): Promise<UserGoal> {
        return this.updateGoal(userId, goalId, { status: 'archived' });
    }

    /**
     * Pause a goal
     */
    async pauseGoal(userId: string, goalId: string): Promise<UserGoal> {
        return this.updateGoal(userId, goalId, { status: 'paused' });
    }

    /**
     * Reactivate a goal
     */
    async reactivateGoal(userId: string, goalId: string): Promise<UserGoal> {
        return this.updateGoal(userId, goalId, { status: 'active' });
    }

    /**
     * Complete a goal
     */
    async completeGoal(userId: string, goalId: string): Promise<UserGoal> {
        return this.updateGoal(userId, goalId, { status: 'completed' });
    }

    /**
     * Delete a goal permanently
     */
    async deleteGoal(userId: string, goalId: string): Promise<void> {
        try {
            const docRef = doc(db, 'users', userId, this.collectionPath, goalId);
            await deleteDoc(docRef);
        } catch (error) {
            console.error('Error deleting goal:', error);
            throw error;
        }
    }

    /**
     * Get top goal for each category
     */
    async getTopGoalsByCategory(userId: string): Promise<Record<GoalCategory, UserGoal | null>> {
        try {
            const categories: GoalCategory[] = ['short-term', 'mid-term', 'long-term'];
            const result: Record<GoalCategory, UserGoal | null> = {} as any;

            for (const category of categories) {
                const goals = await this.getGoalsByCategory(userId, category);
                const activeGoals = goals.filter(g => g.status === 'active');
                result[category] = activeGoals.length > 0 ? activeGoals[0] : null;
            }

            return result;
        } catch (error) {
            console.error('Error fetching top goals by category:', error);
            throw error;
        }
    }

    /**
     * Update goal priority
     */
    async updateGoalPriority(userId: string, goalId: string, priority: number): Promise<UserGoal> {
        if (priority < 1 || priority > 5) {
            throw new Error('Priority must be between 1 and 5');
        }
        return this.updateGoal(userId, goalId, { priority });
    }

    /**
     * Get goals statistics
     */
    async getGoalStats(userId: string): Promise<{
        total: number;
        active: number;
        paused: number;
        completed: number;
        archived: number;
        byCategory: Record<GoalCategory, number>;
    }> {
        try {
            const goals = await this.listGoals(userId);
            
            const stats = {
                total: goals.length,
                active: 0,
                paused: 0,
                completed: 0,
                archived: 0,
                byCategory: {
                    'short-term': 0,
                    'mid-term': 0,
                    'long-term': 0
                } as Record<GoalCategory, number>
            };

            goals.forEach(goal => {
                // Count by status
                switch (goal.status) {
                    case 'active':
                        stats.active++;
                        break;
                    case 'paused':
                        stats.paused++;
                        break;
                    case 'completed':
                        stats.completed++;
                        break;
                    case 'archived':
                        stats.archived++;
                        break;
                }

                // Count by category
                stats.byCategory[goal.category]++;
            });

            return stats;
        } catch (error) {
            console.error('Error calculating goal stats:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const goalService = new GoalService();
