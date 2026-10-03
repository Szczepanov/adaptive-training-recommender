/**
 * Issue #897 PR B2: pure, versioned parser for WL Analysis per-frame CSV exports.
 *
 * WL Analysis velocity stays a RAW trial field (ADR-0046 D-AT-RAWFIELDS): this module only
 * parses the export into rep candidates. It never writes Firestore, never uploads anything,
 * and never reads the summary block for values (the summary is averaged over the whole
 * exported window, so ascent and descent cancel).
 *
 * Expected file shape (from a real export):
 * - `Video id,date,Video resolution,Frame rate,weight,tags` + one metadata row
 * - `Video id: N` + summary block (`, average, Min, time of min, Max, time of max` + rows)
 * - `Video id: N` + per-frame table (`Frame ordinal,Time (s),"velocity (vertical, m/s)",...`)
 */

import {
    CONCENTRIC_SEGMENTATION_V1,
    CONCENTRIC_SEGMENTATION_V2,
    segmentConcentricReps,
    type ConcentricFrame,
    type ConcentricRep,
    type ConcentricSegmentationRule,
} from './concentricSegmentation.ts';

export {
    CONCENTRIC_VELOCITY_THRESHOLD_MPS as WL_CONCENTRIC_VELOCITY_THRESHOLD_MPS,
    MIN_REP_RISE_CM as WL_MIN_REP_RISE_CM,
    MIN_REP_RISE_FRACTION as WL_MIN_REP_RISE_FRACTION,
    COMPLETE_DESCENT_FRACTION as WL_COMPLETE_DESCENT_FRACTION,
    BOUNDARY_VELOCITY_FLOOR_MPS as WL_BOUNDARY_VELOCITY_FLOOR_MPS,
    BOUNDARY_MAX_TRIM_RISE_CM as WL_BOUNDARY_MAX_TRIM_RISE_CM,
} from './concentricSegmentation.ts';

export const WL_ANALYSIS_CSV_PARSER_V1 = 'wl-analysis-csv-v1';
/** v2 reports the guarded active window; detection and completeness remain identical to v1. */
export const WL_ANALYSIS_CSV_PARSER_V2 = 'wl-analysis-csv-v2';
export type WlAnalysisParserVersion = typeof WL_ANALYSIS_CSV_PARSER_V1 | typeof WL_ANALYSIS_CSV_PARSER_V2;
export const WL_PARSER_SEGMENTATION_RULE: Readonly<Record<WlAnalysisParserVersion, ConcentricSegmentationRule>> = Object.freeze({
    [WL_ANALYSIS_CSV_PARSER_V1]: CONCENTRIC_SEGMENTATION_V1,
    [WL_ANALYSIS_CSV_PARSER_V2]: CONCENTRIC_SEGMENTATION_V2,
});
export type WlAnalysisFrame = ConcentricFrame;
export type WlAnalysisRep = ConcentricRep;

export interface WlAnalysisCsvParse {
    parserVersion: WlAnalysisParserVersion;
    videoId: string;
    /** Raw `date` cell; ambiguous DD/MM vs MM/DD by construction, never parsed here. */
    dateRaw: string;
    resolution: string;
    frameRate: number;
    /** Raw `weight` cell; the file carries no unit, so the preview must confirm kg. */
    weight: number;
    tags: string;
    frames: readonly WlAnalysisFrame[];
    reps: readonly WlAnalysisRep[];
    /**
     * Normalized summary-block text, kept ONLY to warn when the same video was exported
     * twice. Summary values are never used for any measurement.
     */
    summarySignature: string;
}

type Delimiter = ',' | ';' | '\t';

const VIDEO_MARKER_PATTERN = /^video id:\s*(\d+)\s*$/i;

function fail(message: string): never {
    throw new Error(message);
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Minimal CSV split that respects double-quoted cells (including embedded delimiters). */
function splitCsvLine(line: string, delimiter: Delimiter): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === delimiter) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells.map(cell => cell.trim());
}

