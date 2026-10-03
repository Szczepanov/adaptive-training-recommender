/** Pure offline evidence tooling. Differences are always OpenBar minus WL. */
import type { ConcentricRep, ConcentricSegmentationRule } from './concentricSegmentation.ts';
import type { OpenBarProvenance } from './openBarAnalysis.ts';

export interface AgreementOpenBarRep extends ConcentricRep {
    exclusion: null | 'spans_gap' | 'touches_series_edge';
}

export type AgreementJsonValue = null | boolean | number | string
    | readonly AgreementJsonValue[] | { readonly [key: string]: AgreementJsonValue };

export interface AgreementInput {
    label: string;
    loadKg: number;
    offsetS?: number;
    wl: {
        fileSha256: string;
        parserVersion: string;
        segmentationRule: ConcentricSegmentationRule;
        videoId: string;
        reps: readonly ConcentricRep[];
    };
    openBar: {
        fileSha256: string;
        parserVersion: string;
        segmentationRule: ConcentricSegmentationRule;
        sourceVideoSha256: string;
        /** SHA-256 of the canonical OpenBar measurement-method configuration (not video-specific scale). */
        methodConfigSha256: string;
        provenance: AgreementJsonValue | OpenBarProvenance;
        breakCount: number;
        reps: readonly AgreementOpenBarRep[];
    };
}

export interface PairingOptions {
    minOverlap?: number;
    /** Added to OpenBar times to place them on the WL timeline. */
    offsetS?: number;
}

export interface RepPair {
    wl: ConcentricRep;
    openBar: AgreementOpenBarRep;
    temporalIoU: number;
}

export interface RepPairing {
    paired: RepPair[];
    wlOnly: { rep: ConcentricRep; reason: 'no_overlap_match' }[];
    openBarOnly: { rep: AgreementOpenBarRep; reason: 'no_overlap_match' }[];
    openBarExcluded: { rep: AgreementOpenBarRep; reason: 'spans_gap' | 'touches_series_edge' }[];
}

function finite(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}

function validateReps(reps: readonly ConcentricRep[], source: string): void {
    const indices = new Set<number>();
    for (const rep of reps) {
        if (!Number.isInteger(rep.index) || rep.index < 0 || indices.has(rep.index)) {
            throw new Error(`${source} rep indices must be unique non-negative integers.`);
        }
        indices.add(rep.index);
        for (const key of ['startTimeS', 'endTimeS', 'meanVelocityMps', 'peakVelocityMps', 'romCm'] as const) {
            finite(rep[key], `${source} rep ${rep.index} ${key}`);
        }
        if (rep.endTimeS <= rep.startTimeS) throw new Error(`${source} rep ${rep.index} has an invalid interval.`);
        finite(rep.endTimeS - rep.startTimeS, `${source} rep ${rep.index} interval`);
    }
}

