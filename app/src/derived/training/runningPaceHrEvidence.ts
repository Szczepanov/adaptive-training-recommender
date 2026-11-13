import type { HrMeasurement, NormalizedGarminActivity } from '../../ledger/models';
import type { SessionExecution, SessionExecutionState } from '../../sessions/models';

/**
 * Issue #920: Pure, display-only eligibility and comparability contract for
 * controlled running pace-HR response proxy evidence.
 *
 * This module has NO recommendation, readiness, fatigue, load, or safety authority
 * (ADR-0033 / ADR-0052) and is intentionally outside `decision-affecting-files.json`.
 * Live provider-only comparison remains unwired because Garmin provider records lack
 * controlled venue, standardized executed protocol, distance-quality provenance, and
 * a running-specific HR-use authority.
 */

export type ControlledRunningVenueContext =
    | {
        kind: 'calibrated_treadmill';
        treadmillCalibrated: boolean;
        treadmillCalibrationId?: string;
        inclinePct: number;
        inclineLocked: boolean;
    }
    | {
        kind: 'verified_standard_track';
        trackVerified: boolean;
        trackLengthMeters?: number;
        laneNumber?: number;
    }
    | {
        kind: 'outdoor_road' | 'trail' | 'unverified';
    };

export interface ControlledRunningProtocolStep {
    stepId: string;
    durationSeconds: number;
    targetSpeedMps: number;
}

export interface ControlledRunningProtocolContext {
    protocolId: string;
    protocolRevision?: number | string;
    prescriptionHash?: string;
    executionState: SessionExecutionState;
    executedSteps: readonly ControlledRunningProtocolStep[];
}

export type RunningPaceDistanceProvenance =
    | 'calibrated_treadmill_console'
    | 'verified_track_splits'
    | 'calibrated_footpod'
    | 'gps'
    | 'unverified';

export type RunningPaceDistanceQuality = 'verified' | 'acceptable' | 'poor' | 'unverified' | 'missing';

export interface ControlledRunningPaceDistanceEvidence {
    provenance: RunningPaceDistanceProvenance;
    quality: RunningPaceDistanceQuality;
    distanceMeters: number;
    durationSeconds: number;
    averageSpeedMps?: number;
}

export interface ControlledRunningHrEvidence {
    averageHrBpm: number | null | undefined;
    hrMeasurement?: HrMeasurement;
}

export interface ControlledRunningSessionEvidence {
    sessionId: string;
    localDate: string;
    performedOccurrenceId?: string;
    activity?: NormalizedGarminActivity;
    execution?: Pick<
        SessionExecution,
        'executionId' | 'occurrenceId' | 'state' | 'prescriptionHash' | 'executedDefinition'
    >;
    venueContext?: ControlledRunningVenueContext;
    protocolContext?: ControlledRunningProtocolContext;
    paceDistanceEvidence?: ControlledRunningPaceDistanceEvidence;
    hrEvidence?: ControlledRunningHrEvidence;
}

export type RunningHrAuthorityReason =
    | 'HR_VALUE_UNAVAILABLE'
    | 'MEASUREMENT_UNAVAILABLE'
    | 'RUNNING_HR_REQUIRES_CHEST_STRAP'
    | 'RUNNING_HR_SOURCE_NOT_EXTERNAL'
    | 'RUNNING_HR_PROVENANCE_UNCONFIRMED'
    | 'MEASUREMENT_CONFIDENCE_NOT_HIGH'
    | 'SIGNAL_QUALITY_NOT_CLEAN'
    | 'SUMMARY_LINEAGE_NOT_VERIFIED';

export interface RunningHrAuthorityResult {
    status: 'ALLOWED' | 'BLOCKED';
    reasons: RunningHrAuthorityReason[];
}

export interface ControlledPaceHrResponseProxy {
    state: 'comparable';
    resultKind: 'controlled_pace_hr_response_proxy';
    authority: 'display_only';
    currentSessionId: string;
    priorSessionId: string;
    currentDate: string;
    priorDate: string;
    currentSpeedMps: number;
    priorSpeedMps: number;
    currentPaceSecPerKm: number;
    priorPaceSecPerKm: number;
    currentAverageHrBpm: number;
    priorAverageHrBpm: number;
    /** Meters covered per heartbeat ((speedMps * 60) / averageHrBpm). */
    paceHrRatioCurrent: number;
    paceHrRatioPrior: number;
    paceHrRatioChangePct: number;
    confidenceCeiling: 'moderate';
    provenance: {
        venueKind: 'calibrated_treadmill' | 'verified_standard_track';
        protocolId: string;
        paceDistanceProvenance: 'calibrated_treadmill_console' | 'verified_track_splits' | 'calibrated_footpod';
        hrSensorTechnology: 'electrode_chest_strap';
        hrAuthorityStatus: 'ALLOWED';
    };
    limitations: readonly string[];
}

