import type { OccupationalLoadBaseline, PhysicalWorkCheckin, PhysicalWorkLoadArea } from './models';

const INTENSITY: Record<NonNullable<PhysicalWorkCheckin['intensity']>, number> = { moderate: 0.45, hard: 0.70, exhausting: 0.88 };
const DURATION: Record<NonNullable<PhysicalWorkCheckin['duration']>, number> = { short: 0.65, medium: 1, extended: 1.25 };

export interface OccupationalLoadContext {
    rawStrain: number;
    baselineStrain: number;
    baselineDiscount: number;
    acuteDeviation: number;
    baselineApplied: boolean;
    baselineConfidence: number;
    loadAreaOverlap: number;
    physicalWorkAndAmbientStepSurge: boolean;
    contributingSources: string[];
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function workStrain(work: PhysicalWorkCheckin | undefined): number {
    if (!work?.performed) return 0;
    // Preserve the pre-baseline engine's conservative fallback semantics: a performed
    // work block with omitted optional detail is treated as moderate/medium, not as zero.
    const intensity = work.intensity ?? 'moderate';
    const duration = work.duration ?? 'medium';
    return Math.min(1, INTENSITY[intensity] * DURATION[duration]);
}

function loadAreaOverlapRatio(
    workAreas: readonly PhysicalWorkLoadArea[] | undefined,
    baselineAreas: readonly PhysicalWorkLoadArea[] | undefined,
): number {
    if (!workAreas?.length || !baselineAreas?.length) return 1;
    const baselineSet = new Set(baselineAreas);
    const overlapping = new Set(workAreas.filter(area => baselineSet.has(area))).size;
    return overlapping / new Set(workAreas).size;
}

/**
 * Resolves the acute occupational load that should remain after discounting the athlete's
 * usual, adapted work context. The baseline is deliberately a soft discount rather than a
 * hard exemption: confidence and current-vs-usual load-area overlap bound how much can be
 * removed. `ambientSteps` must already exclude steps attributed to a logged structured
 * activity, so the diagnostic cannot be triggered solely by the workout we already know.
 */
export function resolveOccupationalLoadContext(
    work: PhysicalWorkCheckin | undefined,
    baseline: OccupationalLoadBaseline | undefined,
    ambientSteps: number | null,
    steps7dAvg: number | null,
): OccupationalLoadContext {
    const rawStrain = workStrain(work);
    const baselineStrain = baseline
        ? workStrain({ performed: true, intensity: baseline.typicalIntensity, duration: baseline.typicalDuration })
        : 0;
    const baselineConfidence = baseline ? clamp01(baseline.confidence) : 0;
    const loadAreaOverlap = baseline ? loadAreaOverlapRatio(work?.loadAreas, baseline.typicalLoadAreas) : 0;
    const baselineDiscount = Math.min(rawStrain, baselineStrain * baselineConfidence * loadAreaOverlap);
    const baselineApplied = baselineDiscount > 0;

    // Diagnostic only. Ambient-step fatigue continues to use max fusion in fatigue.ts,
    // so a suspected same-source work/step surge is never additively charged.
    const physicalWorkAndAmbientStepSurge = Boolean(
        work?.performed && ambientSteps !== null && steps7dAvg !== null && steps7dAvg > 0 &&
        ambientSteps >= steps7dAvg * 1.8 && ambientSteps - steps7dAvg >= 6000,
    );

    return {
        rawStrain,
        baselineStrain,
        baselineDiscount,
        acuteDeviation: Math.max(0, rawStrain - baselineDiscount),
        baselineApplied,
        baselineConfidence,
        loadAreaOverlap,
        physicalWorkAndAmbientStepSurge,
        contributingSources: [
            ...(rawStrain > 0 ? ['physical_work'] : []),
            ...(physicalWorkAndAmbientStepSurge ? ['ambient_steps'] : []),
        ],
    };
}
