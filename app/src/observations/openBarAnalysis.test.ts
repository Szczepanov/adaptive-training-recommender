import { describe, expect, it } from 'vitest';
import { CONCENTRIC_SEGMENTATION_V1, CONCENTRIC_SEGMENTATION_V2 } from './concentricSegmentation';
import { buildOpenBarAnalysis, openBarCsrtParameters, openBarProfileToWlCsv, openBarSingleRepProfile } from './fixtures/openBarAnalysisFixtures';
import { OPENBAR_ANALYSIS_PARSER_V1, OPENBAR_ANALYSIS_PARSER_V2, OPENBAR_MAX_FILE_BYTES, OPENBAR_MAX_SAMPLES, OPENBAR_MAX_TRACKER_SIGNATURE_LENGTH, parseOpenBarAnalysis } from './openBarAnalysis';
import { parseWlAnalysisCsv, WL_ANALYSIS_CSV_PARSER_V1, WL_ANALYSIS_CSV_PARSER_V2 } from './wlAnalysisCsv';

const parse = (value: unknown) => parseOpenBarAnalysis(JSON.stringify(value), CONCENTRIC_SEGMENTATION_V2);

describe('OpenBar analysis-v1 parser (#981)', () => {
    it('pins the fixture top-level keys required by the analysis-v1 schema', () => {
        // Pin from OpenBar validation/schema/analysis-v1.schema.json, main@703c097.
        expect(Object.keys(buildOpenBarAnalysis()).sort()).toEqual([
            'calibration', 'derived', 'identity', 'manual_seed', 'provenance', 'raw_observations', 'schema_version', 'video',
        ]);
    });

    it.each([
        [CONCENTRIC_SEGMENTATION_V1, WL_ANALYSIS_CSV_PARSER_V1],
        [CONCENTRIC_SEGMENTATION_V2, WL_ANALYSIS_CSV_PARSER_V2],
    ] as const)('gives identical rep numbers through WL and OpenBar using %s', (rule, wlVersion) => {
        const profile = openBarSingleRepProfile();
        const openBar = parseOpenBarAnalysis(JSON.stringify(buildOpenBarAnalysis(profile)), rule);
        const wl = parseWlAnalysisCsv(openBarProfileToWlCsv(profile), wlVersion);
        expect(openBar.reps.map(({ exclusion, ...rep }) => {
            expect(exclusion).toBeNull();
            return rep;
        })).toStrictEqual(wl.reps);
        expect(openBar.reps).toHaveLength(1);
        expect(openBar.reps[0].meanVelocityMps).toBeGreaterThan(0);
        expect(openBar.reps[0].romCm).toBeGreaterThan(10);
        expect(openBar.sourceVideoSha256).toBe('a'.repeat(64));
    });

    it.each([
        [9.99, false, 0], [10.01, false, 1],
        [29.99, true, 1], [30.01, true, 2],
    ] as const)('preserves converted-rise parity around thresholds: %s cm, larger rep %s', (rise, largerRep, count) => {
        const profileForRise = (cm: number) => {
            const velocity = cm / (30 * (1 / 30) * 100);
            return [...Array<number>(35).fill(-velocity), ...Array<number>(3).fill(0),
                ...Array<number>(31).fill(velocity), ...Array<number>(5).fill(0)];
        };
        const profile = [...(largerRep ? profileForRise(60) : []), ...profileForRise(rise)];
        for (const [rule, version] of [[CONCENTRIC_SEGMENTATION_V1, WL_ANALYSIS_CSV_PARSER_V1], [CONCENTRIC_SEGMENTATION_V2, WL_ANALYSIS_CSV_PARSER_V2]] as const) {
            const openBar = parseOpenBarAnalysis(JSON.stringify(buildOpenBarAnalysis(profile)), rule);
            const wl = parseWlAnalysisCsv(openBarProfileToWlCsv(profile), version);
            expect(openBar.reps.map(({ exclusion, ...rep }) => {
                expect(exclusion).toBeNull();
                return rep;
            })).toStrictEqual(wl.reps);
            expect(wl.reps).toHaveLength(count);
        }
    });

    it.each([2, '1', null])('rejects unsupported schema_version %s', version => {
        expect(() => parse({ ...buildOpenBarAnalysis(), schema_version: version })).toThrow(/version/);
    });
    it('rejects other coordinate conventions instead of negating the source', () => {
        const analysis = buildOpenBarAnalysis();
        analysis.calibration.coordinate_convention = 'image_y_down';
        expect(() => parse(analysis)).toThrow(/coordinate convention/);
    });
    it.each(['NaN', 'Infinity', '-Infinity'])('rejects invalid JSON token %s with plain language', token => {
        const text = JSON.stringify(buildOpenBarAnalysis()).replace(/"vy_mps":-?[0-9.]+(?:e[+-]?[0-9]+)?/i, `"vy_mps":${token}`);
        expect(() => parseOpenBarAnalysis(text, CONCENTRIC_SEGMENTATION_V2)).toThrow(/not a valid OpenBar analysis file/);
    });
    it.each(['vy_mps', 'y_m', 'timestamp_s', 'confidence'])('rejects 1e999 overflow in %s', key => {
        const analysis = buildOpenBarAnalysis();
        const kinematics = JSON.stringify(analysis.derived.kinematics);
        const injected = kinematics.replace(new RegExp(`"${key}":-?[0-9.]+`), `"${key}":1e999`);
        const text = JSON.stringify(analysis).replace(kinematics, injected);
        expect(() => parseOpenBarAnalysis(text, CONCENTRIC_SEGMENTATION_V2)).toThrow(/finite/);
    });
    it('requires kinematics, video hash, and increasing timestamps', () => {
        const a = buildOpenBarAnalysis();
        expect(() => parse({ ...a, derived: { calibrated: a.derived.calibrated } })).toThrow(/kinematics/);
        expect(() => parse({ ...a, identity: { source_id: 'synthetic-video' } })).toThrow(/SHA-256/);
        a.derived.kinematics.samples[5].timestamp_s = a.derived.kinematics.samples[4].timestamp_s;
        expect(() => parse(a)).toThrow(/increasing/);
    });
    it('requires at least two usable samples and a supported rule', () => {
        expect(() => parse(buildOpenBarAnalysis([0, 0.6]))).toThrow(/two usable/);
        expect(() => parseOpenBarAnalysis('{}', 'unknown' as typeof CONCENTRIC_SEGMENTATION_V2)).toThrow(/segmentation rule/);
    });
    it('caps file bytes before parsing and samples before segmentation', () => {
        expect(() => parseOpenBarAnalysis(' '.repeat(OPENBAR_MAX_FILE_BYTES + 1), CONCENTRIC_SEGMENTATION_V2)).toThrow(/20 MB/);
        const a = buildOpenBarAnalysis();
        a.derived.kinematics.samples = Array(OPENBAR_MAX_SAMPLES + 1).fill(a.derived.kinematics.samples[0]);
        expect(() => parse(a)).toThrow(/100 000 samples/);
    });
    it.each([{ dropSamples: [32, 33] }, { nullVelocities: [32] }])('excludes runs spanning gaps: %j', options => {
        const parsed = parse(buildOpenBarAnalysis(openBarSingleRepProfile(), options));
        expect(parsed.breaks).toHaveLength(1);
        expect(parsed.reps[0].exclusion).toBe('spans_gap');
    });
    it('treats an omitted optional velocity as a tracking break', () => {
        const analysis = buildOpenBarAnalysis();
        const sample: { vy_mps?: number | null } = analysis.derived.kinematics.samples[32];
        delete sample.vy_mps;
        const parsed = parse(analysis);
        expect(parsed.breaks).toHaveLength(1);
        expect(parsed.reps[0].exclusion).toBe('spans_gap');
    });
    it('keeps reps eligible when a gap lies inside the preceding descent', () => {
        expect(parse(buildOpenBarAnalysis(openBarSingleRepProfile(), { dropSamples: [5, 6] })).reps[0].exclusion).toBeNull();
    });
    it.each([22, 54])('excludes a gap on a run boundary transition (%s)', index => {
        expect(parse(buildOpenBarAnalysis(openBarSingleRepProfile(), { nullVelocities: [index] })).reps[0].exclusion).toBe('spans_gap');
    });
    it.each([
        { profile: [...Array<number>(30).fill(0.6), 0] },
        { profile: [0, 0, ...Array<number>(30).fill(0.6)] },
    ])('excludes runs truncated at either series edge', ({ profile }) => {
        expect(parse(buildOpenBarAnalysis(profile)).reps[0].exclusion).toBe('touches_series_edge');
    });
    it('uses observed cadence, keeps low confidence finite velocities, and ignores nominal fps', () => {
        const a = buildOpenBarAnalysis();
        a.video.frame_rate.nominal_fps = 1000;
        a.derived.kinematics.samples[32].confidence = 0.1;
        expect(parse(a).breaks).toHaveLength(0);
        expect(parse(a).reps[0].exclusion).toBeNull();
    });
    it('records derivation parameter provenance and does not mutate the input', () => {
        const filtered = buildOpenBarAnalysis();
        const beforeFiltered = JSON.stringify(filtered);
        const parsed = parse(filtered);
        expect(parsed.provenance.filterParameters).toBe('order=n%3A2&window=n%3A9');
        expect(parsed.provenance.kinematicsMethod).toEqual({ implementation: 'backward-difference', version: '1' });
        expect(parsed.provenance.kinematicsParameters).toBe('max_gap_s=n%3A0.2&min_confidence=n%3A0.5');
        expect(JSON.stringify(filtered)).toBe(beforeFiltered);

        const raw = buildOpenBarAnalysis(undefined, { filtered: false });
        const beforeRaw = JSON.stringify(raw);
        expect(parse(raw).provenance.filter).toBeNull();
        expect(parse(raw).provenance.filterParameters).toBeNull();
        expect(JSON.stringify(raw)).toBe(beforeRaw);
    });
    it('rejects unknown calibration quality instead of storing arbitrary provenance', () => {
        const a = buildOpenBarAnalysis();
        (a.calibration.quality as { status: string }).status = 'mystery';
        expect(() => parse(a)).toThrow(/calibration quality status/);
    });
    it('accepts full scalar tracker provenance beyond 128 characters without changing source bytes', () => {
        const a = buildOpenBarAnalysis();
        a.provenance.tracker.implementation.parameters = openBarCsrtParameters();
        const bytes = JSON.stringify(a);
        const parsed = parseOpenBarAnalysis(bytes, CONCENTRIC_SEGMENTATION_V2);
        expect(parsed.parserVersion).toBe(OPENBAR_ANALYSIS_PARSER_V2);
        expect(parsed.provenance.trackerParameters!.length).toBeGreaterThan(128);
        expect(parsed.provenance.trackerParameters).toContain(`prediction_sha256=s%3A${'c'.repeat(64)}`);
        expect(parsed.provenance.trackerMethodParametersSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(a)).toBe(bytes);
        expect(parse(buildOpenBarAnalysis()).parserVersion).toBe(OPENBAR_ANALYSIS_PARSER_V1);
        expect(parse(buildOpenBarAnalysis()).provenance.trackerParameters).toBeNull();
    });
    it.each([null, [], { nested: 1 }])('rejects non-scalar tracker parameter %j', invalid => {
        const a = buildOpenBarAnalysis();
        a.provenance.tracker.implementation.parameters = { config: invalid };
        expect(() => parse(a)).toThrow(/scalar/);
    });
    it('rejects invalid tracker names, nonfinite values and oversized signatures', () => {
        const a = buildOpenBarAnalysis();
        for (const key of ['', ' '.repeat(2), 'x'.repeat(65)]) {
            a.provenance.tracker.implementation.parameters = { [key]: 1 };
            expect(() => parse(a)).toThrow(/invalid parameter name/);
        }
        a.provenance.tracker.implementation.parameters = { overflow: 1 };
        expect(() => parseOpenBarAnalysis(JSON.stringify(a).replace('"overflow":1', '"overflow":1e999'), CONCENTRIC_SEGMENTATION_V2)).toThrow(/finite/);
        a.provenance.tracker.implementation.parameters = { config: 'x'.repeat(OPENBAR_MAX_TRACKER_SIGNATURE_LENGTH) };
        expect(() => parse(a)).toThrow(/too large/);
    });
    it('canonicalizes key order and separates clip provenance from method settings', () => {
        const a = buildOpenBarAnalysis();
        const params = openBarCsrtParameters();
        a.provenance.tracker.implementation.parameters = params;
        const first = parse(a).provenance;
        a.provenance.tracker.implementation.parameters = Object.fromEntries(Object.entries(params).reverse());
        expect(parse(a).provenance).toEqual(first);
        a.provenance.tracker.implementation.parameters = { ...params, prediction_sha256: 'd'.repeat(64), seed_timestamp_s: 0.5, end_s: 3 };
        const second = parse(a).provenance;
        expect(second.trackerParameters).not.toBe(first.trackerParameters);
        expect(second.trackerMethodParametersSha256).toBe(first.trackerMethodParametersSha256);
        for (const config of [{ threads: 2 }, { init_box: '[301,300,200,200]' }, { confidence: 'other' }, { tracker: 'other' }]) {
            a.provenance.tracker.implementation.parameters = { ...params, ...config };
            expect(parse(a).provenance.trackerMethodParametersSha256).not.toBe(first.trackerMethodParametersSha256);
        }
    });
    it('rejects finite inputs whose reported rep arithmetic overflows', () => {
        const a = buildOpenBarAnalysis();
        for (const sample of a.derived.kinematics.samples) {
            if (sample.vy_mps !== null && sample.vy_mps > 0) sample.vy_mps = 1e308;
        }
        expect(() => parse(a)).toThrow(/finite/);
    });
});
