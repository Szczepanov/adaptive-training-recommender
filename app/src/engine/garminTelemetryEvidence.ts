import type { NormalizedGarminActivity, WorkoutStimulusProfile } from './models';

export const POWER_ZONE_CANDIDATE_POLICY = 'power-zones-direct-share-v1' as const;

export type GarminStimulusPolicy = 'training_effect' | 'power_zones_direct_share_v1';
export type PowerZoneCoverage = 'full' | 'partial' | 'absent';

export interface PowerZoneFeatures {
    policyId: typeof POWER_ZONE_CANDIDATE_POLICY;
    coverage: PowerZoneCoverage;
    candidateEligible: boolean;
    fallbackReason?: 'no_power_zones' | 'missing_zone' | 'duplicate_zone' | 'invalid_zone' | 'zero_total';
    secondsByZone: readonly [number, number, number, number, number, number, number];
    shareByZone: readonly [number, number, number, number, number, number, number];
    totalPowerZoneSeconds: number;
    durationCoverageRatio?: number;
    normalizedPower?: number;
    intensityFactor?: number;
    variabilityIndex?: number;
}

export interface MatchedIntervalFade {
    status: 'available';
    attributedDate: string;
    matchedLapIndexes: number[];
    firstAveragePowerWatts: number;
    lastAveragePowerWatts: number;
    signedPowerChangePct: number;
    fadePct: number;
    negativeSplit: boolean;
}

export interface UnavailableMatchedIntervalFade {
    status: 'unavailable';
    attributedDate: string;
    reason: 'insufficient_matched_laps' | 'matched_lap_missing' | 'matched_lap_power_missing';
}

const REQUIRED_POWER_ZONES = [1, 2, 3, 4, 5, 6, 7] as const;
const GARMIN_CYCLING_POWER_TYPES = new Set([
    'cycling', 'cyclocross', 'gravel_cycling', 'indoor_cycling',
    'mountain_biking', 'road_biking', 'virtual_ride',
]);

function sevenZeros(): [number, number, number, number, number, number, number] {
    return [0, 0, 0, 0, 0, 0, 0];
}

function rounded(value: number, decimals = 6): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/** Mirrors the accepted ingestion gate's explicit Garmin cycling-type vocabulary. It is
 * used only by the default-off candidate; the production TE classifier is unchanged. */
export function isGarminCyclingPowerActivity(type: string): boolean {
    return GARMIN_CYCLING_POWER_TYPES.has(type.trim().toLowerCase());
}

/** Pure, privacy-preserving evidence extraction. Activity IDs and dates are deliberately
 * absent: comparison artifacts need normalized features, not another health-history copy. */
export function extractPowerZoneFeatures(activity: NormalizedGarminActivity): PowerZoneFeatures {
    const secondsByZone = sevenZeros();
    const shareByZone = sevenZeros();
    const zones = activity.powerInZones;
    if (!zones || zones.length === 0) {
        return {
            policyId: POWER_ZONE_CANDIDATE_POLICY,
            coverage: 'absent', candidateEligible: false, fallbackReason: 'no_power_zones',
            secondsByZone, shareByZone, totalPowerZoneSeconds: 0,
        };
    }

    const seen = new Set<number>();
    let fallbackReason: PowerZoneFeatures['fallbackReason'];
    for (const zone of zones) {
        if (!Number.isInteger(zone.zoneNumber) || zone.zoneNumber < 1 || zone.zoneNumber > 7
            || !Number.isFinite(zone.secondsInZone) || zone.secondsInZone < 0) {
            fallbackReason = 'invalid_zone';
            continue;
        }
        if (seen.has(zone.zoneNumber)) fallbackReason = 'duplicate_zone';
        seen.add(zone.zoneNumber);
        secondsByZone[zone.zoneNumber - 1] += zone.secondsInZone;
    }

    const totalPowerZoneSeconds = secondsByZone.reduce((sum, seconds) => sum + seconds, 0);
    if (totalPowerZoneSeconds > 0) {
        secondsByZone.forEach((seconds, index) => { shareByZone[index] = rounded(seconds / totalPowerZoneSeconds); });
    }
    const full = REQUIRED_POWER_ZONES.every(zone => seen.has(zone));
    if (!fallbackReason && !full) fallbackReason = 'missing_zone';
    if (!fallbackReason && totalPowerZoneSeconds <= 0) fallbackReason = 'zero_total';
    const durationSeconds = activity.durationMin !== null && activity.durationMin > 0
        ? activity.durationMin * 60
        : undefined;

    return {
        policyId: POWER_ZONE_CANDIDATE_POLICY,
        coverage: fallbackReason ? 'partial' : 'full',
        candidateEligible: fallbackReason === undefined,
        ...(fallbackReason ? { fallbackReason } : {}),
        secondsByZone,
        shareByZone,
        totalPowerZoneSeconds: rounded(totalPowerZoneSeconds, 3),
        ...(durationSeconds ? { durationCoverageRatio: rounded(totalPowerZoneSeconds / durationSeconds) } : {}),
        ...(activity.normalizedPower !== undefined ? { normalizedPower: activity.normalizedPower } : {}),
        ...(activity.intensityFactor !== undefined ? { intensityFactor: activity.intensityFactor } : {}),
        ...(activity.variabilityIndex !== undefined ? { variabilityIndex: activity.variabilityIndex } : {}),
    };
}

