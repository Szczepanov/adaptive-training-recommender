import type { ActivityLapSummary, ActivityStimulusDomain, NormalizedGarminActivity } from './models';
import { normalizeModality } from './performedTrainingFacts';
import { getHrUseAuthority, type HrAuthorityReason, type HrUseCase } from './activityHrFidelity';

/* Issue #814: conservative, display-only training-response features for the context brief.
 *
 * Pure and deterministic: every value is derived from the activities handed in, nothing is
 * read from I/O or the clock. None of these features — nor any constant below — has
 * recommendation authority (ADR-0033 display-only); they describe recorded sessions for an
 * external reader. Missing or incomparable evidence yields `insufficient_evidence` with a
 * reason, never an estimate. The stimulus classification (`stimulusDomain`) is the
 * engine's own (#809) and HR usability is the HRF authority's (`getHrUseAuthority`); both
 * are reused, never re-derived here. Formulas, eligibility rules and limitations are
 * documented in docs/architecture/recommendation-engine.md ("Training-response features"). */

/** A lap counts as a work interval only when it lasts at least this long… */
export const WORK_INTERVAL_MIN_SECONDS = 120;
/** …and its average power is at least this multiple of the session's duration-weighted
 * mean lap power. */
export const WORK_INTERVAL_POWER_RATIO = 1.05;
/** Laps within this duration ratio of the first work lap are protocol-length laps. */
export const REPEAT_DURATION_MAX_RATIO = 1.25;
/** First→last work-interval drop beyond this percentage is labelled a late fade. */
export const INTERVAL_FADE_PCT = 5;
/** Any second-half interval below this share of the first is labelled a late collapse. */
export const INTERVAL_COLLAPSE_RATIO = 0.9;
/** A session is "steady" only when Garmin's variability index is at most this value. */
export const STEADY_MAX_VARIABILITY_INDEX = 1.05;
/** Pw:HR decoupling needs at least this much recorded session time. */
export const DECOUPLING_MIN_DURATION_MIN = 45;
/** Laps must cover at least this share of the session for a decoupling split. */
export const DECOUPLING_MIN_LAP_COVERAGE = 0.9;
/** Each decoupling half must hold between this share and its complement of lap time. */
export const DECOUPLING_MIN_HALF_SHARE = 0.4;
/** Comparable steady sessions must be within this duration ratio of each other. */
export const COMPARABLE_DURATION_MAX_RATIO = 1.25;

const STEADY_DOMAINS: ReadonlySet<ActivityStimulusDomain> = new Set(['endurance', 'recovery']);
/* `mixed` and `race` are deliberately absent: their auto-laps are not a protocol, so they
 * qualify for interval analysis only with a device structured-workout fingerprint. */
const STRUCTURED_DOMAINS: ReadonlySet<ActivityStimulusDomain> = new Set(['tempo', 'threshold', 'vo2', 'anaerobic']);

export type Insufficient = { state: 'insufficient_evidence'; reason: string };
export type Confidence = 'high' | 'moderate' | 'low';

export interface WorkInterval {
    durationSeconds: number;
    powerWatts: number;
    hrBpm?: number;
}

export type IntervalRepetition =
    | {
        state: 'available';
        intervals: WorkInterval[];
        firstToLastPct: number;
        spreadPct: number;
        pattern: 'repeatable' | 'late_fade' | 'late_collapse';
        hrNote: string | null;
    }
    | Insufficient;

export type Decoupling =
    | { state: 'available'; decouplingPct: number; hrNote: string | null; observational: boolean }
    | Insufficient;

export type ThresholdProvenance = 'same' | 'changed' | 'unknown';

export type EfficiencyComparison =
    | {
        state: 'available';
        priorActivityId: string;
        priorDate: string;
        efficiencyFactor: number;
        priorEfficiencyFactor: number;
        changePct: number;
        confidence: Confidence;
        basis: string;
        thresholdProvenance: ThresholdProvenance;
        hrNote: string | null;
    }
    /** `ineligible`: the session itself is not a steady power+HR session; `no_comparable`:
     * it is, but no prior session passed the comparability contract. */
    | (Insufficient & { kind: 'ineligible' | 'no_comparable'; rejected: string[] });

function round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

/** Engine-classified stimulus domain (#809). Legacy records without one are `unknown`:
 * their `intensityTag` mixed stimulus and dose, so it is not reinterpreted here. */
function stimulusDomainOf(activity: NormalizedGarminActivity): ActivityStimulusDomain {
    return activity.stimulusDomain ?? 'unknown';
}

