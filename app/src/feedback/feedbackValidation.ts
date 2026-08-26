import type {
    AthleteDeclaredRegret,
    AthleteDecisionAction,
    AthleteDecisionLog,
    AutonomicReboundState,
    ClosedLoopFeedbackRecord,
    CoachingHelpfulness,
    CounterfactualRegret,
    CounterfactualRegretClass,
    DoseReconciliation,
    ModificationReason,
    RecoveryTrajectory,
    RecoveryTrajectoryPoint,
    SubjectiveUtility,
    ZoneDistributionSeconds,
} from './feedbackModels';

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const VALID_ACTIONS: readonly AthleteDecisionAction[] = [
    'accepted',
    'scaled_down',
    'scaled_up',
    'substituted',
    'rejected_rest',
    'rejected_train_harder',
];

const VALID_REASONS: readonly ModificationReason[] = [
    'time_constraint',
    'feeling_fatigued',
    'feeling_strong',
    'muscle_joint_pain',
    'illness_symptoms',
    'weather_equipment',
    'social_group_ride',
    'other',
];

const VALID_REGRET_CLASSES: readonly CounterfactualRegretClass[] = [
    'optimal_choice',
    'overreaching_crash',
    'unnecessary_forfeiture',
    'injury_exacerbation',
    'inconclusive',
];

const VALID_DECLARED_REGRETS: readonly AthleteDeclaredRegret[] = [
    'none',
    'should_have_rested',
    'should_have_trained_harder',
];

const VALID_REBOUND_STATES: readonly AutonomicReboundState[] = [
    'accelerated',
    'expected',
    'suppressed',
    'insufficient_data',
];

