import { describe, expect, it } from 'vitest';
import {
    parseWlAnalysisCsv,
    segmentWlReps,
    WL_ANALYSIS_CSV_PARSER_V1,
    WL_ANALYSIS_CSV_PARSER_V2,
    WL_BOUNDARY_VELOCITY_FLOOR_MPS,
    WL_COMPLETE_DESCENT_FRACTION,
    WL_CONCENTRIC_VELOCITY_THRESHOLD_MPS,
    WL_MIN_REP_RISE_CM,
    WL_MIN_REP_RISE_FRACTION,
    type WlAnalysisFrame,
} from './wlAnalysisCsv';

interface SyntheticRepSpec {
    /** Bottom of the rep (negative displacement in cm, e.g. -50). */
    depthCm: number;
    /** Top after ascent (usually ~0). */
    topCm?: number;
    ascentVelocityMps: number;
    peakVelocityMps?: number;
    descentFrames?: number;
    ascentFrames?: number;
}

interface SyntheticCsvOptions {
    weight?: number;
    tags?: string;
    date?: string;
    frameRate?: number;
    resolution?: string;
    summaryAverageVelocity?: string;
    includePerFrameTable?: boolean;
    extraFrameColumns?: string;
    velocityUnit?: string;
    displacementUnit?: string;
    omitDisplacement?: boolean;
    nonNumericVelocityAt?: number;
    videoIds?: readonly string[];
    delimiter?: string;
}

/**
 * Build a synthetic WL Analysis export with the exact header/summary/per-frame structure
 * of a real export. Descent frames carry negative velocity while displacement falls to
 * the rep depth; ascent frames carry positive velocity while displacement rises back.
 */
function buildSyntheticCsv(reps: readonly SyntheticRepSpec[], options: SyntheticCsvOptions = {}): string {
    const delimiter = options.delimiter ?? ',';
    const join = (cells: string[]): string => cells.join(delimiter);
    const weight = options.weight ?? 150;
    const tags = options.tags ?? 'back squat';
    const date = options.date ?? '03/02/2025';
    const frameRate = options.frameRate ?? 30;
    const resolution = options.resolution ?? '1080x1920';
    const videoId = options.videoIds?.[0] ?? '1';

    const header = join(['Video id', 'date', 'Video resolution', 'Frame rate', 'weight', 'tags']);
    const meta = join([videoId, date, resolution, String(frameRate), String(weight), tags]);
    const summaryHeader = delimiter === ','
        ? ', average, Min, time of min, Max, time of max'
        : [' ', 'average', 'Min', 'time of min', 'Max', 'time of max'].join(delimiter);
    const avg = options.summaryAverageVelocity ?? '-0.00';
    const summary = [
        summaryHeader,
        `"velocity (vertical, m/s)"${delimiter} ${avg}${delimiter} -0.69${delimiter} 33.896${delimiter}  0.87${delimiter} 24.197`,
        `"displacement (vertical, cm)"${delimiter} -18.90${delimiter} -63.78${delimiter} 19.197${delimiter}  8.80${delimiter} 35.429`,
    ].join('\n');

    const velocityUnit = options.velocityUnit ?? 'm/s';
    const displacementUnit = options.displacementUnit ?? 'cm';
    const velocityHeader = `"velocity (vertical, ${velocityUnit})"`;
    const displacementHeader = `"displacement (vertical, ${displacementUnit})"`;
    const frameColumns = ['Frame ordinal', 'Time (s)', velocityHeader];
    if (!options.omitDisplacement) frameColumns.push(displacementHeader);
    if (options.extraFrameColumns) frameColumns.push(options.extraFrameColumns);
    const frameHeader = frameColumns.join(delimiter);

    const rows: string[] = [];
    let ordinal = 1;
    let time = 16.231;
    const dt = 1 / frameRate;
    const push = (velocity: number, displacement: number): void => {
        const cells = [String(ordinal), time.toFixed(3)];
        const velocityText = options.nonNumericVelocityAt === ordinal ? 'fast' : velocity.toFixed(2);
        cells.push(velocityText);
        if (!options.omitDisplacement) cells.push(displacement.toFixed(2));
        if (options.extraFrameColumns) cells.push('0.00');
        rows.push(cells.join(delimiter));
        ordinal += 1;
        time += dt;
    };

    // Idle lead-in.
    for (let i = 0; i < 5; i += 1) push(0, 0);
    for (const rep of reps) {
        const depth = rep.depthCm;
        const top = rep.topCm ?? 0;
        const descentFrames = rep.descentFrames ?? 20;
        const ascentFrames = rep.ascentFrames ?? 20;
        for (let i = 0; i < descentFrames; i += 1) {
            push(-0.5, (depth * (i + 1)) / descentFrames);
        }
        const peakAt = Math.floor(ascentFrames / 2);
        for (let i = 0; i < ascentFrames; i += 1) {
            const velocity = i === peakAt ? (rep.peakVelocityMps ?? rep.ascentVelocityMps) : rep.ascentVelocityMps;
            // First ascent frame holds the exact bottom so ROM measures the full rise.
            push(velocity, ascentFrames === 1 ? top : depth + ((top - depth) * i) / (ascentFrames - 1));
        }
        // Rest between reps.
        for (let i = 0; i < 8; i += 1) push(0, top);
    }

    const markerFor = (id: string): string => `Video id: ${id}`;
    const markers = options.videoIds && options.videoIds.length > 1
        ? [markerFor(options.videoIds[0]), markerFor(options.videoIds[1])]
        : [markerFor(videoId), markerFor(videoId)];
    const parts = [header, meta, '', markers[0], summary, ''];
    if (options.includePerFrameTable === false) return parts.join('\n');
    parts.push(markers[1], frameHeader, ...rows);
    return parts.join('\n');
}

