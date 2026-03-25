import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserPreferences } from '../engine/models';
import { validatePreferences } from '../engine/validation';

export class PreferencesService {
    private readonly collectionPath = 'preferences';
    private readonly singletonDocId = 'profile';

    /**
     * Get user preferences
     */
    async getPreferences(userId: string): Promise<UserPreferences | null> {
        try {
            const docRef = doc(db, 'users', userId, this.collectionPath, this.singletonDocId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                return docSnap.data() as UserPreferences;
            }
            return null;
        } catch (error) {
            console.error('Error fetching preferences:', error);
            throw error;
        }
    }

    /**
     * Create or update user preferences
     */
    async upsertPreferences(userId: string, prefsData: Partial<UserPreferences>): Promise<UserPreferences> {
        try {
            // Get existing preferences to merge with
            const existingPrefs = await this.getPreferences(userId);
            
            // Prepare data for validation
            const rawData = {
                userId,
                // Use existing values as defaults
                preferredRecoveryStyle: existingPrefs?.preferredRecoveryStyle ?? 'mixed',
                defaultWeekdayTimeMin: existingPrefs?.defaultWeekdayTimeMin ?? 45,
                defaultWeekendTimeMin: existingPrefs?.defaultWeekendTimeMin ?? 60,
                preferredTimeOfDay: existingPrefs?.preferredTimeOfDay ?? 'flexible',
                preferredModalities: existingPrefs?.preferredModalities ?? [],
                avoidedModalities: existingPrefs?.avoidedModalities ?? [],
                explanationVerbosity: existingPrefs?.explanationVerbosity ?? 'detailed',
                preferredUnits: existingPrefs?.preferredUnits ?? {
                    distance: 'km',
                    weight: 'kg',
                    temperature: 'celsius'
                },
                // Override with provided updates
                ...prefsData,
                // Preserve timestamps if they exist
                createdAt: existingPrefs?.createdAt ?? new Date().toISOString()
            };

            // Validate the data
            const validation = validatePreferences(rawData);
            if (!validation.isValid) {
                const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
                throw new Error(`Validation failed: ${errorMessages}`);
            }

            const validatedPrefs = validation.data!;
            
            // Save to Firestore
            const docRef = doc(db, 'users', userId, this.collectionPath, this.singletonDocId);
            await setDoc(docRef, validatedPrefs, { merge: true });

            return validatedPrefs;
        } catch (error) {
            console.error('Error upserting preferences:', error);
            throw error;
        }
    }

    /**
     * Initialize default preferences for a new user
     */
    async initializeDefaultPreferences(userId: string): Promise<UserPreferences> {
        const defaultPrefs: Omit<UserPreferences, 'userId' | 'createdAt' | 'updatedAt'> = {
            preferredRecoveryStyle: 'mixed',
            defaultWeekdayTimeMin: 45,
            defaultWeekendTimeMin: 60,
            preferredTimeOfDay: 'flexible',
            preferredModalities: ['Running', 'Cycling', 'Strength'],
            avoidedModalities: [],
            explanationVerbosity: 'detailed',
            preferredUnits: {
                distance: 'km',
                weight: 'kg',
                temperature: 'celsius'
            }
        };

        return this.upsertPreferences(userId, defaultPrefs);
    }

    /**
     * Update recovery style preference
     */
    async updateRecoveryStyle(userId: string, style: 'passive' | 'active' | 'mixed'): Promise<UserPreferences> {
        return this.upsertPreferences(userId, { preferredRecoveryStyle: style });
    }

    /**
     * Update time preferences
     */
    async updateTimePreferences(
        userId: string,
        weekdayMinutes?: number,
        weekendMinutes?: number,
        timeOfDay?: 'morning' | 'midday' | 'evening' | 'flexible'
    ): Promise<UserPreferences> {
        const updates: Partial<UserPreferences> = {};
        
        if (weekdayMinutes !== undefined) updates.defaultWeekdayTimeMin = weekdayMinutes;
        if (weekendMinutes !== undefined) updates.defaultWeekendTimeMin = weekendMinutes;
        if (timeOfDay !== undefined) updates.preferredTimeOfDay = timeOfDay;
        
        return this.upsertPreferences(userId, updates);
    }

    /**
     * Update modality preferences
     */
    async updateModalityPreferences(
        userId: string,
        preferred?: string[],
        avoided?: string[]
    ): Promise<UserPreferences> {
        const updates: Partial<UserPreferences> = {};
        
        if (preferred !== undefined) updates.preferredModalities = preferred;
        if (avoided !== undefined) updates.avoidedModalities = avoided;
        
        return this.upsertPreferences(userId, updates);
    }

    /**
     * Add a preferred modality
     */
    async addPreferredModality(userId: string, modality: string): Promise<UserPreferences> {
        const prefs = await this.getPreferences(userId);
        if (!prefs) {
            throw new Error('Preferences not found');
        }

        const updated = [...prefs.preferredModalities];
        if (!updated.includes(modality)) {
            updated.push(modality);
        }

        return this.upsertPreferences(userId, { preferredModalities: updated });
    }

