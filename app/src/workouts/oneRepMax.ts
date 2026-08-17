import type { IntensityGauge, LoggedSet } from '../engine/models';

/**
 * Gauge-aware 1RM estimation (S2.1, ADR-0021). The gauge filter is the entire point of
 * this module, not an afterthought on top of it -- estimation is only valid on sets taken
 * near failure (ADR-0021's Context section, and the source analysis's finding A4.1). Feeding
 * a deliberately fast, submaximal power triple into a 1RM formula returns a number with no
 * physiological meaning, and that number then corrupts every prescription derived from it
 * via `estimated_1rm_percent`.
 *
 * Formula: Epley (1985), `1RM = weight x (1 + reps / 30)`. Chosen for simplicity and being
 * the more commonly implemented default in this space, not a claim that it out-performs
 * Brzycki's `weight x 36 / (37 - reps)` -- this repo does not have evidence either way, and
 * per D-SUBJEST's precedent (ADR-0020: estimator details are versioned policy, not
 * invariants), the formula itself may change without this module's admissibility rules
 * needing to.
 */

export const ONE_RM_FORMULA = 'epley' as const;

/** Sets more than this many reps in reserve are self-estimates too far from failure to
 *  trust -- the source analysis's finding A4 on `primer_rir`'s default of 6 (range 4-8):
 *  at that distance the value functions as a coaching instruction ("stay fast, stay
 *  fresh"), not a measurement. RPE admissibility is the same bound restated on the
 *  inverted scale (RPE 10 = 0 RIR, so admissible RPE is 10 - MAX_RIR_FOR_ESTIMATION). */
export const MAX_RIR_FOR_ESTIMATION = 3;

/** Epley's error grows with rep count; a set logged at 15+ reps is not a reliable proxy
 *  for a 1-5 rep max regardless of how close to failure it was taken. Conservative,
 *  documented cap rather than an unbounded formula applied everywhere it technically runs. */
export const MAX_REPS_FOR_ESTIMATION = 12;

function isNearFailureGauge(gauge: IntensityGauge | undefined): boolean {
    if (!gauge) return false; // No gauge at all: excluded by default, not a guessed fallback (ADR-0021 S2.1).
    switch (gauge.scale) {
        case 'rir':
            return gauge.value <= MAX_RIR_FOR_ESTIMATION;
        case 'rpe_rts':
            return gauge.value >= 10 - MAX_RIR_FOR_ESTIMATION;
        case 'velocity_loss':
        case 'technical':
            // Quality-limited, not failure-limited, by design (D-GAUGE) -- never admissible
            // for 1RM estimation regardless of the recorded value. A power snatch at any
            // velocity-loss percentage says nothing about how close the athlete was to a
            // true maximum, because that was never the intent of the set.
            return false;
    }
}

function isAdmissibleForEstimation(set: LoggedSet): boolean {
    if (set.isWarmup) return false;
    if (set.weightKg === null || set.weightKg <= 0) return false; // No external load to estimate a loaded 1RM from.
    if (set.reps <= 0 || set.reps > MAX_REPS_FOR_ESTIMATION) return false;
    return isNearFailureGauge(set.gauge);
}

function epleyOneRepMax(weightKg: number, reps: number): number {
    return weightKg * (1 + reps / 30);
}

export interface OneRepMaxEstimate {
    estimatedOneRmKg: number;
    fromSet: LoggedSet;
    formula: typeof ONE_RM_FORMULA;
}

/** Estimates a 1RM from whichever admissible set implies the highest true capacity --
 *  the best evidence available from that set of sets, not an average across them (a
 *  single near-failure single is stronger evidence than several sets diluted together).
 *  Returns `null` when nothing in `sets` is admissible: a power/velocity session, an
 *  all-warm-up exercise, or an all-bodyweight exercise all correctly produce no estimate
 *  rather than a fabricated one. */
export function estimateOneRepMax(sets: readonly LoggedSet[]): OneRepMaxEstimate | null {
    let best: OneRepMaxEstimate | null = null;
    for (const set of sets) {
        // Re-checking weightKg here (rather than trusting isAdmissibleForEstimation's
        // identical check) is what lets TypeScript narrow it to `number` without an
        // assertion -- the two checks must stay in sync; MAX_REPS_FOR_ESTIMATION and the
        // gauge rule remain the single source of truth in isAdmissibleForEstimation.
        if (!isAdmissibleForEstimation(set) || set.weightKg === null) continue;
        const estimatedOneRmKg = Math.round(epleyOneRepMax(set.weightKg, set.reps) * 10) / 10;
        if (best === null || estimatedOneRmKg > best.estimatedOneRmKg) {
            best = { estimatedOneRmKg, fromSet: set, formula: ONE_RM_FORMULA };
        }
    }
    return best;
}