export interface ControlledPaceHrRejection {
    state: 'insufficient_evidence' | 'not_comparable';
    resultKind: 'controlled_pace_hr_response_proxy';
    authority: 'display_only';
    rejectionReasons: readonly string[];
    hrReasons: readonly RunningHrAuthorityReason[];
}

export type ControlledPaceHrComparisonResult =
    | ControlledPaceHrResponseProxy
    | ControlledPaceHrRejection;

const PROTOCOL_DURATION_TOLERANCE_SECONDS = 1;
const PROTOCOL_SPEED_TOLERANCE_MPS = 0.02;
const TREADMILL_INCLINE_TOLERANCE_PCT = 0.01;

const CONTROLLED_PACE_DISTANCE_PROVENANCES = new Set<RunningPaceDistanceProvenance>([
    'calibrated_treadmill_console',
    'verified_track_splits',
    'calibrated_footpod',
]);

function round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

function isPositiveFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Provider labels that positively assert an uncontrolled outdoor run (Garmin uses `street_running`). */
const OUTDOOR_RUNNING_ACTIVITY_TYPES = new Set(['street_running', 'road_running', 'outdoor_running']);
/** Provider labels that contradict a given explicit controlled venue. Labels never establish a venue. */
const VENUE_CONFLICTING_ACTIVITY_TYPES: Record<'calibrated_treadmill' | 'verified_standard_track', ReadonlySet<string>> = {
    calibrated_treadmill: new Set(['track_running']),
    verified_standard_track: new Set(['treadmill_running', 'indoor_running', 'virtual_run']),
};

function normalizeActivityType(activityType: string | undefined): string | undefined {
    return activityType?.trim().toLowerCase() || undefined;
}

function isOutdoorOrTrailActivityType(activityType: string | undefined): boolean {
    const normalized = normalizeActivityType(activityType);
    if (!normalized) return false;
    return normalized.includes('trail') || OUTDOOR_RUNNING_ACTIVITY_TYPES.has(normalized);
}

/**
 * Running-specific HR-use authority for controlled pace-HR comparison.
 *
 * Requires explicit verified electrode chest-strap provenance (`electrode_chest_strap`),
 * confirmed external source, high measurement confidence, clean signal quality, and
 * verified summary lineage. Optical wrist HR, unknown, and unreliable traces are blocked.
 */
export function evaluateRunningPaceHrAuthority(
    evidence: ControlledRunningHrEvidence | undefined,
): RunningHrAuthorityResult {
    const reasons: RunningHrAuthorityReason[] = [];
    if (!evidence || !isPositiveFinite(evidence.averageHrBpm)) {
        reasons.push('HR_VALUE_UNAVAILABLE');
    }
    const measurement = evidence?.hrMeasurement;
    if (!measurement) {
        reasons.push('MEASUREMENT_UNAVAILABLE');
        return { status: 'BLOCKED', reasons };
    }
    if (measurement.sensorTechnology !== 'electrode_chest_strap') {
        reasons.push('RUNNING_HR_REQUIRES_CHEST_STRAP');
    }
    if (measurement.sourceForActivity !== 'external') {
        reasons.push('RUNNING_HR_SOURCE_NOT_EXTERNAL');
    }
    if (measurement.provenanceConfidence !== 'confirmed') {
        reasons.push('RUNNING_HR_PROVENANCE_UNCONFIRMED');
    }
    if (measurement.measurementConfidence !== 'high') {
        reasons.push('MEASUREMENT_CONFIDENCE_NOT_HIGH');
    }
    if (measurement.signalQuality !== 'clean') {
        reasons.push('SIGNAL_QUALITY_NOT_CLEAN');
    }
    if (measurement.summaryCompatibility !== 'verified_same_effective_trace') {
        reasons.push('SUMMARY_LINEAGE_NOT_VERIFIED');
    }
    return {
        status: reasons.length === 0 ? 'ALLOWED' : 'BLOCKED',
        reasons,
    };
}

interface SessionEligibilitySuccess {
    eligible: true;
    venue: Extract<ControlledRunningVenueContext, { kind: 'calibrated_treadmill' | 'verified_standard_track' }>;
    protocol: ControlledRunningProtocolContext;
    speedMps: number;
    paceDistanceProvenance: 'calibrated_treadmill_console' | 'verified_track_splits' | 'calibrated_footpod';
    averageHrBpm: number;
}

