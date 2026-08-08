import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { BodyRegion, TrainingSettings, UserConstraint } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { constraintService } from './constraintService';
import { getErrorCode } from '../utils/errors';

export type TrainingSettingsUpdate = {
    equipment?: Partial<TrainingSettings['equipment']>;
    guardrails?: Partial<TrainingSettings['guardrails']>;
    injuries?: TrainingSettings['injuries'];
    defaults?: Partial<TrainingSettings['defaults']>;
    preferences?: Partial<TrainingSettings['preferences']>;
    migration?: Partial<TrainingSettings['migration']>;
};

const SETTINGS_SCHEMA_VERSION = 3 as const;
const COLLECTION = 'trainingSettings';
const DOCUMENT = 'profile';
const equipmentKeys = ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar'] as const;
const guardrailKeys = ['avoid_high_impact', 'avoid_heavy_lower_body', 'avoid_overhead_pressing', 'avoid_heavy_spinal_loading'] as const;
const validBodyRegions = ['knee', 'achilles', 'ankle', 'calf', 'hamstring', 'quadriceps', 'adductor_groin', 'hip', 'lower_back', 'shoulder', 'elbow', 'wrist'] as const;

function timestamp(): string {
    return new Date().toISOString();
}

export function createDefaultTrainingSettings(userId: string, now = timestamp()): TrainingSettings {
    return {
        userId,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        equipment: { free_weights: false, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false },
        guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
        injuries: [],
        defaults: { weekdayMaxMinutes: null, weekendMaxMinutes: null, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: now,
        updatedAt: now,
    };
}

function isDuration(value: unknown): value is number | null {
    return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1440);
}

/** Parses storage data defensively so malformed user data never enters the engine. Accepts schema 2 or 3. */
export function parseTrainingSettings(raw: unknown, userId: string): TrainingSettings | null {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as Record<string, unknown>;
    if (data.userId !== userId || (data.schemaVersion !== 2 && data.schemaVersion !== 3)) return null;
    const equipment = data.equipment as Record<string, unknown> | undefined;
    const guardrails = data.guardrails as Record<string, unknown> | undefined;
    const defaults = data.defaults as Record<string, unknown> | undefined;
    const preferences = data.preferences as Record<string, unknown> | undefined;
    const migration = data.migration as Record<string, unknown> | undefined;
    if (!equipment || !guardrails || !defaults || !preferences || !migration) return null;
    if (!equipmentKeys.every(key => typeof equipment[key] === 'boolean')) return null;
    if (!guardrailKeys.every(key => typeof guardrails[key] === 'boolean')) return null;
    if (!isDuration(defaults.weekdayMaxMinutes) || !isDuration(defaults.weekendMaxMinutes)) return null;
    if (!['indoor', 'outdoor', 'either'].includes(String(defaults.environment))) return null;
    if (typeof preferences.preferActiveRecovery !== 'boolean') return null;
    if (typeof migration.legacyReviewed !== 'boolean' || !(typeof migration.migratedAt === 'string' || migration.migratedAt === null)) return null;
    if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') return null;

    if (data.injuries !== undefined) {
        if (!Array.isArray(data.injuries)) return null;
        for (const inj of data.injuries) {
            if (!inj || typeof inj !== 'object') return null;
            const item = inj as Record<string, unknown>;
            if (typeof item.severity !== 'string' || !['monitor', 'limit', 'exclude'].includes(item.severity)) return null;
            if (item.region !== undefined && (typeof item.region !== 'string' || !validBodyRegions.includes(item.region as BodyRegion))) return null;
            if (item.reviewBy !== undefined && typeof item.reviewBy !== 'string') return null;
        }
    }

    return {
        ...(data as unknown as TrainingSettings),
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        injuries: (data.injuries as TrainingSettings['injuries']) ?? [],
    };
}

/** Converts only unambiguous legacy data. The legacy boolean toggles are intentionally
 * not inferred because the old UI changed isActive while the engine read value. */
export function migrateLegacyConstraints(userId: string, constraints: UserConstraint[], now = timestamp()): TrainingSettings {
    const result = createDefaultTrainingSettings(userId, now);
    if (constraints.length === 0) return result;

    const active = new Set(constraints.filter(c => c.isActive).map(c => c.key));
    const candidateLimits: number[] = [];
    const maxTime = constraints.find(c => c.key === 'max_time_minutes' && c.isActive && typeof c.value === 'number');
    if (typeof maxTime?.value === 'number') candidateLimits.push(maxTime.value);
    if (active.has('max_45_min_weekday')) candidateLimits.push(45);
    if (active.has('max_60_min_weekday')) candidateLimits.push(60);
    if (candidateLimits.length > 0) result.defaults.weekdayMaxMinutes = Math.min(...candidateLimits);

    result.preferences.preferActiveRecovery = active.has('prefer_active_recovery');
    result.migration = { legacyReviewed: false, migratedAt: now };
    return result;
}

function mergeSettings(current: TrainingSettings, update: TrainingSettingsUpdate): TrainingSettings {
    const next: TrainingSettings = {
        ...current,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        equipment: { ...current.equipment, ...update.equipment },
        guardrails: { ...current.guardrails, ...update.guardrails },
        injuries: update.injuries !== undefined ? update.injuries : current.injuries ?? [],
        defaults: { ...current.defaults, ...update.defaults },
        preferences: { ...current.preferences, ...update.preferences },
        migration: { ...current.migration, ...update.migration },
        updatedAt: timestamp(),
    };
    if (!parseTrainingSettings(next, current.userId)) throw new Error('Invalid training settings update');
    return next;
}

export class TrainingSettingsService {
    private ref(userId: string) {
        return doc(getDb(), 'users', userId, COLLECTION, DOCUMENT);
    }

    async getTrainingSettingsState(userId: string): Promise<DataState<TrainingSettings>> {
        try {
            const snapshot = await getDoc(this.ref(userId));
            if (snapshot.exists()) {
                const parsed = parseTrainingSettings(snapshot.data(), userId);
                if (!parsed) {
                    return { status: 'INVALID', issues: [{ code: 'schema-validation-failed', documentPath: `users/${userId}/${COLLECTION}/${DOCUMENT}` }] };
                }
                return { status: 'AVAILABLE', data: parsed, revision: parsed.updatedAt };
            }

            // A missing settings profile is the documented first-run migration path,
            // not an unavailable source. Its write is still subject to Firestore rules.
            const legacy = await constraintService.listConstraints(userId);
            const migrated = migrateLegacyConstraints(userId, legacy);
            await setDoc(this.ref(userId), migrated);
            return { status: 'AVAILABLE', data: migrated, revision: migrated.updatedAt };
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read training settings',
                retryable: getErrorCode(error) !== 'permission-denied',
            };
        }
    }

    async getTrainingSettings(userId: string): Promise<TrainingSettings> {
        const state = await this.getTrainingSettingsState(userId);
        if (state.status === 'AVAILABLE') return state.data;
        if (state.status === 'INVALID') throw new Error('Training settings are invalid. Please review and save them again.');
        throw new Error('Training settings are temporarily unavailable. Please retry.');
    }

    async updateTrainingSettings(userId: string, update: TrainingSettingsUpdate): Promise<TrainingSettings> {
        const updated = mergeSettings(await this.getTrainingSettings(userId), update);
        await setDoc(this.ref(userId), updated);
        return updated;
    }
}

export const trainingSettingsService = new TrainingSettingsService();
