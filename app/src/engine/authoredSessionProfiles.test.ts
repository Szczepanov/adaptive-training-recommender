import { describe, expect, it } from 'vitest';
import { deriveAuthoredSessionEligibility } from './authoredSessionProfiles';
import { toGateableSession } from './externalSessionProfiles';
import type { ExternalPlanSession, ExternalSessionIntensity, ExternalSessionModality } from './models';
import type { ExternalPlanSessionV2 } from '../sessions/externalPlanV2';
import type { SessionDefinition } from '../sessions/models';

import fixture02 from '../sessions/fixtures/02-lower-olympic-variants.json';
import fixture03 from '../sessions/fixtures/03-upper-body-absorption-and-spin.json';

/**
 * M8.1: `deriveAuthoredSessionEligibility` is a default-off measurement candidate, never
 * imported by a production selection path. These tests exercise it directly against the
 * two fixtures the plan names for this exact purpose -- see
 * `simulation/authoredSessionProfilesComparison.test.ts` for the side-by-side comparison
 * against today's coarse adapter.
 */

function v2Session(definition: SessionDefinition, overrides: Partial<ExternalPlanSessionV2['gating']> = {}): ExternalPlanSessionV2 {
    return {
        id: definition.id,
        title: definition.title,
        priority: 'key',
        placement: { week: 1, preferredDay: 'monday', flexibility: 'preferred', ifMissed: 'reschedule_within_week' },
        // A plausible authored coarse guess -- deliberately not tuned to make either
        // adapter look good. It's exactly the kind of gating an athlete's importer would
        // produce without knowing the session's real movement content.
        gating: { modality: 'strength', intensity: 'moderate', durationMin: 45, durationMax: 55, environment: 'either', equipment: [], ...overrides },
        definition,
    };
}

function v1Session(overrides: Partial<ExternalPlanSession> = {}): ExternalPlanSession {
    return {
        id: 'w1-threshold', title: 'Threshold 3x12', priority: 'key',
        placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
        prescription: { summary: '3x12 at threshold.' },
        ...overrides,
    };
}

