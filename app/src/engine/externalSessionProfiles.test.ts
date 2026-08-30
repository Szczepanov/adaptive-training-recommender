import { describe, expect, it } from 'vitest';
import {
    deriveExternalSessionProfiles, externalEventAsFixedActivity, toGateableSession,
    externalSessionDisplaySummary, externalSessionDisplayPrescription, sessionDefinitionToDisplayPrescription,
} from './externalSessionProfiles';
import { DEFAULT_COST_BY_MODALITY } from './completedTraining';
import type { ExternalPlanSession, ExternalSessionIntensity, ExternalSessionModality } from './models';
import type { ExternalPlanSessionV2 } from '../sessions/externalPlanV2';
import type { SessionDefinition } from '../sessions/models';

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
        const modalities: ExternalSessionModality[] = ['cycling', 'running', 'swimming', 'strength', 'field', 'mobility', 'cross_training'];
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

describe('display helpers (M3.6: v1 and v2 sessions render identically)', () => {
    const v2Definition: SessionDefinition = {
        schemaVersion: 1, id: 'w1', revision: 1, title: 'V2 Session', summary: 'A v2 session summary.', intent: 'training',
        blocks: [{
            id: 'block-main', role: 'main', executionMode: 'sequential',
            steps: [{
                id: 'step-1', kind: 'exercise', title: 'Threshold interval',
                exerciseRef: { kind: 'unresolved_free_text', name: 'Threshold interval' },
                dose: { kind: 'duration', sets: 3, seconds: 600 },
                rest: 120,
                notes: 'Hold steady power.',
            }],
        }],
    };
    const v2Session: ExternalPlanSessionV2 = {
        id: 's1', title: 'Session', priority: 'key',
        placement: { week: 1, flexibility: 'any_day', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
        definition: v2Definition,
    };

    it('externalSessionDisplaySummary falls back to title when a v2 definition has no summary, and reads prescription.summary for v1', () => {
        expect(externalSessionDisplaySummary(session('cycling', 'hard', { prescription: { summary: 'v1 summary' } }))).toBe('v1 summary');
        expect(externalSessionDisplaySummary(v2Session)).toBe('A v2 session summary.');
        expect(externalSessionDisplaySummary({ ...v2Session, definition: { ...v2Definition, summary: undefined } }))
            .toBe('V2 Session');
    });

    it('sessionDefinitionToDisplayPrescription flattens a v2 definition into the v1 flat step shape', () => {
        const prescription = sessionDefinitionToDisplayPrescription(v2Definition);
        expect(prescription.summary).toBe('A v2 session summary.');
        expect(prescription.steps).toHaveLength(1);
        expect(prescription.steps![0]).toMatchObject({
            name: 'Threshold interval', sets: 3, durationSec: 600, recoverySec: 120, notes: 'Hold steady power.',
        });
    });

    it('externalSessionDisplayPrescription dispatches on schema without the caller needing to know which one it has', () => {
        const v1Result = externalSessionDisplayPrescription(session('cycling', 'hard', { prescription: { summary: 'v1', steps: [{ name: 'Warm-up', durationMin: 10 }] } }));
        expect(v1Result.steps).toHaveLength(1);
        const v2Result = externalSessionDisplayPrescription(v2Session);
        expect(v2Result.steps).toHaveLength(1);
        expect(v2Result.steps![0].name).toBe('Threshold interval');
    });
});