/** Greedy one-to-one IoU matching; sort keys use source indices, never array positions. */
export function pairReps(
    wlReps: readonly ConcentricRep[],
    openBarReps: readonly AgreementOpenBarRep[],
    options: PairingOptions = {},
): RepPairing {
    const minOverlap = options.minOverlap ?? 0.5;
    const offsetS = options.offsetS ?? 0;
    finite(minOverlap, 'minOverlap');
    finite(offsetS, 'offsetS');
    if (minOverlap < 0 || minOverlap > 1) throw new Error('minOverlap must be between 0 and 1.');
    validateReps(wlReps, 'WL');
    validateReps(openBarReps, 'OpenBar');
    const candidates: RepPair[] = [];
    for (const openBar of openBarReps) {
        if (openBar.exclusion !== null && openBar.exclusion !== 'spans_gap' && openBar.exclusion !== 'touches_series_edge') {
            throw new Error(`OpenBar rep ${openBar.index} has an unknown exclusion.`);
        }
        const start = openBar.startTimeS + offsetS;
        const end = openBar.endTimeS + offsetS;
        finite(start, 'shifted OpenBar start');
        finite(end, 'shifted OpenBar end');
        if (end <= start) throw new Error('Shifted OpenBar interval must have positive duration.');
        if (openBar.exclusion !== null) continue;
        for (const wl of wlReps) {
            const intersection = Math.max(0, Math.min(wl.endTimeS, end) - Math.max(wl.startTimeS, start));
            const union = Math.max(wl.endTimeS, end) - Math.min(wl.startTimeS, start);
            finite(union, 'temporal union');
            const temporalIoU = intersection / union;
            // Even a zero threshold cannot pair disjoint intervals.
            if (intersection > 0 && temporalIoU >= minOverlap) candidates.push({ wl, openBar, temporalIoU });
        }
    }
    candidates.sort((a, b) => b.temporalIoU - a.temporalIoU || a.wl.index - b.wl.index || a.openBar.index - b.openBar.index);
    const wlUsed = new Set<number>();
    const openBarUsed = new Set<number>();
    const paired: RepPair[] = [];
    for (const pair of candidates) {
        if (wlUsed.has(pair.wl.index) || openBarUsed.has(pair.openBar.index)) continue;
        wlUsed.add(pair.wl.index);
        openBarUsed.add(pair.openBar.index);
        paired.push(pair);
    }
    paired.sort((a, b) => a.wl.index - b.wl.index || a.openBar.index - b.openBar.index);
    return {
        paired,
        wlOnly: [...wlReps].sort((a, b) => a.index - b.index).filter(rep => !wlUsed.has(rep.index))
            .map(rep => ({ rep, reason: 'no_overlap_match' })),
        openBarOnly: [...openBarReps].sort((a, b) => a.index - b.index)
            .filter(rep => rep.exclusion === null && !openBarUsed.has(rep.index))
            .map(rep => ({ rep, reason: 'no_overlap_match' })),
        openBarExcluded: [...openBarReps].sort((a, b) => a.index - b.index)
            .flatMap(rep => rep.exclusion === null ? [] : [{ rep, reason: rep.exclusion }]),
    };
}

export type AgreementStatReason = 'insufficient_n' | 'constant_magnitudes' | 'zero_variance' | 'invalid_scale' | 'non_finite_result';
type Statistic = 'bias' | 'sampleSd' | 'lowerLoA' | 'upperLoA' | 'meanAbsoluteDifference'
    | 'slope' | 'intercept' | 'pearsonR' | 'geometricMeanRatio';
export type AgreementStats = { n: number; reasons: Record<Statistic, AgreementStatReason | null> }
    & Record<Statistic, number | null>;

function mean(values: readonly number[]): number {
    // Identical data have exactly zero variance, even when repeated division/summation
    // would introduce rounding error (for example, six observations equal to one).
    if (values.length > 0 && values.every(value => value === values[0])) return values[0];
    return values.reduce((total, value) => total + value / values.length, 0);
}

function maxAbsolute(values: readonly number[]): number {
    return values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
}

