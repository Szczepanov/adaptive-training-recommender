/** Local, versioned OpenBar adapter. Raw evidence only; no IO, uploads or policy authority. */
import {
    CONCENTRIC_SEGMENTATION_V1,
    CONCENTRIC_SEGMENTATION_V2,
    segmentConcentricReps,
    type ConcentricFrame,
    type ConcentricRep,
    type ConcentricSegmentationRule,
} from './concentricSegmentation.ts';
import { sha256Hex } from '../utils/sha256.ts';

export const OPENBAR_ANALYSIS_PARSER_V1 = 'openbar-analysis-v1';
export const OPENBAR_ANALYSIS_PARSER_V2 = 'openbar-analysis-v2';
export const OPENBAR_MAX_TRACKER_SIGNATURE_LENGTH = 16 * 1024;
export const OPENBAR_GAP_INTERVAL_FACTOR = 1.5;
export const OPENBAR_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const OPENBAR_MAX_SAMPLES = 100_000;

export interface OpenBarImplementation {
    implementation: string;
    version: string;
}
export interface OpenBarProvenance {
    trackerId: string;
    tracker: OpenBarImplementation;
    /** Complete canonical scalar signature, including clip-specific provenance. */
    trackerParameters: string | null;
    /** Method identity excludes only prediction_sha256, seed_timestamp_s and end_s. */
    trackerMethodParametersSha256: string | null;
    filter: OpenBarImplementation | null;
    /** Canonical scalar filter configuration; null means no explicit parameters. */
    filterParameters: string | null;
    kinematicsInput: 'calibrated' | 'filtered';
    kinematicsMethod: OpenBarImplementation;
    /** Canonical scalar kinematics configuration used to derive velocity. */
    kinematicsParameters: string;
    maxGapS: number;
    minConfidence: number;
    calibrationMethod: string;
    metresPerPixel: number;
    plateDiameterM: number;
    calibrationQuality: string;
    openbarVersion: string;
    gitCommit: string | null;
}
export interface OpenBarContinuityBreak {
    /** Indices into usable frames, not the original sample array. */
    beforeIndex: number;
    afterIndex: number;
    startTimeS: number;
    endTimeS: number;
    reason: 'null_velocity' | 'missing_sample';
}
export interface OpenBarRep extends ConcentricRep {
    exclusion: null | 'spans_gap' | 'touches_series_edge';
}
export interface OpenBarAnalysisParse {
    parserVersion: typeof OPENBAR_ANALYSIS_PARSER_V1 | typeof OPENBAR_ANALYSIS_PARSER_V2;
    segmentationRule: ConcentricSegmentationRule;
    schemaVersion: 1;
    sourceVideoSha256: string;
    provenance: OpenBarProvenance;
    frames: readonly ConcentricFrame[];
    breaks: readonly OpenBarContinuityBreak[];
    reps: readonly OpenBarRep[];
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`This OpenBar file is missing ${label}. Export an analysis with kinematics and try again.`);
    }
    return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) {
        throw new Error(`OpenBar ${label} must be non-empty text of at most 128 characters.`);
    }
    return value;
}
function finite(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`OpenBar ${label} must be a finite number. Export the analysis again.`);
    }
    return value;
}
function implementation(value: unknown, label: string): OpenBarImplementation {
    const record = object(value, label);
    return { implementation: text(record.implementation, `${label} implementation`), version: text(record.version, `${label} version`) };
}

function parameterSignature(value: unknown, label: string, maxLength = 128): string | null {
    if (value === undefined) return null;
    const record = object(value, label);
    const entries = Object.entries(record).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    if (entries.length === 0) return null;
    const signature = entries.map(([key, raw]) => {
        if (!key.trim() || key.length > 64) throw new Error(`OpenBar ${label} contains an invalid parameter name.`);
        let typed: string;
        if (typeof raw === 'number') {
            if (!Number.isFinite(raw)) throw new Error(`OpenBar ${label}.${key} must be finite.`);
            typed = `n:${String(raw)}`;
        } else if (typeof raw === 'boolean') {
            typed = `b:${raw ? 'true' : 'false'}`;
        } else if (typeof raw === 'string') {
            typed = `s:${raw}`;
        } else {
            throw new Error(`OpenBar ${label}.${key} must be a scalar.`);
        }
        return `${encodeURIComponent(key)}=${encodeURIComponent(typed)}`;
    }).join('&');
    if (signature.length > maxLength) throw new Error(`OpenBar ${label} is too large for the versioned import contract.`);
    return signature;
}

/* Clip identity remains in full provenance; it does not define a tracking algorithm. */
export function openBarTrackerMethodParameters(parameters: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(parameters).filter(([key]) =>
        !['prediction_sha256', 'seed_timestamp_s', 'end_s'].includes(key)));
}

