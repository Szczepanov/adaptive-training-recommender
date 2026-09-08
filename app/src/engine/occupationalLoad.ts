import type { OccupationalLoadBaseline, PhysicalWorkCheckin } from './models';

const INTENSITY: Record<NonNullable<PhysicalWorkCheckin['intensity']>, number> = { moderate: 0.45, hard: 0.70, exhausting: 0.88 };
const DURATION: Record<NonNullable<PhysicalWorkCheckin['duration']>, number> = { short: 0.65, medium: 1, extended: 1.25 };

export interface OccupationalLoadContext {
    rawStrain: number;
    acuteDeviation: number;
    baselineApplied: boolean;
    physicalWorkAndAmbientStepSurge: boolean;
    contributingSources: string[];
}

function workStrain(work: PhysicalWorkCheckin | undefined): number {
    if (!work?.performed || !work.intensity) return 0;
    return Math.min(1, INTENSITY[work.intensity] * (work.duration ? DURATION[work.duration] : 1));
}

export function resolveOccupationalLoadContext(
    work: PhysicalWorkCheckin | undefined,
    baseline: OccupationalLoadBaseline | undefined,
    totalSteps: number | null,
    steps7dAvg: number | null,
): OccupationalLoadContext {
    const rawStrain = workStrain(work);
    const baselineStrain = baseline ? workStrain({ performed: true, intensity: baseline.typicalIntensity, duration: baseline.typicalDuration }) : 0;
    const baselineApplied = rawStrain > 0 && baselineStrain > 0;
    // This is diagnostic context only. Ambient-step fatigue still uses the
    // existing structured-activity deduction and max fusion policy.
    const physicalWorkAndAmbientStepSurge = Boolean(
        work?.performed && totalSteps !== null && steps7dAvg !== null && steps7dAvg > 0 &&
        totalSteps >= steps7dAvg * 1.8 && totalSteps - steps7dAvg >= 6000,
    );
    return {
        rawStrain,
        acuteDeviation: baselineApplied ? Math.max(0, rawStrain - baselineStrain) : rawStrain,
        baselineApplied,
        physicalWorkAndAmbientStepSurge,
        contributingSources: [
            ...(rawStrain > 0 ? ['physical_work'] : []),
            ...(physicalWorkAndAmbientStepSurge ? ['ambient_steps'] : []),
        ],
    };
}