interface SessionEligibilityFailure {
    eligible: false;
    state: 'insufficient_evidence' | 'not_comparable';
    reasons: string[];
    hrReasons: RunningHrAuthorityReason[];
}

function evaluateSessionEligibility(
    side: 'current' | 'prior',
    session: ControlledRunningSessionEvidence,
): SessionEligibilitySuccess | SessionEligibilityFailure {
    const reasons: string[] = [];
    const hrReasons: RunningHrAuthorityReason[] = [];
    let state: 'insufficient_evidence' | 'not_comparable' = 'insufficient_evidence';

    // Gate 1: Explicit controlled venue context (never inferred from activity labels or dynamics).
    if (isOutdoorOrTrailActivityType(session.activity?.type)) {
        state = 'not_comparable';
        reasons.push(`${side}: outdoor/trail activity type excluded`);
    }
    const venue = session.venueContext;
    if (!venue) {
        reasons.push(`${side}: missing controlled venue context`);
    } else if (venue.kind === 'outdoor_road' || venue.kind === 'trail') {
        state = 'not_comparable';
        reasons.push(`${side}: ${venue.kind} activities are excluded`);
    } else if (venue.kind === 'unverified') {
        reasons.push(`${side}: unverified running venue context`);
    } else if (
        (venue.kind === 'calibrated_treadmill' || venue.kind === 'verified_standard_track')
        && VENUE_CONFLICTING_ACTIVITY_TYPES[venue.kind].has(normalizeActivityType(session.activity?.type) ?? '')
    ) {
        state = 'not_comparable';
        reasons.push(`${side}: provider activity type (${session.activity?.type}) conflicts with ${venue.kind} venue`);
    }
    if (venue?.kind === 'calibrated_treadmill') {
        if (!venue.treadmillCalibrated) {
            reasons.push(`${side}: treadmill calibration not verified`);
        }
        if (!venue.inclineLocked || !Number.isFinite(venue.inclinePct)) {
            reasons.push(`${side}: treadmill incline not locked`);
        }
    } else if (venue?.kind === 'verified_standard_track') {
        if (!venue.trackVerified) {
            reasons.push(`${side}: standard track venue not verified`);
        }
        if (venue.trackLengthMeters !== undefined && !isPositiveFinite(venue.trackLengthMeters)) {
            reasons.push(`${side}: invalid track length`);
        }
    }

    // Gate 2: Executed standardized protocol.
    const protocol = session.protocolContext;
    if (!protocol) {
        reasons.push(`${side}: missing standardized protocol context`);
    } else {
        if (!protocol.protocolId.trim()) {
            reasons.push(`${side}: missing standardized protocol identity`);
        }
        if (protocol.executionState !== 'completed') {
            reasons.push(`${side}: protocol execution not completed (${protocol.executionState})`);
        }
        if (session.execution && session.execution.state !== 'completed') {
            reasons.push(`${side}: structured execution not completed (${session.execution.state})`);
        }
        if (protocol.executedSteps.length === 0) {
            reasons.push(`${side}: missing executed protocol steps`);
        } else {
            const invalidStep = protocol.executedSteps.some(
                step =>
                    !step.stepId.trim()
                    || !isPositiveFinite(step.durationSeconds)
                    || !isPositiveFinite(step.targetSpeedMps),
            );
            if (invalidStep) {
                reasons.push(`${side}: invalid executed protocol step`);
            }
        }
    }

    // Gate 3: Valid pace/distance quality.
    const paceDist = session.paceDistanceEvidence;
    let derivedSpeedMps: number | undefined;
    if (!paceDist) {
        reasons.push(`${side}: missing pace/distance quality evidence`);
    } else {
        if (!CONTROLLED_PACE_DISTANCE_PROVENANCES.has(paceDist.provenance)) {
            reasons.push(`${side}: pace/distance provenance (${paceDist.provenance}) not valid for controlled running`);
        }
        if (paceDist.quality !== 'verified' && paceDist.quality !== 'acceptable') {
            reasons.push(`${side}: pace/distance quality rejected (${paceDist.quality})`);
        }
        if (!isPositiveFinite(paceDist.distanceMeters) || !isPositiveFinite(paceDist.durationSeconds)) {
            reasons.push(`${side}: invalid pace/distance duration or distance`);
        } else {
            const candidateSpeed = paceDist.averageSpeedMps ?? paceDist.distanceMeters / paceDist.durationSeconds;
            if (!isPositiveFinite(candidateSpeed)) {
                reasons.push(`${side}: invalid average speed`);
            } else {
                derivedSpeedMps = candidateSpeed;
            }
        }
    }

    // Gate 4: Running-specific HR-use authority.
    const hrInput: ControlledRunningHrEvidence | undefined = session.hrEvidence ?? (
        session.activity
            ? { averageHrBpm: session.activity.averageHr, hrMeasurement: session.activity.hrMeasurement }
            : undefined
    );
    const hrAuthority = evaluateRunningPaceHrAuthority(hrInput);
    if (hrAuthority.status !== 'ALLOWED') {
        hrReasons.push(...hrAuthority.reasons);
        reasons.push(`${side}: HR authority blocked (${hrAuthority.reasons.join(', ')})`);
    }

    if (
        reasons.length > 0
        || !venue
        || (venue.kind !== 'calibrated_treadmill' && venue.kind !== 'verified_standard_track')
        || !protocol
        || !paceDist
        || !CONTROLLED_PACE_DISTANCE_PROVENANCES.has(paceDist.provenance)
        || derivedSpeedMps === undefined
        || !isPositiveFinite(hrInput?.averageHrBpm)
    ) {
        return { eligible: false, state, reasons, hrReasons };
    }

    return {
        eligible: true,
        venue,
        protocol,
        speedMps: derivedSpeedMps,
        paceDistanceProvenance: paceDist.provenance as
            | 'calibrated_treadmill_console'
            | 'verified_track_splits'
            | 'calibrated_footpod',
        averageHrBpm: hrInput.averageHrBpm,
    };
}

