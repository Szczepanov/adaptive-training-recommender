import { describe, expect, it } from 'vitest';
import { COMPLETION_TISSUE_LEVEL_OPTIONS } from './sessionCompletionOptions';

describe('SessionCompletionSheet', () => {
    it('uses the canonical tissue-response vocabulary for completion feedback', () => {
        expect(COMPLETION_TISSUE_LEVEL_OPTIONS.map(option => option.value)).toEqual(['mild', 'moderate', 'severe']);
    });
});
