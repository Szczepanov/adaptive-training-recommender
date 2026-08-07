import type { DailySubjectiveCheckin, Recommendation } from './models';
import { TEMPLATES } from './templates';

/**
 * The small, current-day safety subset required before the engine can prescribe
 * ordinary training. This intentionally differs from the richer check-in's
 * `dataQuality.isComplete`: motivation and preferred modality are useful coaching
 * inputs, but their absence must not be treated the same as an unanswered pain or
 * already-trained question.
 */
export type MinimumSafetyCheckinStatus = 'complete' | 'missing' | 'incomplete';

function isScaleValue(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10;
}

function isAnsweredBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
}

export function getMinimumSafetyCheckinStatus(
    checkin: DailySubjectiveCheckin | null | undefined,
): MinimumSafetyCheckinStatus {
    if (!checkin) return 'missing';

    const hasSafetyFlags = isAnsweredBoolean(checkin.painOrInjury)
        && isAnsweredBoolean(checkin.illnessSymptoms)
        && isAnsweredBoolean(checkin.alreadyTrainedToday);
    const hasFatigueSignal = isScaleValue(checkin.fatigue) || isScaleValue(checkin.soreness);

    return hasSafetyFlags && hasFatigueSignal ? 'complete' : 'incomplete';
}

export function canGenerateNormalRecommendation(status: MinimumSafetyCheckinStatus): boolean {
    return status === 'complete';
}

/**
 * Deliberately avoids invoking the ordinary rules/optimizer when today's safety state is
 * unknown. A rest recommendation is feasible without equipment, duration, or movement
 * assumptions, and is not persisted as an engine-generated training decision.
 */
export function createProvisionalSafetyRecommendation(
    status: Exclude<MinimumSafetyCheckinStatus, 'complete'>,
): Recommendation {
    const restTemplate = TEMPLATES.find(template => template.category === 'Rest');
    if (!restTemplate) {
        throw new Error('Safety fallback requires a Rest session template.');
    }

    const missingMessage = status === 'missing'
        ? "Today's minimum safety check-in has not been completed."
        : "Today's check-in is missing one or more safety answers.";

    return {
        template: restTemplate,
        mode: 'recover',
        rationale: `${missingMessage} Treat this as a recovery day until you confirm pain/injury, illness, whether you have already trained, and your fatigue or soreness.`,
        envelopes: {
            safety: {
                clinicalFlagActive: false,
                clinicalReason: 'Subjective safety state is unknown.',
                restrictedModalities: [],
            },
            plan: {
                maxAllowableTier: 'Rest',
                taperActive: false,
                reason: 'Minimum safety check-in is incomplete.',
            },
        },
    };
}