function compareProtocols(
    current: ControlledRunningProtocolContext,
    prior: ControlledRunningProtocolContext,
): string[] {
    const reasons: string[] = [];
    if (current.protocolId !== prior.protocolId) {
        reasons.push('protocol identity mismatch');
    }
    if (
        current.protocolRevision !== undefined
        && prior.protocolRevision !== undefined
        && current.protocolRevision !== prior.protocolRevision
    ) {
        reasons.push('protocol revision mismatch');
    }
    if (
        current.prescriptionHash
        && prior.prescriptionHash
        && current.prescriptionHash !== prior.prescriptionHash
    ) {
        reasons.push('prescription hash mismatch');
    }
    if (current.executedSteps.length !== prior.executedSteps.length) {
        reasons.push('protocol step count mismatch');
        return reasons;
    }
    for (let i = 0; i < current.executedSteps.length; i++) {
        const a = current.executedSteps[i];
        const b = prior.executedSteps[i];
        if (a.stepId !== b.stepId) {
            reasons.push(`protocol step identity mismatch at step ${i + 1}`);
            break;
        }
        if (Math.abs(a.durationSeconds - b.durationSeconds) > PROTOCOL_DURATION_TOLERANCE_SECONDS) {
            reasons.push(`protocol step duration mismatch at step ${i + 1}`);
            break;
        }
        if (Math.abs(a.targetSpeedMps - b.targetSpeedMps) > PROTOCOL_SPEED_TOLERANCE_MPS) {
            reasons.push(`protocol step target speed mismatch at step ${i + 1}`);
            break;
        }
    }
    return reasons;
}

/**
 * Evaluates whether two running sessions satisfy all four controlled-evidence gates
 * and pairwise compatibility rules. Returns a bounded `controlled_pace_hr_response_proxy`
 * when comparable, or fails closed otherwise.
 */
