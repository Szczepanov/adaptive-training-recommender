import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { BodyRegion, SessionTemplate, TrainingSettings, UserConstraint } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION, isSupportedTrainingSettingsSchemaVersion } from '../engine/trainingSettingsSchema';
import { constraintService } from './constraintService';
import { getErrorCode } from '../utils/errors';
import { isValidDate } from '../engine/validation';

export type TrainingSettingsUpdate = {
    equipment?: Partial<TrainingSettings['equipment']>;
    guardrails?: Partial<TrainingSettings['guardrails']>;
    injuries?: TrainingSettings['injuries'];
    defaults?: Partial<TrainingSettings['defaults']>;
    preferences?: Partial<TrainingSettings['preferences']>;
    migration?: Partial<TrainingSettings['migration']>;
};

const COLLECTION = 'trainingSettings';
const DOCUMENT = 'profile';
const requiredEquipmentKeys = ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar'] as const;
const additiveEquipmentKeys = ['outdoor_bike', 'swim_access'] as const;
const guardrailKeys = ['avoid_high_impact', 'avoid_heavy_lower_body', 'avoid_overhead_pressing', 'avoid_heavy_spinal_loading'] as const;
const validBodyRegions = ['knee', 'achilles', 'ankle', 'calf', 'hamstring', 'quadriceps', 'adductor_groin', 'hip', 'lower_back', 'shoulder', 'elbow', 'wrist'] as const;
const validModalities: SessionTemplate['modality'][] = ['Running', 'Cycling', 'Swimming', 'Walking', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'];

function timestamp(): string {
    return new Date().toISOString();
}

export function createDefaultTrainingSettings(userId: string, now = timestamp()): TrainingSettings {
    return {
        userId,
        schemaVersion: CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION,
        equipment: { free_weights: false, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false, outdoor_bike: false, swim_access: false },
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

/** Parses storage data defensively so malformed user data never enters the engine. */
export function parseTrainingSettings(raw: unknown, userId: string): TrainingSettings | null {
    if (!raw || typeof raw !== 'object') return null;
    const data = raw as Record<string, unknown>;
    if (data.userId !== userId || !isSupportedTrainingSettingsSchemaVersion(data.schemaVersion)) return null;
    const equipment = data.equipment as Record<string, unknown> | undefined;
    const guardrails = data.guardrails as Record<string, unknown> | undefined;
    const defaults = data.defaults as Record<string, unknown> | undefined;
    const preferences = data.preferences as Record<string, unknown> | undefined;
    const migration = data.migration as Record<string, unknown> | undefined;
    if (!equipment || !guardrails || !defaults || !preferences || !migration) return null;
    if (!requiredEquipmentKeys.every(key => typeof equipment[key] === 'boolean')) return null;
    if (!additiveEquipmentKeys.every(key => equipment[key] === undefined || typeof equipment[key] === 'boolean')) return null;
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
            if (item.reviewBy !== undefined && (typeof item.reviewBy !== 'string' || !isValidDate(item.reviewBy))) return null;
            if (item.note !== undefined && typeof item.note !== 'string') return null;
            if (item.restrictedModalities !== undefined
                && (!Array.isArray(item.restrictedModalities)
                    || !item.restrictedModalities.every(modality => typeof modality === 'string' && validModalities.includes(modality as SessionTemplate['modality'])))) return null;
        }
    }

    if (data.recoveryBootstrapDate !== undefined && data.recoveryBootstrapDate !== null) {
        if (typeof data.recoveryBootstrapDate !== 'string' || !isValidDate(data.recoveryBootstrapDate)) return null;
    }

    return {
        ...(data as unknown as TrainingSettings),
        schemaVersion: CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION,
        equipment: {
            free_weights: equipment.free_weights as boolean,
            cable_machine: equipment.cable_machine as boolean,
            treadmill: equipment.treadmill as boolean,
            indoor_bike: equipment.indoor_bike as boolean,
            pullup_bar: equipment.pullup_bar as boolean,
            // Additive sport-access fields are fail-safe for historical settings: unknown
            // access never becomes permission to prescribe an outdoor ride or pool swim.
            outdoor_bike: typeof equipment.outdoor_bike === 'boolean' ? equipment.outdoor_bike : false,
            swim_access: typeof equipment.swim_access === 'boolean' ? equipment.swim_access : false,
        },
        injuries: (data.injuries as TrainingSettings['injuries']) ?? [],
        ...(data.recoveryBootstrapDate !== undefined ? { recoveryBootstrapDate: data.recoveryBootstrapDate as string | null } : {}),
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

export function mergeSettings(current: TrainingSettings, update: TrainingSettingsUpdate): TrainingSettings {
    const next: TrainingSettings = {
        ...current,
        schemaVersion: CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION,
        equipment: { ...current.equipment, ...update.equipment },
        guardrails: { ...current.guardrails, ...update.guardrails },
        injuries: update.injuries !== undefined ? update.injuries : current.injuries ?? [],
        defaults: { ...current.defaults, ...update.defaults },
        preferences: { ...current.preferences, ...update.preferences },
        migration: { ...current.migration, ...update.migration },
        ...(current.recoveryBootstrapDate !== undefined ? { recoveryBootstrapDate: current.recoveryBootstrapDate } : {}),
        updatedAt: timestamp(),
    };
    if (!parseTrainingSettings(next, current.userId)) throw new Error('Invalid training settings update');
    return next;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function buildPartialRevert<T extends object>(previous: T, update: Partial<T>): Partial<T> | null {
    const revert: Partial<T> = {};
    for (const key of Object.keys(update) as Array<keyof T>) {
        if (!valuesEqual(previous[key], update[key])) {
            revert[key] = previous[key];
        }
    }
    return Object.keys(revert).length > 0 ? revert : null;
}

/**
 * Builds the smallest update that restores the values touched by `update` to
 * their state in `previous`. Keeping the inverse patch field-scoped prevents
 * Undo from overwriting unrelated settings saved after the destructive action.
 * Returns `null` when the requested update would not change anything. Pure: no
 * Firestore IO.
 */
export function buildRevertUpdate(previous: TrainingSettings, update: TrainingSettingsUpdate): TrainingSettingsUpdate | null {
    const revert: TrainingSettingsUpdate = {};

    if (update.equipment) {
        const equipment = buildPartialRevert(previous.equipment, update.equipment);
        if (equipment) revert.equipment = equipment;
    }
    if (update.guardrails) {
        const guardrails = buildPartialRevert(previous.guardrails, update.guardrails);
        if (guardrails) revert.guardrails = guardrails;
    }
    if (update.injuries !== undefined && !valuesEqual(previous.injuries ?? [], update.injuries)) {
        revert.injuries = [...(previous.injuries ?? [])];
    }
    if (update.defaults) {
        const defaults = buildPartialRevert(previous.defaults, update.defaults);
        if (defaults) revert.defaults = defaults;
    }
    if (update.preferences) {
        const preferences = buildPartialRevert(previous.preferences, update.preferences);
        if (preferences) revert.preferences = preferences;
    }
    if (update.migration) {
        const migration = buildPartialRevert(previous.migration, update.migration);
        if (migration) revert.migration = migration;
    }

    return Object.keys(revert).length > 0 ? revert : null;
}

export class TrainingSettingsService {
    private ref(userId: string) {
        return doc(getDb(), 'users', userId, COLLECTION, DOCUMENT);
    }

    /** Strictly read-only: a missing profile is reported `MISSING` rather than migrated
     * into existence. Callers that merely *observe* settings must use this, so that
     * looking at data cannot create it. `getTrainingSettingsState` layers the documented
     * first-run migration on top. */
    async peekTrainingSettingsState(userId: string): Promise<DataState<TrainingSettings>> {
        try {
            const snapshot = await getDoc(this.ref(userId));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const parsed = parseTrainingSettings(snapshot.data(), userId);
            if (!parsed) {
                return { status: 'INVALID', issues: [{ code: 'schema-validation-failed', documentPath: `users/${userId}/${COLLECTION}/${DOCUMENT}` }] };
            }
            return { status: 'AVAILABLE', data: parsed, revision: parsed.updatedAt };
        } catch (error: unknown) {
            return {
                status: 'UNAVAILABLE',
                operation: 'read training settings',
                retryable: getErrorCode(error) !== 'permission-denied',
            };
        }
    }

    async getTrainingSettingsState(userId: string): Promise<DataState<TrainingSettings>> {
        try {
            const existing = await this.peekTrainingSettingsState(userId);
            if (existing.status !== 'MISSING') return existing;

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
        const ref = this.ref(userId);
        return runTransaction(getDb(), async transaction => {
            const snapshot = await transaction.get(ref);
            let current: TrainingSettings;
            if (!snapshot.exists()) {
                const legacy = await constraintService.listConstraints(userId);
                current = migrateLegacyConstraints(userId, legacy);
            } else {
                const parsed = parseTrainingSettings(snapshot.data(), userId);
                if (!parsed) {
                    throw new Error('Training settings are invalid. Please review and save them again.');
                }
                current = parsed;
            }

            const updated = mergeSettings(current, update);
            transaction.set(ref, updated);
            return updated;
        });
    }

    /**
     * Reads existing recovery-policy bootstrap date B or initializes it once to `asOfDate`.
     * The transaction re-reads the latest profile and makes initialization first-writer-wins,
     * so two devices/sessions cannot race and slide the durable epoch (ADR-0038 Work D).
     * Missing profile migration/creation is also handled within the transaction so a delayed
     * initial migration write cannot clobber a committed bootstrap epoch.
     */
    async ensureRecoveryBootstrapDate(userId: string, asOfDate: string): Promise<string> {
        if (!isValidDate(asOfDate)) {
            throw new Error('Cannot initialize recovery bootstrap date: asOfDate is invalid.');
        }

        const ref = this.ref(userId);

        return runTransaction(getDb(), async transaction => {
            const snapshot = await transaction.get(ref);
            let current: TrainingSettings;

            if (!snapshot.exists()) {
                const legacy = await constraintService.listConstraints(userId);
                current = migrateLegacyConstraints(userId, legacy);
            } else {
                const parsed = parseTrainingSettings(snapshot.data(), userId);
                if (!parsed) {
                    throw new Error('Training settings are invalid. Please review and save them again.');
                }
                current = parsed;
            }

            if (current.recoveryBootstrapDate) {
                return current.recoveryBootstrapDate;
            }

            const updated: TrainingSettings = {
                ...current,
                recoveryBootstrapDate: asOfDate,
                updatedAt: timestamp(),
            };
            transaction.set(ref, updated);
            return asOfDate;
        });
    }
}

export const trainingSettingsService = new TrainingSettingsService();
