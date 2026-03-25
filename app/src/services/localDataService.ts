import type { DailyRecoverySnapshot } from '../engine/models';

/**
 * Local data service for reading from raw_cache.json
 * This is a fallback for development when Garmin data isn't synced to Firestore
 */
export class LocalDataService {
    private cacheData: Record<string, any> | null = null;

    /**
     * Load the raw cache file
     */
    private async loadCacheData(): Promise<Record<string, any>> {
        if (this.cacheData !== null) {
            return this.cacheData;
        }

        try {
            // In development, we can import the JSON file directly
            const response = await fetch('/raw_cache.json');
            if (!response.ok) {
                throw new Error('Failed to load cache file');
            }
            this.cacheData = await response.json();
            return this.cacheData || {};
        } catch (error) {
            console.error('Error loading local cache:', error);
            return {};
        }
    }

    /**
     * Get recovery snapshot from local cache
     */
    async getRecoverySnapshot(date: string, userId?: string): Promise<DailyRecoverySnapshot | null> {
        try {
            const cache = await this.loadCacheData();
            const rawData = cache[date];

            if (!rawData) {
                return null;
            }

            // Transform the raw data to match DailyRecoverySnapshot format
            const snapshot: DailyRecoverySnapshot = {
                userId: userId || 'local-user',
                date,
                source: {
                    garminSyncedAt: new Date().toISOString(),
                    sourceSchemaVersion: 1
                },
                raw: {
                    sleepScore: rawData.sleepScore || null,
                    sleepDurationSec: rawData.sleepDurationSec || null,
                    restingHr: rawData.restingHr || null,
                    hrvOvernightAvg: rawData.hrvOvernightAvg || null,
                    hrvStatus: rawData.hrvStatus || null,
                    respirationAvg: rawData.respirationAvg || null,
                    bodyBatteryWake: rawData.bodyBatteryWake || null,
                    bodyBatteryChange: rawData.bodyBatteryChange || null,
                    totalSteps: rawData.totalSteps || null,
                    last3DaysHardSessionsCount: rawData.last3DaysHardSessionsCount || 0,
                    yesterdayTraining: rawData.yesterdayTraining || null
                },
                derived: {
                    baselineComputationVersion: 1,
                    sleepScore7dAvg: null, // Would need to be computed
                    sleepScore28dAvg: null, // Would need to be computed
                    restingHr7dAvg: null, // Would need to be computed
                    restingHr28dAvg: null, // Would need to be computed
                    hrv7dAvg: null, // Would need to be computed
                    hrv28dAvg: null, // Would need to be computed
                    respiration7dAvg: null, // Would need to be computed
                    respiration28dAvg: null, // Would need to be computed
                    deltas: {
                        sleepScoreVs7d: null,
                        sleepScoreVs28d: null,
                        restingHrVs7d: null,
                        restingHrVs28d: null,
                        hrvVs7d: null,
                        hrvVs28d: null,
                        respirationVs7d: null,
                        respirationVs28d: null
                    }
                },
                dataQuality: {
                    sleepScoreAvailable: rawData.sleepScore !== null && rawData.sleepScore !== undefined,
                    restingHrAvailable: rawData.restingHr !== null && rawData.restingHr !== undefined,
                    hrvAvailable: rawData.hrvOvernightAvg !== null && rawData.hrvOvernightAvg !== undefined,
                    baseline7dReady: false, // Would need computation
                    baseline28dReady: false // Would need computation
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            return snapshot;
        } catch (error) {
            console.error('Error getting recovery snapshot from local cache:', error);
            return null;
        }
    }

    /**
     * Get available dates in the cache
     */
    async getAvailableDates(): Promise<string[]> {
        try {
            const cache = await this.loadCacheData();
            return Object.keys(cache).sort().reverse(); // Most recent first
        } catch (error) {
            console.error('Error getting available dates:', error);
            return [];
        }
    }
}

// Export singleton instance
export const localDataService = new LocalDataService();
