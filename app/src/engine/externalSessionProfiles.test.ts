import { describe, expect, it } from 'vitest';
import { deriveExternalSessionProfiles, externalEventAsFixedActivity, toGateableSession } from './externalSessionProfiles';
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
    it('keeps the existing modality/intensity fallback as the base model (D-EXTTIER)', () => {
        const derived = deriveExternalSessionProfiles(session('cycling', 'hard'));
        expect(derived.costProfile.systemic).toBeGreaterThan(0);
        expect(derived.costProfile.systemic).toBeLessThanOrEqual(1);
        expect(DEFAULT_COST_BY_MODALITY.Cycling.hard.systemic)
            .toBeGreaterThan(DEFAULT_COST_BY_MODALITY.Cycling.moderate.systemic);
    });

    it('uses authored duration instead of costing every same-intensity session identically', () => {
        const short = deriveExternalSessionProfiles(session('cycling', 'hard', {
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 30, durationMax: 30, environment: 'either', equipment: [] },
        }));
        const long = deriveExternalSessionProfiles(session('cycling', 'hard', {
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 120, durationMax: 120, environment: 'either', equipment: [] },
        }));

        expect(short.systemicCost).toBeLessThan(long.systemicCost);
        expect(short.stimulusProfile.thresholdPower).toBeLessThan(long.stimulusProfile.thresholdPower);
        expect(long.systemicCost).toBeLessThanOrEqual(1);
        expect(long.stimulusProfile.thresholdPower).toBeLessThanOrEqual(1);
    });

    it('collapses the two extra authored intensities conservatively', () => {
        const recovery = deriveExternalSessionProfiles(session('cycling', 'recovery')).systemicCost;
        const easy = deriveExternalSessionProfiles(session('cycling', 'easy')).systemicCost;
        const hard = deriveExternalSessionProfiles(session('cycling', 'hard')).systemicCost;
        const max = deriveExternalSessionProfiles(session('cycling', 'max')).systemicCost;
        expect(recovery).toBe(easy);
        expect(max).toBe(hard);
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

describe('externalEventAsFixedActivity', () => {
    it('reconciles an imported event onto the existing fixed-activity contract without persisting it', () => {
        const event = session('cycling', 'max', {
            isEvent: true,
            placement: { week: 1, preferredDay: 'sunday', flexibility: 'fixed', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'max', durationMin: 50, durationMax: 60, environment: 'outdoor', equipment: [] },
        });
        const fixed = externalEventAsFixedActivity(event, 'race-block', 2, 'u1', '2026-08-23');

        expect(fixed).toMatchObject({
            id: 'external-event:race-block:2:s1', userId: 'u1', date: '2026-08-23',
            durationMin: 60, fixed: true, environment: 'outdoor', isCompleted: false,
            externalAuthoredIdentity: {
                modality: 'Cycling',
                category: 'Hard Endurance',
                stimulusConfidence: 'inferred',
            },
        });
        expect(fixed?.expectedCost?.systemic).toBeGreaterThan(0);
        expect(fixed?.expectedStimulus?.thresholdPower).toBeGreaterThan(0);
    });

    it('does not turn an ordinary imported training session into a fixed activity', () => {
        expect(externalEventAsFixedActivity(session('cycling', 'hard'), 'block', 1, 'u1', '2026-08-18')).toBeNull();
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

    it('infers safety tags conservatively, because guardrails match nothing else', () => {
        expect(toGateableSession(session('running', 'hard')).safetyTags).toContain('avoid_high_impact');
        expect(toGateableSession(session('field', 'moderate')).safetyTags).toContain('avoid_high_impact');
        expect(toGateableSession(session('cycling', 'hard')).safetyTags).toEqual([]);
    });

    it('tags loaded strength work but leaves easy strength available', () => {
        const loaded = toGateableSession(session('strength', 'hard')).safetyTags;
        expect(loaded).toEqual(expect.arrayContaining(['avoid_heavy_lower_body', 'avoid_overhead_pressing', 'avoid_heavy_spinal_loading']));
        expect(toGateableSession(session('strength', 'easy')).safetyTags).toEqual([]);
    });

    it('assigns a recovery-intensity session to a recovery category', () => {
        expect(toGateableSession(session('cycling', 'recovery')).category).toBe('Mobility/Recovery');
        expect(toGateableSession(session('cycling', 'hard')).category).toBe('Hard Endurance');
    });
});
