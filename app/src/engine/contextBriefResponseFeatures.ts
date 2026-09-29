import type { ActivityLapSummary, ActivityPrescribedTarget, ActivitySegmentSummary, ActivityStimulusDomain, NormalizedGarminActivity } from './models';
import { normalizeModality } from './performedTrainingFacts';
import { getHrUseAuthority, type HrAuthorityReason, type HrUseCase } from './activityHrFidelity';
import {
    decideSessionComparability,
    type ComparisonMatchBasis,
    type ComparisonDecision,
    type Confidence,
    type ResponseSessionIdentity,
    STEADY_MAX_VARIABILITY_INDEX,
    type ThresholdProvenance,
} from './contextBriefComparability';

export { COMPARABLE_DURATION_MAX_RATIO, STEADY_MAX_VARIABILITY_INDEX, thresholdProvenance } from './contextBriefComparability';
export type { Confidence, ThresholdProvenance } from './contextBriefComparability';

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
/** Lower prescribed-target outliers outside this band are not primary-set reps. */
const PRIMARY_TARGET_TOLERANCE_RATIO = 0.15;
/** A session is "steady" only when Garmin's variability index is at most this value. */
/** Pw:HR decoupling needs at least this much recorded session time. */
export const DECOUPLING_MIN_DURATION_MIN = 45;
/** Laps must cover at least this share of the session for a decoupling split. */
export const DECOUPLING_MIN_LAP_COVERAGE = 0.9;
/** Each decoupling half must hold between this share and its complement of lap time. */
export const DECOUPLING_MIN_HALF_SHARE = 0.4;

const STEADY_DOMAINS: ReadonlySet<ActivityStimulusDomain> = new Set(['endurance', 'recovery']);
/* `mixed` and `race` are deliberately absent: their auto-laps are not a protocol, so they
 * qualify for interval analysis only with a device structured-workout fingerprint. */
const STRUCTURED_DOMAINS: ReadonlySet<ActivityStimulusDomain> = new Set(['tempo', 'threshold', 'vo2', 'anaerobic']);

export type Insufficient = { state: 'insufficient_evidence'; reason: string };

export interface WorkInterval {
    durationSeconds: number;
    powerWatts: number;
    hrBpm?: number;
    endHrBpm?: number;
    lastThirdHrBpm?: number;
    peak5sPowerWatts?: number;
    peak10sPowerWatts?: number;
    maxCadenceRpm?: number;
    firstThirdPowerWatts?: number;
    middleThirdPowerWatts?: number;
    lastThirdPowerWatts?: number;
    prescribedTarget?: ActivityPrescribedTarget;
    identitySource?: ActivitySegmentSummary['identitySource'];
}

export type SprintRepetition =
    | {
        state: 'available';
        sprints: WorkInterval[];
        lastToBestPct: number;
        meanPowerWatts: number;
        meanPeak5sWatts?: number;
        pattern: 'repeatable' | 'late_fade';
    }
    | Insufficient;

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
        decision: ComparisonDecision;
        thresholdProvenance: ThresholdProvenance;
        hrNote: string | null;
    }
    /** `ineligible`: the session itself is not a steady power+HR session; `no_comparable`:
     * it is, but no prior session passed the comparability contract. */
    | (Insufficient & { kind: 'ineligible' | 'no_comparable'; rejected: string[]; rejectedOmittedCount?: number });

const MAX_COMPARISON_REJECTIONS = 8;

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

type SemanticSelection = { state: 'selected'; segments: ActivitySegmentSummary[] } | Insufficient;
type TargetAnchor = { family: 'watts' | 'zone'; value: number };

function targetAnchor(target: ActivityPrescribedTarget | undefined): TargetAnchor | null {
    if (!target) return null;
    if (target.kind === 'power_watts' && target.value !== undefined && Number.isFinite(target.value)) {
        return { family: 'watts', value: target.value };
    }
    const isBoundedPowerTarget = target.kind === 'power_range_watts'
        || (target.kind.startsWith('power_') && target.kind.endsWith('_target'));
    if (isBoundedPowerTarget) {
        const values = [target.low, target.high]
            .filter((value): value is number => value !== undefined && Number.isFinite(value));
        if (values.length > 0) {
            return { family: 'watts', value: values.reduce((sum, value) => sum + value, 0) / values.length };
        }
    }
    if (target.kind === 'power_zone' && target.value !== undefined && Number.isFinite(target.value)) {
        return { family: 'zone', value: target.value };
    }
    return null;
}