/** HR evidence as decided by the HRF authority (`activityHrFidelity.ts`
 * `getHrUseAuthority`, the HRF6 consumer rule). No verified segment or lineage context is
 * claimed, so the authority fails closed. A trace rated unreliable/low or a discordant
 * summary withholds the HR value; any other non-ALLOWED/BOUNDED status keeps the value but
 * labels it observational with the authority's own status and reasons. */
export interface HrEvidence {
    withheld: boolean;
    observational: boolean;
    note: string | null;
}

const WITHHOLDING_REASONS: ReadonlySet<HrAuthorityReason> = new Set([
    'MEASUREMENT_UNRELIABLE',
    'LOW_MEASUREMENT_CONFIDENCE',
    'SUMMARY_LINEAGE_DISCORDANT',
]);

export function hrEvidence(activity: NormalizedGarminActivity, useCase: HrUseCase): HrEvidence {
    const authority = getHrUseAuthority(activity, useCase);
    const reasons = authority.reasons.join(', ') || 'no reason given';
    if (authority.reasons.some(reason => WITHHOLDING_REASONS.has(reason))) {
        return { withheld: true, observational: true, note: `HR withheld: HR authority ${authority.status} (${reasons})` };
    }
    if (authority.status === 'ALLOWED' || authority.status === 'BOUNDED') {
        return { withheld: false, observational: false, note: null };
    }
    return { withheld: false, observational: true, note: `HR observational only: HR authority ${authority.status} (${reasons})` };
}

function weightedMeanPower(laps: readonly ActivityLapSummary[]): number | null {
    const withPower = laps.filter(lap => lap.averagePowerWatts !== undefined && lap.durationSeconds > 0);
    const seconds = withPower.reduce((sum, lap) => sum + lap.durationSeconds, 0);
    if (seconds <= 0) return null;
    return withPower.reduce((sum, lap) => sum + (lap.averagePowerWatts as number) * lap.durationSeconds, 0) / seconds;
}

function isCycling(activity: NormalizedGarminActivity): boolean {
    return normalizeModality(activity.type) === 'Cycling';
}

type ProtocolSelection = { state: 'selected'; laps: ActivityLapSummary[] } | Insufficient;

/** Protocol structure first, power second: the first qualifying work lap fixes the protocol
 * length and every later lap of that length is a protocol interval. A protocol-length lap
 * below the power bar may be a collapsed interval or an equal-length recovery; that
 * ambiguity is reported, never smoothed into "repeatable". */
function selectProtocolLaps(activity: NormalizedGarminActivity): ProtocolSelection {
    const laps = [...(activity.laps ?? [])].sort((a, b) => a.lapIndex - b.lapIndex);
    const reference = weightedMeanPower(laps);
    if (reference === null) return { state: 'insufficient_evidence', reason: 'no lap power recorded' };
    const passesBar = (lap: ActivityLapSummary) => lap.averagePowerWatts !== undefined
        && lap.averagePowerWatts >= reference * WORK_INTERVAL_POWER_RATIO;
    const firstIndex = laps.findIndex(lap => lap.durationSeconds >= WORK_INTERVAL_MIN_SECONDS && passesBar(lap));
    if (firstIndex === -1) return { state: 'insufficient_evidence', reason: 'no work interval detected in the laps' };
    const protocolSeconds = laps[firstIndex].durationSeconds;
    const protocol = laps.slice(firstIndex).filter(lap => lap.durationSeconds >= WORK_INTERVAL_MIN_SECONDS
        && Math.max(lap.durationSeconds, protocolSeconds) / Math.min(lap.durationSeconds, protocolSeconds) <= REPEAT_DURATION_MAX_RATIO);
    const failing = protocol.filter(lap => !passesBar(lap)).length;
    if (failing > 0) {
        return {
            state: 'insufficient_evidence',
            reason: `${failing} protocol-length lap(s) below the work-power bar (a possible late collapse or an equal-length recovery); repeatability not judged`,
        };
    }
    if (protocol.length < 2) return { state: 'insufficient_evidence', reason: 'fewer than two work intervals detected in the laps' };
    return { state: 'selected', laps: protocol };
}

/** Structured-interval repeatability from lap power. Eligible only for cycling sessions
 * the engine classified as a structured stimulus, or that carry a device
 * structured-workout fingerprint. */
