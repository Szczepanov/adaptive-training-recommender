import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    CONCENTRIC_SEGMENTATION_V1,
    CONCENTRIC_SEGMENTATION_V2,
    segmentConcentricReps,
    type ConcentricSegmentationRule,
} from './concentricSegmentation';
import { segmentationGoldenCorpus } from './fixtures/concentricSegmentationGoldenFixtures';
import {
    WL_ANALYSIS_CSV_PARSER_V1,
    WL_ANALYSIS_CSV_PARSER_V2,
    WL_PARSER_SEGMENTATION_RULE,
} from './wlAnalysisCsv';

describe('Source-neutral concentric segmentation (#981)', () => {
    it('pins the WL parser versions to immutable rule identities', () => {
        expect(WL_PARSER_SEGMENTATION_RULE).toStrictEqual({
            [WL_ANALYSIS_CSV_PARSER_V1]: CONCENTRIC_SEGMENTATION_V1,
            [WL_ANALYSIS_CSV_PARSER_V2]: CONCENTRIC_SEGMENTATION_V2,
        });
    });

    it.each<ConcentricSegmentationRule>([CONCENTRIC_SEGMENTATION_V1, CONCENTRIC_SEGMENTATION_V2])(
        '%s preserves input and exposes array indices bracketing the reporting window', rule => {
            for (const { frames } of segmentationGoldenCorpus()) {
                const original = structuredClone(frames);
                // Non-contiguous ordinals distinguish source frame ids from array indices.
                const input = frames.map(frame => Object.freeze({ ...frame, ordinal: frame.ordinal * 3 }));
                for (const rep of segmentConcentricReps(Object.freeze(input), rule)) {
                    expect(rep.runStartIndex).toBeLessThanOrEqual(rep.windowStartIndex);
                    expect(rep.windowStartIndex).toBeLessThanOrEqual(rep.windowEndIndex);
                    expect(rep.windowEndIndex).toBeLessThanOrEqual(rep.runEndIndex);
                    expect(rep.startFrame).toBe(input[rep.windowStartIndex].ordinal);
                    expect(rep.endFrame).toBe(input[rep.windowEndIndex].ordinal);
                    expect(rep.frameCount).toBe(rep.windowEndIndex - rep.windowStartIndex + 1);
                    if (rule === CONCENTRIC_SEGMENTATION_V1) {
                        expect(rep.windowStartIndex).toBe(rep.runStartIndex);
                        expect(rep.windowEndIndex).toBe(rep.runEndIndex);
                    }
                }
                expect(frames).toStrictEqual(original);
            }
        },
    );

    it('is an import-free pure leaf', () => {
        const source = readFileSync(new URL('./concentricSegmentation.ts', import.meta.url), 'utf8');
        expect(source).not.toMatch(/\bimport\s*(?:[({*]|type\b|['"])/);
    });
});
