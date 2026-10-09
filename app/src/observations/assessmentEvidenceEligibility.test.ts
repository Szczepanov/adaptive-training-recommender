import { describe, expect, it } from 'vitest';
import type { AssessmentAttempt, AssessmentAttemptPurpose, AssessmentAttemptState } from './models';
import { benchmarkEligibleAttemptIds, isBenchmarkEligibleAttempt } from './assessmentEvidenceEligibility';

function attempt(id: string, purpose: AssessmentAttemptPurpose, state: AssessmentAttemptState): AssessmentAttempt {
    return { id, protocolRef: { id: 'cycling-20m-tt', revision: 1 }, state, purpose };
}

describe('isBenchmarkEligibleAttempt (#897 WP8)', () => {
    it.each(['baseline', 'checkpoint', 'post_block'] as const)('accepts a completed %s attempt', purpose => {
        expect(isBenchmarkEligibleAttempt(attempt('a', purpose, 'completed'))).toBe(true);
    });

    it('rejects a completed familiarization attempt', () => {
        expect(isBenchmarkEligibleAttempt(attempt('a', 'familiarization', 'completed'))).toBe(false);
    });

    it.each(['abandoned', 'in_progress', 'scheduled'] as const)('rejects a %s attempt even with a benchmark purpose', state => {
        expect(isBenchmarkEligibleAttempt(attempt('a', 'baseline', state))).toBe(false);
    });
});

describe('benchmarkEligibleAttemptIds', () => {
    it('returns only the ids of eligible attempts', () => {
        const ids = benchmarkEligibleAttemptIds([
            attempt('base', 'baseline', 'completed'),
            attempt('famil', 'familiarization', 'completed'),
            attempt('aband', 'checkpoint', 'abandoned'),
            attempt('post', 'post_block', 'completed'),
        ]);
        expect([...ids].sort()).toEqual(['base', 'post']);
    });

    it('returns an empty set for no attempts', () => {
        expect(benchmarkEligibleAttemptIds([]).size).toBe(0);
    });
});
