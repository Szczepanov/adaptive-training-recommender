/**
 * Biometric co-presence and imposter validator (ADR-0027).
 *
 * Distinguishes between:
 * 1. Genuine athlete sleeping on Eight Sleep pod with Garmin on wrist.
 * 2. Athlete sleeping away from pod (travel/hotel) with Garmin on wrist (Garmin authoritative).
 * 3. Watch charging overnight while genuine athlete sleeps on pod (Eight Sleep fallback).
 * 4. Family member (child, spouse, guest) sleeping on Eight Sleep pod (IMPOSTER_REJECTED).
 */

export interface CoPresenceValidationResult {
    verifiedAthlete: boolean;
    status: 'VERIFIED' | 'IMPOSTER_REJECTED' | 'UNVERIFIED_OFF_WRIST' | 'NO_SECONDARY_DATA';
    reason: string;
    garminRhr: number | null;
    eightSleepRhr: number | null;
    rhrDelta: number | null;
}

export function validateCoPresence(params: {
    garminRhr?: number | null;
    eightSleepRhr?: number | null;
    athleteRhr28dMedian?: number | null;
    maxRhrDeltaBpm?: number;
    maxUnverifiedRhrDeltaBpm?: number;
}): CoPresenceValidationResult {
    const {
        garminRhr = null,
        eightSleepRhr = null,
        athleteRhr28dMedian = null,
        maxRhrDeltaBpm = 8.0,
        maxUnverifiedRhrDeltaBpm = 12.0,
    } = params;

    if (eightSleepRhr === null || eightSleepRhr === undefined) {
        return {
            verifiedAthlete: true,
            status: 'NO_SECONDARY_DATA',
            reason: 'No Eight Sleep data recorded; Garmin Direct is authoritative.',
            garminRhr,
            eightSleepRhr: null,
            rhrDelta: null,
        };
    }

    // Case 1: Both sensors present -> Cross-sensor boundary check
    if (garminRhr !== null && garminRhr !== undefined) {
        const delta = Math.abs(garminRhr - eightSleepRhr);
        if (delta > maxRhrDeltaBpm) {
            return {
                verifiedAthlete: false,
                status: 'IMPOSTER_REJECTED',
                reason: `RHR discrepancy (${delta.toFixed(1)} bpm > ${maxRhrDeltaBpm.toFixed(1)} bpm limit). Garmin=${garminRhr.toFixed(1)} bpm vs EightSleep=${eightSleepRhr.toFixed(1)} bpm. Likely a family member sleeping on pod side.`,
                garminRhr,
                eightSleepRhr,
                rhrDelta: delta,
            };
        }

        return {
            verifiedAthlete: true,
            status: 'VERIFIED',
            reason: `Cross-sensor RHR is concordant (delta = ${delta.toFixed(1)} bpm <= ${maxRhrDeltaBpm.toFixed(1)} bpm).`,
            garminRhr,
            eightSleepRhr,
            rhrDelta: delta,
        };
    }

    // Case 2: Garmin watch was off-wrist overnight -> Validate against historical baseline
    if (athleteRhr28dMedian !== null && athleteRhr28dMedian !== undefined) {
        const baselineDelta = Math.abs(eightSleepRhr - athleteRhr28dMedian);
        if (baselineDelta > maxUnverifiedRhrDeltaBpm) {
            return {
                verifiedAthlete: false,
                status: 'IMPOSTER_REJECTED',
                reason: `Watch off-wrist and Eight Sleep RHR (${eightSleepRhr.toFixed(1)} bpm) deviates by ${baselineDelta.toFixed(1)} bpm from 28d baseline (${athleteRhr28dMedian.toFixed(1)} bpm).`,
                garminRhr: null,
                eightSleepRhr,
                rhrDelta: baselineDelta,
            };
        }

        return {
            verifiedAthlete: true,
            status: 'UNVERIFIED_OFF_WRIST',
            reason: 'Watch off-wrist overnight; Eight Sleep RHR matches historical baseline expectations.',
            garminRhr: null,
            eightSleepRhr,
            rhrDelta: baselineDelta,
        };
    }

    return {
        verifiedAthlete: true,
        status: 'VERIFIED',
        reason: 'Eight Sleep present without conflicting physiological signals.',
        garminRhr: null,
        eightSleepRhr,
        rhrDelta: null,
    };
}
