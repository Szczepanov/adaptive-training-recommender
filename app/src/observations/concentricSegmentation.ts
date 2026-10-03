/** Source-neutral concentric segmentation. Pure leaf; rules are immutable identities. */
export const CONCENTRIC_SEGMENTATION_V1 = 'concentric-segmentation-v1';
export const CONCENTRIC_SEGMENTATION_V2 = 'concentric-segmentation-v2';
export type ConcentricSegmentationRule = typeof CONCENTRIC_SEGMENTATION_V1 | typeof CONCENTRIC_SEGMENTATION_V2;

/** Detection and completeness are identical in both rules. Reporting windows differ in v2. */
export const CONCENTRIC_VELOCITY_THRESHOLD_MPS = 0;
export const MIN_REP_RISE_CM = 10;
export const MIN_REP_RISE_FRACTION = 0.5;
export const COMPLETE_DESCENT_FRACTION = 0.85;
/** v2 trims near-zero edges only when each omitted rise is at most 1 cm. */
export const BOUNDARY_VELOCITY_FLOOR_MPS = 0.05;
export const BOUNDARY_MAX_TRIM_RISE_CM = 1;

export interface ConcentricFrame {
    ordinal: number;
    timeS: number;
    velocityMps: number;
    displacementCm: number;
}

export interface ConcentricRep {
    /** Zero-based position among detected reps. */
    index: number;
    startFrame: number;
    endFrame: number;
    frameCount: number;
    startTimeS: number;
    endTimeS: number;
    durationS: number;
    meanVelocityMps: number;
    peakVelocityMps: number;
    romCm: number;
    complete: boolean;
}

export interface ConcentricRepSegment extends ConcentricRep {
    /** Indices into the input array (distinct from the source frame ordinals). */
    runStartIndex: number;
    runEndIndex: number;
    windowStartIndex: number;
    windowEndIndex: number;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

interface FrameRun {
    start: number;
    end: number;
}

/**
 * v2 reporting window: find the inner boundary frames that reach
 * `BOUNDARY_VELOCITY_FLOOR_MPS`, then trim each low-velocity edge only when the omitted
 * displacement is small enough to be boundary drift. This protects the standard mean-velocity
 * definition (the whole concentric phase) from deleting materially slow movement on heavy reps.
 * Falls back to the whole run if no frame reaches the floor.
 */
function activeWindow(frames: readonly ConcentricFrame[], run: FrameRun): FrameRun {
    let candidateStart = run.start;
    let candidateEnd = run.end;
    while (
        candidateStart <= candidateEnd
        && frames[candidateStart].velocityMps < BOUNDARY_VELOCITY_FLOOR_MPS
    ) {
        candidateStart += 1;
    }
    while (
        candidateEnd >= candidateStart
        && frames[candidateEnd].velocityMps < BOUNDARY_VELOCITY_FLOOR_MPS
    ) {
        candidateEnd -= 1;
    }
    if (candidateStart > candidateEnd) return run;

    const leadingRiseCm = frames[candidateStart].displacementCm - frames[run.start].displacementCm;
    const trailingRiseCm = frames[run.end].displacementCm - frames[candidateEnd].displacementCm;
    const start = leadingRiseCm >= 0 && leadingRiseCm <= BOUNDARY_MAX_TRIM_RISE_CM
        ? candidateStart
        : run.start;
    const end = trailingRiseCm >= 0 && trailingRiseCm <= BOUNDARY_MAX_TRIM_RISE_CM
        ? candidateEnd
        : run.end;
    return { start, end };
}

/**
 * Segment concentric reps: maximal runs of frames with velocity above
 * `CONCENTRIC_VELOCITY_THRESHOLD_MPS`. A run is a rep when its displacement rise
 * reaches `max(MIN_REP_RISE_CM, MIN_REP_RISE_FRACTION * largest rise)`.
 *
 * `rule` selects how each rep is reported: v1 reports the whole run; v2 reports the
 * run's active window (see `CONCENTRIC_SEGMENTATION_V2`). Detection and completeness never differ.
 */
export function segmentConcentricReps(
    frames: readonly ConcentricFrame[],
    rule: ConcentricSegmentationRule,
): ConcentricRepSegment[] {
    const runs: FrameRun[] = [];
    let runStart: number | null = null;
    for (let i = 0; i < frames.length; i += 1) {
        if (frames[i].velocityMps > CONCENTRIC_VELOCITY_THRESHOLD_MPS) {
            if (runStart === null) runStart = i;
        } else if (runStart !== null) {
            runs.push({ start: runStart, end: i - 1 });
            runStart = null;
        }
    }
    if (runStart !== null) runs.push({ start: runStart, end: frames.length - 1 });

    let largestRise = Number.NEGATIVE_INFINITY;
    const rises = runs.map(run => frames[run.end].displacementCm - frames[run.start].displacementCm);
    for (const rise of rises) {
        if (rise > largestRise) largestRise = rise;
    }
    if (!Number.isFinite(largestRise)) return [];
    const repThreshold = Math.max(MIN_REP_RISE_CM, MIN_REP_RISE_FRACTION * largestRise);

    const reps: ConcentricRepSegment[] = [];
    const repRuns = runs.filter(run => frames[run.end].displacementCm - frames[run.start].displacementCm >= repThreshold);
    let previousRepEndArrayIndex = -1;
    for (const run of repRuns) {
        const window = rule === CONCENTRIC_SEGMENTATION_V2 ? activeWindow(frames, run) : run;
        const slice = frames.slice(window.start, window.end + 1);
        const velocities = slice.map(frame => frame.velocityMps);
        const mean = velocities.reduce((sum, value) => sum + value, 0) / velocities.length;
        const peak = Math.max(...velocities);
        const rom = frames[window.end].displacementCm - frames[window.start].displacementCm;
        // Completeness always uses the whole run, so v1 and v2 agree on success/miss.
        const runRise = frames[run.end].displacementCm - frames[run.start].displacementCm;

        // Preceding descent (top -> bottom): the highest displacement observed since the end
        // of the previous rep (or the start of the file) minus the displacement at rep start.
        const gapStart = previousRepEndArrayIndex + 1 <= run.start ? previousRepEndArrayIndex + 1 : run.start;
        let top = Number.NEGATIVE_INFINITY;
        for (let i = gapStart; i <= run.start; i += 1) {
            if (frames[i].displacementCm > top) top = frames[i].displacementCm;
        }
        const descent = top - frames[run.start].displacementCm;
        const complete = descent <= 0 || runRise >= COMPLETE_DESCENT_FRACTION * descent;

        const startTime = frames[window.start].timeS;
        const endTime = frames[window.end].timeS;
        reps.push({
            index: reps.length,
            startFrame: frames[window.start].ordinal,
            endFrame: frames[window.end].ordinal,
            frameCount: slice.length,
            startTimeS: startTime,
            endTimeS: endTime,
            durationS: round3(Math.max(0, endTime - startTime)),
            meanVelocityMps: round3(mean),
            peakVelocityMps: round3(peak),
            romCm: round2(rom),
            complete,
            runStartIndex: run.start,
            runEndIndex: run.end,
            windowStartIndex: window.start,
            windowEndIndex: window.end,
        });
        previousRepEndArrayIndex = run.end;
    }
    return reps;
}