const VALID_COACHING_HELPFULNESS: readonly CoachingHelpfulness[] = [
    'very_helpful',
    'helpful',
    'neutral',
    'unhelpful',
    'counterproductive',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRealLocalDate(value: unknown): value is string {
    if (typeof value !== 'string' || !LOCAL_DATE_RE.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const instant = Date.UTC(year, month - 1, day);
    const date = new Date(instant);
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function isIsoTimestampWithOffset(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_TIMESTAMP_WITH_OFFSET_RE.test(value)) return false;
    if (!isRealLocalDate(value.slice(0, 10))) return false;
    return Number.isFinite(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNonNegative(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
    return value === null || isFiniteNumber(value);
}

function isNullableFiniteNonNegative(value: unknown): value is number | null {
    return value === null || isFiniteNonNegative(value);
}

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function derivePercentageDelta(planned: number | null, actual: number | null): number | null {
    if (planned === null || actual === null) return null;
    if (planned === 0) return actual === 0 ? 0 : null;
    return Math.round(((actual - planned) / planned) * 10_000) / 100;
}

function validateDerivedPercentageDelta(
    provided: unknown,
    expected: number | null,
    field: 'durationDeltaPct' | 'workDeltaPct',
): number | null {
    if (expected === null) {
        if (provided !== null) {
            throw new Error(`Invalid ${field} in DoseReconciliation: expected null for unavailable values or positive actual dose after a zero plan`);
        }
        return null;
    }
    if (!isFiniteNumber(provided) || Math.abs(provided - expected) > 0.005) {
        throw new Error(`Invalid ${field} in DoseReconciliation: does not match planned and actual dose`);
    }
    return expected;
}

function parseRecommendationRef(value: unknown, context: string): { recommendationId: string; revision: number } {
    if (!isPlainObject(value)
        || typeof value.recommendationId !== 'string'
        || value.recommendationId.trim().length === 0
        || typeof value.revision !== 'number'
        || !Number.isInteger(value.revision)
        || value.revision < 1) {
        throw new Error(`Invalid recommendationRef in ${context}`);
    }
    return {
        recommendationId: value.recommendationId,
        revision: value.revision,
    };
}

function parseRecoveryTrajectoryPoint(value: unknown, context: string): RecoveryTrajectoryPoint {
    if (!isPlainObject(value)) throw new Error(`Invalid ${context} in RecoveryTrajectory`);
    if (!isNullableFiniteNumber(value.hrvDeltaPct)) throw new Error(`Invalid hrvDeltaPct in ${context}`);
    if (!isNullableFiniteNumber(value.rhrDeltaBpm)) throw new Error(`Invalid rhrDeltaBpm in ${context}`);
    if (value.sorenessScore !== null
        && (!isFiniteNumber(value.sorenessScore) || value.sorenessScore < 0 || value.sorenessScore > 10)) {
        throw new Error(`Invalid sorenessScore in ${context}`);
    }
    if (value.readinessScore !== null
        && (!isFiniteNumber(value.readinessScore) || value.readinessScore < 0 || value.readinessScore > 100)) {
        throw new Error(`Invalid readinessScore in ${context}`);
    }
    return {
        hrvDeltaPct: value.hrvDeltaPct as number | null,
        rhrDeltaBpm: value.rhrDeltaBpm as number | null,
        sorenessScore: value.sorenessScore as number | null,
        readinessScore: value.readinessScore as number | null,
    };
}

/** Parses an athlete decision while preserving its immutable recommendation revision. */
export function parseAthleteDecisionLog(value: unknown): AthleteDecisionLog {
    if (!isPlainObject(value)) throw new Error('AthleteDecisionLog must be an object');
    if (!isRealLocalDate(value.date)) throw new Error('Invalid date in AthleteDecisionLog');
    const recommendationRef = parseRecommendationRef(value.recommendationRef, 'AthleteDecisionLog');

    if (typeof value.action !== 'string' || !VALID_ACTIONS.includes(value.action as AthleteDecisionAction)) {
        throw new Error(`Invalid action in AthleteDecisionLog: ${String(value.action)}`);
    }

    if (!Array.isArray(value.reasons)
        || !value.reasons.every(r => typeof r === 'string' && VALID_REASONS.includes(r as ModificationReason))) {
        throw new Error('Invalid reasons array in AthleteDecisionLog');
    }

    if (!isNullableString(value.note)) {
        throw new Error('Invalid note in AthleteDecisionLog');
    }

    if (!isIsoTimestampWithOffset(value.decidedAt)) {
        throw new Error('Invalid decidedAt ISO timestamp in AthleteDecisionLog');
    }

    return {
        date: value.date,
        recommendationRef,
        action: value.action as AthleteDecisionAction,
        reasons: [...value.reasons] as ModificationReason[],
        note: value.note,
        decidedAt: value.decidedAt,
    };
}

/** Parses executed dose and verifies that stored percentage deltas match their source values. */
export function parseDoseReconciliation(value: unknown): DoseReconciliation {
    if (!isPlainObject(value)) throw new Error('DoseReconciliation must be an object');
    if (!isRealLocalDate(value.date)) throw new Error('Invalid date in DoseReconciliation');

    if (!isFiniteNonNegative(value.plannedDurationMin)) {
        throw new Error('Invalid plannedDurationMin in DoseReconciliation');
    }
    if (!isFiniteNonNegative(value.actualDurationMin)) {
        throw new Error('Invalid actualDurationMin in DoseReconciliation');
    }
    if (!isNullableFiniteNonNegative(value.plannedWorkKj)) {
        throw new Error('Invalid plannedWorkKj in DoseReconciliation');
    }
    if (!isNullableFiniteNonNegative(value.actualWorkKj)) {
        throw new Error('Invalid actualWorkKj in DoseReconciliation');
    }
    const expectedDurationDeltaPct = derivePercentageDelta(
        value.plannedDurationMin,
        value.actualDurationMin,
    );
    const durationDeltaPct = validateDerivedPercentageDelta(
        value.durationDeltaPct,
        expectedDurationDeltaPct,
        'durationDeltaPct',
    );
    const workDeltaPct = validateDerivedPercentageDelta(
        value.workDeltaPct,
        derivePercentageDelta(value.plannedWorkKj, value.actualWorkKj),
        'workDeltaPct',
    );
    const holdCompliancePct = value.holdCompliancePct;
    if (holdCompliancePct !== null
        && (!isFiniteNumber(holdCompliancePct) || holdCompliancePct < 0 || holdCompliancePct > 100)) {
        throw new Error('Invalid holdCompliancePct in DoseReconciliation');
    }
    if (typeof value.stepOmissionsCount !== 'number'
        || !Number.isInteger(value.stepOmissionsCount)
        || value.stepOmissionsCount < 0) {
        throw new Error('Invalid stepOmissionsCount in DoseReconciliation');
    }

    let completedZoneDistribution: ZoneDistributionSeconds | null = null;
    if (value.completedZoneDistribution !== null) {
        if (!isPlainObject(value.completedZoneDistribution)) {
            throw new Error('Invalid completedZoneDistribution in DoseReconciliation');
        }
        const zd = value.completedZoneDistribution;
        const zoneValues = [zd.z1Seconds, zd.z2Seconds, zd.z3Seconds, zd.z4Seconds, zd.z5Seconds];
        if (!zoneValues.every(isFiniteNonNegative)) {
            throw new Error('Invalid zone distribution values in DoseReconciliation');
        }
        completedZoneDistribution = {
            z1Seconds: zd.z1Seconds as number,
            z2Seconds: zd.z2Seconds as number,
            z3Seconds: zd.z3Seconds as number,
            z4Seconds: zd.z4Seconds as number,
            z5Seconds: zd.z5Seconds as number,
        };
    }

    return {
        date: value.date,
        plannedDurationMin: value.plannedDurationMin,
        actualDurationMin: value.actualDurationMin,
        plannedWorkKj: value.plannedWorkKj,
        actualWorkKj: value.actualWorkKj,
        durationDeltaPct,
        workDeltaPct,
        completedZoneDistribution,
        holdCompliancePct: holdCompliancePct as number | null,
        stepOmissionsCount: value.stepOmissionsCount,
    };
}

/** Parses bounded 24h, 48h, and 72h recovery observations. */
export function parseRecoveryTrajectory(value: unknown): RecoveryTrajectory {
    if (!isPlainObject(value)) throw new Error('RecoveryTrajectory must be an object');
    if (!isRealLocalDate(value.date)) throw new Error('Invalid date in RecoveryTrajectory');
    if (typeof value.autonomicReboundState !== 'string'
        || !VALID_REBOUND_STATES.includes(value.autonomicReboundState as AutonomicReboundState)) {
        throw new Error('Invalid autonomicReboundState in RecoveryTrajectory');
    }

    return {
        date: value.date,
        hours24: parseRecoveryTrajectoryPoint(value.hours24, 'hours24'),
        hours48: parseRecoveryTrajectoryPoint(value.hours48, 'hours48'),
        hours72: parseRecoveryTrajectoryPoint(value.hours72, 'hours72'),
        autonomicReboundState: value.autonomicReboundState as AutonomicReboundState,
    };
}

/** Parses an observational regret label without treating it as a causal conclusion. */
export function parseCounterfactualRegret(value: unknown): CounterfactualRegret {
    if (!isPlainObject(value)) throw new Error('CounterfactualRegret must be an object');
    if (!isRealLocalDate(value.date)) throw new Error('Invalid date in CounterfactualRegret');

    if (typeof value.regretClass !== 'string'
        || !VALID_REGRET_CLASSES.includes(value.regretClass as CounterfactualRegretClass)) {
        throw new Error(`Invalid regretClass in CounterfactualRegret: ${String(value.regretClass)}`);
    }

    if (typeof value.confidence !== 'string' || !['low', 'medium', 'high'].includes(value.confidence)) {
        throw new Error('Invalid confidence in CounterfactualRegret');
    }

    if (!Array.isArray(value.rationales)
        || !value.rationales.every(r => typeof r === 'string' && r.trim().length > 0)) {
        throw new Error('Invalid rationales in CounterfactualRegret');
    }

    if (value.athleteDeclaredRegret !== null
        && (typeof value.athleteDeclaredRegret !== 'string'
            || !VALID_DECLARED_REGRETS.includes(value.athleteDeclaredRegret as AthleteDeclaredRegret))) {
        throw new Error('Invalid athleteDeclaredRegret in CounterfactualRegret');
    }

    if (!isNullableString(value.counterfactualAlternative)) {
        throw new Error('Invalid counterfactualAlternative in CounterfactualRegret');
    }

    return {
        date: value.date,
        regretClass: value.regretClass as CounterfactualRegretClass,
        athleteDeclaredRegret: value.athleteDeclaredRegret as AthleteDeclaredRegret | null,
        confidence: value.confidence as 'low' | 'medium' | 'high',
        rationales: [...value.rationales],
        counterfactualAlternative: value.counterfactualAlternative,
    };
}

/** Parses the athlete's bounded usefulness and clarity ratings. */
export function parseSubjectiveUtility(value: unknown): SubjectiveUtility {
    if (!isPlainObject(value)) throw new Error('SubjectiveUtility must be an object');
    if (!Number.isInteger(value.utilityScore) || (value.utilityScore as number) < 1 || (value.utilityScore as number) > 5) {
        throw new Error('Invalid utilityScore in SubjectiveUtility');
    }
    if (!Number.isInteger(value.clarityScore) || (value.clarityScore as number) < 1 || (value.clarityScore as number) > 5) {
        throw new Error('Invalid clarityScore in SubjectiveUtility');
    }
    if (typeof value.coachingHelpfulness !== 'string'
        || !VALID_COACHING_HELPFULNESS.includes(value.coachingHelpfulness as CoachingHelpfulness)) {
        throw new Error('Invalid coachingHelpfulness in SubjectiveUtility');
    }
    if (!isNullableString(value.feedbackNote)) {
        throw new Error('Invalid feedbackNote in SubjectiveUtility');
    }

    return {
        utilityScore: value.utilityScore as number,
        clarityScore: value.clarityScore as number,
        coachingHelpfulness: value.coachingHelpfulness as CoachingHelpfulness,
        feedbackNote: value.feedbackNote,
    };
}

/** Parses a complete feedback record and enforces nested date/reference consistency. */
export function parseClosedLoopFeedbackRecord(value: unknown): ClosedLoopFeedbackRecord {
    if (!isPlainObject(value)) throw new Error('ClosedLoopFeedbackRecord must be an object');
    if (!isRealLocalDate(value.date)) throw new Error('Invalid date in ClosedLoopFeedbackRecord');
    const recommendationRef = parseRecommendationRef(value.recommendationRef, 'ClosedLoopFeedbackRecord');
    const decision = parseAthleteDecisionLog(value.decision);
    const doseReconciliation = parseDoseReconciliation(value.doseReconciliation);
    const recoveryTrajectory = value.recoveryTrajectory === null ? null : parseRecoveryTrajectory(value.recoveryTrajectory);
    const regret = value.regret === null ? null : parseCounterfactualRegret(value.regret);
    const utility = value.utility === null ? null : parseSubjectiveUtility(value.utility);

    if (!isIsoTimestampWithOffset(value.createdAt) || !isIsoTimestampWithOffset(value.updatedAt)) {
        throw new Error('Invalid timestamps in ClosedLoopFeedbackRecord');
    }
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
        throw new Error('updatedAt precedes createdAt in ClosedLoopFeedbackRecord');
    }

    const nestedDates = [
        decision.date,
        doseReconciliation.date,
        recoveryTrajectory?.date ?? value.date,
        regret?.date ?? value.date,
    ];
    if (nestedDates.some(date => date !== value.date)) {
        throw new Error('Nested date mismatch in ClosedLoopFeedbackRecord');
    }
    if (decision.recommendationRef.recommendationId !== recommendationRef.recommendationId
        || decision.recommendationRef.revision !== recommendationRef.revision) {
        throw new Error('Nested recommendationRef mismatch in ClosedLoopFeedbackRecord');
    }

    return {
        date: value.date,
        recommendationRef,
        decision,
        doseReconciliation,
        recoveryTrajectory,
        regret,
        utility,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
}