export function deriveIntervalRepetition(activity: NormalizedGarminActivity): IntervalRepetition {
    if (!isCycling(activity)) return { state: 'insufficient_evidence', reason: 'not a cycling session' };
    const domain = stimulusDomainOf(activity);
    if (!activity.fitWorkoutFingerprint && !STRUCTURED_DOMAINS.has(domain)) {
        return { state: 'insufficient_evidence', reason: `stimulus classified ${domain} without a structured-workout fingerprint` };
    }
    const selection = selectProtocolLaps(activity);
    if (selection.state !== 'selected') return selection;
    const hr = hrEvidence(activity, 'INTERVAL_RESPONSE');
    const intervals: WorkInterval[] = selection.laps.map(lap => ({
        durationSeconds: lap.durationSeconds,
        powerWatts: lap.averagePowerWatts as number,
        ...(!hr.withheld && lap.averageHrBpm !== undefined ? { hrBpm: lap.averageHrBpm } : {}),
    }));
    const powers = intervals.map(item => item.powerWatts);
    const first = powers[0];
    const last = powers[powers.length - 1];
    const mean = powers.reduce((sum, value) => sum + value, 0) / powers.length;
    const firstToLastPct = ((last - first) / first) * 100;
    const secondHalf = powers.slice(Math.ceil(powers.length / 2));
    const pattern = secondHalf.some(value => value < first * INTERVAL_COLLAPSE_RATIO)
        ? 'late_collapse'
        : firstToLastPct < -INTERVAL_FADE_PCT ? 'late_fade' : 'repeatable';
    return {
        state: 'available',
        intervals,
        firstToLastPct: round(firstToLastPct, 1),
        spreadPct: round(((Math.max(...powers) - Math.min(...powers)) / mean) * 100, 1),
        pattern,
        hrNote: hr.note,
    };
}

/** Reasons a session is not a steady, power+HR session; empty when it is one. */
function steadyIneligibility(activity: NormalizedGarminActivity): string[] {
    const reasons: string[] = [];
    if (!isCycling(activity)) reasons.push('not a cycling session');
    const domain = stimulusDomainOf(activity);
    if (!STEADY_DOMAINS.has(domain)) reasons.push(`stimulus classified ${domain}, not steady endurance`);
    if (activity.variabilityIndex === undefined) reasons.push('variability index not reported');
    else if (activity.variabilityIndex > STEADY_MAX_VARIABILITY_INDEX) reasons.push(`variable power (VI ${round(activity.variabilityIndex, 2)})`);
    if (activity.normalizedPower === undefined) reasons.push('no power recorded');
    if (activity.averageHr === null) reasons.push('no HR recorded');
    else if (hrEvidence(activity, 'AEROBIC_DECOUPLING').withheld) reasons.push('HR withheld by the HR authority');
    return reasons;
}

function halfEfficiency(items: readonly ActivityLapSummary[]): number {
    const seconds = items.reduce((sum, lap) => sum + lap.durationSeconds, 0);
    const power = items.reduce((sum, lap) => sum + (lap.averagePowerWatts as number) * lap.durationSeconds, 0) / seconds;
    const hr = items.reduce((sum, lap) => sum + (lap.averageHrBpm as number) * lap.durationSeconds, 0) / seconds;
    return power / hr;
}

/** Pw:HR decoupling from lap averages, first vs second half of recorded lap time. Only for
 * steady sessions with balanced halves: intervals and variable power make a lap-based drift
 * misleading. Stops inside a lap are not detected (laps carry no moving-time split). */
export function deriveDecoupling(activity: NormalizedGarminActivity): Decoupling {
    const reasons = steadyIneligibility(activity).filter(reason => reason !== 'no power recorded');
    if (reasons.length > 0) return { state: 'insufficient_evidence', reason: reasons.join('; ') };
    if ((activity.durationMin ?? 0) < DECOUPLING_MIN_DURATION_MIN) {
        return { state: 'insufficient_evidence', reason: `shorter than ${DECOUPLING_MIN_DURATION_MIN} min` };
    }
    const laps = [...(activity.laps ?? [])]
        .sort((a, b) => a.lapIndex - b.lapIndex)
        .filter(lap => lap.averagePowerWatts !== undefined && lap.averageHrBpm !== undefined && lap.durationSeconds > 0);
    const covered = laps.reduce((sum, lap) => sum + lap.durationSeconds, 0);
    if (covered < (activity.durationMin as number) * 60 * DECOUPLING_MIN_LAP_COVERAGE) {
        return { state: 'insufficient_evidence', reason: 'laps with both power and HR do not cover the session' };
    }
    const halves: [ActivityLapSummary[], ActivityLapSummary[]] = [[], []];
    let elapsed = 0;
    for (const lap of laps) {
        halves[elapsed + lap.durationSeconds / 2 < covered / 2 ? 0 : 1].push(lap);
        elapsed += lap.durationSeconds;
    }
    const firstShare = halves[0].reduce((sum, lap) => sum + lap.durationSeconds, 0) / covered;
    if (firstShare < DECOUPLING_MIN_HALF_SHARE || firstShare > 1 - DECOUPLING_MIN_HALF_SHARE) {
        return { state: 'insufficient_evidence', reason: 'lap layout cannot split the session into balanced halves' };
    }
    const first = halfEfficiency(halves[0]);
    const second = halfEfficiency(halves[1]);
    const hr = hrEvidence(activity, 'AEROBIC_DECOUPLING');
    return { state: 'available', decouplingPct: round(((first - second) / first) * 100, 1), hrNote: hr.note, observational: hr.observational };
}

