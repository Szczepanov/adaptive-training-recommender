import type { DailyDecisionInput, DailyRecoverySnapshot, DailySubjectiveCheckin, TrainingIntentProfile, TrainingSettings, UserGoal, UserPreferences } from './models';
import type { DataState } from './dataState';
import { checkinService } from '../services/checkinService';
import { goalService } from '../services/goalService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { preferencesService } from '../services/preferencesService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import { trainingIntentProfileService } from '../services/trainingIntentProfileService';
import { getLocalDateString } from '../utils/localDate';

export class DecisionComposer {
    /**
     * Compose a complete DailyDecisionInput object from all data sources
     */
    async composeDailyDecisionInput(userId: string, date?: string): Promise<DailyDecisionInput> {
        const targetDate = date || getLocalDateString();
        
        try {
            // Use Promise.allSettled to handle individual service failures
            const results = await Promise.allSettled([
                recoverySnapshotService.getRecoverySnapshotState(userId, targetDate),
                checkinService.getCheckinState(userId, targetDate),
                goalService.getActiveGoalsState(userId),
                trainingSettingsService.getTrainingSettingsState(userId),
                preferencesService.getPreferencesState(userId),
                trainingIntentProfileService.getProfileState(userId),
            ] as const);

            const unavailable = <T>(operation: string): DataState<T> => ({ status: 'UNAVAILABLE', operation, retryable: true });
            const recoveryState: DataState<DailyRecoverySnapshot> = results[0].status === 'fulfilled'
                ? results[0].value
                : unavailable<DailyRecoverySnapshot>('read recovery snapshot');
            const checkinState: DataState<DailySubjectiveCheckin> = results[1].status === 'fulfilled'
                ? results[1].value
                : unavailable<DailySubjectiveCheckin>('read subjective check-in');
            const recoverySnapshot = recoveryState.status === 'AVAILABLE' ? recoveryState.data : null;
            const subjectiveCheckin = checkinState.status === 'AVAILABLE' ? checkinState.data : null;
            const goalsState = results[2].status === 'fulfilled' ? results[2].value : unavailable<UserGoal[]>('read active goals');
            const activeGoals = goalsState.status === 'AVAILABLE' ? goalsState.data : [];
            const trainingSettingsState = results[3].status === 'fulfilled'
                ? results[3].value
                : unavailable<TrainingSettings>('read training settings');
            if (trainingSettingsState.status !== 'AVAILABLE') {
                throw new Error(trainingSettingsState.status === 'INVALID'
                    ? 'Training settings are invalid. Please review and save them again.'
                    : 'Training settings are temporarily unavailable. Please retry.');
            }
            const trainingSettings = trainingSettingsState.data;
            const preferencesState = results[4].status === 'fulfilled' ? results[4].value : unavailable<UserPreferences>('read preferences');
            const preferences = preferencesState.status === 'AVAILABLE' ? preferencesState.data : null;
            const trainingIntentProfileState = results[5].status === 'fulfilled'
                ? results[5].value
                : unavailable<TrainingIntentProfile>('read training intent profile');
            const trainingIntentProfile = trainingIntentProfileState.status === 'AVAILABLE' ? trainingIntentProfileState.data : null;
            const sourceStates = {
                recoverySnapshot: recoveryState.status === 'AVAILABLE' ? { status: 'AVAILABLE' as const, revision: recoveryState.revision } : recoveryState,
                subjectiveCheckin: checkinState.status === 'AVAILABLE' ? { status: 'AVAILABLE' as const, revision: checkinState.revision } : checkinState,
                activeGoals: goalsState.status === 'AVAILABLE' ? { status: 'AVAILABLE' as const, revision: goalsState.revision } : goalsState,
                trainingSettings: { status: 'AVAILABLE' as const, revision: trainingSettingsState.revision },
                preferences: preferencesState.status === 'AVAILABLE'
                    ? { status: 'AVAILABLE' as const, revision: preferencesState.revision }
                    : preferencesState,
                trainingIntentProfile: trainingIntentProfileState.status === 'AVAILABLE'
                    ? { status: 'AVAILABLE' as const, revision: trainingIntentProfileState.revision }
                    : trainingIntentProfileState,
            };

            // Log permission errors for debugging
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    const serviceNames = ['recoverySnapshot', 'checkinService', 'goalService', 'trainingSettingsService', 'preferencesService', 'trainingIntentProfileService'];
                    console.warn(`${serviceNames[index]} failed:`, result.reason);
                    
                    // If it's a permission error, provide a helpful message
                    if (result.reason instanceof Error && result.reason.message.includes('Missing or insufficient permissions')) {
                        console.warn(`Permission denied for ${serviceNames[index]}. This may be due to missing Firebase security rules.`);
                    }
                }
            });

            // Compute data quality flags
            const dataQuality = {
                hasRecoverySnapshot: recoverySnapshot !== null,
                hasSubjectiveCheckin: subjectiveCheckin !== null,
                subjectiveCheckinComplete: subjectiveCheckin?.dataQuality.isComplete ?? false,
                profileReady: preferences !== null
            };

            // Compose the final decision input
            const decisionInput: DailyDecisionInput = {
                userId,
                date: targetDate,
                recoverySnapshot,
                subjectiveCheckin,
                activeGoals,
                trainingSettings,
                preferences,
                trainingIntentProfile,
                sourceStates,
                dataQuality
            };

            return decisionInput;
        } catch (error) {
            console.error('Error composing daily decision input:', error);
            throw error;
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
                const dateStr = getLocalDateString(d);
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
        const today = getLocalDateString();
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
            } else if (!input.dataQuality.subjectiveCheckinComplete) {
                missingItems.push('Complete daily check-in (some fields left unanswered)');
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
            trainingSettings: boolean;
        };
    }> {
        try {
            const input = await this.composeDailyDecisionInput(userId, date);
            
            const details = {
                recoverySnapshot: input.dataQuality.hasRecoverySnapshot,
                subjectiveCheckin: input.dataQuality.hasSubjectiveCheckin,
                preferences: input.dataQuality.profileReady,
                goals: input.activeGoals.length > 0,
                trainingSettings: input.trainingSettings.userId === input.userId
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

        if (input.trainingSettings.userId !== input.userId) errors.push('Training settings userId mismatch');
        if (input.trainingSettings.schemaVersion !== 2) errors.push('Unsupported training settings schema');

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
        configuredEquipmentCount: number;
        activeGuardrailsCount: number;
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

            const configuredEquipmentCount = Object.values(input.trainingSettings.equipment).filter(Boolean).length;
            const activeGuardrailsCount = Object.values(input.trainingSettings.guardrails).filter(Boolean).length;

            return {
                hasData: input.dataQuality.hasRecoverySnapshot || input.dataQuality.hasSubjectiveCheckin,
                readinessScore,
                timeAvailable: input.subjectiveCheckin?.availability.timeAvailableMin ?? undefined,
                activeGoalsCount: input.activeGoals.length,
                configuredEquipmentCount,
                activeGuardrailsCount,
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
    (window as unknown as Record<string, unknown>).__DEBUG_DECISION_INPUT__ = async (userId?: string, date?: string) => {
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
