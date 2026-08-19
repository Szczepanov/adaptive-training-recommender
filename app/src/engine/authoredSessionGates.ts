import type { DailyReadiness, PlannedDose, UserContext, PlanEnvelope, Modality, SessionTemplate } from './models';
import type { SessionDefinition, SessionBlock, SessionStep } from '../sessions/models';
import { describeEligibilityReasons, evaluateTemplateEligibility, type EligibilityReason } from './eligibility';
import { resolveExecutionDose } from './dose';
import type { evaluateReadinessAndSafetyEnvelope } from './rules';
import type { ResolvedAvailability } from './schedule';

export const AUTHORED_MODIFY_MAX_SYSTEMIC_COST = 0.5;

export const AUTHORED_PLAN_TIER_SYSTEMIC_COST_CEILING: Record<PlanEnvelope['maxAllowableTier'], number> = {
    Rest: 0,
    Mobility: 0.15,
    Easy: 0.5,
    Moderate: 0.8,
    Hard: Infinity,
};

export type AuthoredSessionDecision = 'proceed' | 'scale' | 'reject';

export interface AuthoredSessionVerdict {
    decision: AuthoredSessionDecision;
    scaledDefinition?: SessionDefinition;
    executionDose?: PlannedDose;
    /** Cost after the readiness scale. Callers carry this forward when adjudicating an
     * additional same-day occurrence so each accepted session consumes the same finite
     * plan-envelope budget. */
    acceptedSystemicCost?: number;
    gateFailures: EligibilityReason[];
    rationale: string;
}

type EnvelopeState = ReturnType<typeof evaluateReadinessAndSafetyEnvelope>;

/**
 * Estimates systemic cost of an authored session for comparison against
 * the readiness clinical ceiling (ADR-0023 / D-CANDIDATE).
 */
export function estimateAuthoredSessionSystemicCost(definition: SessionDefinition): number {
    const duration = definition.duration?.max ?? definition.duration?.min ?? 45;
    const intent = definition.intent;

    if (intent === 'recovery') return 0.1;
    if (intent === 'competition' || intent === 'testing') return Math.min(1.2, 0.6 + (duration / 60) * 0.4);

    // Default baseline estimation based on duration
    return Math.min(1.0, (duration / 60) * 0.5);
}

function authoredCategory(definition: SessionDefinition): SessionTemplate['category'] {
    if (definition.intent === 'recovery') return 'Mobility/Recovery';
    if (definition.intent === 'testing' || definition.intent === 'skill_technical') return 'Technical Skill';

    switch (definition.dominantModality) {
        case 'Strength': return 'Full-body Strength';
        case 'Field': return 'Field Maintenance';
        case 'Mobility': return 'Mobility/Recovery';
        case 'None': return 'Rest';
        default: return 'Easy Endurance';
    }
}

/**
 * The small `SessionTemplate` projection used only for common hard-gate machinery and
 * for rendering an accepted authored primary. It deliberately has no stimulus profile:
 * ADR-0023 D-MPOLICY keeps authored-session load and stimulus evidence-only.
 */
export function createAuthoredSessionTemplate(definition: SessionDefinition): SessionTemplate {
    const durationMin = definition.duration?.min ?? 45;
    const durationMax = definition.duration?.max ?? durationMin;
    return {
        id: `authored:${definition.id}:${definition.revision}`,
        title: definition.title,
        description: definition.summary ?? 'Athlete-authored session.',
        modality: (definition.dominantModality as Modality) ?? 'Strength',
        category: authoredCategory(definition),
        durationMin,
        durationMax,
        environment: 'either',
        requiredEquipment: [],
        safetyTags: [],
        systemicCost: estimateAuthoredSessionSystemicCost(definition),
    };
}

/**
 * Deterministically scales an authored session definition's volume
 * when readiness mode requires 'modify' (ADR-0023 / D-MAUTH).
 */