/** Sample LoA are descriptive; OLS needs three observations. */
export function agreementStats(differences: readonly number[], magnitudes: readonly number[]): AgreementStats {
    if (differences.length !== magnitudes.length) throw new Error('Differences and magnitudes must have equal lengths.');
    differences.forEach(value => finite(value, 'difference'));
    magnitudes.forEach(value => finite(value, 'magnitude'));
    const n = differences.length;
    const stats: AgreementStats = {
        n, bias: null, sampleSd: null, lowerLoA: null, upperLoA: null,
        meanAbsoluteDifference: null, slope: null, intercept: null, pearsonR: null, geometricMeanRatio: null,
        reasons: {
            bias: 'insufficient_n', sampleSd: 'insufficient_n', lowerLoA: 'insufficient_n', upperLoA: 'insufficient_n',
            meanAbsoluteDifference: 'insufficient_n', slope: 'insufficient_n', intercept: 'insufficient_n',
            pearsonR: 'insufficient_n', geometricMeanRatio: 'insufficient_n',
        },
    };
    const set = (key: Statistic, value: number): void => {
        stats[key] = Number.isFinite(value) ? value : null;
        stats.reasons[key] = Number.isFinite(value) ? null : 'non_finite_result';
    };
    if (n === 0) return stats;
    const bias = mean(differences);
    // Subtraction of two measurements and centering can introduce a few ulps.
    // Classify only machine-scale variation as zero, relative to the source scale;
    // this is an arithmetic guard, not a statistical or scientific threshold.
    const magnitudeScale = maxAbsolute(magnitudes);
    const differenceTolerance = Number.EPSILON * Math.max(magnitudeScale, maxAbsolute(differences)) * 4;
    const magnitudeTolerance = Number.EPSILON * magnitudeScale * 4;
    set('bias', bias);
    set('meanAbsoluteDifference', mean(differences.map(Math.abs)));
    if (n >= 2) {
        const deviations = differences.map(value => value - bias);
        const scale = maxAbsolute(deviations);
        const sd = scale <= differenceTolerance ? 0 : scale * Math.sqrt(deviations.reduce((sum, d) => sum + (d / scale) ** 2, 0) / (n - 1));
        set('sampleSd', sd);
        set('lowerLoA', bias - 1.96 * sd);
        set('upperLoA', bias + 1.96 * sd);
    }
    const logs = differences.map((d, i) => {
        const wl = magnitudes[i] - d / 2;
        const openBar = magnitudes[i] + d / 2;
        return wl > 0 && openBar > 0 && Number.isFinite(wl) && Number.isFinite(openBar)
            ? Math.log(openBar) - Math.log(wl) : null;
    });
    if (logs.some(value => value === null)) stats.reasons.geometricMeanRatio = 'invalid_scale';
    else set('geometricMeanRatio', Math.exp(mean(logs as number[])));
    if (n >= 3) {
        const magnitudeMean = mean(magnitudes);
        const x = magnitudes.map(value => value - magnitudeMean);
        const y = differences.map(value => value - bias);
        const xScale = maxAbsolute(x);
        const yScale = maxAbsolute(y);
        if (xScale <= magnitudeTolerance) {
            stats.reasons.slope = stats.reasons.intercept = stats.reasons.pearsonR = 'constant_magnitudes';
        } else if (yScale <= differenceTolerance) {
            set('slope', 0);
            set('intercept', bias);
            stats.reasons.pearsonR = 'zero_variance';
        } else {
            const xx = x.reduce((sum, value) => sum + (value / xScale) ** 2, 0);
            const yy = y.reduce((sum, value) => sum + (value / yScale) ** 2, 0);
            const xy = x.reduce((sum, value, i) => sum + (value / xScale) * (y[i] / yScale), 0);
            const slope = (xy / xx) * (yScale / xScale);
            set('slope', slope);
            set('intercept', bias - slope * magnitudeMean);
            const r = xy / Math.sqrt(xx * yy);
            set('pearsonR', Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : r);
        }
    }
    return stats;
}

const METRICS = ['meanVelocityMps', 'peakVelocityMps', 'romCm'] as const;
type Metric = typeof METRICS[number];
interface RepMeasurement { wl: number; openBar: number; difference: number; magnitude: number }
interface AgreementRow {
    label: string;
    loadKg: number;
    wlIndex: number;
    openBarIndex: number;
    wlComplete: boolean;
    openBarComplete: boolean;
    temporalIoU: number;
    meanVelocityMps: RepMeasurement;
    peakVelocityMps: RepMeasurement;
    romCm: RepMeasurement;
}

function measurements(wl: number, openBar: number): RepMeasurement {
    const difference = openBar - wl;
    const magnitude = openBar / 2 + wl / 2;
    finite(difference, 'paired difference');
    finite(magnitude, 'paired magnitude');
    return { wl, openBar, difference, magnitude };
}

function reportRep(rep: ConcentricRep): ConcentricRep {
    return {
        index: rep.index, startFrame: rep.startFrame, endFrame: rep.endFrame, frameCount: rep.frameCount,
        startTimeS: rep.startTimeS, endTimeS: rep.endTimeS, durationS: rep.durationS,
        meanVelocityMps: rep.meanVelocityMps, peakVelocityMps: rep.peakVelocityMps, romCm: rep.romCm, complete: rep.complete,
    };
}

