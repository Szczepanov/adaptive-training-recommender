import { describe, expect, it } from 'vitest';
import { resolveSequenceIntent, resolveSequenceIntentPreference } from './sequenceIntent';

describe('resolveSequenceIntent', () => {
    it.each([
        ['Base', 'recondition', 'spread', 2],
        ['Build', 'build', 'spread', 1],
        ['Specificity', 'specialize', 'cluster_allowed', 1],
        ['Peak/Taper', 'taper', 'spread', 2],
        ['Post-Event Recovery', 'recovery', 'spread', 3],
    ] as const)('%s resolves to the canonical phase policy', (phaseName, progressionMode, density, gap) => {
        const policy = resolveSequenceIntent({ phaseName });
        expect(policy.progressionMode).toBe(progressionMode);
        expect(policy.qualityDensityMode).toBe(density);
        expect(policy.minimumPreferredKeyGapDays).toBe(gap);
        expect(policy.sourcePhase).toBe(phaseName);
    });
});

describe('resolveSequenceIntentPreference', () => {
    const neutralContext = {
        candidateIsKey: false,
        candidateIsRecovery: false,
        candidateIsLongEndurance: false,
        daysSinceLastKeySession: null,
        lastWasHighIntensity: false,
    };

    it('keeps a neutral candidate unchanged', () => {
        const result = resolveSequenceIntentPreference(resolveSequenceIntent({ phaseName: 'Base' }), neutralContext);
        expect(result.multiplier).toBe(1);
        expect(result.reasons).toEqual([]);
    });

    it('keeps specificity clustering soft while still penalizing consecutive high intensity', () => {
        const specificity = resolveSequenceIntentPreference(resolveSequenceIntent({ phaseName: 'Specificity' }), {
            ...neutralContext,
            candidateIsKey: true,
            daysSinceLastKeySession: 1,
            lastWasHighIntensity: true,
        });
        const base = resolveSequenceIntentPreference(resolveSequenceIntent({ phaseName: 'Base' }), {
            ...neutralContext,
            candidateIsKey: true,
            daysSinceLastKeySession: 1,
            lastWasHighIntensity: true,
        });

        expect(specificity.multiplier).toBeGreaterThan(base.multiplier);
        expect(specificity.multiplier).toBeLessThan(1);
        expect(base.multiplier).toBeCloseTo(0.35 * 0.75);
    });

    it('protects recovery more strongly in post-event recovery', () => {
        const result = resolveSequenceIntentPreference(resolveSequenceIntent({ phaseName: 'Post-Event Recovery' }), {
            ...neutralContext,
            candidateIsRecovery: true,
            lastWasHighIntensity: true,
        });
        expect(result.multiplier).toBeGreaterThan(1);
        expect(result.reasons.join(' ')).toContain('recovery protection');
    });

    it('gives long endurance a larger soft boost in specificity than taper', () => {
        const specificity = resolveSequenceIntentPreference(resolveSequenceIntent({ phaseName: 'Specificity' }), {
            ...neutralContext,
            candidateIsLongEndurance: true,
        });
        const taper = resolveSequenceIntentPreference(resolveSequenceIntent({ phaseName: 'Peak/Taper' }), {
            ...neutralContext,
            candidateIsLongEndurance: true,
        });
        expect(specificity.multiplier).toBeCloseTo(1.1);
        expect(taper.multiplier).toBeCloseTo(0.97);
        expect(specificity.multiplier).toBeGreaterThan(taper.multiplier);
    });
});