describe('deriveAuthoredSessionEligibility', () => {
    it('tags real heavy lower-body and axial-spine barbell work (fixture 02: hang power clean / power clean from floor)', () => {
        const candidate = deriveAuthoredSessionEligibility(v2Session(fixture02 as unknown as SessionDefinition));
        expect(candidate.safetyTags).toContain('avoid_heavy_lower_body');
        expect(candidate.safetyTags).toContain('avoid_heavy_spinal_loading');
        expect(candidate.safetyTags).not.toContain('avoid_overhead_pressing');
        expect(candidate.evidenceConfidence).toBe('resolved');
    });

    it('does not claim heavy lower work for an upper-body-only session (fixture 03)', () => {
        const candidate = deriveAuthoredSessionEligibility(v2Session(fixture03 as unknown as SessionDefinition));
        expect(candidate.safetyTags).not.toContain('avoid_heavy_lower_body');
        expect(candidate.safetyTags).not.toContain('avoid_heavy_spinal_loading');
        // A seated dumbbell overhead press is genuinely present -- that tag is correct to
        // keep regardless of load, since the guardrail is about the movement, not its load.
        expect(candidate.safetyTags).toContain('avoid_overhead_pressing');
    });

    it('ignores an optional step\'s movement entirely -- optional steps cannot block the session', () => {
        const heavySquat: SessionDefinition = {
            schemaVersion: 1, id: 'optional-heavy-squat', revision: 1, title: 'Optional heavy squat', intent: 'training',
            blocks: [{
                id: 'block-main', role: 'main', executionMode: 'sequential',
                steps: [{
                    id: 'step-back-squat', kind: 'exercise', optional: true,
                    exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                    dose: { kind: 'repetition', sets: 5, reps: 3 },
                    effort: { kind: 'rpe', target: 9 },
                }],
            }],
        };
        const candidate = deriveAuthoredSessionEligibility(v2Session(heavySquat));
        expect(candidate.safetyTags).not.toContain('avoid_heavy_lower_body');
        expect(candidate.safetyTags).not.toContain('avoid_heavy_spinal_loading');
        expect(candidate.evidenceConfidence).toBe('resolved');
        expect(candidate.unresolvedStepIds).toEqual([]);
    });

    it('falls back to the conservative coarse heuristic and discounts evidence for an unresolved required step', () => {
        const freeText: SessionDefinition = {
            schemaVersion: 1, id: 'unresolved-strength', revision: 1, title: 'Unresolved strength session', intent: 'training',
            blocks: [{
                id: 'block-main', role: 'main', executionMode: 'sequential',
                steps: [{
                    id: 'step-mystery', kind: 'exercise',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Some special calf drill' },
                    dose: { kind: 'repetition', sets: 3, reps: 10 },
                }],
            }],
        };
        const session = v2Session(freeText, { intensity: 'hard' });
        const candidate = deriveAuthoredSessionEligibility(session);
        expect(candidate.evidenceConfidence).toBe('discounted');
        expect(candidate.unresolvedStepIds).toEqual(['step-mystery']);
        // Falls back to the exact same conservative tags production already trusts for a
        // hard strength session -- unresolved content never makes the candidate *safer*
        // than today's adapter, only ever as conservative.
        const current = toGateableSession(session);
        for (const tag of current.safetyTags) expect(candidate.safetyTags).toContain(tag);
    });

    it('matches toGateableSession exactly for a v1 session, which has no step content to resolve', () => {
        const session = v1Session();
        const candidate = deriveAuthoredSessionEligibility(session);
        const current = toGateableSession(session);
        expect(candidate.safetyTags).toEqual(current.safetyTags);
        expect(candidate.durationMin).toBe(current.durationMin);
        expect(candidate.durationMax).toBe(current.durationMax);
        expect(candidate.evidenceConfidence).toBe('discounted');
    });

    it('classifies an RIR-only-authored heavy step as heavy (import path never populates rpe)', () => {
        const rirSquat: SessionDefinition = {
            schemaVersion: 1, id: 'rir-heavy-squat', revision: 1, title: 'RIR-authored back squat', intent: 'training',
            blocks: [{
                id: 'block-main', role: 'main', executionMode: 'sequential',
                steps: [{
                    id: 'step-back-squat', kind: 'exercise',
                    exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                    dose: { kind: 'repetition', sets: 3, reps: 5 },
                    // canonicalWorkoutAdapter.ts's RIR import path produces exactly this
                    // shape -- no `kind`, no `rpe`, only `rir`.
                    effort: { rir: 1 },
                }],
            }],
        };
        const candidate = deriveAuthoredSessionEligibility(v2Session(rirSquat));
        expect(candidate.safetyTags).toContain('avoid_heavy_lower_body');
        expect(candidate.safetyTags).toContain('avoid_heavy_spinal_loading');
        expect(candidate.evidenceConfidence).toBe('resolved');
    });

    const ALL_MODALITIES: ExternalSessionModality[] = ['cycling', 'running', 'swimming', 'strength', 'field', 'mobility', 'cross_training'];
    const ALL_INTENSITIES: ExternalSessionIntensity[] = ['recovery', 'easy', 'moderate', 'hard', 'max'];
    const MODALITY_INTENSITY_MATRIX = ALL_MODALITIES.flatMap(modality => ALL_INTENSITIES.map(intensity => [modality, intensity] as const));

    it.each(MODALITY_INTENSITY_MATRIX)(
        'drift guard: an all-unresolved session (%s/%s) falls back to exactly today\'s coarse tags',
        (modality, intensity) => {
            const allUnresolved: SessionDefinition = {
                schemaVersion: 1, id: `all-unresolved-${modality}-${intensity}`, revision: 1, title: 'Unresolved session', intent: 'training',
                blocks: [{
                    id: 'block-main', role: 'main', executionMode: 'sequential',
                    steps: [{
                        id: 'step-mystery', kind: 'exercise',
                        exerciseRef: { kind: 'unresolved_free_text', name: 'Unresolved movement' },
                        dose: { kind: 'repetition', sets: 3, reps: 10 },
                    }],
                }],
            };
            const session = v2Session(allUnresolved, { modality, intensity });
            const candidate = deriveAuthoredSessionEligibility(session);
            const current = toGateableSession(session);
            // With no resolved steps at all, the candidate's safety tags are exactly the
            // fallback -- if `coarseFallbackSafetyTags` (hand-duplicated because
            // `externalSessionProfiles.ts` can't be touched without tripping
            // check-policy-drift.mjs) ever drifts from the original `inferredSafetyTags`,
            // this fails immediately rather than silently.
            expect([...candidate.safetyTags].sort()).toEqual([...current.safetyTags].sort());
        },
    );

    it('uses the definition\'s own authored duration rather than the coarse gating range', () => {
        const shortDefinition: SessionDefinition = {
            schemaVersion: 1, id: 'short-session', revision: 1, title: 'Short session', intent: 'training',
            duration: { min: 20, max: 25 },
            blocks: [{
                id: 'block-main', role: 'main', executionMode: 'sequential',
                steps: [{ id: 'step-1', kind: 'exercise', exerciseRef: { kind: 'catalog', exerciseId: 'push_up' }, dose: { kind: 'repetition', sets: 2, reps: 10 } }],
            }],
        };
        const candidate = deriveAuthoredSessionEligibility(v2Session(shortDefinition, { durationMin: 45, durationMax: 55 }));
        expect(candidate.durationMin).toBe(20);
        expect(candidate.durationMax).toBe(25);
    });
});