function detectDelimiter(headerLine: string): Delimiter {
    const candidates: readonly Delimiter[] = [',', ';', '\t'];
    let best: Delimiter | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
        const cells = splitCsvLine(headerLine, candidate).map(cell => cell.toLowerCase());
        let score = 0;
        if (cells.some(cell => cell === 'video id')) score += 1;
        if (cells.some(cell => cell === 'date')) score += 1;
        if (cells.some(cell => cell === 'weight')) score += 1;
        if (cells.some(cell => cell === 'tags')) score += 1;
        if (cells.some(cell => cell.includes('frame rate'))) score += 1;
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    if (!best || bestScore < 4) {
        fail(
            'This file does not look like a WL Analysis CSV export (unknown delimiter). '
            + 'Export the video from WL Analysis as a CSV file and try again.',
        );
    }
    return best;
}

function parseDecimal(raw: string, delimiter: Delimiter, label: string): number {
    const text = raw.trim();
    if (text.length === 0) fail(`${label} is missing. Check the WL Analysis export and try again.`);
    if (delimiter === ';') {
        const normalized = text.replace(',', '.');
        const value = Number(normalized);
        if (!Number.isFinite(value)) fail(`${label} ("${raw}") is not a number. Check the WL Analysis export and try again.`);
        return value;
    }
    if (text.includes(',')) {
        fail(
            `${label} ("${raw}") uses an unknown decimal format. `
            + 'Export the video from WL Analysis with a dot decimal separator and try again.',
        );
    }
    const value = Number(text);
    if (!Number.isFinite(value)) fail(`${label} ("${raw}") is not a number. Check the WL Analysis export and try again.`);
    return value;
}

function normalizeHeaderCell(cell: string): string {
    return cell.trim().toLowerCase();
}

/**
 * Split a metric header such as `velocity (vertical, m/s)` into its parts.
 * Returns null when the header carries no `(direction, unit)` suffix.
 */
