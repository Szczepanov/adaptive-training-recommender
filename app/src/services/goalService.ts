import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, addDoc, deleteField, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserGoal, GoalCategory } from '../engine/models';
import { deriveGoalCategory } from '../engine/periodization';
import { getLocalDateString } from '../utils/localDate';

type UserGoalWithId = UserGoal & { id: string };
import { validateGoal } from '../engine/validation';
import { getErrorCode, getErrorMessage } from '../utils/errors';

/** category is never trusted as read directly from Firestore for a DATED goal -- it's
 *  recomputed here on every read, relative to *today*, so it can never drift as the
 *  target date approaches (see models.ts UserGoal.category and validation.ts
 *  validateGoal). Open-ended goals (no targetDate) keep whatever category was stored. */
function withResolvedCategory<T extends UserGoal>(goal: T): T {
    if (!goal.targetDate) return goal;
    return { ...goal, category: deriveGoalCategory(goal.targetDate, getLocalDateString()) };
}

/** Firestore never stores `category` for a dated goal in the first place (see
 *  createGoal/updateGoal below) -- nothing to keep in sync, nothing to go stale. */
function stripDerivedCategoryForWrite(goal: UserGoal): UserGoal {
    if (!goal.targetDate) return goal;
    const rest: Partial<UserGoal> = { ...goal };
    delete rest.category;
    return rest as UserGoal;
}

/** Builds a document payload containing only stored inputs. Event-specific inputs are
 * absent for plain/open-ended goals, and category is absent for dated goals. */
function storedGoalPayload(goal: UserGoal): DocumentData {
    const payload: DocumentData = { ...stripDerivedCategoryForWrite(goal) };
    if (!goal.targetDate || !goal.eventCategory) {
        delete payload.eventCategory;
        delete payload.eventPreset;
        delete payload.eventLifecycle;
    }
    return payload;
}

/** Merge writes need explicit field deletions for values that existed on an earlier
 * version of a goal (for example when "This is a race" is unchecked). */
function updatedGoalPayload(goal: UserGoal): DocumentData {
    const payload = storedGoalPayload(goal);
    if (goal.targetDate) payload.category = deleteField();
    if (!goal.targetDate || !goal.eventCategory) {
        payload.eventCategory = deleteField();
        payload.eventPreset = deleteField();
        payload.eventLifecycle = deleteField();
    }
    return payload;
}

export class GoalService {
    private readonly collectionPath = 'goals';

    /**
     * List all goals for a user
     */
    async listGoals(userId: string): Promise<UserGoalWithId[]> {
        try {
            const collRef = collection(db, 'users', userId, this.collectionPath);
            // No orderBy('category', ...) here -- category is no longer stored for dated
            // goals (see stripDerivedCategoryForWrite), so it can't be sorted server-side.
            // Grouping/sorting by category happens client-side after resolving it below.
            const q = query(
                collRef,
                where('userId', '==', userId),
            );

            const querySnapshot = await getDocs(q);
            const goals = querySnapshot.docs.map(doc => withResolvedCategory({
                ...doc.data(),
                id: doc.id
            } as UserGoal & { id: string }));

            return goals.sort((a, b) => {
                const categoryCompare = a.category.localeCompare(b.category);
                if (categoryCompare !== 0) return categoryCompare;
                if (b.priority !== a.priority) return b.priority - a.priority;
                return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
            });
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
            const goals = querySnapshot.docs.map(doc => withResolvedCategory({
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
        } catch (error: unknown) {
            if (getErrorCode(error) === 'permission-denied' || getErrorMessage(error).includes('Missing or insufficient permissions')) {
                console.warn('Permission denied accessing goals. User may need to complete first check-in.');
                return [];
            }
            console.error('Error fetching active goals:', error);
            throw error;
        }
    }

    /**
     * Get goals by category. Category is derived for dated goals, so this can no longer
     * be a Firestore-side `where('category', '==', ...)` query -- fetch and filter
     * client-side against the resolved value instead.
     */
    async getGoalsByCategory(userId: string, category: GoalCategory): Promise<UserGoalWithId[]> {
        try {
            const goals = await this.listGoals(userId);
            return goals
                .filter(g => g.category === category)
                .sort((a, b) => {
                    if (b.priority !== a.priority) return b.priority - a.priority;
                    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
                });
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
                return withResolvedCategory({
                    ...docSnap.data(),
                    id: docSnap.id
                } as UserGoalWithId);
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
    async createGoal(userId: string, goalData: Omit<UserGoal, 'userId' | 'createdAt' | 'updatedAt' | 'schemaVersion'>): Promise<UserGoal> {
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

            // Create new document. `category` is intentionally left out of what's
            // persisted for a dated goal (see stripDerivedCategoryForWrite) -- the
            // returned in-memory object still carries the correct, freshly-derived value
            // for immediate UI use.
            const collRef = collection(db, 'users', userId, this.collectionPath);
            const docRef = await addDoc(collRef, storedGoalPayload(validatedGoal));

            // Update with the document ID
            const goalWithId = { ...validatedGoal, id: docRef.id };
            await setDoc(docRef, storedGoalPayload(goalWithId), { merge: true });

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

            // Merge writes must remove fields that are no longer valid rather than leave
            // a former event able to reappear after a reload or future date edit.
            const docRef = doc(db, 'users', userId, this.collectionPath, goalId);
            await setDoc(docRef, updatedGoalPayload(validatedGoal), { merge: true });

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
            const result = {} as Record<GoalCategory, UserGoal | null>;

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
