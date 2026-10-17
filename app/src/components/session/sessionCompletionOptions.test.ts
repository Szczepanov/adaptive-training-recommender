import { describe, expect, it } from 'vitest';
import {
    buildCompletionPayload,
    contradictsRequiredWork,
    type CompletionEvidenceDraft,
} from './sessionCompletionOptions';

const untouched: CompletionEvidenceDraft = {
    notes: '',
    tissueFeedback: [],
    selectedRegion: '',
    reportedPain: 'mild',
    missingRequiredStepCount: 0,
};

describe('buildCompletionPayload (#896 missingness)', () => {
    it('emits no sRPE or completion fraction for an untouched form', () => {
        expect(buildCompletionPayload(untouched)).toEqual({});
    });

    it('persists an explicitly selected sRPE of 7', () => {
        expect(buildCompletionPayload({ ...untouched, sessionRpe: 7 })).toEqual({ sessionRpe: 7 });
    });

    it('persists an explicit completed fraction, including 0', () => {
        expect(buildCompletionPayload({ ...untouched, completedFraction: 0 })).toEqual({ completedFraction: 0 });
        expect(buildCompletionPayload({ ...untouched, completedFraction: 1 })).toEqual({ completedFraction: 1 });
    });

    it('never persists 100% completion over known unfinished required work', () => {
        const partial = { ...untouched, completedFraction: 1, missingRequiredStepCount: 2 };
        expect(contradictsRequiredWork(1, 2)).toBe(true);
        expect(contradictsRequiredWork(0.75, 2)).toBe(false);
        expect(buildCompletionPayload(partial)).toEqual({});
        expect(buildCompletionPayload({ ...partial, completedFraction: 0.75 })).toEqual({ completedFraction: 0.75 });
    });

    it('persists unexpectedFatigue only as an explicit No or Yes answer', () => {
        expect(buildCompletionPayload(untouched)).not.toHaveProperty('unexpectedFatigue');
        expect(buildCompletionPayload({ ...untouched, unexpectedFatigue: false })).toEqual({ unexpectedFatigue: false });
        expect(buildCompletionPayload({ ...untouched, unexpectedFatigue: true })).toEqual({ unexpectedFatigue: true });
    });

    it('keeps empty notes absent and trims real ones', () => {
        expect(buildCompletionPayload({ ...untouched, notes: '   ' })).toEqual({});
        expect(buildCompletionPayload({ ...untouched, notes: ' felt fast ' })).toEqual({ notes: 'felt fast' });
    });

    it('still submits a pending tissue draft', () => {
        expect(buildCompletionPayload({ ...untouched, selectedRegion: 'knee', reportedPain: 'moderate' })).toEqual({
            tissueFeedback: [{ region: 'knee', painDuringTraining: 'moderate', afterTrainingState: 'moderate' }],
        });
    });
});