function medianValue(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

/** Keep performed failure visible when the prescription matches the main set, while
 * excluding clearly lower prescribed recovery/rollout steps that arrived mislabeled as
 * semantic work. The filter is activated only when a dominant target cluster exists. */
function primarySetSegments(
    segments: ActivitySegmentSummary[],
    allSegments: readonly ActivitySegmentSummary[],
): ActivitySegmentSummary[] {
    if (segments.length < 3) return segments;

    // Compatibility guard for already-persisted telemetry: trim only a final
    // lower-prescription tail. Internal or higher-target work may be deliberate.
    const terminal = segments[segments.length - 1];
    const finalSegmentIndex = allSegments.reduce(
        (latest, segment) => Math.max(latest, segment.segmentIndex),
        Number.NEGATIVE_INFINITY,
    );
    if (terminal.segmentIndex !== finalSegmentIndex) return segments;

    const terminalAnchor = targetAnchor(terminal.prescribedTarget);
    if (terminalAnchor === null) return segments;

    const preceding = segments.slice(0, -1);
    const anchored = preceding
        .map(segment => targetAnchor(segment.prescribedTarget))
        .filter((anchor): anchor is TargetAnchor =>
            anchor !== null && anchor.family === terminalAnchor.family);
    const requiredCoverage = Math.max(2, Math.ceil(preceding.length * 0.6));
    if (anchored.length < requiredCoverage) return segments;

    const center = medianValue(anchored.map(anchor => anchor.value));
    if (terminalAnchor.family === 'watts') {
        if (center <= 0) return segments;
        const coherentPrecedingSet = anchored.every(anchor =>
            Math.abs(anchor.value - center) / center <= PRIMARY_TARGET_TOLERANCE_RATIO);
        if (!coherentPrecedingSet) return segments;
        return terminalAnchor.value < center * (1 - PRIMARY_TARGET_TOLERANCE_RATIO)
            ? preceding
            : segments;
    }

    const coherentHighZoneSet = anchored.every(anchor => anchor.value >= 3);
    return coherentHighZoneSet && terminalAnchor.value <= 2 ? preceding : segments;
}

function semanticSegments(
    activity: NormalizedGarminActivity,
    segmentType: 'work' | 'sprint',
): SemanticSelection | null {
    const response = activity.activityResponse;
    if (!response) return null;
    const structured = response.segments
        .filter(segment =>
            segment.segmentType === segmentType
            && (segment.identitySource === 'reconciled_workout_step' || segment.identitySource === 'fit_workout_step'))
        .sort((a, b) => a.segmentIndex - b.segmentIndex);
    if (structured.length === 0) return null;
    if (response.segmentsTruncated) {
        return { state: 'insufficient_evidence', reason: 'semantic segment list was truncated; repeatability not judged' };
    }
    const primary = segmentType === 'work' ? primarySetSegments(structured, response.segments) : structured;
    if (primary.some(segment => segment.averagePowerWatts === undefined)) {
        return { state: 'insufficient_evidence', reason: 'semantic work segment lacks performed power' };
    }
    return { state: 'selected', segments: primary };
}

function workIntervalFromSegment(
    segment: ActivitySegmentSummary,
    hr: HrEvidence,
): WorkInterval {
    return {
        durationSeconds: segment.durationSeconds,
        powerWatts: segment.averagePowerWatts as number,
        ...(!hr.withheld && segment.averageHrBpm !== undefined ? { hrBpm: segment.averageHrBpm } : {}),
        ...(!hr.withheld && segment.endHrBpm !== undefined ? { endHrBpm: segment.endHrBpm } : {}),
        ...(!hr.withheld && segment.lastThirdHrBpm !== undefined ? { lastThirdHrBpm: segment.lastThirdHrBpm } : {}),
        ...(segment.peak5sPowerWatts !== undefined ? { peak5sPowerWatts: segment.peak5sPowerWatts } : {}),
        ...(segment.peak10sPowerWatts !== undefined ? { peak10sPowerWatts: segment.peak10sPowerWatts } : {}),
        ...(segment.maxCadenceRpm !== undefined ? { maxCadenceRpm: segment.maxCadenceRpm } : {}),
        ...(segment.firstThirdPowerWatts !== undefined ? { firstThirdPowerWatts: segment.firstThirdPowerWatts } : {}),
        ...(segment.middleThirdPowerWatts !== undefined ? { middleThirdPowerWatts: segment.middleThirdPowerWatts } : {}),
        ...(segment.lastThirdPowerWatts !== undefined ? { lastThirdPowerWatts: segment.lastThirdPowerWatts } : {}),
        ...(segment.prescribedTarget ? { prescribedTarget: segment.prescribedTarget } : {}),
        identitySource: segment.identitySource,
    };
}

function summarizeIntervals(intervals: WorkInterval[], hrNote: string | null): IntervalRepetition {
    if (intervals.length < 2) return { state: 'insufficient_evidence', reason: 'fewer than two work intervals available' };
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
        hrNote,
    };
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
    const isProtocolLength = (lap: ActivityLapSummary) => lap.durationSeconds >= WORK_INTERVAL_MIN_SECONDS
        && Math.max(lap.durationSeconds, protocolSeconds) / Math.min(lap.durationSeconds, protocolSeconds) <= REPEAT_DURATION_MAX_RATIO;
    const later = laps.slice(firstIndex);
    // A later work-power lap that is not protocol-length may be a truncated interval;
    // dropping it could hide a collapse, so the set is not judged.
    if (later.some(lap => !isProtocolLength(lap) && lap.durationSeconds >= WORK_INTERVAL_MIN_SECONDS && passesBar(lap))) {
        return { state: 'insufficient_evidence', reason: 'off-protocol work lap (possibly a truncated interval); repeatability not judged' };
    }
    const protocol = later.filter(isProtocolLength);
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

/** Structured-interval repeatability. Issue #850 gives executed workout-step
 * semantics first authority; the older >=120 s relative-power lap heuristic is retained
 * only as a backward-compatible fallback for legacy records without semantic segments. */
export function deriveIntervalRepetition(activity: NormalizedGarminActivity): IntervalRepetition {
    if (!isCycling(activity)) return { state: 'insufficient_evidence', reason: 'not a cycling session' };
    const hr = hrEvidence(activity, 'INTERVAL_RESPONSE');
    const semantic = semanticSegments(activity, 'work');
    if (semantic) {
        if (semantic.state !== 'selected') return semantic;
        return summarizeIntervals(
            semantic.segments.map(segment => workIntervalFromSegment(segment, hr)),
            hr.note,
        );
    }

    const domain = stimulusDomainOf(activity);
    // A fingerprint proves only that some workout structure existed; without executed
    // semantic step linkage it cannot turn race/auto-laps into interval identity.
    if (!STRUCTURED_DOMAINS.has(domain)) {
        return { state: 'insufficient_evidence', reason: `stimulus classified ${domain}; no executed structured-workout segments` };
    }
    const selection = selectProtocolLaps(activity);
    if (selection.state !== 'selected') return selection;
    return summarizeIntervals(
        selection.laps.map(lap => ({
            durationSeconds: lap.durationSeconds,
            powerWatts: lap.averagePowerWatts as number,
            ...(!hr.withheld && lap.averageHrBpm !== undefined ? { hrBpm: lap.averageHrBpm } : {}),
            identitySource: 'manual_lap' as const,
        })),
        hr.note,
    );
}

/** Repeated short efforts use semantic workout-step identity rather than the long-interval
 * fallback. HR is intentionally not part of sprint-quality classification. */
export function deriveSprintRepetition(activity: NormalizedGarminActivity): SprintRepetition {
    if (!isCycling(activity)) return { state: 'insufficient_evidence', reason: 'not a cycling session' };
    const semantic = semanticSegments(activity, 'sprint');
    if (!semantic) return { state: 'insufficient_evidence', reason: 'no executed semantic sprint segments' };
    if (semantic.state !== 'selected') return semantic;
    if (semantic.segments.length < 2) return { state: 'insufficient_evidence', reason: 'fewer than two semantic sprint segments' };
    const sprints = semantic.segments.map(segment =>
        workIntervalFromSegment(segment, { withheld: true, observational: true, note: null }));
    const powers = sprints.map(item => item.powerWatts);
    const best = Math.max(...powers);
    const lastToBestPct = ((powers[powers.length - 1] - best) / best) * 100;
    const meanPeak5 = sprints.every(item => item.peak5sPowerWatts !== undefined)
        ? sprints.reduce((sum, item) => sum + (item.peak5sPowerWatts as number), 0) / sprints.length
        : undefined;
    return {
        state: 'available',
        sprints,
        lastToBestPct: round(lastToBestPct, 1),
        meanPowerWatts: round(powers.reduce((sum, value) => sum + value, 0) / powers.length, 1),
        ...(meanPeak5 === undefined ? {} : { meanPeak5sWatts: round(meanPeak5, 1) }),
        pattern: lastToBestPct < -INTERVAL_FADE_PCT ? 'late_fade' : 'repeatable',
    };
}

function steadyStructureIneligibility(activity: NormalizedGarminActivity): string[] {
    const reasons: string[] = [];
    if (!isCycling(activity)) reasons.push('not a cycling session');
    const domain = stimulusDomainOf(activity);
    if (!STEADY_DOMAINS.has(domain)) reasons.push(`stimulus classified ${domain}, not steady endurance`);
    if (activity.variabilityIndex === undefined) reasons.push('variability index not reported');
    else if (activity.variabilityIndex > STEADY_MAX_VARIABILITY_INDEX) reasons.push(`variable power (VI ${round(activity.variabilityIndex, 2)})`);
    return reasons;
}

/** Reasons a session is not a steady, session-summary power+HR comparison candidate. */
function steadyIneligibility(activity: NormalizedGarminActivity): string[] {
    const reasons = steadyStructureIneligibility(activity);
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
    const reasons = steadyStructureIneligibility(activity);
    const hr = hrEvidence(activity, 'AEROBIC_DECOUPLING');
    if (hr.withheld) reasons.push('HR withheld by the HR authority');
    if (reasons.length > 0) return { state: 'insufficient_evidence', reason: reasons.join('; ') };
    if ((activity.durationMin ?? 0) < DECOUPLING_MIN_DURATION_MIN) {
        return { state: 'insufficient_evidence', reason: `shorter than ${DECOUPLING_MIN_DURATION_MIN} min` };
    }

    const native = activity.activityResponse?.steadyHalves;
    if (
        native?.firstPowerWatts !== undefined
        && native.secondPowerWatts !== undefined
        && native.firstHrBpm !== undefined
        && native.secondHrBpm !== undefined
        && native.firstHrBpm > 0
        && native.secondHrBpm > 0
    ) {
        const first = native.firstPowerWatts / native.firstHrBpm;
        const second = native.secondPowerWatts / native.secondHrBpm;
        return {
            state: 'available',
            decouplingPct: round(((first - second) / first) * 100, 1),
            hrNote: hr.note,
            observational: hr.observational,
        };
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
    return { state: 'available', decouplingPct: round(((first - second) / first) * 100, 1), hrNote: hr.note, observational: hr.observational };
}

function responseLocalDate(
    activity: NormalizedGarminActivity,
    identities: ReadonlyMap<string, ResponseSessionIdentity>,
): string {
    return identities.get(activity.activityId)?.localDate || activity.date;
}

function comparisonBasisLabel(basis: ComparisonMatchBasis | undefined): string {
    switch (basis) {
        case 'exact_prescription_identity': return 'same authored prescription';
        case 'authored_protocol_family': return 'same authored protocol family';
        case 'provider_fallback': return 'same device structured workout';
        case 'semantic_protocol_match': return 'semantic protocol match';
        case 'controlled_steady_match':
        default: return 'matched steady protocol (type, stimulus, duration)';
    }
}

/** Power–HR response ratio against the highest-ranked comparable prior steady
 * session in `history`. Never compares across a changed threshold definition; confidence
 * comes from the centralized comparability contract's weakest required provenance component. */
export function deriveEfficiencyComparison(
    activity: NormalizedGarminActivity,
    history: readonly NormalizedGarminActivity[],
    identities: ReadonlyMap<string, ResponseSessionIdentity> = new Map(),
): EfficiencyComparison {
    const own = steadyIneligibility(activity);
    if (own.length > 0) return { state: 'insufficient_evidence', kind: 'ineligible', reason: own.join('; '), rejected: [] };
    const currentDate = responseLocalDate(activity, identities);
    const priors = history
        .filter(item => item.activityId !== activity.activityId && responseLocalDate(item, identities) < currentDate)
        .sort((a, b) =>
            responseLocalDate(b, identities).localeCompare(responseLocalDate(a, identities))
            || a.activityId.localeCompare(b.activityId));
    const rejected: string[] = [];
    const comparable: Array<{
        prior: NormalizedGarminActivity;
        comparison: ReturnType<typeof decideSessionComparability>;
        confidence: Confidence;
    }> = [];
    for (const prior of priors) {
        const comparison = decideSessionComparability({
            featureFamily: 'cycling_steady_power_hr',
            current: { activity, identity: identities.get(activity.activityId) },
            prior: { activity: prior, identity: identities.get(prior.activityId) },
            priorIneligibility: steadyIneligibility(prior),
        });
        if (comparison.state !== 'comparable') {
            if (isCycling(prior)) rejected.push(`${responseLocalDate(prior, identities)}: ${comparison.hardRejections[0] ?? 'insufficient comparison evidence'}`);
            continue;
        }
        comparable.push({
            prior,
            comparison,
            confidence: comparison.confidenceCeiling ?? 'low',
        });
    }
    const matchRank: Record<NonNullable<ReturnType<typeof decideSessionComparability>['matchBasis']>, number> = {
        exact_prescription_identity: 0,
        authored_protocol_family: 1,
        canonical_exercise_identity: 0,
        provider_fallback: 2,
        semantic_protocol_match: 3,
        controlled_steady_match: 3,
    };
    const confidenceRank: Record<Confidence, number> = { high: 0, moderate: 1, low: 2 };
    comparable.sort((left, right) =>
        matchRank[left.comparison.matchBasis ?? 'controlled_steady_match'] - matchRank[right.comparison.matchBasis ?? 'controlled_steady_match']
        || confidenceRank[left.confidence] - confidenceRank[right.confidence]
        || responseLocalDate(right.prior, identities).localeCompare(responseLocalDate(left.prior, identities))
        || left.prior.activityId.localeCompare(right.prior.activityId));
    for (const { prior, comparison, confidence } of comparable) {
        const efficiency = (activity.normalizedPower as number) / (activity.averageHr as number);
        const priorEfficiency = (prior.normalizedPower as number) / (prior.averageHr as number);
        const thresholdEvidence = comparison.provenance.thresholdUnitEvidence;
        const provenance: ThresholdProvenance = thresholdEvidence === 'not_required' ? 'unknown' : thresholdEvidence;
        const hrNow = hrEvidence(activity, 'AEROBIC_DECOUPLING');
        const hrPrior = hrEvidence(prior, 'AEROBIC_DECOUPLING');
        return {
            state: 'available',
            priorActivityId: prior.activityId,
            priorDate: responseLocalDate(prior, identities),
            efficiencyFactor: round(efficiency, 2),
            priorEfficiencyFactor: round(priorEfficiency, 2),
            changePct: round(((efficiency - priorEfficiency) / priorEfficiency) * 100, 1),
            confidence,
            basis: comparisonBasisLabel(comparison.matchBasis),
            decision: comparison,
            thresholdProvenance: provenance,
            hrNote: hrNow.note ?? (hrPrior.note ? `prior session ${hrPrior.note}` : null),
        };
    }
    return {
        state: 'insufficient_evidence',
        kind: 'no_comparable',
        reason: 'no comparable prior steady session in the fetched history',
        rejected: rejected.slice(0, MAX_COMPARISON_REJECTIONS),
        ...(rejected.length > MAX_COMPARISON_REJECTIONS ? { rejectedOmittedCount: rejected.length - MAX_COMPARISON_REJECTIONS } : {}),
    };
}