/** ADR-0022 reference candidate. Direct observed shares replace only axes the zone
 * distribution can identify; TE remains the fatigue-resistance authority. */
export function derivePowerZoneStimulusCandidate(
    features: PowerZoneFeatures,
    trainingEffectStimulus: WorkoutStimulusProfile,
): WorkoutStimulusProfile | null {
    if (!features.candidateEligible) return null;
    const [, z2, z3, z4, z5, z6, z7] = features.shareByZone;
    return {
        aerobicEndurance: rounded(Math.min(1, z2 + z3)),
        thresholdPower: z4,
        vo2MaxPower: z5,
        repeatedSurges: z6,
        sprintPower: z7,
        fatigueResistance: trainingEffectStimulus.fatigueResistance,
        maxStrength: 0,
        hypertrophy: 0,
    };
}

/** Descriptive only. The caller must supply the authored/matched work-lap indexes; this
 * function never guesses a set from auto-laps. Date attribution always stays on the
 * normalized Warsaw-local activity start date, including sessions crossing midnight. */
export function deriveMatchedIntervalFade(
    activity: NormalizedGarminActivity,
    matchedLapIndexes: readonly number[],
): MatchedIntervalFade | UnavailableMatchedIntervalFade {
    const uniqueIndexes = [...new Set(matchedLapIndexes)].sort((left, right) => left - right);
    if (uniqueIndexes.length < 2) {
        return { status: 'unavailable', attributedDate: activity.date, reason: 'insufficient_matched_laps' };
    }
    const lapsByIndex = new Map((activity.laps ?? []).map(lap => [lap.lapIndex, lap]));
    const matched = uniqueIndexes.map(index => lapsByIndex.get(index));
    if (matched.some(lap => lap === undefined)) {
        return { status: 'unavailable', attributedDate: activity.date, reason: 'matched_lap_missing' };
    }
    const powers = matched.map(lap => lap?.averagePowerWatts);
    if (powers.some(power => power === undefined || !Number.isFinite(power) || power <= 0)) {
        return { status: 'unavailable', attributedDate: activity.date, reason: 'matched_lap_power_missing' };
    }
    const firstAveragePowerWatts = powers[0] as number;
    const lastAveragePowerWatts = powers[powers.length - 1] as number;
    const signedPowerChangePct = rounded(((lastAveragePowerWatts - firstAveragePowerWatts) / firstAveragePowerWatts) * 100, 2);
    return {
        status: 'available', attributedDate: activity.date, matchedLapIndexes: uniqueIndexes,
        firstAveragePowerWatts, lastAveragePowerWatts, signedPowerChangePct,
        fadePct: Math.max(0, -signedPowerChangePct),
        negativeSplit: signedPowerChangePct > 0,
    };
}