function metricStats(rows: readonly AgreementRow[]): Record<Metric, AgreementStats> {
    const compute = (metric: Metric): AgreementStats => agreementStats(rows.map(row => row[metric].difference), rows.map(row => row[metric].magnitude));
    return { meanVelocityMps: compute('meanVelocityMps'), peakVelocityMps: compute('peakVelocityMps'), romCm: compute('romCm') };
}

/** Preserve schema key order; sort only unconstrained provenance keys. */
function canonicalProvenance(value: unknown): AgreementJsonValue {
    if (typeof value === 'number') {
        finite(value, 'provenance number');
        return value;
    }
    if (Array.isArray(value)) return value.map(canonicalProvenance);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalProvenance((value as Record<string, unknown>)[key])]));
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    throw new Error('Provenance must contain JSON values.');
}

function roundNumbers(_key: string, value: unknown): unknown {
    if (typeof value !== 'number') return value;
    finite(value, 'report number');
    // toFixed avoids overflowing value * 1e6 for large finite metadata.
    return Number(value.toFixed(6));
}

function md(value: string | number): string {
    return String(value).replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const AGREEMENT_POOLING_CAVEAT = 'Reps are nested within videos. Pooled figures are descriptive and do not account for within-video dependence.';
export const AGREEMENT_METHOD_CONFIG_CAVEAT = 'Each report is method-homogeneous: parser versions and segmentation are fixed across the cohort, while tracker/model/filter/kinematics/calibration-method configuration is fingerprinted; mixed methods must be reported separately.';
export const AGREEMENT_RATIO_CAVEAT = 'The geometric OpenBar/WL ratio is a cross-device measurement ratio, not an independent physical calibration-scale estimate.';
export const AGREEMENT_VELOCITY_METHOD_CAVEAT = 'OpenBar uses backward-difference velocity. The WL derivative scheme is unknown; central difference is not established.';

/** Deterministic strings, with no filesystem, wall clock, host or other IO. */
export function buildAgreementReport(
    inputs: readonly AgreementInput[],
    options: Pick<PairingOptions, 'minOverlap'> = {},
): { json: string; markdown: string } {
    const sorted = [...inputs].sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    const labels = new Set<string>();
    // Assert the complete cohort before any matching or statistics.
    for (const input of sorted) {
        if (!input.label.trim() || labels.has(input.label)) throw new Error('Pair labels must be non-empty and unique.');
        labels.add(input.label);
        if (input.wl.segmentationRule !== input.openBar.segmentationRule) throw new Error(`Segmentation rule mismatch for ${input.label}.`);
        if (!input.wl.parserVersion.trim() || !input.openBar.parserVersion.trim()) throw new Error('Parser versions must be non-empty.');
        if (sorted[0].wl.segmentationRule !== input.wl.segmentationRule) throw new Error('All videos must use the same segmentation rule.');
        if (sorted[0].wl.parserVersion !== input.wl.parserVersion) throw new Error('All videos must use the same WL parser version.');
        if (sorted[0].openBar.parserVersion !== input.openBar.parserVersion) throw new Error('All videos must use the same OpenBar parser version.');
        if (sorted[0].openBar.methodConfigSha256 !== input.openBar.methodConfigSha256) {
            throw new Error('All videos in one report must use the same OpenBar method configuration. Split distinct tracker/filter/kinematics configurations into separate reports.');
        }
        finite(input.loadKg, 'loadKg');
        if (input.loadKg <= 0) throw new Error('loadKg must be positive.');
        if (!Number.isInteger(input.openBar.breakCount) || input.openBar.breakCount < 0) throw new Error('breakCount must be a non-negative integer.');
        for (const hash of [input.wl.fileSha256, input.openBar.fileSha256, input.openBar.sourceVideoSha256, input.openBar.methodConfigSha256]) {
            if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('File and source video SHA-256 values must have 64 hexadecimal characters.');
        }
    }
    const minOverlap = options.minOverlap ?? 0.5;
    finite(minOverlap, 'minOverlap');
    if (minOverlap < 0 || minOverlap > 1) throw new Error('minOverlap must be between 0 and 1.');
    const videos = sorted.map(input => {
        const pairing = pairReps(input.wl.reps, input.openBar.reps, { minOverlap, offsetS: input.offsetS });
        const rows: AgreementRow[] = pairing.paired.map(({ wl, openBar, temporalIoU }) => ({
            label: input.label, loadKg: input.loadKg, wlIndex: wl.index, openBarIndex: openBar.index,
            wlComplete: wl.complete, openBarComplete: openBar.complete, temporalIoU,
            meanVelocityMps: measurements(wl.meanVelocityMps, openBar.meanVelocityMps),
            peakVelocityMps: measurements(wl.peakVelocityMps, openBar.peakVelocityMps),
            romCm: measurements(wl.romCm, openBar.romCm),
        }));
        return {
            label: input.label, loadKg: input.loadKg, offsetS: input.offsetS ?? 0,
            wl: { fileSha256: input.wl.fileSha256, parserVersion: input.wl.parserVersion, segmentationRule: input.wl.segmentationRule, videoId: input.wl.videoId },
            openBar: {
                fileSha256: input.openBar.fileSha256, parserVersion: input.openBar.parserVersion,
                segmentationRule: input.openBar.segmentationRule, sourceVideoSha256: input.openBar.sourceVideoSha256,
                methodConfigSha256: input.openBar.methodConfigSha256,
                provenance: canonicalProvenance(input.openBar.provenance), breakCount: input.openBar.breakCount,
            },
            counts: {
                wlTotal: input.wl.reps.length, openBarTotal: input.openBar.reps.length, paired: rows.length,
                wlOnly: pairing.wlOnly.length, openBarOnly: pairing.openBarOnly.length, openBarExcluded: pairing.openBarExcluded.length,
            },
            stats: metricStats(rows), paired: rows,
            wlOnly: pairing.wlOnly.map(({ rep, reason }) => ({ rep: reportRep(rep), reason })),
            openBarOnly: pairing.openBarOnly.map(({ rep, reason }) => ({ rep: { ...reportRep(rep), exclusion: rep.exclusion }, reason })),
            openBarExcluded: pairing.openBarExcluded.map(({ rep, reason }) => ({ rep: { ...reportRep(rep), exclusion: rep.exclusion }, reason })),
        };
    });
    const rows = videos.flatMap(video => video.paired);
    const sum = (key: keyof typeof videos[number]['counts']): number => videos.reduce((total, video) => total + video.counts[key], 0);
    const report = {
        schemaVersion: 'velocity-agreement-v1', segmentationRule: sorted[0]?.wl.segmentationRule ?? null,
        wlParserVersion: sorted[0]?.wl.parserVersion ?? null,
        openBarParserVersion: sorted[0]?.openBar.parserVersion ?? null,
        openBarMethodConfigSha256: sorted[0]?.openBar.methodConfigSha256 ?? null,
        differenceConvention: 'OpenBar minus WL', primaryMetric: 'meanVelocityMps', secondaryMetrics: ['peakVelocityMps', 'romCm'],
        minOverlap, caveats: [AGREEMENT_POOLING_CAVEAT, AGREEMENT_METHOD_CONFIG_CAVEAT, AGREEMENT_RATIO_CAVEAT, AGREEMENT_VELOCITY_METHOD_CAVEAT],
        pooled: {
            videoCount: videos.length,
            counts: { wlTotal: sum('wlTotal'), openBarTotal: sum('openBarTotal'), paired: sum('paired'), wlOnly: sum('wlOnly'), openBarOnly: sum('openBarOnly'), openBarExcluded: sum('openBarExcluded') },
            stats: metricStats(rows),
        },
        videos,
    };
    const json = `${JSON.stringify(report, roundNumbers, 2)}\n`;
    // Render exactly the rounded values serialized in JSON.
    const rounded = JSON.parse(json) as typeof report;
    const lines = [
        '# Velocity agreement report', '',
        `Segmentation: ${md(rounded.segmentationRule ?? 'none')}. Minimum temporal IoU: ${rounded.minOverlap}.`,
        'Differences: OpenBar minus WL. Primary: mean velocity (m/s). Secondary: peak velocity (m/s), ROM (cm).', '',
        AGREEMENT_POOLING_CAVEAT, '', AGREEMENT_METHOD_CONFIG_CAVEAT, '', AGREEMENT_RATIO_CAVEAT, '', AGREEMENT_VELOCITY_METHOD_CAVEAT, '',
        '## Counts', '',
        '| Scope | WL total | OpenBar total | Paired | WL only | OpenBar only | OpenBar excluded |',
        '| --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const video of [{ label: 'Pooled', counts: rounded.pooled.counts }, ...rounded.videos]) {
        const c = video.counts;
        lines.push(`| ${md(video.label)} | ${c.wlTotal} | ${c.openBarTotal} | ${c.paired} | ${c.wlOnly} | ${c.openBarOnly} | ${c.openBarExcluded} |`);
    }
    const show = (stats: AgreementStats, key: Statistic): string => stats[key] === null ? `null (${stats.reasons[key]})` : String(stats[key]);
    for (const scope of [{ label: 'Pooled', stats: rounded.pooled.stats }, ...rounded.videos]) {
        lines.push('', `## ${md(scope.label)} statistics`, '',
            '| Metric | n | Bias | Sample SD | Lower 95% LoA | Upper 95% LoA | Mean absolute difference | Slope | Intercept | Pearson r | Geometric OpenBar/WL measurement ratio |',
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
        for (const metric of METRICS) {
            const s = scope.stats[metric];
            lines.push(`| ${metric} | ${s.n} | ${(['bias', 'sampleSd', 'lowerLoA', 'upperLoA', 'meanAbsoluteDifference', 'slope', 'intercept', 'pearsonR', 'geometricMeanRatio'] as const).map(key => show(s, key)).join(' | ')} |`);
        }
    }
    for (const video of rounded.videos) {
        lines.push('', `## ${md(video.label)} provenance and reps`, '',
            `Load: ${video.loadKg} kg. OpenBar time offset: ${video.offsetS} s. Tracking breaks: ${video.openBar.breakCount}.`,
            `WL video id: ${md(video.wl.videoId)}. Parser: ${md(video.wl.parserVersion)}. File SHA-256: ${md(video.wl.fileSha256)}.`,
            `OpenBar parser: ${md(video.openBar.parserVersion)}. File SHA-256: ${md(video.openBar.fileSha256)}. Source video SHA-256: ${md(video.openBar.sourceVideoSha256)}.`,
            `OpenBar method configuration SHA-256: ${md(video.openBar.methodConfigSha256)}.`,
            '', 'OpenBar provenance:', '', '```json', JSON.stringify(video.openBar.provenance, null, 2), '```', '',
            '| WL rep | OpenBar rep | IoU | Metric | WL | OpenBar | Difference | Magnitude |',
            '| --- | --- | --- | --- | --- | --- | --- | --- |');
        for (const row of video.paired) for (const metric of METRICS) {
            const m = row[metric];
            lines.push(`| ${row.wlIndex} | ${row.openBarIndex} | ${row.temporalIoU} | ${metric} | ${m.wl} | ${m.openBar} | ${m.difference} | ${m.magnitude} |`);
        }
        for (const [source, unmatched] of [['WL only', video.wlOnly], ['OpenBar only', video.openBarOnly], ['OpenBar excluded', video.openBarExcluded]] as const) {
            for (const { rep, reason } of unmatched) {
                lines.push('', `${source}: rep ${rep.index}, ${reason}; interval ${rep.startTimeS}–${rep.endTimeS} s; mean ${rep.meanVelocityMps} m/s, peak ${rep.peakVelocityMps} m/s, ROM ${rep.romCm} cm.`);
            }
        }
    }
    return { json, markdown: `${lines.join('\n')}\n` };
}
