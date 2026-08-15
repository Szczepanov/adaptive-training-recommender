import { describe, expect, it } from 'vitest';
import { deriveExternalSessionProfiles, toGateableSession } from './externalSessionProfiles';
import { DEFAULT_COST_BY_MODALITY } from './completedTraining';
import type { ExternalPlanSession, ExternalSessionIntensity, ExternalSessionModality } from './models';

function session(modality: ExternalSessionModality, intensity: ExternalSessionIntensity, overrides: Partial<ExternalPlanSession> = {}): ExternalPlanSession {
    return {
        id: 's1', title: 'Session', priority: 'key',
        placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' },
        gating: { modality, intensity, durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
        prescription: { summary: 'x' },
        ...overrides,
    };
}

describe('deriveExternalSessionProfiles', () => {
    it('reuses the same table that costs an unmatched Garmin activity (D-EXTTIER)', () => {
        const derived = deriveExternalSessionProfiles(session('cycling', 'hard'));
        expect(derived.costProfile).toEqual(DEFAULT_COST_BY_MODALITY.Cycling.hard);
        expect(derived.systemicCost).toBe(DEFAULT_COST_BY_MODALITY.Cycling.hard.systemic);
    });

    it('collapses the two extra authored intensities conservatively', () => {
        // recovery is never costed below the easy row, max never below the hard row.
        expect(deriveExternalSessionProfiles(session('cycling', 'recovery')).costProfile)
            .toEqual(DEFAULT_COST_BY_MODALITY.Cycling.easy);
        expect(deriveExternalSessionProfiles(session('cycling', 'max')).costProfile)
            .toEqual(DEFAULT_COST_BY_MODALITY.Cycling.hard);
    });

    it('increases systemic cost monotonically with authored intensity', () => {
        const order: ExternalSessionIntensity[] = ['recovery', 'easy', 'moderate', 'hard', 'max'];
        const costs = order.map(intensity => deriveExternalSessionProfiles(session('running', intensity)).systemicCost);
        for (let index = 1; index < costs.length; index++) {
            expect(costs[index]).toBeGreaterThanOrEqual(costs[index - 1]);
        }
    });

    it('maps every authored modality to a real engine modality', () => {
        const modalities: ExternalSessionModality[] = ['cycling', 'running', 'strength', 'field', 'mobility', 'cross_training'];
        for (const modality of modalities) {
            const gateable = toGateableSession(session(modality, 'moderate'));
            expect(DEFAULT_COST_BY_MODALITY[gateable.modality], modality).toBeDefined();
            expect(gateable.modality).not.toBe('None');
        }
    });
});

describe('toGateableSession', () => {
    it('carries the athlete-facing constraints the gates read', () => {
        const gateable = toGateableSession(session('strength', 'moderate', {
            gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 45, environment: 'indoor', equipment: ['free_weights'] },
        }));
        expect(gateable).toMatchObject({
            durationMin: 30, durationMax: 45, environment: 'indoor',
            requiredEquipment: ['free_weights'], modality: 'Strength',
        });
    });

    it('claims no safety tags, because a plan cannot vouch for which guardrails it trips', () => {
        // Guardrails act through the athlete's own restricted modalities and categories,
        // which are athlete-owned, rather than through a tag the plan asserts about itself.
        expect(toGateableSession(session('running', 'hard')).safetyTags).toEqual([]);
    });

    it('assigns a recovery-intensity session to a recovery category', () => {
        expect(toGateableSession(session('cycling', 'recovery')).category).toBe('Mobility/Recovery');
        expect(toGateableSession(session('cycling', 'hard')).category).toBe('Hard Endurance');
    });
});
