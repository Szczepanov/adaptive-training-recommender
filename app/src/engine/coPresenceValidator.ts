/**
 * Secondary-source identity & session concordance validator (ADR-0027 D-MS-IDENTITY, D-MS-PREBASE).
 *
 * @deprecated PROVISIONAL / LEGACY COMPATIBILITY LOGIC (PI0, ADR-0028).
 *
 * This validator is a temporary scalar heuristic (fixed session-overlap and RHR-delta bounds),
 * NOT a validated biometric identity classifier. Its `60 min` / `10 bpm` / `14 bpm` defaults are
 * unvalidated safety guards carried over from PR #240, not thresholds derived from labelled
 * evidence. Do not describe them as validated identity thresholds in docs, copy, or telemetry.
 *
 * It will be superseded by the ternary Physiological Identity Passport gate
 * (`USER | NOT_USER | UNCERTAIN`, see ADR-0028 and
 * ../../../docs/plans/physiological-identity-passport-and-measurement-trust.md, tasks PI1-PI9).
 * That gate sits upstream of `computeSourceMetricBaseline()` (PI5); this validator currently runs
 * downstream, inside fusion, and does not fix that ordering defect. `verifiedAthlete: boolean` and
 * the `IMPOSTER_REJECTED` status are legacy vocabulary — new code must not depend on them as
 * permanent domain contracts. Prefer `EffectiveIdentityDecision` (PI1) once it lands.
 *
 * A physiological anomaly alone (e.g. illness driving up RHR) is NOT proof that another person
 * used the shared device — it is deliberately impossible for this heuristic to assert that; see
 * `coPresenceValidator.test.ts` for the regression test documenting this (ADR-0028 P-PI-8).
 *
 * Evaluates whether secondary-source (Eight Sleep) observations correspond to the authenticated
 * primary athlete and are eligible for baseline accumulation and evidence fusion.
 *
 * Uses paired Garmin (authoritative worn anchor) ↔ Eight Sleep session timing overlap and
 * physiological plausibility bounds. Quarantines unverified off-wrist or discordant mattress
 * records before longitudinal baseline accumulation.
 */

export interface SleepSessionInterval {
    startIso: string;
    endIso: string;
}

/**
 * @deprecated Provisional quarantine/concordance vocabulary (PI0). This is intentionally NOT an
 * identity verdict: it never asserts who used the device, only whether the secondary record is
 * concordant enough to trust. `IMPOSTER_REJECTED` is a legacy alias kept for backward
 * compatibility and must not be read as a confirmed identity-fraud determination.
 */
export type CoPresenceStatus =
    | 'CONCORDANT'
    | 'VERIFIED' // Alias for CONCORDANT
    | 'DISCORDANT_SECONDARY'
    | 'IMPOSTER_REJECTED' // Legacy alias for DISCORDANT_SECONDARY
    | 'UNVERIFIED_OFF_WRIST'
    | 'NO_SECONDARY_DATA';

export interface CoPresenceValidationResult {
    /** @deprecated Legacy boolean; cannot represent abstention. Superseded by `EffectiveIdentityDecision` (PI1). */
    verifiedAthlete: boolean;
    status: CoPresenceStatus;
    reason: string;
    garminRhr: number | null;
    eightSleepRhr: number | null;
    rhrDelta: number | null;
    timingOverlapMinutes?: number | null;
}

function calculateSessionOverlapMinutes(
    a: SleepSessionInterval,
    b: SleepSessionInterval,
): number {
    const startA = new Date(a.startIso).getTime();
    const endA = new Date(a.endIso).getTime();
    const startB = new Date(b.startIso).getTime();
    const endB = new Date(b.endIso).getTime();

    if (isNaN(startA) || isNaN(endA) || isNaN(startB) || isNaN(endB)) {
        return 0;
    }

    const overlapStart = Math.max(startA, startB);
    const overlapEnd = Math.min(endA, endB);
    const diffMs = overlapEnd - overlapStart;

    return diffMs > 0 ? Math.round(diffMs / 60000) : 0;
}

/**
 * @deprecated PROVISIONAL heuristic (PI0, ADR-0028) — see module doc comment above. Do not
 * present its output as a validated identity determination.
 */
