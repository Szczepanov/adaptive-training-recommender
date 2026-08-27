/**
 * Cross-source night/session pairing and physiological relation feature extraction (PI2, ADR-0028).
 *
 * Pairs Garmin (worn anchor) and Eight Sleep (shared-source) sleep session intervals by temporal
 * overlap -- not calendar date alone, since recovery nights cross midnight and upstream
 * logical-date conventions can differ -- and derives the evidence features the Physiological
 * Identity Passport (PI3/PI4) scores against a passport's paired relationship.
 *
 * This module does not decide identity. It produces features and abstains (via reason codes) when
 * a feature cannot be computed safely; PI4's evaluator composes these into USER/NOT_USER/UNCERTAIN.
 */

import type { IdentityReasonCode } from '../observations/identityModels';

export interface SessionInterval {
    startIso: string;
    endIso: string;
}

export interface IntervalOverlapMetrics {
    intersectionMinutes: number;
    unionMinutes: number;
    jaccard: number;
    eightOverlapFraction: number;
    garminOverlapFraction: number;
    startDeltaMinutes: number;
    endDeltaMinutes: number;
    durationDeltaMinutes: number;
}

export interface IntervalPairingResult {
    valid: boolean;
    reasonCode: 'SESSION_INTERVAL_INVALID' | null;
    metrics: IntervalOverlapMetrics | null;
}

function parseIntervalMs(interval: SessionInterval): { startMs: number; endMs: number } | null {
    const startMs = new Date(interval.startIso).getTime();
    const endMs = new Date(interval.endIso).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return null;
    }
    return { startMs, endMs };
}

const INVALID_INTERVAL_RESULT: IntervalPairingResult = {
    valid: false,
    reasonCode: 'SESSION_INTERVAL_INVALID',
    metrics: null,
};

/**
 * Computes Garmin<->Eight Sleep session overlap metrics per the plan's interval math. Rejects
 * (abstains on) unparsable timestamps or a non-positive duration on either side rather than
 * dividing by a zero/negative duration -- callers must treat a rejected pair as `UNCERTAIN`
 * (`SESSION_INTERVAL_INVALID`), a deterministic technical-quality rejection independent of anchor
 * eligibility.
 */
export function computeIntervalOverlapMetrics(
    garmin: SessionInterval,
    eightSleep: SessionInterval,
): IntervalPairingResult {
    const g = parseIntervalMs(garmin);
    const e = parseIntervalMs(eightSleep);
    if (!g || !e) {
        return INVALID_INTERVAL_RESULT;
    }

    const garminDurationMs = g.endMs - g.startMs;
    const eightDurationMs = e.endMs - e.startMs;
    if (garminDurationMs <= 0 || eightDurationMs <= 0) {
        return INVALID_INTERVAL_RESULT;
    }

    const intersectionMs = Math.max(0, Math.min(g.endMs, e.endMs) - Math.max(g.startMs, e.startMs));
    const unionMs = Math.max(g.endMs, e.endMs) - Math.min(g.startMs, e.startMs);

    const msToMin = (ms: number) => ms / 60000;

    const metrics: IntervalOverlapMetrics = {
        intersectionMinutes: msToMin(intersectionMs),
        unionMinutes: msToMin(unionMs),
        jaccard: unionMs > 0 ? intersectionMs / unionMs : 0,
        eightOverlapFraction: intersectionMs / eightDurationMs,
        garminOverlapFraction: intersectionMs / garminDurationMs,
        startDeltaMinutes: msToMin(e.startMs - g.startMs),
        endDeltaMinutes: msToMin(e.endMs - g.endMs),
        durationDeltaMinutes: msToMin(eightDurationMs - garminDurationMs),
    };

    return { valid: true, reasonCode: null, metrics };
}

export interface PairingCandidate {
    garminIndex: number;
    eightSleepIndex: number;
    garmin: SessionInterval;
    eightSleep: SessionInterval;
    validation: IntervalPairingResult;
}

export interface SessionPairingResult {
    selected: PairingCandidate | null;
    candidates: readonly PairingCandidate[];
    reasonCodes: readonly IdentityReasonCode[];
}

function compareCandidatesForSelection(a: PairingCandidate, b: PairingCandidate): number {
    const aMetrics = a.validation.metrics;
    const bMetrics = b.validation.metrics;
    if (!aMetrics || !bMetrics) {
        return 0; // unreachable for candidates passed in here (always valid+overlapping), kept for safety
    }
    if (aMetrics.intersectionMinutes !== bMetrics.intersectionMinutes) {
        return bMetrics.intersectionMinutes - aMetrics.intersectionMinutes; // largest overlap wins
    }
    if (aMetrics.jaccard !== bMetrics.jaccard) {
        return bMetrics.jaccard - aMetrics.jaccard;
    }
    // Deterministic tie-break: earliest Garmin session, then earliest Eight Sleep session index.
    if (a.garminIndex !== b.garminIndex) {
        return a.garminIndex - b.garminIndex;
    }
    return a.eightSleepIndex - b.eightSleepIndex;
}

