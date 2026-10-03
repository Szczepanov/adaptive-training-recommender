import { describe, expect, it } from 'vitest';
import { CONCENTRIC_SEGMENTATION_V1, CONCENTRIC_SEGMENTATION_V2, type ConcentricRep } from './concentricSegmentation.ts';
import {
    AGREEMENT_METHOD_CONFIG_CAVEAT, AGREEMENT_POOLING_CAVEAT, AGREEMENT_RATIO_CAVEAT, AGREEMENT_VELOCITY_METHOD_CAVEAT,
    agreementStats, buildAgreementReport, pairReps,
    type AgreementInput, type AgreementOpenBarRep,
} from './velocityAgreement.ts';

function rep(index: number, overrides: Partial<ConcentricRep> = {}): ConcentricRep {
    return {
        index, startFrame: index * 100, endFrame: index * 100 + 20, frameCount: 21,
        startTimeS: index * 3, endTimeS: index * 3 + 1, durationS: 1,
        meanVelocityMps: 0.5 + index * 0.25, peakVelocityMps: 0.75 + index * 0.25,
        romCm: 50 + index * 10, complete: true, ...overrides,
    };
}

function ob(index: number, overrides: Partial<AgreementOpenBarRep> = {}): AgreementOpenBarRep {
    return { ...rep(index), exclusion: null, ...overrides };
}

function input(label = 'lift-a'): AgreementInput {
    return {
        label, loadKg: 100,
        wl: { fileSha256: 'a'.repeat(64), parserVersion: 'wl-analysis-csv-v2', segmentationRule: CONCENTRIC_SEGMENTATION_V2, videoId: '42', reps: [rep(0), rep(1), rep(2)] },
        openBar: {
            fileSha256: 'b'.repeat(64), parserVersion: 'openbar-analysis-v1', segmentationRule: CONCENTRIC_SEGMENTATION_V2,
            sourceVideoSha256: 'c'.repeat(64), methodConfigSha256: 'd'.repeat(64), breakCount: 0,
            provenance: { tracker: { implementation: 'CSRT', version: '1' }, pipeline: { openbar_version: '1', git_commit: 'synthetic' }, filter: null, kinematics: { max_gap_s: 0.1 } },
            reps: [ob(0), ob(1), ob(2)],
        },
    };
}