/** Validates the consumed schema subset. OpenBar's Rust validator owns the full schema. */
export function parseOpenBarAnalysis(rawText: string, segmentationRule: ConcentricSegmentationRule): OpenBarAnalysisParse {
    if (segmentationRule !== CONCENTRIC_SEGMENTATION_V1 && segmentationRule !== CONCENTRIC_SEGMENTATION_V2) {
        throw new Error('Choose a supported concentric segmentation rule.');
    }
    if (rawText.length > OPENBAR_MAX_FILE_BYTES || new TextEncoder().encode(rawText).length > OPENBAR_MAX_FILE_BYTES) {
        throw new Error('This OpenBar file exceeds 20 MB. Export a shorter clip and try again.');
    }
    let decoded: unknown;
    try { decoded = JSON.parse(rawText); } catch {
        throw new Error('This is not a valid OpenBar analysis file. Select the exported analysis JSON and try again.');
    }
    const root = object(decoded, 'analysis');
    if (root.schema_version !== 1) throw new Error('This OpenBar schema version is not supported. Export analysis-v1 and try again.');
    const calibration = object(root.calibration, 'calibration');
    if (calibration.coordinate_convention !== 'reference_centre_x_right_y_up') {
        throw new Error('This OpenBar coordinate convention is not supported. Export upward-positive reference-centre coordinates.');
    }
    const identity = object(root.identity, 'source identity');
    if (typeof identity.source_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(identity.source_sha256)) {
        throw new Error('This OpenBar file needs the source video SHA-256. Register the video and export the analysis again.');
    }
    const derived = object(root.derived, 'derived kinematics');
    const kinematics = object(derived.kinematics, 'derived kinematics');
    if (!Array.isArray(kinematics.samples) || kinematics.samples.length === 0) {
        throw new Error('This OpenBar file has no kinematics samples. Run analysis with kinematics and try again.');
    }
    if (kinematics.samples.length > OPENBAR_MAX_SAMPLES) {
        throw new Error('This OpenBar file exceeds 100 000 samples. Export a shorter clip and try again.');
    }
    const samples = kinematics.samples.map((value, index) => {
        const sample = object(value, `sample ${index + 1}`);
        const timeS = finite(sample.timestamp_s, `sample ${index + 1} timestamp`);
        const yM = finite(sample.y_m, `sample ${index + 1} displacement`);
        const confidence = finite(sample.confidence, `sample ${index + 1} confidence`);
        if (timeS < 0 || confidence < 0 || confidence > 1) throw new Error('OpenBar timestamps must be non-negative and confidence within 0–1.');
        const velocityMps = sample.vy_mps === null || sample.vy_mps === undefined ? null : finite(sample.vy_mps, `sample ${index + 1} velocity`);
        return { timeS, yM, velocityMps };
    });
    const intervals: number[] = [];
    for (let i = 1; i < samples.length; i += 1) {
        const dt = samples[i].timeS - samples[i - 1].timeS;
        if (dt <= 0 || !Number.isFinite(dt)) throw new Error('OpenBar timestamps must be strictly increasing.');
        intervals.push(dt);
    }
    intervals.sort((a, b) => a - b);
    const midpoint = Math.floor(intervals.length / 2);
    const medianInterval = intervals.length % 2 === 0
        ? intervals[midpoint - 1] + (intervals[midpoint] - intervals[midpoint - 1]) / 2 : intervals[midpoint];
    const frames: ConcentricFrame[] = [];
    const breaks: OpenBarContinuityBreak[] = [];
    let previousSampleIndex: number | null = null;
    for (const [index, sample] of samples.entries()) {
        if (sample.velocityMps === null) continue;
        const displacementCm = (sample.yM - samples[0].yM) * 100;
        if (!Number.isFinite(displacementCm)) throw new Error('OpenBar converted displacement must be finite.');
        if (previousSampleIndex !== null) {
            const previous = samples[previousSampleIndex];
            const skippedNull = index > previousSampleIndex + 1;
            if (skippedNull || sample.timeS - previous.timeS > OPENBAR_GAP_INTERVAL_FACTOR * medianInterval) {
                breaks.push({
                    beforeIndex: frames.length - 1, afterIndex: frames.length,
                    startTimeS: previous.timeS, endTimeS: sample.timeS,
                    reason: skippedNull ? 'null_velocity' : 'missing_sample',
                });
            }
        }
        frames.push({ ordinal: index + 1, timeS: sample.timeS, velocityMps: sample.velocityMps, displacementCm });
        previousSampleIndex = index;
    }
    if (frames.length < 2) throw new Error('This OpenBar file needs at least two usable velocity samples. Export a longer tracked clip.');
    const provenanceRoot = object(root.provenance, 'provenance');
    const tracker = object(provenanceRoot.tracker, 'tracker');
    const trackerMethod = object(tracker.implementation, 'tracker implementation');
    const trackerParameters = parameterSignature(trackerMethod.parameters, 'tracker parameters', OPENBAR_MAX_TRACKER_SIGNATURE_LENGTH);
    const trackerMethodParametersSha256 = trackerParameters === null ? null : sha256Hex(
        parameterSignature(openBarTrackerMethodParameters(object(trackerMethod.parameters, 'tracker parameters')),
            'tracker method parameters', OPENBAR_MAX_TRACKER_SIGNATURE_LENGTH) ?? 'none');
    const pipeline = object(provenanceRoot.pipeline, 'pipeline');
    const method = object(kinematics.method, 'kinematics method');
    const parameters = object(method.parameters, 'kinematics parameters');
    const scale = object(calibration.scale, 'calibration scale');
    const quality = object(calibration.quality, 'calibration quality');
    if (kinematics.input !== 'calibrated' && kinematics.input !== 'filtered') throw new Error('OpenBar kinematics input must be calibrated or filtered.');
    const filterMethod = kinematics.input === 'filtered'
        ? object(object(derived.filtered, 'filtered trajectory').filter, 'filter')
        : null;
    const calibrationQuality = text(quality.status, 'calibration quality');
    if (!['unassessed', 'supported', 'warning', 'unsupported'].includes(calibrationQuality)) {
        throw new Error('OpenBar calibration quality status is not supported.');
    }
    const maxGapS = finite(parameters.max_gap_s, 'maximum kinematics gap');
    const minConfidence = finite(parameters.min_confidence, 'minimum kinematics confidence');
    const metresPerPixel = finite(scale.metres_per_pixel, 'calibration scale');
    const plateDiameterM = finite(scale.diameter_m, 'plate diameter');
    if (maxGapS <= 0 || minConfidence < 0 || minConfidence > 1 || metresPerPixel <= 0 || plateDiameterM <= 0) {
        throw new Error('OpenBar calibration and kinematics parameters are outside their valid ranges.');
    }
    const provenance: OpenBarProvenance = {
        trackerId: text(tracker.id, 'tracker id'), tracker: implementation(trackerMethod, 'tracker'),
        trackerParameters, trackerMethodParametersSha256,
        filter: filterMethod ? implementation(filterMethod, 'filter') : null,
        filterParameters: filterMethod ? parameterSignature(filterMethod.parameters, 'filter parameters') : null,
        kinematicsInput: kinematics.input, kinematicsMethod: implementation(method, 'kinematics method'),
        kinematicsParameters: parameterSignature(method.parameters, 'kinematics parameters') ?? 'none',
        maxGapS, minConfidence,
        calibrationMethod: `${text(calibration.method, 'calibration method')}@${finite(calibration.method_version, 'calibration version')}`,
        metresPerPixel, plateDiameterM, calibrationQuality,
        openbarVersion: text(pipeline.openbar_version, 'pipeline version'),
        gitCommit: pipeline.git_commit === undefined ? null : text(pipeline.git_commit, 'git commit'),
    };
    let breakCursor = 0;
    const reps: OpenBarRep[] = segmentConcentricReps(frames, segmentationRule).map(segment => {
        // Runs and breaks are ordered; a monotone cursor avoids rescanning every gap per rep.
        while (breakCursor < breaks.length && breaks[breakCursor].afterIndex < segment.runStartIndex) breakCursor += 1;
        const spansGap = breakCursor < breaks.length && breaks[breakCursor].beforeIndex <= segment.runEndIndex;
        return {
        index: segment.index, startFrame: segment.startFrame, endFrame: segment.endFrame,
        frameCount: segment.frameCount, startTimeS: segment.startTimeS, endTimeS: segment.endTimeS,
        durationS: segment.durationS, meanVelocityMps: segment.meanVelocityMps,
        peakVelocityMps: segment.peakVelocityMps, romCm: segment.romCm, complete: segment.complete,
        exclusion: spansGap
            ? 'spans_gap'
            : segment.runStartIndex === 0 || segment.runEndIndex === frames.length - 1 ? 'touches_series_edge' : null,
        };
    });
    if (reps.some(rep => [rep.meanVelocityMps, rep.peakVelocityMps, rep.durationS, rep.romCm].some(value => !Number.isFinite(value)))) {
        throw new Error('OpenBar repetition measurements must be finite. Export the analysis again.');
    }
    return {
        parserVersion: trackerParameters === null ? OPENBAR_ANALYSIS_PARSER_V1 : OPENBAR_ANALYSIS_PARSER_V2, segmentationRule, schemaVersion: 1,
        sourceVideoSha256: identity.source_sha256.toLowerCase(), provenance, frames, breaks, reps,
    };
}