export function evaluateControlledRunningPaceHrComparison(
    current: ControlledRunningSessionEvidence,
    prior: ControlledRunningSessionEvidence,
): ControlledPaceHrComparisonResult {
    if (
        current.sessionId === prior.sessionId
        || (current.performedOccurrenceId && current.performedOccurrenceId === prior.performedOccurrenceId)
    ) {
        return {
            state: 'not_comparable',
            resultKind: 'controlled_pace_hr_response_proxy',
            authority: 'display_only',
            rejectionReasons: ['same performed session or occurrence'],
            hrReasons: [],
        };
    }
    if (!(prior.localDate < current.localDate)) {
        return {
            state: 'not_comparable',
            resultKind: 'controlled_pace_hr_response_proxy',
            authority: 'display_only',
            rejectionReasons: [`prior session date (${prior.localDate}) is not before current (${current.localDate})`],
            hrReasons: [],
        };
    }

    const left = evaluateSessionEligibility('current', current);
    const right = evaluateSessionEligibility('prior', prior);
    if (!left.eligible || !right.eligible) {
        const rejectionReasons = [
            ...(!left.eligible ? left.reasons : []),
            ...(!right.eligible ? right.reasons : []),
        ];
        const hrReasons = [
            ...new Set([
                ...(!left.eligible ? left.hrReasons : []),
                ...(!right.eligible ? right.hrReasons : []),
            ]),
        ];
        const state = (!left.eligible && left.state === 'not_comparable')
            || (!right.eligible && right.state === 'not_comparable')
            ? 'not_comparable'
            : 'insufficient_evidence';
        return {
            state,
            resultKind: 'controlled_pace_hr_response_proxy',
            authority: 'display_only',
            rejectionReasons,
            hrReasons,
        };
    }

    const compatibilityRejections: string[] = [];
    if (left.venue.kind !== right.venue.kind) {
        compatibilityRejections.push(`conflicting controlled venue (${left.venue.kind} vs ${right.venue.kind})`);
    } else if (left.venue.kind === 'calibrated_treadmill' && right.venue.kind === 'calibrated_treadmill') {
        if (Math.abs(left.venue.inclinePct - right.venue.inclinePct) > TREADMILL_INCLINE_TOLERANCE_PCT) {
            compatibilityRejections.push('conflicting treadmill incline');
        }
        if (
            left.venue.treadmillCalibrationId
            && right.venue.treadmillCalibrationId
            && left.venue.treadmillCalibrationId !== right.venue.treadmillCalibrationId
        ) {
            compatibilityRejections.push('conflicting treadmill calibration identity');
        }
    } else if (left.venue.kind === 'verified_standard_track' && right.venue.kind === 'verified_standard_track') {
        if (
            left.venue.trackLengthMeters !== undefined
            && right.venue.trackLengthMeters !== undefined
            && left.venue.trackLengthMeters !== right.venue.trackLengthMeters
        ) {
            compatibilityRejections.push('conflicting track length');
        }
        if (
            left.venue.laneNumber !== undefined
            && right.venue.laneNumber !== undefined
            && left.venue.laneNumber !== right.venue.laneNumber
        ) {
            compatibilityRejections.push('conflicting track lane');
        }
    }

    if (left.paceDistanceProvenance !== right.paceDistanceProvenance) {
        compatibilityRejections.push(
            `conflicting pace/distance provenance (${left.paceDistanceProvenance} vs ${right.paceDistanceProvenance})`,
        );
    }

    compatibilityRejections.push(...compareProtocols(left.protocol, right.protocol));

    if (compatibilityRejections.length > 0) {
        return {
            state: 'not_comparable',
            resultKind: 'controlled_pace_hr_response_proxy',
            authority: 'display_only',
            rejectionReasons: compatibilityRejections,
            hrReasons: [],
        };
    }

    const paceHrRatioCurrent = (left.speedMps * 60) / left.averageHrBpm;
    const paceHrRatioPrior = (right.speedMps * 60) / right.averageHrBpm;
    const paceHrRatioChangePct = ((paceHrRatioCurrent - paceHrRatioPrior) / paceHrRatioPrior) * 100;

    return {
        state: 'comparable',
        resultKind: 'controlled_pace_hr_response_proxy',
        authority: 'display_only',
        currentSessionId: current.sessionId,
        priorSessionId: prior.sessionId,
        currentDate: current.localDate,
        priorDate: prior.localDate,
        currentSpeedMps: round(left.speedMps, 3),
        priorSpeedMps: round(right.speedMps, 3),
        currentPaceSecPerKm: round(1000 / left.speedMps, 1),
        priorPaceSecPerKm: round(1000 / right.speedMps, 1),
        currentAverageHrBpm: round(left.averageHrBpm, 1),
        priorAverageHrBpm: round(right.averageHrBpm, 1),
        paceHrRatioCurrent: round(paceHrRatioCurrent, 3),
        paceHrRatioPrior: round(paceHrRatioPrior, 3),
        paceHrRatioChangePct: round(paceHrRatioChangePct, 1),
        confidenceCeiling: 'moderate',
        provenance: {
            venueKind: left.venue.kind,
            protocolId: left.protocol.protocolId,
            paceDistanceProvenance: left.paceDistanceProvenance,
            hrSensorTechnology: 'electrode_chest_strap',
            hrAuthorityStatus: 'ALLOWED',
        },
        limitations: [
            'Controlled pace-HR response proxy only; does not measure oxygen cost or running economy.',
            'Display-only observational evidence; no recommendation, readiness, load, or safety authority.',
            'Subject to environmental, hydration, and cardiac-drift variance not captured by venue/protocol gates.',
        ],
    };
}