/**
 * Pairs every candidate Garmin session against every candidate Eight Sleep session (naps
 * included) and deterministically selects the strongest genuine overlap. Multiple sessions with
 * plausible overlap surface `MULTIPLE_PAIRING_CANDIDATES` rather than being silently merged --
 * per-night ambiguity is evidence, not a solved problem, and PI4 must see it.
 */
export function selectBestSessionPairing(
    garminSessions: readonly SessionInterval[],
    eightSleepSessions: readonly SessionInterval[],
): SessionPairingResult {
    const candidates: PairingCandidate[] = [];
    for (let garminIndex = 0; garminIndex < garminSessions.length; garminIndex++) {
        for (let eightSleepIndex = 0; eightSleepIndex < eightSleepSessions.length; eightSleepIndex++) {
            const garmin = garminSessions[garminIndex];
            const eightSleep = eightSleepSessions[eightSleepIndex];
            candidates.push({
                garminIndex,
                eightSleepIndex,
                garmin,
                eightSleep,
                validation: computeIntervalOverlapMetrics(garmin, eightSleep),
            });
        }
    }

    const overlapping = candidates.filter(
        (c) => c.validation.valid && (c.validation.metrics?.intersectionMinutes ?? 0) > 0,
    );

    if (overlapping.length === 0) {
        const anyInvalid = candidates.some((c) => !c.validation.valid);
        return {
            selected: null,
            candidates,
            reasonCodes: anyInvalid ? ['SESSION_INTERVAL_INVALID'] : [],
        };
    }

    const [selected] = [...overlapping].sort(compareCandidatesForSelection);
    const reasonCodes: IdentityReasonCode[] =
        overlapping.length > 1 ? ['MULTIPLE_PAIRING_CANDIDATES'] : [];

    return { selected, candidates, reasonCodes };
}

export interface AnchorEligibilityInput {
    present: boolean;
    /** Result of the relevant technical/wear/session-quality checks for this Garmin record. */
    technicallyEligible: boolean;
}

export interface AnchorEligibilityResult {
    eligible: boolean;
    reasonCode: 'ANCHOR_MISSING' | 'ANCHOR_QUALITY_INSUFFICIENT' | null;
}

/**
 * A present Garmin record is not automatically a usable identity anchor. Both failure modes
 * abstain (feed `UNCERTAIN`) rather than infer `NOT_USER` -- missing/ineligible anchor evidence is
 * missing evidence, not negative evidence (ADR-0028 P-PI-9).
 */
export function evaluateAnchorEligibility(input: AnchorEligibilityInput): AnchorEligibilityResult {
    if (!input.present) {
        return { eligible: false, reasonCode: 'ANCHOR_MISSING' };
    }
    if (!input.technicallyEligible) {
        return { eligible: false, reasonCode: 'ANCHOR_QUALITY_INSUFFICIENT' };
    }
    return { eligible: true, reasonCode: null };
}

export interface PhysiologicalRelationInput {
    eightSleepRhr?: number | null;
    garminRhr?: number | null;
    eightSleepResp?: number | null;
    garminResp?: number | null;
    eightSleepHrv?: number | null;
    garminHrv?: number | null;
}

export interface PhysiologicalRelationFeatures {
    rhrResidual: number | null;
    respResidual: number | null;
    hrvLogResidual: number | null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function computeResidual(a: number | null | undefined, b: number | null | undefined): number | null {
    if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
        return null; // missingness is never zero-filled
    }
    return a - b;
}

function computeLogResidual(a: number | null | undefined, b: number | null | undefined): number | null {
    if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
        return null;
    }
    if (a <= 0 || b <= 0) {
        return null; // log domain guard: non-positive HRV is invalid input, not a computable residual
    }
    return Math.log(a) - Math.log(b);
}

/**
 * Derives paired physiological relation residuals. Each feature is computed independently and
 * missingness never zero-fills or falls back to a population mean -- an absent Garmin RHR simply
 * yields `rhrResidual: null` while `respResidual`/`hrvLogResidual` may still be available.
 * Cross-device HRV equality is never required; only the paired relationship (log residual) is
 * evaluated by the passport (PI3/PI4).
 */
export function computePhysiologicalRelationFeatures(
    input: PhysiologicalRelationInput,
): PhysiologicalRelationFeatures {
    return {
        rhrResidual: computeResidual(input.eightSleepRhr, input.garminRhr),
        respResidual: computeResidual(input.eightSleepResp, input.garminResp),
        hrvLogResidual: computeLogResidual(input.eightSleepHrv, input.garminHrv),
    };
}