    /**
     * Remove a preferred modality
     */
    async removePreferredModality(userId: string, modality: string): Promise<UserPreferences> {
        const prefs = await this.getPreferences(userId);
        if (!prefs) {
            throw new Error('Preferences not found');
        }

        const updated = prefs.preferredModalities.filter(m => m !== modality);
        return this.upsertPreferences(userId, { preferredModalities: updated });
    }

    /**
     * Add an avoided modality
     */
    async addAvoidedModality(userId: string, modality: string): Promise<UserPreferences> {
        const prefs = await this.getPreferences(userId);
        if (!prefs) {
            throw new Error('Preferences not found');
        }

        const updated = [...prefs.avoidedModalities];
        if (!updated.includes(modality)) {
            updated.push(modality);
        }

        return this.upsertPreferences(userId, { avoidedModalities: updated });
    }

    /**
     * Remove an avoided modality
     */
    async removeAvoidedModality(userId: string, modality: string): Promise<UserPreferences> {
        const prefs = await this.getPreferences(userId);
        if (!prefs) {
            throw new Error('Preferences not found');
        }

        const updated = prefs.avoidedModalities.filter(m => m !== modality);
        return this.upsertPreferences(userId, { avoidedModalities: updated });
    }

    /**
     * Update explanation verbosity
     */
    async updateExplanationVerbosity(
        userId: string,
        verbosity: 'brief' | 'detailed' | 'technical'
    ): Promise<UserPreferences> {
        return this.upsertPreferences(userId, { explanationVerbosity: verbosity });
    }

    /**
     * Update unit preferences
     */
    async updateUnitPreferences(
        userId: string,
        units: {
            distance?: 'km' | 'miles';
            weight?: 'kg' | 'lbs';
            temperature?: 'celsius' | 'fahrenheit';
        }
    ): Promise<UserPreferences> {
        const prefs = await this.getPreferences(userId);
        if (!prefs) {
            throw new Error('Preferences not found');
        }

        const updatedUnits = {
            ...prefs.preferredUnits,
            ...units
        };

        return this.upsertPreferences(userId, { preferredUnits: updatedUnits });
    }

    /**
     * Check if preferences exist for a user
     */
    async preferencesExist(userId: string): Promise<boolean> {
        try {
            const prefs = await this.getPreferences(userId);
            return prefs !== null;
        } catch (error) {
            console.error('Error checking if preferences exist:', error);
            return false;
        }
    }

    /**
     * Get a summary of preferences for dashboard display
     */
    async getPreferencesSummary(userId: string): Promise<{
        hasPreferences: boolean;
        recoveryStyle: string | null;
        defaultTimeRange: string;
        preferredModalitiesCount: number;
        avoidedModalitiesCount: number;
        explanationVerbosity: string | null;
        units: {
            distance: string;
            weight: string;
            temperature: string;
        } | null;
    }> {
        try {
            const prefs = await this.getPreferences(userId);
            
            if (!prefs) {
                return {
                    hasPreferences: false,
                    recoveryStyle: null,
                    defaultTimeRange: 'Not set',
                    preferredModalitiesCount: 0,
                    avoidedModalitiesCount: 0,
                    explanationVerbosity: null,
                    units: null
                };
            }

            return {
                hasPreferences: true,
                recoveryStyle: prefs.preferredRecoveryStyle,
                defaultTimeRange: `${prefs.defaultWeekdayTimeMin}-${prefs.defaultWeekendTimeMin} min`,
                preferredModalitiesCount: prefs.preferredModalities.length,
                avoidedModalitiesCount: prefs.avoidedModalities.length,
                explanationVerbosity: prefs.explanationVerbosity,
                units: prefs.preferredUnits
            };
        } catch (error) {
            console.error('Error getting preferences summary:', error);
            throw error;
        }
    }

    /**
     * Create default preferences for a new user
     */
    async createDefaultPreferences(userId: string): Promise<UserPreferences> {
        try {
            const defaultPreferences: Omit<UserPreferences, 'userId' | 'createdAt' | 'updatedAt'> = {
                // Recovery preferences
                preferredRecoveryStyle: 'mixed',
                
                // Time preferences
                defaultWeekdayTimeMin: 45,
                defaultWeekendTimeMin: 60,
                preferredTimeOfDay: 'flexible',
                
                // Modality preferences
                preferredModalities: [],
                avoidedModalities: [],
                
                // UI/Explanation preferences
                explanationVerbosity: 'detailed',
                
                // Metric preferences
                preferredUnits: {
                    distance: 'km',
                    weight: 'kg',
                    temperature: 'celsius'
                }
            };

            return this.upsertPreferences(userId, defaultPreferences);
        } catch (error) {
            console.error('Error creating default preferences:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const preferencesService = new PreferencesService();