export function scaleSessionDefinitionForModify(
    definition: SessionDefinition,
    volumeScale: number = 0.7,
): SessionDefinition {
    const clampedScale = Math.max(0.4, Math.min(0.9, volumeScale));

    const scaledBlocks: SessionBlock[] = definition.blocks.map(block => {
        const scaledSteps: SessionStep[] = block.steps.map(step => {
            if (!step.dose) return step;

            if (step.dose.kind === 'repetition') {
                const newSets = Math.max(1, Math.round(step.dose.sets * clampedScale));
                return {
                    ...step,
                    dose: {
                        ...step.dose,
                        sets: newSets,
                    },
                };
            }

            if (step.dose.kind === 'duration') {
                if (typeof step.dose.seconds === 'number') {
                    return {
                        ...step,
                        dose: {
                            ...step.dose,
                            seconds: Math.max(10, Math.round(step.dose.seconds * clampedScale)),
                        },
                    };
                }
            }

            if (step.dose.kind === 'distance') {
                if (typeof step.dose.meters === 'number') {
                    return {
                        ...step,
                        dose: {
                            ...step.dose,
                            meters: Math.max(20, Math.round(step.dose.meters * clampedScale)),
                        },
                    };
                }
            }

            return step;
        });

        return {
            ...block,
            steps: scaledSteps,
        };
    });

    const scaledDuration = definition.duration
        ? {
            min: Math.max(10, Math.round(definition.duration.min * clampedScale)),
            max: Math.max(15, Math.round(definition.duration.max * clampedScale)),
        }
        : undefined;

    return {
        ...definition,
        duration: scaledDuration,
        blocks: scaledBlocks,
        summary: definition.summary
            ? `${definition.summary} (Scaled for modified readiness)`
            : 'Scaled for modified readiness',
    };
}

/**
 * Adjudicates an athlete-authored session replacement against all clinical,
 * injury, schedule, equipment, environment, and systemic cost gates (ADR-0023).
 */
export function adjudicateAuthoredSession(
    definition: SessionDefinition,
    _readiness: DailyReadiness,
    context: UserContext,
    envelopeState: EnvelopeState,
    plannedDose: PlannedDose,
    date: string,
    availability: ResolvedAvailability,
    acceptedSameDaySystemicCost = 0,
): AuthoredSessionVerdict {
    const { mode, envelopes } = envelopeState;
    const systemicCost = estimateAuthoredSessionSystemicCost(definition);
    const maxCost = AUTHORED_PLAN_TIER_SYSTEMIC_COST_CEILING[envelopes.plan.maxAllowableTier];
    const syntheticTemplate = createAuthoredSessionTemplate(definition);
    const modality = syntheticTemplate.modality;
    const category = syntheticTemplate.category;

    const eligibility = evaluateTemplateEligibility(syntheticTemplate, context, availability.maxTimeMinutes, date);
    const gateFailures: EligibilityReason[] = [];

    if (!eligibility.eligible) {
        gateFailures.push(...eligibility.reasons);
    }

    // 1. Clinical / Readiness recover mode gate
    if (mode === 'recover' && definition.intent !== 'recovery') {
        gateFailures.push('restricted_category');
    }

    // 2. Systemic cost ceiling (in modify mode, check if scaled cost fits)
    const effectiveCost = mode === 'modify' ? systemicCost * 0.7 : systemicCost;
    if (acceptedSameDaySystemicCost + effectiveCost > maxCost) {
        gateFailures.push('restricted_category');
    }

    // 3. Safety restricted modalities
    if (envelopes.safety.restrictedModalities.includes(modality)) {
        gateFailures.push('restricted_modality');
    }

    // 4. Restricted categories
    if ((context.constraints.restrictedCategories ?? []).includes(category)) {
        gateFailures.push('restricted_category');
    }

    // If hard gates failed, reject the replacement
    if (gateFailures.length > 0) {
        const failureDescription = describeEligibilityReasons(gateFailures);
        return {
            decision: 'reject',
            gateFailures,
            rationale: `Authored session cannot replace today's recommendation: ${failureDescription}.`,
        };
    }

    // If mode is 'modify', scale the prescription
    if (mode === 'modify') {
        const executionDose = resolveExecutionDose(plannedDose, envelopes.plan, null) ?? { volume: 0.7, intensity: 0.7 };
        const scaledDefinition = scaleSessionDefinitionForModify(definition, executionDose.volume);
        return {
            decision: 'scale',
            scaledDefinition,
            executionDose,
            acceptedSystemicCost: effectiveCost,
            gateFailures: [],
            rationale: 'Authored session accepted with modified dose scaling to match current readiness.',
        };
    }

    const executionDose = resolveExecutionDose(plannedDose, envelopes.plan, null) ?? plannedDose;
    return {
        decision: 'proceed',
        scaledDefinition: definition,
        executionDose,
        acceptedSystemicCost: effectiveCost,
        gateFailures: [],
        rationale: 'Authored session cleared all safety, eligibility, and capacity gates for today.',
    };
}
