import { doc, getDoc, setDoc, type WriteBatch } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { StrengthSession, UserPreferences } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { validatePreferences } from '../engine/validation';
import { deriveOneRepMaxUpdatesForSession, type OneRepMaxDerivationOutcome } from '../workouts/oneRepMaxWriteback';

export class PreferencesService {
    private readonly collectionPath = 'preferences';
    private readonly singletonDocId = 'profile';

    /**
     * Get user preferences
     */
    async getPreferencesState(userId: string): Promise<DataState<UserPreferences>> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, this.singletonDocId);
            const docSnap = await getDoc(docRef);
            if (!docSnap.exists()) return { status: 'MISSING' };
            const validation = validatePreferences(docSnap.data());
            if (!validation.isValid || !validation.data || validation.data.userId !== userId) {
                return { status: 'INVALID', issues: [{ code: 'schema-validation-failed', documentPath: `users/${userId}/${this.collectionPath}/${this.singletonDocId}` }] };
            }
            return { status: 'AVAILABLE', data: validation.data, revision: validation.data.updatedAt || null };
        } catch {
            return { status: 'UNAVAILABLE', operation: 'read preferences', retryable: true };
        }
    }

    async getPreferences(userId: string): Promise<UserPreferences | null> {
        try {
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, this.singletonDocId);
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
    async upsertPreferences(userId: string, prefsData: Partial<UserPreferences>, existingPrefsArg?: UserPreferences | null, batch?: WriteBatch): Promise<UserPreferences> {
        try {
            // Get existing preferences to merge with
            const existingPrefs = existingPrefsArg !== undefined ? existingPrefsArg : await this.getPreferences(userId);
            
            // Prepare data for validation
            const rawData = {
                userId,
                // Use existing values as defaults
                preferredRecoveryStyle: existingPrefs?.preferredRecoveryStyle ?? 'mixed',
                defaultWeekdayTimeMin: existingPrefs?.defaultWeekdayTimeMin ?? 45,
                defaultWeekendTimeMin: existingPrefs?.defaultWeekendTimeMin ?? 60,
                preferredTimeOfDay: existingPrefs?.preferredTimeOfDay ?? 'flexible',
                preferredModalities: existingPrefs?.preferredModalities ?? [],
                deprioritizedModalities: existingPrefs?.deprioritizedModalities ?? [],
                avoidedModalities: existingPrefs?.avoidedModalities ?? [],
                unavailableModalities: existingPrefs?.unavailableModalities ?? [],
                explanationVerbosity: existingPrefs?.explanationVerbosity ?? 'detailed',
                conservativeBias: existingPrefs?.conservativeBias ?? false,
                preferredUnits: existingPrefs?.preferredUnits ?? {
                    distance: 'km',
                    weight: 'kg',
                    temperature: 'celsius'
                },
                performanceProfile: existingPrefs?.performanceProfile,
                schemaVersion: existingPrefs?.schemaVersion ?? 1,
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

            // Save to Firestore. When `batch` is supplied, this write is queued into a
            // caller-owned WriteBatch instead of committed here -- the caller commits once,
            // atomically, alongside whatever other write depends on this one landing too.
            const docRef = doc(getDb(), 'users', userId, this.collectionPath, this.singletonDocId);
            if (batch) {
                batch.set(docRef, validatedPrefs, { merge: true });
            } else {
                await setDoc(docRef, validatedPrefs, { merge: true });
            }

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
            deprioritizedModalities: [],
            avoidedModalities: [],
            unavailableModalities: [],
            explanationVerbosity: 'detailed',
            conservativeBias: false,
            preferredUnits: {
                distance: 'km',
                weight: 'kg',
                temperature: 'celsius'
            },
            schemaVersion: 1
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

        return this.upsertPreferences(userId, { preferredModalities: updated }, prefs);
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
        return this.upsertPreferences(userId, { preferredModalities: updated }, prefs);
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

        return this.upsertPreferences(userId, { avoidedModalities: updated }, prefs);
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
        return this.upsertPreferences(userId, { avoidedModalities: updated }, prefs);
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

        return this.upsertPreferences(userId, { preferredUnits: updatedUnits }, prefs);
    }

    /**
     * Applies S2.2's gauge-aware 1RM write-back (ADR-0021 D-1RMSRC) for every exercise in a
     * completed strength session. Reads the *effective* current value the same way
     * `prescription.ts` does -- `strength.estimated1RmKg` first, falling back to the legacy
     * top-level `estimated1RmKg` -- so a value only ever present in the legacy field is
     * still correctly protected rather than treated as absent. A write is dual-written to
     * both locations (matching how this profile's V2/V3 fields already coexist) so neither
     * reader is left stale, but `estimated1RmSources` is a single shared provenance map --
     * there is exactly one true source per exercise, not one per schema version.
     *
     * Returns every outcome (updated and protected alike) so a caller can show what
     * happened; only the `updated: true` outcomes are actually persisted.
     *
     * Pass `batch` to queue the write into a caller-owned `WriteBatch` (e.g. alongside the
     * execution-completion write) instead of committing it here -- see `upsertPreferences`.
     */
    async applyOneRepMaxDerivations(userId: string, session: StrengthSession, computedAtIso: string = new Date().toISOString(), batch?: WriteBatch): Promise<OneRepMaxDerivationOutcome[]> {
        const prefs = await this.getPreferences(userId);
        const profile = prefs?.performanceProfile;
        const effectiveEstimated1RmKg: Record<string, number> = { ...profile?.estimated1RmKg, ...profile?.strength?.estimated1RmKg };

        const outcomes = deriveOneRepMaxUpdatesForSession(session, effectiveEstimated1RmKg, profile?.estimated1RmSources, computedAtIso);
        const written = outcomes.filter(outcome => outcome.result.updated);
        if (written.length === 0) return outcomes;

        const updatedEstimated1RmKg = { ...profile?.estimated1RmKg };
        const updatedStrengthEstimated1RmKg = { ...profile?.strength?.estimated1RmKg };
        const updatedSources = { ...profile?.estimated1RmSources };
        for (const outcome of written) {
            if (!outcome.result.updated) continue;
            updatedEstimated1RmKg[outcome.exerciseId] = outcome.result.estimatedOneRmKg;
            updatedStrengthEstimated1RmKg[outcome.exerciseId] = outcome.result.estimatedOneRmKg;
            updatedSources[outcome.exerciseId] = { source: outcome.result.source, ...(outcome.result.computedAt ? { computedAt: outcome.result.computedAt } : {}) };
        }

        await this.upsertPreferences(userId, {
            performanceProfile: {
                ...profile,
                estimated1RmKg: updatedEstimated1RmKg,
                estimated1RmSources: updatedSources,
                strength: { ...profile?.strength, estimated1RmKg: updatedStrengthEstimated1RmKg },
            },
        }, prefs, batch);

        return outcomes;
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

    async createDefaultPreferences(userId: string): Promise<UserPreferences> {
        return this.initializeDefaultPreferences(userId);
    }
}

// Export singleton instance
export const preferencesService = new PreferencesService();