function parseMetricHeader(cell: string): { metric: string; direction: string; unit: string } | null {
    const match = cell.trim().match(/^(.*?)\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/);
    if (!match) return null;
    return {
        metric: match[1].trim().toLowerCase(),
        direction: match[2].trim().toLowerCase(),
        unit: match[3].trim().toLowerCase(),
    };
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/** Compatibility wrapper: never expose source-neutral bookkeeping in WL parse results. */
export function segmentWlReps(
    frames: readonly WlAnalysisFrame[],
    parserVersion: WlAnalysisParserVersion = WL_ANALYSIS_CSV_PARSER_V1,
): WlAnalysisRep[] {
    return segmentConcentricReps(frames, WL_PARSER_SEGMENTATION_RULE[parserVersion]).map(segment => ({
        index: segment.index,
        startFrame: segment.startFrame,
        endFrame: segment.endFrame,
        frameCount: segment.frameCount,
        startTimeS: segment.startTimeS,
        endTimeS: segment.endTimeS,
        durationS: segment.durationS,
        meanVelocityMps: segment.meanVelocityMps,
        peakVelocityMps: segment.peakVelocityMps,
        romCm: segment.romCm,
        complete: segment.complete,
    }));
}

/** Deterministic signature of the per-frame measurement data (velocity + displacement). */
export function wlFrameDataSignature(frames: readonly WlAnalysisFrame[]): string {
    return frames.map(frame => `${frame.velocityMps}:${frame.displacementCm}`).join(';');
}

export function parseWlAnalysisCsv(
    rawText: string,
    parserVersion: WlAnalysisParserVersion = WL_ANALYSIS_CSV_PARSER_V1,
): WlAnalysisCsvParse {
    const text = stripBom(rawText);
    if (text.trim().length === 0) fail('This file is empty. Export the video from WL Analysis as a CSV file and try again.');
    const lines = text.split(/\r\n|\r|\n/);

    const firstIdx = lines.findIndex(line => line.trim().length > 0);
    if (firstIdx === -1) fail('This file is empty. Export the video from WL Analysis as a CSV file and try again.');
    const delimiter = detectDelimiter(lines[firstIdx]);
    const headerCells = splitCsvLine(lines[firstIdx], delimiter).map(cell => cell.toLowerCase());
    const expected = ['video id', 'date', 'video resolution', 'frame rate', 'weight', 'tags'];
    const hasExpected = expected.every(name => headerCells.some(cell => cell === name));
    if (!hasExpected) {
        fail(
            'This file does not look like a WL Analysis export: the first row should be '
            + '"Video id,date,Video resolution,Frame rate,weight,tags". '
            + 'Export the video from WL Analysis as a CSV file and try again.',
        );
    }
    const headerIndex = Object.fromEntries(headerCells.map((cell, idx) => [cell, idx]));

    const secondIdx = lines.findIndex((line, idx) => idx > firstIdx && line.trim().length > 0);
    if (secondIdx === -1) fail('This WL Analysis file has a header but no video row. Export the video again and try again.');
    const metaCells = splitCsvLine(lines[secondIdx], delimiter);
    if (metaCells.length < 6) {
        fail('This WL Analysis file has a header but no complete video row. Export the video again and try again.');
    }
    const videoId = metaCells[headerIndex['video id']].trim();
    const dateRaw = metaCells[headerIndex['date']].trim();
    const resolution = metaCells[headerIndex['video resolution']].trim();
    const frameRate = parseDecimal(metaCells[headerIndex['frame rate']], delimiter, 'Frame rate');
    const weight = parseDecimal(metaCells[headerIndex['weight']], delimiter, 'Weight');
    const tags = metaCells[headerIndex['tags']].trim();
    if (videoId.length === 0) fail('This WL Analysis file has no video id. Export the video again and try again.');
    if (!(frameRate > 0)) fail('Frame rate must be a positive number. Check the WL Analysis export and try again.');
    if (!(weight > 0)) fail('Weight must be a positive number. Check the WL Analysis export and try again.');

    const markerIds = new Set<string>([videoId]);
    const markerLines: number[] = [];
    lines.forEach((line, idx) => {
        const match = line.trim().match(VIDEO_MARKER_PATTERN);
        if (match) {
            markerIds.add(match[1]);
            markerLines.push(idx);
        }
    });
    if (markerIds.size > 1) {
        fail(
            `This file contains ${markerIds.size} videos (${[...markerIds].join(', ')}). `
            + 'Export one video per CSV file in WL Analysis and import them one by one.',
        );
    }

    // Summary block: the first `Video id:` marker is followed by a `, average, ...` header
    // and one row per metric. It is fingerprinted for duplicate detection only.
    let summarySignature = '';
    if (markerLines.length >= 1) {
        const afterFirst = lines.slice(markerLines[0] + 1);
        const summaryHeaderIdx = afterFirst.findIndex(line => {
            const cells = splitCsvLine(line, delimiter).map(cell => cell.trim().toLowerCase());
            return cells.includes('average') && cells.includes('min') && cells.includes('max');
        });
        if (summaryHeaderIdx !== -1) {
            const summaryRows: string[] = [];
            for (let i = summaryHeaderIdx + 1; i < afterFirst.length; i += 1) {
                const line = afterFirst[i];
                if (line.trim().length === 0) break;
                if (VIDEO_MARKER_PATTERN.test(line.trim())) break;
                summaryRows.push(line.trim());
            }
            summarySignature = summaryRows.join('\n');
        }
    }

    // Per-frame table: a header row containing `Frame ordinal` and `Time`.
    let frameHeaderIdx = -1;
    for (let i = 0; i < lines.length; i += 1) {
        const normalized = normalizeHeaderCell(lines[i]);
        if (normalized.includes('frame ordinal') && normalized.includes('time')) {
            frameHeaderIdx = i;
            break;
        }
    }
    if (frameHeaderIdx === -1) {
        fail(
            'This file has only summary values, with no per-frame table. '
            + 'In WL Analysis, enable per-frame export in WL Analysis and export the video again.',
        );
    }
    const frameHeaderCells = splitCsvLine(lines[frameHeaderIdx], delimiter);
    const lowered = frameHeaderCells.map(cell => cell.trim().toLowerCase());
    const ordinalIdx = lowered.indexOf('frame ordinal');
    if (ordinalIdx === -1) {
        fail(
            'This WL Analysis file is missing the "Frame ordinal" column. '
            + 'In WL Analysis, enable per-frame export in WL Analysis and export the video again.',
        );
    }
    let timeIdx = -1;
    let timeUnit: string | null = null;
    frameHeaderCells.forEach((cell, idx) => {
        const match = cell.trim().match(/^time\s*\(\s*([^)]+?)\s*\)$/i);
        if (match) {
            timeIdx = idx;
            timeUnit = match[1].trim().toLowerCase();
        }
    });
    if (timeIdx === -1) {
        const fallback = lowered.indexOf('time (s)');
        if (fallback !== -1) {
            timeIdx = fallback;
            timeUnit = 's';
        }
    }
    if (timeIdx !== -1 && timeUnit !== 's') {
        fail(
            `Time is in "${timeUnit ?? 'an unknown unit'}", not seconds. `
            + 'Export the video from WL Analysis with seconds and try again.',
        );
    }

    let velocityIdx = -1;
    let velocityUnitMismatch: string | null = null;
    let displacementIdx = -1;
    let displacementUnitMismatch: string | null = null;
    frameHeaderCells.forEach((cell, idx) => {
        const parsed = parseMetricHeader(cell);
        if (!parsed) return;
        if (parsed.metric === 'velocity' && parsed.direction === 'vertical') {
            if (parsed.unit === 'm/s') {
                velocityIdx = idx;
            } else {
                velocityUnitMismatch = parsed.unit;
            }
        }
        if (parsed.metric === 'displacement' && parsed.direction === 'vertical') {
            if (parsed.unit === 'cm') {
                displacementIdx = idx;
            } else {
                displacementUnitMismatch = parsed.unit;
            }
        }
    });
    if (velocityUnitMismatch !== null && velocityIdx === -1) {
        fail(
            `Velocity is in "${velocityUnitMismatch}", not m/s. `
            + 'Export the video from WL Analysis with velocity in m/s and try again.',
        );
    }
    if (displacementUnitMismatch !== null && displacementIdx === -1) {
        fail(
            `Displacement is in "${displacementUnitMismatch}", not cm. `
            + 'Export the video from WL Analysis with displacement in cm and try again.',
        );
    }
    if (velocityIdx === -1) {
        fail(
            'This WL Analysis file is missing the "velocity (vertical, m/s)" column. '
            + 'In WL Analysis, enable per-frame export in WL Analysis with velocity and displacement columns.',
        );
    }
    if (displacementIdx === -1) {
        fail(
            'This WL Analysis file is missing the "displacement (vertical, cm)" column. '
            + 'In WL Analysis, enable per-frame export in WL Analysis with velocity and displacement columns.',
        );
    }

    const frames: WlAnalysisFrame[] = [];
    const frameCount = { value: 0 };
    for (let i = frameHeaderIdx + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim().length === 0) continue;
        if (VIDEO_MARKER_PATTERN.test(line.trim())) {
            fail('This file has an unexpected extra section after the per-frame table. Export one video per CSV file and try again.');
        }
        const cells = splitCsvLine(line, delimiter);
        const needed = Math.max(ordinalIdx, velocityIdx, displacementIdx, timeIdx);
        if (cells.length <= needed) {
            fail(`Row ${frameCount.value + 1} of the per-frame table is incomplete. Check the WL Analysis export and try again.`);
        }
        const ordinal = Number(cells[ordinalIdx].trim());
        if (!Number.isInteger(ordinal) || ordinal < 1) {
            fail(`Row ${frameCount.value + 1} of the per-frame table has a Frame ordinal that is not a positive number.`);
        }
        const velocityMps = parseDecimal(cells[velocityIdx], delimiter, `Row ${ordinal} velocity`);
        const displacementCm = parseDecimal(cells[displacementIdx], delimiter, `Row ${ordinal} displacement`);
        const timeS = timeIdx !== -1
            ? parseDecimal(cells[timeIdx], delimiter, `Row ${ordinal} time`)
            : round3((ordinal - 1) / frameRate);
        frames.push({ ordinal, timeS, velocityMps, displacementCm });
        frameCount.value += 1;
    }
    if (frames.length === 0) {
        fail(
            'This file has a per-frame header but no frame rows. '
            + 'In WL Analysis, enable per-frame export in WL Analysis and export the video again.',
        );
    }

    const reps = segmentWlReps(frames, parserVersion);
    return {
        parserVersion,
        videoId,
        dateRaw,
        resolution,
        frameRate,
        weight,
        tags,
        frames,
        reps,
        summarySignature,
    };
}
