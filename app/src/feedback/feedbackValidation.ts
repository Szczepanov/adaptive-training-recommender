import type {
    AthleteDeclaredRegret,
    AthleteDecisionAction,
    AthleteDecisionLog,
    CounterfactualRegret,
    CounterfactualRegretClass,
    DoseReconciliation,
    ModificationReason,
    ZoneDistributionSeconds,
} from './feedbackModels';

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export function parseAthleteDecisionLog(value: unknown): AthleteDecisionLog {
    if (!isPlainObject(value)) throw new Error('AthleteDecisionLog must be an object');
    if (!isRealLocalDate(value.date)) throw new Error('Invalid date in AthleteDecisionLog');

    if (!isPlainObject(value.recommendationRef)
        || typeof value.recommendationRef.recommendationId !== 'string'
        || value.recommendationRef.recommendationId.length === 0
        || typeof value.recommendationRef.revision !== 'number'
        || !Number.isInteger(value.recommendationRef.revision)
        || value.recommendationRef.revision < 1) {
        throw new Error('Invalid recommendationRef in AthleteDecisionLog');
    }

    if (typeof value.action !== 'string' || !VALID_ACTIONS.includes(value.action as AthleteDecisionAction)) {
        throw new Error(`Invalid action in AthleteDecisionLog: ${String(value.action)}`);
    }

    if (!Array.isArray(value.reasons) || !value.reasons.every(r => typeof r === 'string' && VALID_REASONS.includes(r as ModificationReason))) {
        throw new Error('Invalid reasons array in AthleteDecisionLog');
    }

    if (value.note !== null && typeof value.note !== 'string') {
        throw new Error('Invalid note in AthleteDecisionLog');
    }

    if (typeof value.decidedAt !== 'string' || Number.isNaN(Date.parse(value.decidedAt))) {
        throw new Error('Invalid decidedAt ISO timestamp in AthleteDecisionLog');
    }

    return {
        date: value.date,
        recommendationRef: {
            recommendationId: value.recommendationRef.recommendationId,
            revision: value.recommendationRef.revision,
        },
        action: value.action as AthleteDecisionAction,
        reasons: [...value.reasons] as ModificationReason[],
        note: value.note,
        decidedAt: value.decidedAt,
    };
}

export function parseDoseReconciliation(value: unknown): DoseReconciliation {
    if (!isPlainObject(value)) throw new Error('DoseReconciliation must be an object');
    if (!isRealLocalDate(value.date)) throw new Error('Invalid date in DoseReconciliation');

    if (typeof value.plannedDurationMin !== 'number' || value.plannedDurationMin < 0) {
        throw new Error('Invalid plannedDurationMin in DoseReconciliation');
    }
    if (typeof value.actualDurationMin !== 'number' || value.actualDurationMin < 0) {
        throw new Error('Invalid actualDurationMin in DoseReconciliation');
    }
    if (value.plannedWorkKj !== null && (typeof value.plannedWorkKj !== 'number' || value.plannedWorkKj < 0)) {
        throw new Error('Invalid plannedWorkKj in DoseReconciliation');
    }
    if (value.actualWorkKj !== null && (typeof value.actualWorkKj !== 'number' || value.actualWorkKj < 0)) {
        throw new Error('Invalid actualWorkKj in DoseReconciliation');
    }
    if (typeof value.durationDeltaPct !== 'number' || !Number.isFinite(value.durationDeltaPct)) {
        throw new Error('Invalid durationDeltaPct in DoseReconciliation');
    }
    if (value.workDeltaPct !== null && (typeof value.workDeltaPct !== 'number' || !Number.isFinite(value.workDeltaPct))) {
        throw new Error('Invalid workDeltaPct in DoseReconciliation');
    }
    if (typeof value.stepOmissionsCount !== 'number' || value.stepOmissionsCount < 0) {
        throw new Error('Invalid stepOmissionsCount in DoseReconciliation');
    }

    let completedZoneDistribution: ZoneDistributionSeconds | null = null;
    if (value.completedZoneDistribution !== null) {
        if (!isPlainObject(value.completedZoneDistribution)) {
            throw new Error('Invalid completedZoneDistribution in DoseReconciliation');
        }
        const zd = value.completedZoneDistribution;
        if (typeof zd.z1Seconds !== 'number' || typeof zd.z2Seconds !== 'number'
            || typeof zd.z3Seconds !== 'number' || typeof zd.z4Seconds !== 'number'
            || typeof zd.z5Seconds !== 'number') {
            throw new Error('Invalid zone distribution values in DoseReconciliation');
        }
        completedZoneDistribution = {
            z1Seconds: zd.z1Seconds,
            z2Seconds: zd.z2Seconds,
            z3Seconds: zd.z3Seconds,
            z4Seconds: zd.z4Seconds,
            z5Seconds: zd.z5Seconds,
        };
    }

    return {
        date: value.date,
        plannedDurationMin: value.plannedDurationMin,
        actualDurationMin: value.actualDurationMin,
        plannedWorkKj: value.plannedWorkKj,
        actualWorkKj: value.actualWorkKj,
        durationDeltaPct: value.durationDeltaPct,
        workDeltaPct: value.workDeltaPct,
        completedZoneDistribution,
        holdCompliancePct: typeof value.holdCompliancePct === 'number' ? value.holdCompliancePct : null,
        stepOmissionsCount: value.stepOmissionsCount,
    };
}

export function parseCounterfactualRegret(value: unknown): CounterfactualRegret {
    if (!isPlainObject(value)) throw new Error('CounterfactualRegret must be an object');
    if (!isRealLocalDate(value.date)) throw new Error('Invalid date in CounterfactualRegret');

    if (typeof value.regretClass !== 'string' || !VALID_REGRET_CLASSES.includes(value.regretClass as CounterfactualRegretClass)) {
        throw new Error(`Invalid regretClass in CounterfactualRegret: ${String(value.regretClass)}`);
    }

    if (!['low', 'medium', 'high'].includes(value.confidence as string)) {
        throw new Error('Invalid confidence in CounterfactualRegret');
    }

    if (!Array.isArray(value.rationales) || !value.rationales.every(r => typeof r === 'string')) {
        throw new Error('Invalid rationales in CounterfactualRegret');
    }

    const declaredRegret = typeof value.athleteDeclaredRegret === 'string'
        && VALID_DECLARED_REGRETS.includes(value.athleteDeclaredRegret as AthleteDeclaredRegret)
        ? (value.athleteDeclaredRegret as AthleteDeclaredRegret)
        : null;

    return {
        date: value.date,
        regretClass: value.regretClass as CounterfactualRegretClass,
        athleteDeclaredRegret: declaredRegret,
        confidence: value.confidence as 'low' | 'medium' | 'high',
        rationales: [...value.rationales],
        counterfactualAlternative: typeof value.counterfactualAlternative === 'string' ? value.counterfactualAlternative : null,
    };
}
