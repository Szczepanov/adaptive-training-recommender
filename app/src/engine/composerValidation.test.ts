import { describe, expect, it } from 'vitest';
import type { DailyDecisionInput } from './models';
import { DecisionComposer } from './composer';
import { CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION } from './trainingSettingsSchema';
import { createDefaultTrainingSettings } from '../services/trainingSettingsService';

function decisionInput(schemaVersion: number): DailyDecisionInput {
    return {
        userId: 'athlete',
        date: '2026-08-15',
        recoverySnapshot: null,
        subjectiveCheckin: null,
        activeGoals: [],
        trainingSettings: {
            ...createDefaultTrainingSettings('athlete', '2026-08-15T00:00:00.000Z'),
            schemaVersion,
        },
        preferences: null,
        trainingIntentProfile: null,
        dataQuality: {
            hasRecoverySnapshot: false,
            hasSubjectiveCheckin: false,
            subjectiveCheckinComplete: false,
            profileReady: false,
        },
    } as DailyDecisionInput;
}

describe('DecisionComposer decision-input validation', () => {
    it('accepts both the current and supported legacy training-settings schemas', async () => {
        const composer = new DecisionComposer();

        await expect(composer.validateDecisionInput(decisionInput(CURRENT_TRAINING_SETTINGS_SCHEMA_VERSION)))
            .resolves.toEqual({ isValid: true, errors: [] });
        await expect(composer.validateDecisionInput(decisionInput(2)))
            .resolves.toEqual({ isValid: true, errors: [] });
    });

    it('rejects a training-settings schema outside the shared compatibility set', async () => {
        const result = await new DecisionComposer().validateDecisionInput(decisionInput(99));

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Unsupported training settings schema');
    });
});
