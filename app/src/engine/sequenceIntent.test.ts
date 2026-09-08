import { describe, expect, it } from 'vitest';
import { resolveSequenceIntent } from './sequenceIntent';

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