function squatRep(ascentVelocity: number, peak?: number): SyntheticRepSpec {
    return { depthCm: -55, ascentVelocityMps: ascentVelocity, peakVelocityMps: peak ?? ascentVelocity };
}

describe('wlAnalysisCsv parser version and thresholds', () => {
    it('pins the parser version and exported segmentation thresholds', () => {
        expect(WL_ANALYSIS_CSV_PARSER_V1).toBe('wl-analysis-csv-v1');
        expect(WL_CONCENTRIC_VELOCITY_THRESHOLD_MPS).toBe(0);
        expect(WL_MIN_REP_RISE_CM).toBe(10);
        expect(WL_MIN_REP_RISE_FRACTION).toBe(0.5);
        expect(WL_COMPLETE_DESCENT_FRACTION).toBe(0.85);
    });
});

describe('wlAnalysisCsv rep segmentation', () => {
    it('detects 5 reps in a 5-rep set with the expected MCV/peak/ROM', () => {
        const csv = buildSyntheticCsv([
            squatRep(0.567, 0.79),
            squatRep(0.574, 0.87),
            squatRep(0.549, 0.86),
            squatRep(0.563, 0.82),
            squatRep(0.5, 0.77),
        ]);
        const parsed = parseWlAnalysisCsv(csv);
        expect(parsed.parserVersion).toBe(WL_ANALYSIS_CSV_PARSER_V1);
        expect(parsed.weight).toBe(150);
        expect(parsed.tags).toBe('back squat');
        expect(parsed.reps).toHaveLength(5);
        const means = parsed.reps.map(rep => rep.meanVelocityMps);
        // One peak frame per 20-frame ascent lifts the mean slightly above the base velocity.
        expect(means[0]).toBeGreaterThan(0.56);
        expect(means[0]).toBeLessThan(0.6);
        expect(parsed.reps.map(rep => rep.peakVelocityMps)).toEqual([0.79, 0.87, 0.86, 0.82, 0.77]);
        for (const rep of parsed.reps) {
            expect(rep.romCm).toBeCloseTo(55, 0);
            expect(rep.complete).toBe(true);
        }
    });

    it('parses a single-rep 1RM attempt as one complete rep', () => {
        const csv = buildSyntheticCsv([squatRep(0.32, 0.45)], { tags: 'back squat attempt 1' });
        const parsed = parseWlAnalysisCsv(csv);
        expect(parsed.reps).toHaveLength(1);
        const [rep] = parsed.reps;
        expect(rep.complete).toBe(true);
        expect(rep.meanVelocityMps).toBeGreaterThan(0.3);
        expect(rep.peakVelocityMps).toBe(0.45);
        expect(rep.romCm).toBeCloseTo(55, 0);
    });

    it('marks a missed rep with an incomplete ascent as complete=false', () => {
        // Descent 50 cm, ascent stalls at -20 cm: rise 30 cm qualifies as a rep
        // (threshold max(10, 50% of 30) = 15) but is far short of the 50 cm descent.
        const csv = buildSyntheticCsv([{ depthCm: -50, topCm: -20, ascentVelocityMps: 0.25 }]);
        const parsed = parseWlAnalysisCsv(csv);
        expect(parsed.reps).toHaveLength(1);
        expect(parsed.reps[0].complete).toBe(false);
        expect(parsed.reps[0].romCm).toBeCloseTo(30, 0);
    });

    it('ignores lockout wobble below the rise threshold', () => {
        const wobble: WlAnalysisFrame[] = [];
        let ordinal = 1;
        for (let i = 0; i < 30; i += 1) {
            wobble.push({ ordinal: ordinal++, timeS: i / 30, velocityMps: -0.4, displacementCm: (-55 * (i + 1)) / 30 });
        }
        for (let i = 0; i < 20; i += 1) {
            wobble.push({ ordinal: ordinal++, timeS: 1 + i / 30, velocityMps: 0.55, displacementCm: -55 + (55 * i) / 19 });
        }
        // Lockout wobble: brief positive-velocity jitter with a tiny rise.
        wobble.push({ ordinal: ordinal++, timeS: 2, velocityMps: 0.05, displacementCm: 0.2 });
        wobble.push({ ordinal, timeS: 2.033, velocityMps: 0, displacementCm: 0.2 });
        const reps = segmentWlReps(wobble);
        expect(reps).toHaveLength(1);
        expect(reps[0].romCm).toBeCloseTo(55, 0);
    });

    it('segments bench-like ROM around 40 cm', () => {
        const csv = buildSyntheticCsv([{ depthCm: -40, ascentVelocityMps: 0.45, peakVelocityMps: 0.62 }], { tags: 'bench press' });
        const parsed = parseWlAnalysisCsv(csv);
        expect(parsed.reps).toHaveLength(1);
        expect(parsed.reps[0].romCm).toBeCloseTo(40, 0);
        expect(parsed.reps[0].complete).toBe(true);
    });

    it('is deterministic across parses', () => {
        const csv = buildSyntheticCsv([squatRep(0.567, 0.79), squatRep(0.574, 0.87)]);
        expect(parseWlAnalysisCsv(csv)).toEqual(parseWlAnalysisCsv(csv));
    });

    it('never reads the summary block for values', () => {
        const base = buildSyntheticCsv([squatRep(0.567, 0.79)]);
        const tampered = base.replace('-0.00, -0.69', '9.99, -9.99');
        expect(parseWlAnalysisCsv(tampered).reps).toEqual(parseWlAnalysisCsv(base).reps);
    });
});

