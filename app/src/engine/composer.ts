import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { DailyDecisionInput, DailyRecoverySnapshot } from './models';
import { checkinService } from '../services/checkinService';
import { goalService } from '../services/goalService';
import { constraintService } from '../services/constraintService';
import { preferencesService } from '../services/preferencesService';
import { localDataService } from '../services/localDataService';

export class DecisionComposer {
    /**
     * Compose a complete DailyDecisionInput object from all data sources
     */
    async composeDailyDecisionInput(userId: string, date?: string): Promise<DailyDecisionInput> {
        const targetDate = date || new Date().toISOString().split('T')[0];
        
        try {
            // Fetch all data sources in parallel for better performance
            const [
                recoverySnapshot,
                subjectiveCheckin,
                activeGoals,
                activeConstraints,
                preferences
            ] = await Promise.allSettled([
                this.getRecoverySnapshot(userId, targetDate),
                checkinService.getCheckin(userId, targetDate),
                goalService.getActiveGoals(userId),
                constraintService.getActiveConstraints(userId),
                preferencesService.getPreferences(userId)
            ]);

            // Extract values or defaults from settled promises
            const recoveryValue = recoverySnapshot.status === 'fulfilled' ? recoverySnapshot.value : null;
            const checkinValue = subjectiveCheckin.status === 'fulfilled' ? subjectiveCheckin.value : null;
            const goalsValue = activeGoals.status === 'fulfilled' ? activeGoals.value : [];
            const constraintsValue = activeConstraints.status === 'fulfilled' ? activeConstraints.value : [];
            const preferencesValue = preferences.status === 'fulfilled' ? preferences.value : null;

            // Log any rejections for debugging
            if (recoverySnapshot.status === 'rejected') {
                console.warn('Failed to load recovery snapshot:', recoverySnapshot.reason);
            }
            if (subjectiveCheckin.status === 'rejected') {
                console.warn('Failed to load checkin:', subjectiveCheckin.reason);
            }
            if (activeGoals.status === 'rejected') {
                console.warn('Failed to load goals:', activeGoals.reason);
            }
            if (activeConstraints.status === 'rejected') {
                console.warn('Failed to load constraints:', activeConstraints.reason);
            }
            if (preferences.status === 'rejected') {
                console.warn('Failed to load preferences:', preferences.reason);
            }

            // Compute data quality flags
            const dataQuality = {
                hasRecoverySnapshot: recoveryValue !== null,
                hasSubjectiveCheckin: checkinValue !== null && checkinValue.dataQuality?.isComplete || false,
                profileReady: preferencesValue !== null
            };

            // Compose the final decision input
            const decisionInput: DailyDecisionInput = {
                userId,
                date: targetDate,
                recoverySnapshot: recoveryValue,
                subjectiveCheckin: checkinValue,
                activeGoals: goalsValue,
                activeConstraints: constraintsValue,
                preferences: preferencesValue,
                dataQuality
            };

            return decisionInput;
        } catch (error) {
            console.error('Error composing daily decision input:', error);
            throw error;
        }
    }

