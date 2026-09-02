import { describe, expect, it } from 'vitest';
import { deriveTissueSeverity } from './injuryPolicy';

describe('SEP-C3 tissue latency fail-closed behavior', () => {
    it('does not infer recovery when post-session follow-up is missing', () => {
        expect(deriveTissueSeverity({
            region: 'achilles',
            morningState: 'normal',
            painDuringTraining: 'moderate',
            nextMorningReaction: 'normal',
        })).toBe('limit');
    });

    it('does not infer recovery before the next-morning latency observation exists', () => {
        expect(deriveTissueSeverity({
            region: 'achilles',
            morningState: 'normal',
            painDuringTraining: 'moderate',
            afterTrainingState: 'normal',
        })).toBe('limit');
    });

    it('relaxes transient moderate loading discomfort only after both later observations explicitly settle', () => {
        expect(deriveTissueSeverity({
            region: 'achilles',
            morningState: 'normal',
            painDuringTraining: 'moderate',
            afterTrainingState: 'mild',
            nextMorningReaction: 'normal',
        })).toBe('monitor');
    });

    it('keeps delayed moderate reactivity load-limiting', () => {
        expect(deriveTissueSeverity({
            region: 'achilles',
            morningState: 'normal',
            painDuringTraining: 'moderate',
            afterTrainingState: 'normal',
            nextMorningReaction: 'moderate',
        })).toBe('limit');
    });
});
