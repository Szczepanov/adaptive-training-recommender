import { describe, expect, it } from 'vitest';
import {
    buildCompletionPayload,
    contradictsRequiredWork,
    type CompletionEvidenceDraft,
} from './sessionCompletionOptions';

const untouched: CompletionEvidenceDraft = {
    unexpectedFatigueChecked: false,
    notes: '',
    tissueFeedback: [],
    selectedRegion: '',
    reportedPain: 'mild',
    missingRequiredStepCount: 0,
};

describe('buildCompletionPayload (#896 missingness)', () => {
    it('emits no sRPE or completion fraction for an untouched form', () => {
        expect(buildCompletionPayload(untouched)).toEqual({ unexpectedFatigue: false });
    });

    it('persists an explicitly selected sRPE of 7', () => {
        expect(buildCompletionPayload({ ...untouched, sessionRpe: 7 })).toEqual({ sessionRpe: 7, unexpectedFatigue: false });
    });

    it('persists an explicit completed fraction, including 0', () => {
        expect(buildCompletionPayload({ ...untouched, completedFraction: 0 })).toEqual({ completedFraction: 0, unexpectedFatigue: false });
        expect(buildCompletionPayload({ ...untouched, completedFraction: 1 })).toEqual({ completedFraction: 1, unexpectedFatigue: false });
    });

    it('never persists 100% completion over known unfinished required work', () => {
        const partial = { ...untouched, completedFraction: 1, missingRequiredStepCount: 2 };
        expect(contradictsRequiredWork(1, 2)).toBe(true);
        expect(contradictsRequiredWork(0.75, 2)).toBe(false);
        expect(buildCompletionPayload(partial)).toEqual({ unexpectedFatigue: false });
        expect(buildCompletionPayload({ ...partial, completedFraction: 0.75 })).toEqual({ completedFraction: 0.75, unexpectedFatigue: false });
    });

    it('keeps unexpectedFatigue an explicit boolean so the immediate response still exists', () => {
        expect(buildCompletionPayload(untouched).unexpectedFatigue).toBe(false);
        expect(buildCompletionPayload({ ...untouched, unexpectedFatigueChecked: true }).unexpectedFatigue).toBe(true);
    });

    it('keeps empty notes absent and trims real ones', () => {
        expect(buildCompletionPayload({ ...untouched, notes: '   ' })).toEqual({ unexpectedFatigue: false });
        expect(buildCompletionPayload({ ...untouched, notes: ' felt fast ' })).toEqual({ notes: 'felt fast', unexpectedFatigue: false });
    });

    it('still submits a pending tissue draft', () => {
        expect(buildCompletionPayload({ ...untouched, selectedRegion: 'knee', reportedPain: 'moderate' })).toEqual({
            unexpectedFatigue: false,
            tissueFeedback: [{ region: 'knee', painDuringTraining: 'moderate', afterTrainingState: 'moderate' }],
        });
    });
});