export function validateCoPresence(params: {
    garminRhr?: number | null;
    eightSleepRhr?: number | null;
    athleteRhr28dMedian?: number | null;
    garminSleepInterval?: SleepSessionInterval | null;
    eightSleepInterval?: SleepSessionInterval | null;
    minOverlapMinutes?: number;
    maxRhrDeltaBpm?: number;
    maxUnverifiedRhrDeltaBpm?: number;
}): CoPresenceValidationResult {
    const {
        garminRhr = null,
        eightSleepRhr = null,
        athleteRhr28dMedian = null,
        garminSleepInterval = null,
        eightSleepInterval = null,
        minOverlapMinutes = 60,
        maxRhrDeltaBpm = 10.0,
        maxUnverifiedRhrDeltaBpm = 14.0,
    } = params;

    if (eightSleepRhr === null || eightSleepRhr === undefined) {
        return {
            verifiedAthlete: true,
            status: 'NO_SECONDARY_DATA',
            reason: 'No Eight Sleep data recorded; Garmin Direct is sole authoritative source.',
            garminRhr,
            eightSleepRhr: null,
            rhrDelta: null,
            timingOverlapMinutes: null,
        };
    }

    // Step 1: Evaluate Sleep Session Timing Concordance (if session intervals provided)
    let overlapMins: number | null = null;
    if (garminSleepInterval && eightSleepInterval) {
        overlapMins = calculateSessionOverlapMinutes(garminSleepInterval, eightSleepInterval);
        if (overlapMins < minOverlapMinutes) {
            return {
                verifiedAthlete: false,
                status: 'DISCORDANT_SECONDARY',
                reason: `Sleep timing mismatch: Garmin and Eight Sleep sessions overlap for only ${overlapMins} min (< ${minOverlapMinutes} min threshold). Secondary record quarantined.`,
                garminRhr,
                eightSleepRhr,
                rhrDelta: garminRhr !== null ? Math.abs(garminRhr - eightSleepRhr) : null,
                timingOverlapMinutes: overlapMins,
            };
        }
    }

    // Step 2: Both sensors present -> Cross-sensor physiological concordance check
    if (garminRhr !== null && garminRhr !== undefined) {
        const delta = Math.abs(garminRhr - eightSleepRhr);
        if (delta > maxRhrDeltaBpm) {
            return {
                verifiedAthlete: false,
                status: 'DISCORDANT_SECONDARY',
                reason: `Cross-sensor physiological divergence (${delta.toFixed(1)} bpm > ${maxRhrDeltaBpm.toFixed(1)} bpm bound). Garmin=${garminRhr.toFixed(1)} bpm vs EightSleep=${eightSleepRhr.toFixed(1)} bpm. Secondary record quarantined from baseline and fusion.`,
                garminRhr,
                eightSleepRhr,
                rhrDelta: delta,
                timingOverlapMinutes: overlapMins,
            };
        }

        return {
            verifiedAthlete: true,
            status: 'CONCORDANT',
            reason: `Cross-sensor RHR is concordant (delta = ${delta.toFixed(1)} bpm <= ${maxRhrDeltaBpm.toFixed(1)} bpm limit).`,
            garminRhr,
            eightSleepRhr,
            rhrDelta: delta,
            timingOverlapMinutes: overlapMins,
        };
    }

    // Step 3: Garmin watch was off-wrist overnight -> Validate against historical baseline
    if (athleteRhr28dMedian !== null && athleteRhr28dMedian !== undefined) {
        const baselineDelta = Math.abs(eightSleepRhr - athleteRhr28dMedian);
        if (baselineDelta > maxUnverifiedRhrDeltaBpm) {
            return {
                verifiedAthlete: false,
                status: 'DISCORDANT_SECONDARY',
                reason: `Watch off-wrist and Eight Sleep RHR (${eightSleepRhr.toFixed(1)} bpm) deviates by ${baselineDelta.toFixed(1)} bpm from 28d baseline (${athleteRhr28dMedian.toFixed(1)} bpm). Quarantined.`,
                garminRhr: null,
                eightSleepRhr,
                rhrDelta: baselineDelta,
                timingOverlapMinutes: overlapMins,
            };
        }

        // Off-wrist is safe for fallback viewing but strictly quarantined from baseline mutation (D-MS-PREBASE)
        return {
            verifiedAthlete: false,
            status: 'UNVERIFIED_OFF_WRIST',
            reason: 'Watch off-wrist overnight; Eight Sleep matches baseline plausibility but is quarantined from baseline mutation (D-MS-PREBASE).',
            garminRhr: null,
            eightSleepRhr,
            rhrDelta: baselineDelta,
            timingOverlapMinutes: overlapMins,
        };
    }

    return {
        verifiedAthlete: false,
        status: 'UNVERIFIED_OFF_WRIST',
        reason: 'Eight Sleep data cannot be verified without Garmin RHR or a historical baseline.',
        garminRhr: null,
        eightSleepRhr,
        rhrDelta: null,
        timingOverlapMinutes: overlapMins,
    };
}
