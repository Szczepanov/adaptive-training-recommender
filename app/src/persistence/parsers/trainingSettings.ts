import type { BodyRegion, SessionTemplate, TrainingSettings } from '../../engine/models';
import { CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION, isSupportedTrainingSettingsSchemaVersion } from '../../engine/trainingSettingsSchema';
import { isValidDate } from '../../engine/validation';

const requiredEquipmentKeys = ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike', 'pullup_bar'] as const;
const additiveEquipmentKeys = ['outdoor_bike', 'swim_access'] as const;
const guardrailKeys = ['avoid_high_impact', 'avoid_heavy_lower_body', 'avoid_overhead_pressing', 'avoid_heavy_spinal_loading'] as const;
const validBodyRegions = ['knee', 'achilles', 'ankle', 'calf', 'hamstring', 'quadriceps', 'adductor_groin', 'hip', 'lower_back', 'shoulder', 'elbow', 'wrist'] as const;
const validModalities: SessionTemplate['modality'][] = ['Running', 'Cycling', 'Swimming', 'Walking', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'];

function isDuration(value: unknown): value is number | null {
    return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1440);
}

/** Parses persisted settings without importing the Firestore-backed settings service. */
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
        for (const injury of data.injuries) {
            if (!injury || typeof injury !== 'object') return null;
            const item = injury as Record<string, unknown>;
            if (typeof item.severity !== 'string' || !['monitor', 'limit', 'exclude'].includes(item.severity)) return null;
            if (item.region !== undefined && (typeof item.region !== 'string' || !validBodyRegions.includes(item.region as BodyRegion))) return null;
            if (item.reviewBy !== undefined && (typeof item.reviewBy !== 'string' || !isValidDate(item.reviewBy))) return null;
            if (item.note !== undefined && typeof item.note !== 'string') return null;
            if (item.restrictedModalities !== undefined
                && (!Array.isArray(item.restrictedModalities)
                    || !item.restrictedModalities.every(modality => typeof modality === 'string' && validModalities.includes(modality as SessionTemplate['modality'])))) return null;
        }
    }

    if (data.recoveryBootstrapDate !== undefined && data.recoveryBootstrapDate !== null
        && (typeof data.recoveryBootstrapDate !== 'string' || !isValidDate(data.recoveryBootstrapDate))) return null;

    return {
        ...(data as unknown as TrainingSettings),
        schemaVersion: CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION,
        equipment: {
            free_weights: equipment.free_weights as boolean,
            cable_machine: equipment.cable_machine as boolean,
            treadmill: equipment.treadmill as boolean,
            indoor_bike: equipment.indoor_bike as boolean,
            pullup_bar: equipment.pullup_bar as boolean,
            outdoor_bike: typeof equipment.outdoor_bike === 'boolean' ? equipment.outdoor_bike : false,
            swim_access: typeof equipment.swim_access === 'boolean' ? equipment.swim_access : false,
        },
        injuries: (data.injuries as TrainingSettings['injuries']) ?? [],
        ...(data.recoveryBootstrapDate !== undefined ? { recoveryBootstrapDate: data.recoveryBootstrapDate as string | null } : {}),
    };
}
