import { describe, expect, it } from 'vitest';
import golden from './fixtures/concentricSegmentation.golden.json';
import { segmentationGoldenCorpus } from './fixtures/concentricSegmentationGoldenFixtures';
import { segmentWlReps, WL_ANALYSIS_CSV_PARSER_V1, WL_ANALYSIS_CSV_PARSER_V2 } from './wlAnalysisCsv';

describe('WL pre-extraction segmentation characterisation (#981)', () => {
    it('preserves every v1 and v2 output in the seeded corpus captured before extraction', () => {
        const actual = segmentationGoldenCorpus().map(({ label, frames }) => ({
            label,
            v1: segmentWlReps(frames, WL_ANALYSIS_CSV_PARSER_V1),
            v2: segmentWlReps(frames, WL_ANALYSIS_CSV_PARSER_V2),
        }));
        expect(actual).toEqual(golden);
        expect(actual).toHaveLength(200);
        expect(actual.some(entry => JSON.stringify(entry.v1) !== JSON.stringify(entry.v2))).toBe(true);
    });
});
