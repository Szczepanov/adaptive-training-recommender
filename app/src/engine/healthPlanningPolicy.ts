import type { TrainingPriority, UserPreferences } from './models';

/** Product-policy limits for event-free health planning. These are intentionally
 * narrow ranking/recovery guards: they do not make running unavailable and do not
 * replace the health aerobic or strength dose requirements. */
export const HEALTH_QUALITY_ENDURANCE_LOOKBACK_DAYS = 7;
export const HEALTH_QUALITY_ENDURANCE_SESSION_LIMIT = 1;
export const HEALTH_QUALITY_ENDURANCE_CATEGORIES = ['Moderate Endurance', 'Hard Endurance'] as const;

export interface HealthHistoryEvidence {
    category?: string;
    type?: string;
    intensity_tag?: string;
    durationMin?: number;
    duration_min?: number;
    trainingRecordLike?: {
        type?: string;
        intensity_tag?: string;
        duration_min?: number;
    };
}

export function isHealthQualityEnduranceCategory(category: string | undefined): boolean {
    return HEALTH_QUALITY_ENDURANCE_CATEGORIES.includes(category as typeof HEALTH_QUALITY_ENDURANCE_CATEGORIES[number]);
}

/** Only canonical quality categories, or a typed quality marker with a meaningful
 * duration, count toward the conservative rolling cap. Free-form labels alone do not. */
export function isQualifyingHealthQualityEnduranceEvidence(evidence: HealthHistoryEvidence): boolean {
    if (isHealthQualityEnduranceCategory(evidence.category)) return true;

    const record = evidence.trainingRecordLike;
    const intensity = String(evidence.intensity_tag ?? record?.intensity_tag ?? '').toLowerCase();
    const label = String(evidence.type ?? record?.type ?? '').toLowerCase();
    const duration = evidence.durationMin ?? evidence.duration_min ?? record?.duration_min ?? 0;
    const typedIntensity = ['moderate', 'hard', 'threshold', 'high'].includes(intensity);
    const qualityMarker = /(tempo|threshold|interval|vo2|max effort|hard endurance)/i.test(label);
    return duration >= 20 && typedIntensity && qualityMarker;
}

export interface HealthPlanningPolicy {
    enabled: true;
    preferLowImpactAerobic: boolean;
    withholdQualityEndurance: boolean;
    withholdHardEndurance: boolean;
    qualityEnduranceSessionLimit: number | null;
}

export function resolveHealthPlanningPolicy(
    priorities: readonly TrainingPriority[],
    preferences: Pick<UserPreferences, 'preferredModalities' | 'deprioritizedModalities' | 'avoidedModalities'> | null,
    isAdverseRecovery: boolean,
): HealthPlanningPolicy | null {
    if (!priorities.includes('health')) return null;

    const preferred = new Set((preferences?.preferredModalities ?? []).map(modality => modality.toLowerCase()));
    const runningExplicitlySupported = preferred.has('running')
        && !(preferences?.deprioritizedModalities ?? []).some(modality => modality.toLowerCase() === 'running')
        && !(preferences?.avoidedModalities ?? []).some(modality => modality.toLowerCase() === 'running');

    return {
        enabled: true,
        preferLowImpactAerobic: !runningExplicitlySupported,
        withholdQualityEndurance: isAdverseRecovery,
        withholdHardEndurance: !runningExplicitlySupported,
        qualityEnduranceSessionLimit: !runningExplicitlySupported ? HEALTH_QUALITY_ENDURANCE_SESSION_LIMIT : null,
    };
}