describe('pairReps', () => {
    it('retains all reps when counts differ in either direction', () => {
        const a = pairReps([rep(0), rep(1), rep(2)], [ob(0), ob(1), ob(2), ob(3)]);
        expect(a.paired.map(pair => [pair.wl.index, pair.openBar.index])).toEqual([[0, 0], [1, 1], [2, 2]]);
        expect(a.openBarOnly.map(({ rep: r }) => r.index)).toEqual([3]);
        expect(a.paired.length + a.wlOnly.length).toBe(3);
        expect(a.paired.length + a.openBarOnly.length + a.openBarExcluded.length).toBe(4);
        const b = pairReps([rep(0), rep(1), rep(2), rep(3)], [ob(0), ob(1), ob(2)]);
        expect(b.wlOnly.map(({ rep: r }) => r.index)).toEqual([3]);
    });

    it('adds the optional offset to OpenBar times without changing inputs', () => {
        const wl = [rep(0), rep(1), rep(2)];
        const openBar = [0, 1, 2, 3].map(index => ob(index, { startTimeS: index * 3 + 20, endTimeS: index * 3 + 21 }));
        const before = JSON.stringify({ wl, openBar });
        expect(pairReps(wl, openBar).paired).toHaveLength(0);
        expect(pairReps(wl, openBar, { offsetS: -20 }).paired).toHaveLength(3);
        expect(pairReps(wl, openBar, { offsetS: -20 }).openBarOnly).toHaveLength(1);
        expect(JSON.stringify({ wl, openBar })).toBe(before);
    });

    it('greedily takes highest IoU before lower-IoU candidates', () => {
        const wl = [rep(0, { startTimeS: 0, endTimeS: 2 }), rep(1, { startTimeS: 1, endTimeS: 3 })];
        const result = pairReps(wl, [ob(0, { startTimeS: 1, endTimeS: 3 })], { minOverlap: 0.3 });
        expect(result.paired[0].wl.index).toBe(1);
        expect(result.wlOnly[0].rep.index).toBe(0);
    });

    it('breaks ties by WL index then OpenBar index regardless of input order', () => {
        const wl = [rep(5, { startTimeS: 0, endTimeS: 1 }), rep(2, { startTimeS: 0, endTimeS: 1 })];
        const openBar = [ob(7, { startTimeS: 0, endTimeS: 1 }), ob(3, { startTimeS: 0, endTimeS: 1 })];
        expect(pairReps(wl, openBar).paired.map(p => [p.wl.index, p.openBar.index])).toEqual([[2, 3], [5, 7]]);
    });

    it('uses temporal IoU with an inclusive threshold, not overlap divided by shorter duration', () => {
        expect(pairReps([rep(0)], [ob(0, { endTimeS: 2 })]).paired[0].temporalIoU).toBe(0.5);
        expect(pairReps([rep(0)], [ob(0, { endTimeS: 2.01 })]).paired).toHaveLength(0);
        expect(pairReps([rep(0)], [ob(0, { startTimeS: 1, endTimeS: 2 })], { minOverlap: 0 }).paired).toHaveLength(0);
    });

    it('retains excluded reps and their reasons; completeness does not exclude tracking-eligible reps', () => {
        const result = pairReps([rep(0, { complete: false }), rep(1), rep(2)], [ob(0, { complete: false }), ob(1, { exclusion: 'spans_gap' }), ob(2, { exclusion: 'touches_series_edge' })]);
        expect(result.paired).toHaveLength(1);
        expect(result.openBarExcluded.map(e => e.reason)).toEqual(['spans_gap', 'touches_series_edge']);
        expect(result.wlOnly).toHaveLength(2);
        expect(result.openBarOnly).toHaveLength(0);
    });

    it('validates options, finite fields, unique indices and positive intervals', () => {
        for (const minOverlap of [-1, 1.1, NaN, Infinity]) expect(() => pairReps([], [], { minOverlap })).toThrow();
        expect(() => pairReps([], [], { offsetS: Infinity })).toThrow(/finite/);
        expect(() => pairReps([rep(0), rep(0)], [])).toThrow(/unique/);
        expect(() => pairReps([rep(-1)], [])).toThrow(/indices/);
        expect(() => pairReps([rep(0, { endTimeS: 0 })], [])).toThrow(/interval/);
        for (const field of ['startTimeS', 'endTimeS', 'meanVelocityMps', 'peakVelocityMps', 'romCm'] as const) {
            expect(() => pairReps([rep(0, { [field]: Infinity })], [])).toThrow(/finite/);
        }
        expect(() => pairReps([], [ob(0, { startTimeS: Number.MAX_VALUE, endTimeS: Number.MAX_VALUE })])).toThrow();
    });
});