describe('wlAnalysisCsv fail-closed errors', () => {
    it('rejects a summary-only export with the per-frame guidance', () => {
        const csv = buildSyntheticCsv([squatRep(0.5)], { includePerFrameTable: false });
        expect(() => parseWlAnalysisCsv(csv)).toThrow(/enable per-frame export in WL Analysis/);
    });

    it('rejects a missing displacement column', () => {
        const csv = buildSyntheticCsv([squatRep(0.5)], { omitDisplacement: true });
        expect(() => parseWlAnalysisCsv(csv)).toThrow(/displacement.*cm/i);
    });

    it('rejects a velocity unit other than m/s', () => {
        const csv = buildSyntheticCsv([squatRep(0.5)], { velocityUnit: 'ft/s' });
        expect(() => parseWlAnalysisCsv(csv)).toThrow(/not m\/s/);
    });

    it('rejects non-numeric frame values in plain language', () => {
        const csv = buildSyntheticCsv([squatRep(0.5)], { nonNumericVelocityAt: 8 });
        expect(() => parseWlAnalysisCsv(csv)).toThrow(/not a number/);
    });

    it('rejects more than one video id', () => {
        const csv = buildSyntheticCsv([squatRep(0.5)], { videoIds: ['1', '2'] });
        expect(() => parseWlAnalysisCsv(csv)).toThrow(/one video per CSV/i);
    });

    it('rejects an unknown delimiter', () => {
        const csv = buildSyntheticCsv([squatRep(0.5)], { delimiter: '|' });
        expect(() => parseWlAnalysisCsv(csv)).toThrow(/delimiter/i);
    });
});

