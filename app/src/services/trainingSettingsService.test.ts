import { describe, expect, it } from 'vitest';
import { buildRevertUpdate, createDefaultTrainingSettings, mergeSettings, migrateLegacyConstraints, parseTrainingSettings, type TrainingSettingsUpdate } from './trainingSettingsService';
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

describe('training settings storage parsing', () => {
    it('rejects malformed injury constraint fields', () => {
        const base = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const malformedInjuries = [
            { severity: 'limit', reviewBy: '2026-02-30' },
            { severity: 'limit', note: 42 },
            { severity: 'limit', restrictedModalities: 'Running' },
            { severity: 'limit', restrictedModalities: ['Unsupported'] },
        ];

        for (const injury of malformedInjuries) {
            expect(parseTrainingSettings({ ...base, injuries: [injury] }, 'athlete')).toBeNull();
        }
    });

    it('accepts a fully valid injury constraint', () => {
        const base = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const parsed = parseTrainingSettings({
            ...base,
            injuries: [{ region: 'knee', severity: 'limit', reviewBy: '2026-08-31', note: 'Avoid hills', restrictedModalities: ['Running'] }],
        }, 'athlete');
        expect(parsed?.injuries).toHaveLength(1);
    });

    it('accepts both walking and swimming injury restrictions after the multisport merge', () => {
        const base = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const parsed = parseTrainingSettings({
            ...base,
            injuries: [{ severity: 'limit', restrictedModalities: ['Walking', 'Swimming'] }],
        }, 'athlete');
        expect(parsed?.injuries?.[0].restrictedModalities).toEqual(['Walking', 'Swimming']);
    });

    it('accepts valid recoveryBootstrapDate and preserves it', () => {
        const base = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const parsed = parseTrainingSettings({
            ...base,
            recoveryBootstrapDate: '2026-09-01',
        }, 'athlete');
        expect(parsed?.recoveryBootstrapDate).toBe('2026-09-01');
    });

    it('rejects malformed recoveryBootstrapDate', () => {
        const base = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        expect(parseTrainingSettings({ ...base, recoveryBootstrapDate: 'invalid-date' }, 'athlete')).toBeNull();
        expect(parseTrainingSettings({ ...base, recoveryBootstrapDate: 12345 }, 'athlete')).toBeNull();
    });

    it('ensures recoveryBootstrapDate is preserved and cannot be cleared by ordinary settings update', () => {
        const base = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const withBootstrap = { ...base, recoveryBootstrapDate: '2026-09-01' };
        // Even if an update object attempts to inject recoveryBootstrapDate (e.g. from untyped caller)
        const untypedUpdate = { defaults: { weekdayMaxMinutes: 45 }, recoveryBootstrapDate: '2026-09-05' } as unknown as Parameters<typeof mergeSettings>[1];
        const updated = mergeSettings(withBootstrap, untypedUpdate);
        expect(updated.recoveryBootstrapDate).toBe('2026-09-01');

        const clearingUpdate = { defaults: { weekdayMaxMinutes: 30 }, recoveryBootstrapDate: null } as unknown as Parameters<typeof mergeSettings>[1];
        const clearedAttempt = mergeSettings(withBootstrap, clearingUpdate);
        expect(clearedAttempt.recoveryBootstrapDate).toBe('2026-09-01');
    });
});

describe('destructive settings revert (#492)', () => {
    it('builds a field-scoped equipment revert that restores the previous value', () => {
        const previous = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const update: TrainingSettingsUpdate = { equipment: { treadmill: true } };
        const next = mergeSettings(previous, update);
        const revert = buildRevertUpdate(previous, update);
        expect(revert).toEqual({ equipment: { treadmill: false } });
        expect(mergeSettings(next, revert!).equipment.treadmill).toBe(false);
    });

    it('does not clobber a later equipment save when undoing an earlier toggle', () => {
        const previous = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const firstUpdate: TrainingSettingsUpdate = { equipment: { treadmill: true } };
        const revert = buildRevertUpdate(previous, firstUpdate);
        const afterFirst = mergeSettings(previous, firstUpdate);
        const afterLaterSave = mergeSettings(afterFirst, { equipment: { outdoor_bike: true } });
        const restored = mergeSettings(afterLaterSave, revert!);
        expect(restored.equipment.treadmill).toBe(false);
        expect(restored.equipment.outdoor_bike).toBe(true);
    });

    it('builds a guardrail revert only for the avoid flags that changed', () => {
        const previous = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const update: TrainingSettingsUpdate = { guardrails: { avoid_high_impact: true, avoid_heavy_spinal_loading: true } };
        const next = mergeSettings(previous, update);
        const revert = buildRevertUpdate(previous, update);
        expect(revert).toEqual({ guardrails: { avoid_high_impact: false, avoid_heavy_spinal_loading: false } });
        const restored = mergeSettings(next, revert!);
        expect(restored.guardrails.avoid_high_impact).toBe(false);
        expect(restored.guardrails.avoid_heavy_spinal_loading).toBe(false);
    });

    it('reverts an injury-constraint add back to the previous list', () => {
        const previous = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const update: TrainingSettingsUpdate = { injuries: [{ region: 'knee', severity: 'limit' }] };
        const next = mergeSettings(previous, update);
        const revert = buildRevertUpdate(previous, update);
        expect(revert).toEqual({ injuries: [] });
        expect(mergeSettings(next, revert!).injuries).toEqual([]);
    });

    it('reverts an injury-constraint edit back to the previous list', () => {
        const previous = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        const withInjury = mergeSettings(previous, { injuries: [{ region: 'knee', severity: 'monitor' }] });
        const update: TrainingSettingsUpdate = { injuries: [{ region: 'knee', severity: 'exclude' }] };
        const edited = mergeSettings(withInjury, update);
        const revert = buildRevertUpdate(withInjury, update);
        expect(revert).toEqual({ injuries: withInjury.injuries });
        expect(mergeSettings(edited, revert!).injuries).toEqual([{ region: 'knee', severity: 'monitor' }]);
    });

    it('returns null when the requested update would not change anything', () => {
        const previous = createDefaultTrainingSettings('athlete', '2026-08-07T10:00:00.000Z');
        expect(buildRevertUpdate(previous, { equipment: { treadmill: false } })).toBeNull();
    });
});