describe('agreementStats', () => {
    it('reports zero differences for identical measurements', () => {
        const s = agreementStats([0, 0, 0], [0.5, 0.75, 1]);
        expect([s.bias, s.sampleSd, s.lowerLoA, s.upperLoA, s.meanAbsoluteDifference, s.slope, s.intercept]).toEqual([0, 0, 0, 0, 0, 0, 0]);
        expect(s.geometricMeanRatio).toBe(1);
        expect(s.pearsonR).toBeNull();
        expect(s.reasons.pearsonR).toBe('zero_variance');
    });

    it('recovers constant additive offset', () => {
        const s = agreementStats([0.25, 0.25, 0.25], [0.625, 0.875, 1.125]);
        expect(s.bias).toBe(0.25);
        expect(s.sampleSd).toBe(0);
        expect(s.lowerLoA).toBe(0.25);
        expect(s.upperLoA).toBe(0.25);
        expect(s.slope).toBe(0);
        expect(s.intercept).toBe(0.25);
    });

    it('classifies non-binary decimal subtraction noise as zero variance without suppressing real variation', () => {
        const wl = [0.1, 0.2, 0.8];
        const openBar = [0.15, 0.25, 0.85];
        const s = agreementStats(openBar.map((v, i) => v - wl[i]), openBar.map((v, i) => (v + wl[i]) / 2));
        expect(s.bias).toBeCloseTo(0.05, 15);
        expect(s.sampleSd).toBe(0);
        expect(s.slope).toBe(0);
        expect(s.intercept).toBeCloseTo(0.05, 15);
        expect(s.pearsonR).toBeNull();
        expect(s.reasons.pearsonR).toBe('zero_variance');
        const varying = agreementStats([0.05, 0.05 + 1e-12, 0.05 - 1e-12], [0.125, 0.225, 0.825]);
        expect(varying.sampleSd).toBeGreaterThan(0);
        expect(varying.pearsonR).not.toBeNull();
        const constantMagnitude = agreementStats([0.6, 0.4, 0.2], [(0.7 + 0.1) / 2, (0.6 + 0.2) / 2, (0.5 + 0.3) / 2]);
        expect(constantMagnitude.reasons.slope).toBe('constant_magnitudes');
        expect(constantMagnitude.pearsonR).toBeNull();
    });

    it('recovers multiplicative scale and proportional bias', () => {
        const wl = [0.5, 0.75, 1, 1.25];
        const k = 1.4;
        const s = agreementStats(wl.map(v => (k - 1) * v), wl.map(v => (k + 1) * v / 2));
        expect(s.slope).toBeCloseTo(2 * (k - 1) / (k + 1), 12);
        expect(s.intercept).toBeCloseTo(0, 12);
        expect(s.pearsonR).toBeCloseTo(1, 12);
        expect(s.geometricMeanRatio).toBeCloseTo(k, 12);
    });

    it('uses sample SD and signed limits of agreement', () => {
        const s = agreementStats([-1, 0, 1], [2, 3, 4]);
        expect(s.sampleSd).toBe(1);
        expect(s.lowerLoA).toBe(-1.96);
        expect(s.upperLoA).toBe(1.96);
        expect(s.meanAbsoluteDifference).toBeCloseTo(2 / 3);
    });

    it('marks insufficient samples per statistic', () => {
        const empty = agreementStats([], []);
        expect(empty.n).toBe(0);
        expect(empty.bias).toBeNull();
        expect(Object.values(empty.reasons).every(reason => reason === 'insufficient_n')).toBe(true);
        const single = agreementStats([1], [1.5]);
        expect(single.bias).toBe(1);
        expect(single.meanAbsoluteDifference).toBe(1);
        expect(single.geometricMeanRatio).toBeCloseTo(2);
        expect(single.sampleSd).toBeNull();
        expect(single.reasons.sampleSd).toBe('insufficient_n');
        const two = agreementStats([0, 1], [1, 2]);
        expect(two.sampleSd).toBeCloseTo(Math.SQRT1_2);
        expect(two.slope).toBeNull();
        expect(two.reasons.slope).toBe('insufficient_n');
    });

    it('marks constant magnitudes and invalid reconstructed ratios', () => {
        const constant = agreementStats([1, 2, 3], [5, 5, 5]);
        expect([constant.slope, constant.intercept, constant.pearsonR]).toEqual([null, null, null]);
        expect(constant.reasons.slope).toBe('constant_magnitudes');
        const repeated = agreementStats(Array<number>(6).fill(1), Array<number>(6).fill(3));
        expect(repeated.bias).toBe(1);
        expect(repeated.sampleSd).toBe(0);
        expect(repeated.reasons.slope).toBe('constant_magnitudes');
        for (const [d, m] of [[2, 1], [3, 1], [0, 0], [0, -1]]) {
            const result = agreementStats([d], [m]);
            expect(result.geometricMeanRatio).toBeNull();
            expect(result.reasons.geometricMeanRatio).toBe('invalid_scale');
        }
    });

    it('rejects non-finite inputs and reports numeric overflow without NaN or Infinity', () => {
        expect(() => agreementStats([1], [])).toThrow(/equal lengths/);
        expect(() => agreementStats([NaN], [1])).toThrow(/finite/);
        expect(() => agreementStats([1], [Infinity])).toThrow(/finite/);
        const extreme = agreementStats([Number.MAX_VALUE, -Number.MAX_VALUE], [1, 2]);
        for (const value of Object.values(extreme)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        expect(extreme.sampleSd).toBeNull();
        expect(extreme.reasons.sampleSd).toBe('non_finite_result');
    });
});

describe('buildAgreementReport', () => {
    it('reports a constant decimal velocity offset with zero SD and a null correlation', () => {
        const data = input();
        data.wl.reps = [0.1, 0.2, 0.8].map((meanVelocityMps, i) => rep(i, { meanVelocityMps }));
        data.openBar.reps = [0.15, 0.25, 0.85].map((meanVelocityMps, i) => ob(i, { meanVelocityMps }));
        const report = buildAgreementReport([data]);
        const parsed = JSON.parse(report.json);
        for (const s of [parsed.pooled.stats.meanVelocityMps, parsed.videos[0].stats.meanVelocityMps]) {
            expect(s.bias).toBe(0.05);
            expect(s.sampleSd).toBe(0);
            expect(s.lowerLoA).toBe(0.05);
            expect(s.upperLoA).toBe(0.05);
            expect(s.slope).toBe(0);
            expect(s.intercept).toBe(0.05);
            expect(s.pearsonR).toBeNull();
            expect(s.reasons.pearsonR).toBe('zero_variance');
        }
        expect(parsed.videos[0].paired.map((r: { meanVelocityMps: { difference: number } }) => r.meanVelocityMps.difference)).toEqual([0.05, 0.05, 0.05]);
        expect(report.markdown).toContain('null (zero_variance)');
    });

    it('reports per-video and pooled primary/secondary metrics, values, load and provenance', () => {
        const report = buildAgreementReport([input()]);
        const parsed = JSON.parse(report.json);
        expect(parsed.primaryMetric).toBe('meanVelocityMps');
        expect(parsed.secondaryMetrics).toEqual(['peakVelocityMps', 'romCm']);
        expect(parsed.pooled.stats.meanVelocityMps.n).toBe(3);
        expect(parsed.videos[0].stats.romCm.bias).toBe(0);
        expect(parsed.videos[0].paired[0].meanVelocityMps).toEqual({ wl: 0.5, openBar: 0.5, difference: 0, magnitude: 0.5 });
        expect(parsed.videos[0].paired[0].loadKg).toBe(100);
        expect(parsed.videos[0].wl.videoId).toBe('42');
        expect(parsed.videos[0].openBar.fileSha256).toBe('b'.repeat(64));
        expect(parsed.wlParserVersion).toBe('wl-analysis-csv-v2');
        expect(parsed.openBarParserVersion).toBe('openbar-analysis-v1');
        expect(parsed.openBarMethodConfigSha256).toBe('d'.repeat(64));
        expect(report.markdown).toContain('git_commit');
        expect(report.markdown).toContain(AGREEMENT_POOLING_CAVEAT);
        expect(report.markdown).toContain(AGREEMENT_METHOD_CONFIG_CAVEAT);
        expect(report.markdown).toContain(AGREEMENT_RATIO_CAVEAT);
        expect(report.markdown).toContain(AGREEMENT_VELOCITY_METHOD_CAVEAT);
        expect(report.markdown).toContain('Geometric OpenBar/WL measurement ratio');
    });

    it('keeps unmatched and excluded details and totals', () => {
        const data = input();
        data.openBar.reps = [ob(0), ob(1, { exclusion: 'spans_gap' }), ob(2), ob(3)];
        data.openBar.breakCount = 1;
        const report = buildAgreementReport([data]);
        const parsed = JSON.parse(report.json);
        expect(parsed.pooled.counts).toEqual({ wlTotal: 3, openBarTotal: 4, paired: 2, wlOnly: 1, openBarOnly: 1, openBarExcluded: 1 });
        expect(parsed.videos[0].openBarExcluded[0].reason).toBe('spans_gap');
        expect(parsed.videos[0].wlOnly[0].rep.index).toBe(1);
        expect(report.markdown).toContain('OpenBar excluded: rep 1, spans_gap');
    });

    it('rejects rule mismatches before computing malformed rep statistics', () => {
        const data = input();
        data.openBar.segmentationRule = CONCENTRIC_SEGMENTATION_V1;
        data.wl.reps = [rep(0, { meanVelocityMps: NaN })];
        expect(() => buildAgreementReport([data])).toThrow(/Segmentation rule mismatch/);
        const other = input('lift-b');
        other.wl.segmentationRule = other.openBar.segmentationRule = CONCENTRIC_SEGMENTATION_V1;
        expect(() => buildAgreementReport([input(), other])).toThrow(/same segmentation rule/);
    });

    it('rejects mixed OpenBar method configurations instead of pooling incomparable methods', () => {
        const other = input('lift-b');
        other.openBar.methodConfigSha256 = 'e'.repeat(64);
        expect(() => buildAgreementReport([input(), other])).toThrow(/same OpenBar method configuration/);
    });

    it('rejects mixed parser versions because parser identity is part of the measurement method', () => {
        const wlOther = input('lift-b');
        wlOther.wl.parserVersion = 'wl-analysis-csv-v3';
        expect(() => buildAgreementReport([input(), wlOther])).toThrow(/same WL parser version/);

        const openBarOther = input('lift-b');
        openBarOther.openBar.parserVersion = 'openbar-analysis-v2';
        expect(() => buildAgreementReport([input(), openBarOther])).toThrow(/same OpenBar parser version/);

        const blank = input();
        blank.wl.parserVersion = ' ';
        expect(() => buildAgreementReport([blank])).toThrow(/Parser versions must be non-empty/);
    });

    it('is byte-identical after source array and provenance key permutations, with six-decimal rounding and LF', () => {
        const a = input('a');
        const b = input('b');
        a.loadKg = 100.123456789;
        const before = JSON.stringify([a, b]);
        const first = buildAgreementReport([b, a]);
        const shuffled = { ...a, wl: { ...a.wl, reps: [...a.wl.reps].reverse() }, openBar: { ...a.openBar, reps: [...a.openBar.reps].reverse(), provenance: { kinematics: { max_gap_s: 0.1 }, filter: null, pipeline: { git_commit: 'synthetic', openbar_version: '1' }, tracker: { version: '1', implementation: 'CSRT' } } } };
        expect(buildAgreementReport([shuffled, b])).toEqual(first);
        expect(JSON.stringify([a, b])).toBe(before);
        expect(JSON.parse(first.json).videos[0].loadKg).toBe(100.123457);
        for (const text of [first.json, first.markdown]) {
            expect(text.endsWith('\n')).toBe(true);
            expect(text).not.toContain('\r');
            expect(text).not.toMatch(/generatedAt|hostname|[A-Z]:\\/);
        }
    });

    it('supports an empty cohort and escapes table labels', () => {
        expect(JSON.parse(buildAgreementReport([]).json).pooled.stats.meanVelocityMps.n).toBe(0);
        expect(buildAgreementReport([input('a|b\r\n<c>')]).markdown).toContain('a\\|b &lt;c&gt;');
    });

    it('uses fixed unmatched and excluded rep keys regardless of insertion order or extra caller fields', () => {
        const data = input();
        data.openBar.reps = [ob(0), ob(1, { exclusion: 'spans_gap' }), ob(3)];
        const first = buildAgreementReport([data]);
        const reverseKeys = <T extends ConcentricRep>(original: T): T => ({
            ...Object.fromEntries(Object.entries(original).reverse()), ignoredCallerField: 'synthetic extra metadata',
        }) as unknown as T;
        const wl = [...data.wl.reps].reverse().map(reverseKeys);
        const openBar = [...data.openBar.reps].reverse().map(reverseKeys);
        expect(buildAgreementReport([{ ...data, wl: { ...data.wl, reps: wl }, openBar: { ...data.openBar, reps: openBar } }])).toEqual(first);
        const pairing = pairReps(wl, openBar);
        expect(pairing.wlOnly[0].rep).toBe(wl.find(r => r.index === 1));
        expect(pairing.openBarOnly[0].rep).toBe(openBar.find(r => r.index === 3));
        expect(pairing.openBarExcluded[0].rep).toBe(openBar.find(r => r.index === 1));
    });

    it('validates metadata and labels', () => {
        expect(() => buildAgreementReport([input(), input()])).toThrow(/unique/);
        expect(() => buildAgreementReport([input(' ')])).toThrow(/non-empty/);
        for (const loadKg of [0, -1, Infinity]) expect(() => buildAgreementReport([{ ...input(), loadKg }])).toThrow();
        const hash = input();
        hash.wl.fileSha256 = 'unknown';
        expect(() => buildAgreementReport([hash])).toThrow(/SHA-256/);
        const breaks = input();
        breaks.openBar.breakCount = 0.5;
        expect(() => buildAgreementReport([breaks])).toThrow(/breakCount/);
        const provenance = input();
        provenance.openBar.provenance = { value: Infinity };
        expect(() => buildAgreementReport([provenance])).toThrow(/finite/);
    });
});