interface DriftRepSpec {
    /** Frames at the bottom with small positive velocity before the real ascent. */
    leadDriftFrames?: number;
    /** Frames after the ascent with small positive velocity (slow settle at lockout). */
    tailDriftFrames?: number;
    driftVelocityMps?: number;
    driftRiseCmPerFrame?: number;
    /** Top of the main ascent (cm); the descent starts at 0 and bottoms out at -55. */
    ascentTopCm?: number;
}

/** One squat rep built frame by frame: descent, optional lead drift, ascent, optional tail drift. */
function driftRepFrames(spec: DriftRepSpec = {}): WlAnalysisFrame[] {
    const frames: WlAnalysisFrame[] = [];
    const drift = spec.driftVelocityMps ?? 0.03;
    const step = spec.driftRiseCmPerFrame ?? 0.1;
    const top = spec.ascentTopCm ?? 0;
    let ordinal = 1;
    let displacement = 0;
    const push = (velocityMps: number, displacementCm: number): void => {
        frames.push({ ordinal, timeS: (ordinal - 1) / 30, velocityMps, displacementCm });
        ordinal += 1;
        displacement = displacementCm;
    };
    push(0, 0);
    for (let i = 0; i < 30; i += 1) push(-0.4, (-55 * (i + 1)) / 30);
    for (let i = 0; i < (spec.leadDriftFrames ?? 0); i += 1) push(drift, displacement + step);
    const bottom = displacement;
    // First ascent frame holds the exact bottom so the run's rise is the full ascent.
    for (let i = 0; i < 20; i += 1) push(0.6, bottom + ((top - bottom) * i) / 19);
    for (let i = 0; i < (spec.tailDriftFrames ?? 0); i += 1) push(drift, displacement + step);
    push(0, displacement);
    return frames;
}