    /**
     * Get recovery snapshot from user-scoped path
     * Falls back to legacy path if needed
     */
    private async getRecoverySnapshot(userId: string, date: string): Promise<DailyRecoverySnapshot | null> {
        try {
            // First try the new user-scoped path
            const docRef = doc(db, 'users', userId, 'daily_recovery_snapshots', date);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                return docSnap.data() as DailyRecoverySnapshot;
            }

            // Fall back to legacy path for backward compatibility
            const legacyDocRef = doc(db, 'daily_recovery_snapshot', date);
            const legacyDocSnap = await getDoc(legacyDocRef);
            
            if (legacyDocSnap.exists()) {
                const snapshot = legacyDocSnap.data() as DailyRecoverySnapshot;
                // Verify it belongs to the user
                if (snapshot.userId === userId) {
                    return snapshot;
                }
            }

            // Final fallback: try local cache file (for development)
            console.log('No data in Firestore, trying local cache...');
            const localSnapshot = await localDataService.getRecoverySnapshot(date, userId);
            if (localSnapshot) {
                console.log('Found data in local cache for', date);
                return localSnapshot;
            }

            return null;
        } catch (error) {
            console.error('Error fetching recovery snapshot:', error);
            return null;
        }
    }

    /**
     * Get decision inputs for a date range
     */
    async composeDecisionInputsInRange(
        userId: string, 
        startDate: string, 
        endDate: string
    ): Promise<DailyDecisionInput[]> {
        try {
            const inputs: DailyDecisionInput[] = [];
            const start = new Date(startDate);
            const end = new Date(endDate);

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const input = await this.composeDailyDecisionInput(userId, dateStr);
                inputs.push(input);
            }

            return inputs;
        } catch (error) {
            console.error('Error composing decision inputs in range:', error);
            throw error;
        }
    }

    /**
     * Get today's decision input with caching
     */
    async getTodaysDecisionInput(userId: string): Promise<DailyDecisionInput> {
        const today = new Date().toISOString().split('T')[0];
        return this.composeDailyDecisionInput(userId, today);
    }

    /**
     * Check if all required data is available for recommendations
     */
    async isDataReadyForRecommendations(userId: string, date?: string): Promise<{
        isReady: boolean;
        missingItems: string[];
        dataQuality: DailyDecisionInput['dataQuality'];
    }> {
        try {
            const input = await this.composeDailyDecisionInput(userId, date);
            const missingItems: string[] = [];

            if (!input.dataQuality.hasRecoverySnapshot) {
                missingItems.push('Recovery snapshot (Garmin data)');
            }

            if (!input.dataQuality.hasSubjectiveCheckin) {
                missingItems.push('Daily subjective check-in');
            }

            if (!input.dataQuality.profileReady) {
                missingItems.push('User preferences');
            }

            return {
                isReady: missingItems.length === 0,
                missingItems,
                dataQuality: input.dataQuality
            };
        } catch (error) {
            console.error('Error checking data readiness:', error);
            throw error;
        }
    }

    /**
     * Get data completeness percentage
     */
    async getDataCompleteness(userId: string, date?: string): Promise<{
        percentage: number;
        details: {
            recoverySnapshot: boolean;
            subjectiveCheckin: boolean;
            preferences: boolean;
            goals: boolean;
            constraints: boolean;
        };
    }> {
        try {
            const input = await this.composeDailyDecisionInput(userId, date);
            
            const details = {
                recoverySnapshot: input.dataQuality.hasRecoverySnapshot,
                subjectiveCheckin: input.dataQuality.hasSubjectiveCheckin,
                preferences: input.dataQuality.profileReady,
                goals: input.activeGoals.length > 0,
                constraints: input.activeConstraints.length > 0
            };

            const trueCount = Object.values(details).filter(v => v).length;
            const percentage = (trueCount / Object.keys(details).length) * 100;

            return {
                percentage: Math.round(percentage * 100) / 100,
                details
            };
        } catch (error) {
            console.error('Error calculating data completeness:', error);
            throw error;
        }
    }

    /**
     * Export decision input as JSON for debugging
     */
    async exportDecisionInput(userId: string, date?: string): Promise<string> {
        try {
            const input = await this.composeDailyDecisionInput(userId, date);
            return JSON.stringify(input, null, 2);
        } catch (error) {
            console.error('Error exporting decision input:', error);
            throw error;
        }
    }

    /**
     * Validate decision input integrity
     */
    async validateDecisionInput(input: DailyDecisionInput): Promise<{
        isValid: boolean;
        errors: string[];
    }> {
        const errors: string[] = [];

        // Basic structure validation
        if (!input.userId) errors.push('Missing userId');
        if (!input.date) errors.push('Missing date');

        // Data consistency checks
        if (input.recoverySnapshot && input.recoverySnapshot.userId !== input.userId) {
            errors.push('Recovery snapshot userId mismatch');
        }

        if (input.subjectiveCheckin && input.subjectiveCheckin.userId !== input.userId) {
            errors.push('Subjective check-in userId mismatch');
        }

        if (input.subjectiveCheckin && input.subjectiveCheckin.date !== input.date) {
            errors.push('Subjective check-in date mismatch');
        }

        if (input.preferences && input.preferences.userId !== input.userId) {
            errors.push('Preferences userId mismatch');
        }

        // Goal validation
        input.activeGoals.forEach(goal => {
            if (goal.userId !== input.userId) {
                errors.push(`Goal ${goal.title} userId mismatch`);
            }
            if (goal.status !== 'active') {
                errors.push(`Goal ${goal.title} is not active`);
            }
        });

        // Constraint validation
        input.activeConstraints.forEach(constraint => {
            if (constraint.userId !== input.userId) {
                errors.push(`Constraint ${constraint.displayName} userId mismatch`);
            }
            if (!constraint.isActive) {
                errors.push(`Constraint ${constraint.displayName} is not active`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Get decision input summary for dashboard
     */
    async getDecisionInputSummary(userId: string, date?: string): Promise<{
        hasData: boolean;
        readinessScore?: number;
        timeAvailable?: number;
        activeGoalsCount: number;
        activeConstraintsCount: number;
        hardConstraintsCount: number;
        preferredModalities: string[];
        dataQuality: DailyDecisionInput['dataQuality'];
    }> {
        try {
            const input = await this.composeDailyDecisionInput(userId, date);
            
            // Calculate average readiness if check-in exists
            let readinessScore: number | undefined;
            if (input.subjectiveCheckin) {
                const { readiness, sleepQuality, fatigue, soreness, mentalStress, motivation } = input.subjectiveCheckin;
                const values = [readiness, sleepQuality, fatigue, soreness, mentalStress, motivation]
                    .filter(v => v !== null) as number[];
                if (values.length > 0) {
                    readinessScore = values.reduce((a, b) => a + b, 0) / values.length;
                }
            }

            // Count hard constraints
            const hardConstraintsCount = input.activeConstraints.filter(c => c.severity === 'hard').length;

            return {
                hasData: input.dataQuality.hasRecoverySnapshot || input.dataQuality.hasSubjectiveCheckin,
                readinessScore,
                timeAvailable: input.subjectiveCheckin?.availability.timeAvailableMin ?? undefined,
                activeGoalsCount: input.activeGoals.length,
                activeConstraintsCount: input.activeConstraints.length,
                hardConstraintsCount,
                preferredModalities: input.preferences?.preferredModalities ?? [],
                dataQuality: input.dataQuality
            };
        } catch (error) {
            console.error('Error getting decision input summary:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const decisionComposer = new DecisionComposer();

// Development helper - expose on window for debugging
if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as any).__DEBUG_DECISION_INPUT__ = async (userId?: string, date?: string) => {
        if (!userId) {
            console.error('User ID required. Usage: __DEBUG_DECISION_INPUT__(userId, date?)');
            return;
        }
        
        try {
            const input = await decisionComposer.composeDailyDecisionInput(userId, date);
            console.log('Daily Decision Input:', input);
            console.log('JSON Export:', JSON.stringify(input, null, 2));
            
            // Validate
            const validation = await decisionComposer.validateDecisionInput(input);
            console.log('Validation:', validation);
            
            // Check readiness
            const readiness = await decisionComposer.isDataReadyForRecommendations(userId, date);
            console.log('Data Readiness:', readiness);
            
            return input;
        } catch (error) {
            console.error('Error fetching decision input:', error);
        }
    };
}
