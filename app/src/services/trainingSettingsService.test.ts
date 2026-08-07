import { describe, expect, it } from 'vitest';
import { migrateLegacyConstraints } from './trainingSettingsService';
import type { UserConstraint } from '../engine/models';

function legacy(key: string, value: UserConstraint['value'], isActive = true): UserConstraint {
    return { userId: 'athlete', key, label: key, valueType: typeof value === 'number' ? 'number' : 'boolean', type: typeof value === 'number' ? 'number' : 'boolean', value, severity: 'hard', isActive, category: 'schedule', displayName: key, description: null, schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

describe('legacy settings migration', () => {
    it('migrates only unambiguous time and preference data and requires review', () => {
        const migrated = migrateLegacyConstraints('athlete', [legacy('has_pull_up_bar', false), legacy('max_60_min_weekday', false), legacy('prefer_active_recovery', false)], '2026-08-07T10:00:00.000Z');
        expect(migrated.equipment.pullup_bar).toBe(false);
        expect(migrated.defaults.weekdayMaxMinutes).toBe(60);
        expect(migrated.preferences.preferActiveRecovery).toBe(true);
        expect(migrated.migration.legacyReviewed).toBe(false);
    });

    it('chooses the safer smaller legacy weekday limit', () => {
        const migrated = migrateLegacyConstraints('athlete', [legacy('max_45_min_weekday', false), legacy('max_time_minutes', 60)], '2026-08-07T10:00:00.000Z');
        expect(migrated.defaults.weekdayMaxMinutes).toBe(45);
    });
});