describe('wlAnalysisCsv v2 rep boundaries (#983)', () => {
    it('pins the v2 parser version and boundary floor', () => {
        expect(WL_ANALYSIS_CSV_PARSER_V2).toBe('wl-analysis-csv-v2');
        expect(WL_BOUNDARY_VELOCITY_FLOOR_MPS).toBe(0.05);
    });

    it('keeps the default parser at v1 so stored v1 trials stay reproducible', () => {
        const csv = buildSyntheticCsv([squatRep(0.567, 0.79)]);
        expect(parseWlAnalysisCsv(csv).parserVersion).toBe(WL_ANALYSIS_CSV_PARSER_V1);
        expect(parseWlAnalysisCsv(csv, WL_ANALYSIS_CSV_PARSER_V2).parserVersion).toBe(WL_ANALYSIS_CSV_PARSER_V2);
    });

    it('reports a slow lockout settle without diluting mean velocity', () => {
        const clean = segmentWlReps(driftRepFrames(), WL_ANALYSIS_CSV_PARSER_V2);
        const settled = driftRepFrames({ tailDriftFrames: 7 });
        const v1 = segmentWlReps(settled, WL_ANALYSIS_CSV_PARSER_V1);
        const v2 = segmentWlReps(settled, WL_ANALYSIS_CSV_PARSER_V2);
        expect(v2).toHaveLength(1);
        expect(v2[0].meanVelocityMps).toBeCloseTo(clean[0].meanVelocityMps, 3);
        expect(v2[0].frameCount).toBe(clean[0].frameCount);
        // v1 still averages the settle in: same detection, lower mean.
        expect(v1).toHaveLength(1);
        expect(v1[0].meanVelocityMps).toBeLessThan(v2[0].meanVelocityMps - 0.1);
        expect(v1[0].complete).toBe(v2[0].complete);
    });

    it('reports drift at the bottom without diluting mean velocity', () => {
        const clean = segmentWlReps(driftRepFrames(), WL_ANALYSIS_CSV_PARSER_V2);
        const v2 = segmentWlReps(driftRepFrames({ leadDriftFrames: 5 }), WL_ANALYSIS_CSV_PARSER_V2);
        expect(v2).toHaveLength(1);
        expect(v2[0].meanVelocityMps).toBeCloseTo(clean[0].meanVelocityMps, 3);
        // The reported window starts at the real ascent: 55 cm minus the 0.5 cm drifted at the bottom.
        expect(v2[0].romCm).toBeCloseTo(54.5, 1);
        expect(clean[0].romCm).toBeCloseTo(55, 1);
    });

    it('matches v1 exactly when no boundary frame is below the floor', () => {
        const csv = buildSyntheticCsv([
            squatRep(0.567, 0.79),
            squatRep(0.574, 0.87),
            { depthCm: -40, ascentVelocityMps: 0.45, peakVelocityMps: 0.62 },
        ]);
        expect(parseWlAnalysisCsv(csv, WL_ANALYSIS_CSV_PARSER_V2).reps).toEqual(parseWlAnalysisCsv(csv).reps);
    });

    it('decides completeness on the whole run, so v1 and v2 agree on success/miss', () => {
        // Main ascent reaches 84 % of the 55 cm descent; a 10-frame settle (+0.2 cm each) lifts the
        // whole run to 87.6 %. v2 reports the shorter window but must not turn the rep into a miss.
        const frames = driftRepFrames({ ascentTopCm: -55 + 0.84 * 55, tailDriftFrames: 10, driftRiseCmPerFrame: 0.2 });
        const v1 = segmentWlReps(frames, WL_ANALYSIS_CSV_PARSER_V1);
        const v2 = segmentWlReps(frames, WL_ANALYSIS_CSV_PARSER_V2);
        expect(v1[0].complete).toBe(true);
        expect(v2[0].complete).toBe(true);
        expect(v2[0].romCm).toBeLessThan(WL_COMPLETE_DESCENT_FRACTION * 55);
    });

    it('falls back to the whole run when no frame reaches the floor', () => {
        const frames: WlAnalysisFrame[] = [{ ordinal: 1, timeS: 0, velocityMps: 0, displacementCm: 0 }];
        for (let i = 1; i <= 300; i += 1) {
            frames.push({ ordinal: i + 1, timeS: i / 30, velocityMps: 0.04, displacementCm: (40 * i) / 300 });
        }
        frames.push({ ordinal: 302, timeS: 301 / 30, velocityMps: 0, displacementCm: 40 });
        expect(segmentWlReps(frames, WL_ANALYSIS_CSV_PARSER_V2)).toEqual(segmentWlReps(frames, WL_ANALYSIS_CSV_PARSER_V1));
    });
});
