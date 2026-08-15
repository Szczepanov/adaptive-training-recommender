export const CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION = 3 as const;
export const SUPPORTED_TRAINING_SETTINGS_SCHEMA_VERSIONS = [2, CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION] as const;

export type SupportedTrainingSettingsSchemaVersion = typeof SUPPORTED_TRAINING_SETTINGS_SCHEMA_VERSIONS[number];

export function isSupportedTrainingSettingsSchemaVersion(value: unknown): value is SupportedTrainingSettingsSchemaVersion {
    return typeof value === 'number'
        && SUPPORTED_TRAINING_SETTINGS_SCHEMA_VERSIONS.some(version => version === value);
}