/** Garmin's power-zone low boundaries are derived from the FTP in force when the session
 * was recorded; identical boundaries mean the threshold definition did not change. */
export function thresholdProvenance(a: NormalizedGarminActivity, b: NormalizedGarminActivity): ThresholdProvenance {
    const signature = (activity: NormalizedGarminActivity) => {
        const bounds = (activity.powerInZones ?? [])
            .filter(zone => zone.lowBoundary !== undefined)
            .sort((x, y) => x.zoneNumber - y.zoneNumber)
            .map(zone => `${zone.zoneNumber}:${Math.round(zone.lowBoundary as number)}`);
        return bounds.length > 0 ? bounds.join(',') : null;
    };
    const left = signature(a);
    const right = signature(b);
    if (left === null || right === null) return 'unknown';
    return left === right ? 'same' : 'changed';
}

function comparisonRejection(current: NormalizedGarminActivity, prior: NormalizedGarminActivity): string | null {
    if (prior.type !== current.type) return `different activity type (${prior.type})`;
    const priorReasons = steadyIneligibility(prior);
    if (priorReasons.length > 0) return priorReasons[0];
    if (stimulusDomainOf(prior) !== stimulusDomainOf(current)) return `different stimulus (${stimulusDomainOf(prior)})`;
    const [a, b] = [current.durationMin ?? 0, prior.durationMin ?? 0];
    if (a <= 0 || b <= 0 || Math.max(a, b) / Math.min(a, b) > COMPARABLE_DURATION_MAX_RATIO) {
        return `different protocol duration (${Math.round(b)} vs ${Math.round(a)} min)`;
    }
    if (thresholdProvenance(current, prior) === 'changed') return 'power-zone (FTP) definition changed between sessions';
    return null;
}

/** Aerobic efficiency (NP ÷ average HR) against the most recent comparable prior steady
 * session in `history`. Never compares across a changed threshold definition; confidence
 * is `low` whenever either session's HR is only observational under the HR authority. */
export function deriveEfficiencyComparison(
    activity: NormalizedGarminActivity,
    history: readonly NormalizedGarminActivity[],
): EfficiencyComparison {
    const own = steadyIneligibility(activity);
    if (own.length > 0) return { state: 'insufficient_evidence', kind: 'ineligible', reason: own.join('; '), rejected: [] };
    const priors = history
        .filter(item => item.activityId !== activity.activityId && item.date < activity.date)
        .sort((a, b) => b.date.localeCompare(a.date) || a.activityId.localeCompare(b.activityId));
    const rejected: string[] = [];
    for (const prior of priors) {
        const rejection = comparisonRejection(activity, prior);
        if (rejection) {
            if (isCycling(prior)) rejected.push(`${prior.date}: ${rejection}`);
            continue;
        }
        const efficiency = (activity.normalizedPower as number) / (activity.averageHr as number);
        const priorEfficiency = (prior.normalizedPower as number) / (prior.averageHr as number);
        const provenance = thresholdProvenance(activity, prior);
        const sameWorkout = activity.fitWorkoutFingerprint !== undefined
            && activity.fitWorkoutFingerprint === prior.fitWorkoutFingerprint;
        const hrNow = hrEvidence(activity, 'AEROBIC_DECOUPLING');
        const hrPrior = hrEvidence(prior, 'AEROBIC_DECOUPLING');
        const observational = hrNow.observational || hrPrior.observational;
        const confidence: Confidence = provenance !== 'same' || observational
            ? 'low'
            : sameWorkout ? 'high' : 'moderate';
        return {
            state: 'available',
            priorActivityId: prior.activityId,
            priorDate: prior.date,
            efficiencyFactor: round(efficiency, 2),
            priorEfficiencyFactor: round(priorEfficiency, 2),
            changePct: round(((efficiency - priorEfficiency) / priorEfficiency) * 100, 1),
            confidence,
            basis: sameWorkout ? 'same device structured workout' : 'matched steady protocol (type, stimulus, duration)',
            thresholdProvenance: provenance,
            hrNote: hrNow.note ?? (hrPrior.note ? `prior session ${hrPrior.note}` : null),
        };
    }
    return { state: 'insufficient_evidence', kind: 'no_comparable', reason: 'no comparable prior steady session in the fetched history', rejected };
}
