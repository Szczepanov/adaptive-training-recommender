import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { TrainingSettings, UserConstraint } from '../engine/models';
import type { DataState } from '../engine/dataState';
import { CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION } from '../engine/trainingSettingsSchema';
import { constraintService } from './constraintService';
import { getErrorCode } from '../utils/errors';
import { isValidDate } from '../engine/validation';
import { parseTrainingSettings } from '../persistence/parsers/trainingSettings';
export { parseTrainingSettings };

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
    private readonly inFlightMigrations = new Map<string, Promise<DataState<TrainingSettings>>>();

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

    private async migrateMissingTrainingSettings(userId: string): Promise<DataState<TrainingSettings>> {
        // A missing settings profile is the documented first-run migration path,
        // not an unavailable source. Re-reading inside a transaction makes initialization
        // first-writer-wins so concurrent sign-in readers (e.g. AuthContext initialization
        // and DecisionComposer) never attempt an update with a mismatched createdAt timestamp
        // or clobber a concurrently committed profile.
        const legacy = await constraintService.listConstraints(userId);
        const ref = this.ref(userId);
        return runTransaction(getDb(), async transaction => {
            const snapshot = await transaction.get(ref);
            if (snapshot.exists()) {
                const parsed = parseTrainingSettings(snapshot.data(), userId);
                if (!parsed) {
                    return {
                        status: 'INVALID' as const,
                        issues: [{ code: 'schema-validation-failed', documentPath: `users/${userId}/${COLLECTION}/${DOCUMENT}` }],
                    };
                }
                return { status: 'AVAILABLE' as const, data: parsed, revision: parsed.updatedAt };
            }

            const migrated = migrateLegacyConstraints(userId, legacy);
            transaction.set(ref, migrated);
            return { status: 'AVAILABLE' as const, data: migrated, revision: migrated.updatedAt };
        });
    }

    async getTrainingSettingsState(userId: string): Promise<DataState<TrainingSettings>> {
        try {
            const existing = await this.peekTrainingSettingsState(userId);
            if (existing.status !== 'MISSING') return existing;

            const existingInFlight = this.inFlightMigrations.get(userId);
            if (existingInFlight) return await existingInFlight;

            const migrationPromise = this.migrateMissingTrainingSettings(userId);
            this.inFlightMigrations.set(userId, migrationPromise);
            try {
                return await migrationPromise;
            } finally {
                if (this.inFlightMigrations.get(userId) === migrationPromise) {
                    this.inFlightMigrations.delete(userId);
                }
            }
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
