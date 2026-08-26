/* eslint-disable @typescript-eslint/no-explicit-any -- validating untrusted raw subjective input, matching engine/validationCore.ts's own convention */
import type { DailyReadiness, SafetyEnvelope, PlanEnvelope } from '../engine/models';

export interface ObservationEngineContractResult {
    valid: boolean;
    errors: string[];
}

export function validateSubjectiveInputContract(subjective: unknown): ObservationEngineContractResult {
    const errors: string[] = [];
    if (!subjective || typeof subjective !== 'object' || Array.isArray(subjective)) {
        return { valid: false, errors: ['Subjective input must be a non-null object'] };
    }

    const s = subjective as Record<string, any>;
    const scoreFields = ['readiness', 'sleepQuality', 'fatigue', 'soreness', 'stress', 'motivation'];
    for (const field of scoreFields) {
        if (typeof s[field] !== 'number' || s[field] < 1 || s[field] > 10 || !Number.isInteger(s[field])) {
            errors.push('subjective.' + field + ' must be an integer between 1 and 10, got ' + s[field]);
        }
    }

    if (typeof s.timeAvailable !== 'number' || s.timeAvailable < 0 || s.timeAvailable > 480) {
        errors.push('subjective.timeAvailable must be a non-negative number <= 480 min, got ' + s.timeAvailable);
    }
    if (typeof s.painFlag !== 'boolean') {
        errors.push('subjective.painFlag must be a boolean');
    }
    if (typeof s.alreadyTrainedToday !== 'boolean') {
        errors.push('subjective.alreadyTrainedToday must be a boolean');
    }

    return { valid: errors.length === 0, errors };
}

export function validateObservationEnvelopesContract(
    readiness: DailyReadiness,
    safety: SafetyEnvelope,
    plan: PlanEnvelope
): ObservationEngineContractResult {
    const errors: string[] = [];

    // Clinical safety invariants
    if (readiness.subjective.painFlag) {
        if (!safety.clinicalFlagActive) {
            errors.push('Contract violation: painFlag=true MUST set safety.clinicalFlagActive=true');
        }
        if (!safety.restrictedModalities.includes('Running')) {
            errors.push('Contract violation: painFlag=true MUST restrict Running modality');
        }
        if (plan.maxAllowableTier === 'Hard' || plan.maxAllowableTier === 'Moderate' || plan.maxAllowableTier === 'Easy') {
            errors.push('Contract violation: painFlag=true MUST NOT permit tier ' + plan.maxAllowableTier);
        }
    }

    // Already trained today invariant
    if (readiness.subjective.alreadyTrainedToday) {
        if (plan.maxAllowableTier !== 'Rest') {
            errors.push('Contract violation: alreadyTrainedToday=true MUST restrict plan tier to Rest, got ' + plan.maxAllowableTier);
        }
    }

    // Severe recovery depression invariants
    const wakeDepressed = readiness.objective.body_battery_wake !== null && readiness.objective.body_battery_wake < 30;
    const sleepDepressed = readiness.objective.sleep_score !== null && readiness.objective.sleep_score < 55;
    if ((wakeDepressed || sleepDepressed) && !readiness.subjective.alreadyTrainedToday && !readiness.subjective.painFlag) {
        if (plan.maxAllowableTier === 'Hard' || plan.maxAllowableTier === 'Moderate') {
            errors.push('Contract violation: severe recovery depression MUST cap tier at Easy or lower, got ' + plan.maxAllowableTier);
        }
    }

    return { valid: errors.length === 0, errors };
}
