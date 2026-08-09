import type {
    DailyReadiness,
    UserContext,
    Recommendation,
    SessionTemplate,
    NextDayPotentialPlan,
    NextDayPlanBranch,
    NextDayScenario,
    NextDayScenarioSet,
    DecisionScoreTelemetry,
    SafetyEnvelope,
    PlanEnvelope,
    UserEvent,
    FixedActivity,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';
import { TEMPLATES, ENRICHED_TEMPLATES } from './templates';
import { eligibleTemplates, evaluateTemplateEligibility, resolveMaximumSessionMinutes } from './eligibility';
import { buildOptimizationContext, rankCandidates } from './optimizer';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { resolveTrainingIntent } from './trainingIntent';
import { POLICY_VERSION } from './policy';
import { resolveExecutionDose } from './dose';
import { isTemplatePhaseEligible } from './periodization';
import { resolveMinimumDaysAfterHardLowerBody } from './planningCandidate';
import { applyFixedActivityStimulusCredit } from './planner';
import { getUnresolvedObjectives } from './microcycle';
import { applyCompletedSessionLoad } from './fatigue';
import { resolveAvailability } from './schedule';
import { workoutForTemplate } from '../workouts/prescription';

function pickTemplate(options: SessionTemplate[], seedDate: string): SessionTemplate | undefined {
    if (options.length === 0) return undefined;
    if (options.length === 1) return options[0];
    let hash = 0;
    for (let i = 0; i < seedDate.length; i++) hash = (hash * 31 + seedDate.charCodeAt(i)) >>> 0;
    return options[hash % options.length];
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function modalityMatches(templateModality: string, wanted: string): boolean {
    return templateModality.toLowerCase() === wanted.trim().toLowerCase();
}

function rankByModalityPreference(
    options: SessionTemplate[],
    preferredModalities: string[],
    deprioritizedModalities: string[]
): SessionTemplate[] {
    const isDeprioritized = (t: SessionTemplate) => deprioritizedModalities.some(m => modalityMatches(t.modality, m));
    const isPreferred = (t: SessionTemplate) => preferredModalities.some(m => modalityMatches(t.modality, m));
    const preferred = options.filter(t => isPreferred(t) && !isDeprioritized(t));
    if (preferred.length > 0) return preferred;
    const neutral = options.filter(t => !isDeprioritized(t));
    return neutral.length > 0 ? neutral : options;
}

function applyModalityPreference(
    searchPool: SessionTemplate[],
    fallbackPool: SessionTemplate[],
    preferredModalityToday: string | null
): { options: SessionTemplate[]; note: string | null } {
    if (!preferredModalityToday || !preferredModalityToday.trim()) return { options: fallbackPool, note: null };
    const matchingToday = searchPool.filter(t => modalityMatches(t.modality, preferredModalityToday));
    if (matchingToday.length > 0) return { options: matchingToday, note: null };
    const existsAnywhereInCatalog = TEMPLATES.some(t => modalityMatches(t.modality, preferredModalityToday));
    return {
        options: fallbackPool,
        note: existsAnywhereInCatalog
            ? `You asked for ${preferredModalityToday} today, but today's readiness/constraints don't support it -- sticking with a safer option instead.`
            : `You asked for ${preferredModalityToday} today, but we don't have a matching session type in the catalog yet.`,
    };
}

const HRV_STRAIN_WEIGHT = 0.5;
const RHR_STRAIN_WEIGHT = 0.3;
const SLEEP_STRAIN_WEIGHT = 0.2;
const HRV_STDEV_FLOOR_MS = 3;
const RHR_STDEV_FLOOR_BPM = 1.5;
const SLEEP_STDEV_FLOOR_PTS = 4;
const STRAIN_Z_CAP = 2.0;
const CHRONIC_STRAIN_MULTIPLIER = 1.5;
const SLEEP_SCORE_ABSOLUTE_FLOOR = 50;
const SLEEP_SCORE_ABSOLUTE_FLOOR_STRAIN = 0.5;
const BODY_BATTERY_LOW_ANCHOR = 50;
const BODY_BATTERY_LOW_FULL_STRAIN_AT = 25;
const BODY_BATTERY_MAX_STRAIN = 0.3;
const BODY_BATTERY_RECOVER_THRESHOLD = 20;
const RECENT_HARD_SESSIONS_STRAIN = 1.0;
const CONSERVATIVE_BIAS_STRAIN_OFFSET = 0.4;
const STRAIN_MODIFY_THRESHOLD = 1.0;
const STRAIN_RECOVER_THRESHOLD = 2.2;
const MODIFY_MAX_SYSTEMIC_COST = 0.5;

function metricStrain(
    deltaVs7d: number | null,
    deltaVs28d: number | null,
    stdev: number | null,
    stdevFloor: number,
    weight: number,
    sign: 1 | -1
): { acuteDeviation: number; multiDayDrift: number; total: number } {
    if (deltaVs7d === null) return { acuteDeviation: 0, multiDayDrift: 0, total: 0 };
    const sd = Math.max(stdev ?? stdevFloor, stdevFloor);
    const zAcute = (sign * deltaVs7d) / sd;
    const acuteStrain = clamp(-zAcute, 0, STRAIN_Z_CAP);
    let chronicStrain = 0;
    if (deltaVs28d !== null) {
        const zChronic = (sign * (deltaVs28d - deltaVs7d)) / sd;
        chronicStrain = clamp(-zChronic, 0, STRAIN_Z_CAP);
    }
    const acuteDeviation = weight * acuteStrain;
    const multiDayDrift = weight * CHRONIC_STRAIN_MULTIPLIER * chronicStrain;
    return { acuteDeviation, multiDayDrift, total: acuteDeviation + multiDayDrift };
}

export function evaluateReadinessAndSafetyEnvelope(
    readiness: DailyReadiness,
    context: UserContext,
    _date?: string,
    previousMode?: 'train' | 'modify' | 'recover'
): {
    mode: 'train' | 'modify' | 'recover';
    envelopes: { safety: SafetyEnvelope; plan: PlanEnvelope };
    telemetry: DecisionScoreTelemetry;
    alreadyTrainedOverride: boolean;
    fatigueTriggeredRecover: boolean;
    multiDayDriftIsDecisionRelevant: boolean;
    postRecoverBufferApplied: boolean;
} {
    const { subjective, objective } = readiness;
    const invertedMotivation = 10 - subjective.motivation;
    const invertedSleepQual = 10 - subjective.sleepQuality;
    const invertedReadiness = 10 - subjective.readiness;
    const overallFatigueScore = (subjective.fatigue + subjective.soreness + invertedReadiness + invertedSleepQual + invertedMotivation) / 5;

    const hrvStrain = metricStrain(objective.hrv_delta, objective.hrv_delta_28d, objective.hrv_stdev_28d, HRV_STDEV_FLOOR_MS, HRV_STRAIN_WEIGHT, 1);
    const rhrStrain = metricStrain(objective.rhr_delta, objective.rhr_delta_28d, objective.rhr_stdev_28d, RHR_STDEV_FLOOR_BPM, RHR_STRAIN_WEIGHT, -1);
    const sleepStrain = metricStrain(objective.sleep_score_delta_7d, objective.sleep_score_delta_28d, objective.sleep_score_stdev_28d, SLEEP_STDEV_FLOOR_PTS, SLEEP_STRAIN_WEIGHT, 1);
    const totalAcuteDeviation = hrvStrain.acuteDeviation + rhrStrain.acuteDeviation + sleepStrain.acuteDeviation;
    const totalMultiDayDrift = hrvStrain.multiDayDrift + rhrStrain.multiDayDrift + sleepStrain.multiDayDrift;
    const totalMetricStrain = totalAcuteDeviation + totalMultiDayDrift;

    const sleepFloorPenalty = objective.sleep_score !== null && objective.sleep_score < SLEEP_SCORE_ABSOLUTE_FLOOR
        ? SLEEP_SCORE_ABSOLUTE_FLOOR_STRAIN : 0;
    let bodyBatteryDeficit = 0;
    if (objective.body_battery_wake !== null) {
        const deficit = BODY_BATTERY_LOW_ANCHOR - objective.body_battery_wake;
        const range = BODY_BATTERY_LOW_ANCHOR - BODY_BATTERY_LOW_FULL_STRAIN_AT;
        bodyBatteryDeficit = clamp(deficit / range, 0, 1) * BODY_BATTERY_MAX_STRAIN;
    }
    const conservativeBias = context.preferences.conservativeBias ? CONSERVATIVE_BIAS_STRAIN_OFFSET : 0;
    const extremeFatigue = subjective.fatigue > 8 || subjective.soreness > 8 || subjective.painFlag;
    const recentHardSessionsCount = objective.last_3_days_hard_sessions_count || 0;
    const recentHardSessionsPenalty = recentHardSessionsCount >= 2 ? RECENT_HARD_SESSIONS_STRAIN : 0;
    const objectiveStrain = totalMetricStrain + sleepFloorPenalty + bodyBatteryDeficit + conservativeBias + recentHardSessionsPenalty;

    const lowBodyBatteryRecovery = objective.body_battery_wake !== null && objective.body_battery_wake <= BODY_BATTERY_RECOVER_THRESHOLD;
    const fatigueTriggeredRecover = overallFatigueScore > 7 || extremeFatigue || lowBodyBatteryRecovery || objectiveStrain >= STRAIN_RECOVER_THRESHOLD;
    let mode: 'train' | 'modify' | 'recover' = fatigueTriggeredRecover
        ? 'recover'
        : (overallFatigueScore > 5 || subjective.soreness > 6 || objectiveStrain >= STRAIN_MODIFY_THRESHOLD) ? 'modify' : 'train';

    const strainWithoutDrift = objectiveStrain - totalMultiDayDrift;
    const counterfactualRecover = overallFatigueScore > 7 || extremeFatigue || strainWithoutDrift >= STRAIN_RECOVER_THRESHOLD;
    const counterfactualModify = counterfactualRecover || overallFatigueScore > 5 || subjective.soreness > 6 || strainWithoutDrift >= STRAIN_MODIFY_THRESHOLD;
    const counterfactualModeWithoutDrift = counterfactualRecover ? 'recover' : (counterfactualModify ? 'modify' : 'train');
    const multiDayDriftIsDecisionRelevant = (mode !== 'train') && (mode !== counterfactualModeWithoutDrift);

    const postRecoverBufferApplied = mode === 'train' && previousMode === 'recover';
    if (postRecoverBufferApplied) mode = 'modify';
    const alreadyTrainedOverride = subjective.alreadyTrainedToday === true || objective.today_training !== null;
    if (alreadyTrainedOverride) mode = 'recover';

    const round2 = (val: number) => Math.round(val * 100) / 100;
    const telemetry: DecisionScoreTelemetry = {
        metricStrain: {
            acuteDeviation: round2(totalAcuteDeviation),
            multiDayDrift: round2(totalMultiDayDrift),
            totalMetricStrain: round2(totalMetricStrain),
        },
        contextPenalties: {
            recentHardSessions: round2(recentHardSessionsPenalty),
            bodyBatteryDeficit: round2(bodyBatteryDeficit),
            sleepFloorPenalty: round2(sleepFloorPenalty),
            conservativeBias: round2(conservativeBias),
        },
        totalDecisionScore: round2(objectiveStrain),
    };

    return {
        mode,
        envelopes: evaluateEnvelopes(readiness, context),
        telemetry,
        alreadyTrainedOverride,
        fatigueTriggeredRecover,
        multiDayDriftIsDecisionRelevant,
        postRecoverBufferApplied,
    };
}

export function evaluateTraining(
    readiness: DailyReadiness,
    context: UserContext,
    date: string,
    previousMode?: 'train' | 'modify' | 'recover',
    precomputedEnvelopeState?: ReturnType<typeof evaluateReadinessAndSafetyEnvelope>
): Recommendation {
    const { subjective, objective } = readiness;
    const state = precomputedEnvelopeState ?? evaluateReadinessAndSafetyEnvelope(readiness, context, date, previousMode);
    const { mode, envelopes, telemetry, alreadyTrainedOverride, fatigueTriggeredRecover, multiDayDriftIsDecisionRelevant, postRecoverBufferApplied } = state;

    const availableTemplates = eligibleTemplates(TEMPLATES, context, subjective.timeAvailable, date).filter(t => {
        if (context.preferences.avoidedModalities.some(m => modalityMatches(t.modality, m))) return false;
        if (t.phaseEligibility) return false;
        return true;
    });

    let selectedTemplate = availableTemplates.find(t => t.category === 'Rest') || TEMPLATES[1];
    let rationale = '';
    let modalityNote: string | null = null;

    if (mode === 'recover') {
        const recoverOptions = availableTemplates.filter(t => t.category === 'Rest' || t.category === 'Mobility/Recovery');
        const preferenceResult = applyModalityPreference(recoverOptions, recoverOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        let rankedRecoverOptions = rankByModalityPreference(preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities);
        if (context.trainingSettings?.preferences.preferActiveRecovery) {
            rankedRecoverOptions = [...rankedRecoverOptions].sort((a, b) => Number(b.category === 'Mobility/Recovery') - Number(a.category === 'Mobility/Recovery'));
        }
        if (rankedRecoverOptions.length > 0) selectedTemplate = pickTemplate(rankedRecoverOptions, date)!;
        if (alreadyTrainedOverride) {
            const loggedSession = objective.today_training;
            const sessionDescription = loggedSession
                ? `Garmin shows you already completed a ${loggedSession.type} session today (~${loggedSession.duration_min} min).`
                : "You've already logged a training session today.";
            const cautionNote = subjective.painFlag
                ? "You're also flagging pain or injury today, so prioritize recovery and get it checked out if it persists."
                : "Your fatigue markers are also elevated today, so prioritize recovery (hydration, nutrition, sleep) rather than adding anything further.";
            rationale = fatigueTriggeredRecover ? `${sessionDescription} ${cautionNote}` : `${sessionDescription} Nice work -- no further training is needed. Focus on recovery (hydration, nutrition, sleep) for the rest of the day.`;
        } else {
            rationale = 'Your overall fatigue markers are high today (combining subjective feel with drops in objective baselines). Pushing hard could be counter-productive; focus on active or passive recovery.';
        }
    } else if (mode === 'modify') {
        const modifyOptions = availableTemplates.filter(t => t.category !== 'Rest' && t.systemicCost <= MODIFY_MAX_SYSTEMIC_COST);
        const preferenceResult = applyModalityPreference(modifyOptions, modifyOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        const rankedModifyOptions = rankByModalityPreference(preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities);
        selectedTemplate = rankedModifyOptions.length > 0 ? pickTemplate(rankedModifyOptions, date)! : TEMPLATES[0];
        rationale = "You're showing moderate soreness or slight downward trends in Garmin baselines. We're capping today's systemic/autonomic load rather than ruling out a whole modality.";
        if (selectedTemplate.category === 'Upper-body Strength') rationale += " Upper-body strength is included: it's a low-systemic-load, muscle-local stimulus, so softer HRV/RHR readings are a better reason to skip legs or intervals than to skip push/pull work.";
    } else {
        const trainOptions = availableTemplates.filter(t => t.category === 'Hard Endurance' || t.category === 'Moderate Endurance' || t.category === 'Full-body Strength' || t.category === 'Upper-body Strength' || t.category === 'Lower-body Strength' || t.category === 'Power Maintenance');
        const preferenceResult = applyModalityPreference(availableTemplates, trainOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        const rankedTrainOptions = rankByModalityPreference(preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities);
        if (rankedTrainOptions.length > 0) selectedTemplate = pickTemplate(rankedTrainOptions, date)!;
        rationale = !trainOptions.some(t => t.id === selectedTemplate!.id)
            ? `Readiness is solid -- you'd be fine pushing harder -- but you asked for ${selectedTemplate.modality.toLowerCase()} today, so going with that instead.`
            : 'Readiness is solid across both subjective feelings and Garmin baselines. Great day for a hard session aligned with your primary goals!';
    }

    if (modalityNote) rationale += ` ${modalityNote}`;
    if (multiDayDriftIsDecisionRelevant) rationale += " Your recovery metrics have been trending away from baseline over several days, capping today's training load.";
    if (postRecoverBufferApplied) rationale += " Yesterday was a mandated recovery day, so easing back in today (rather than going straight to a hard session) even though this morning's numbers look fully green.";
    if (objective.yesterday_training && objective.yesterday_training.duration_min && mode === 'modify') rationale += ` Giving your body a break after yesterday's ${objective.yesterday_training.type} session.`;
    if (!selectedTemplate) {
        selectedTemplate = TEMPLATES[0];
        rationale += ' (Defaulted to Rest/Mobility due to severe time/equipment constraints).';
    }
    return { template: selectedTemplate, rationale, mode, envelopes, telemetry };
}

export async function evaluateTrainingWithIntent(
    userId: string,
    readiness: DailyReadiness,
    context: UserContext,
    events: UserEvent[],
    date: string,
    previousMode?: 'train' | 'modify' | 'recover',
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
    fixedActivities: FixedActivity[] = [],
): Promise<Recommendation> {
    const envelopeState = evaluateReadinessAndSafetyEnvelope(readiness, context, date, previousMode);
    const { mode, envelopes, telemetry } = envelopeState;
    let intent = await resolveTrainingIntent(userId, events, date, readiness, 7, historyProvider, preparedHistorySnapshot);

    const todaysFixedActivities = fixedActivities.filter(a => a.date === date && !a.isCompleted);
    if (todaysFixedActivities.length > 0) {
        const stimulusResult = applyFixedActivityStimulusCredit(intent.microcycle, fixedActivities, date);
        intent = {
            ...intent,
            microcycle: stimulusResult.microcycle,
            unresolvedObjectives: getUnresolvedObjectives(stimulusResult.microcycle, true),
        };
    }

    const availability = resolveAvailability(date, readiness.subjective, fixedActivities, context);
    const maxCost = PLAN_TIER_SYSTEMIC_COST_CEILING[envelopes.plan.maxAllowableTier];
    const candidates = eligibleTemplates(ENRICHED_TEMPLATES, context, availability.maxTimeMinutes, date)
        .filter(template => !envelopes.safety.restrictedModalities.includes(template.modality))
        .filter(template => !(context.constraints.restrictedCategories ?? []).includes(template.category))
        .filter(template => template.systemicCost <= maxCost)
        .filter(template => mode !== 'recover' || template.category === 'Rest' || template.category === 'Mobility/Recovery')
        .filter(template => mode !== 'modify' || template.systemicCost <= MODIFY_MAX_SYSTEMIC_COST)
        .filter(template => isTemplatePhaseEligible(template, intent.periodization))
        .filter(template => !availability.environmentOverride || template.environment === 'either' || template.environment === availability.environmentOverride);

    const rankingFatigue = applyCompletedSessionLoad(intent.fatigue, date, availability.reservedCapacityCostProfile);
    const optContext = buildOptimizationContext(
        { ...intent, fatigue: rankingFatigue },
        context,
        context.preferences,
        date,
        { resolveMinimumDaysAfterHardLowerBody, resolvedAvailability: availability },
        fixedActivities,
    );
    const rankingResult = rankCandidates(
        candidates,
        optContext.unresolvedObjectives,
        optContext.fatigueState,
        availability,
        optContext.injuryConstraints,
        optContext.preferences,
        optContext.options,
    );
    const phaseContext = intent.periodization.focusEvent
        ? `${intent.periodization.daysToEvent} days out from ${intent.periodization.focusEvent.title}, ${intent.periodization.phase.phaseName} phase.`
        : `${intent.periodization.phase.phaseName} phase.`;
    const pick = rankingResult.accepted[0];
    if (!pick) {
        const safeRecovery = candidates.find(template => template.category === 'Rest' || template.category === 'Mobility/Recovery')
            ?? ENRICHED_TEMPLATES.find(template => template.category === 'Rest')
            ?? TEMPLATES.find(template => template.category === 'Rest')
            ?? TEMPLATES[0];
        return {
            template: safeRecovery,
            rationale: `${phaseContext} No candidate survived the active hard constraints; defaulting to recovery rather than bypassing those constraints.`,
            mode: 'recover', envelopes, telemetry,
            decisionTrace: {
                policyVersion: POLICY_VERSION,
                candidateScores: rankingResult.all.map(candidate => ({ templateId: candidate.template.id, utilityScore: candidate.utilityScore, excludedReasons: candidate.excludedReasons })),
                droppedContributorObjectives: intent.droppedContributorObjectives,
            },
        };
    }
    return {
        template: pick.template,
        plannedDose: intent.plannedDose,
        executionDose: resolveExecutionDose(intent.plannedDose, envelopes.plan, null),
        rationale: `${phaseContext} ${pick.rationale}`,
        mode, envelopes, telemetry,
        decisionTrace: {
            policyVersion: POLICY_VERSION,
            candidateScores: rankingResult.all.map(candidate => ({ templateId: candidate.template.id, utilityScore: candidate.utilityScore, excludedReasons: candidate.excludedReasons })),
            droppedContributorObjectives: intent.droppedContributorObjectives,
        },
    };
}

export function evaluateEnvelopes(readiness: DailyReadiness, context: UserContext): { safety: SafetyEnvelope; plan: PlanEnvelope } {
    const isPain = readiness.subjective.painFlag;
    const restrictedModalities = [...(context.constraints.restrictedModalities ?? [])];
    const hasActiveInjury = restrictedModalities.length > 0 || (context.constraints.impliedGuardrails ?? []).length > 0 || (context.constraints.restrictedCategories ?? []).length > 0;
    if (isPain && !restrictedModalities.includes('Running')) restrictedModalities.push('Running');
    const clinicalFlagActive = isPain || hasActiveInjury;
    let maxAllowableTier: 'Rest' | 'Mobility' | 'Easy' | 'Moderate' | 'Hard' = 'Hard';
    if (readiness.subjective.alreadyTrainedToday) maxAllowableTier = 'Rest';
    else if (isPain) maxAllowableTier = 'Mobility';
    else if (readiness.objective.body_battery_wake !== null && readiness.objective.body_battery_wake < 25) maxAllowableTier = 'Easy';
    return {
        safety: { clinicalFlagActive, clinicalReason: clinicalFlagActive ? 'Active pain or injury flag reported.' : null, restrictedModalities },
        plan: { maxAllowableTier, taperActive: false, reason: null },
    };
}

const PLAN_TIER_SYSTEMIC_COST_CEILING: Record<PlanEnvelope['maxAllowableTier'], number> = {
    Rest: 0, Mobility: 0.15, Easy: MODIFY_MAX_SYSTEMIC_COST, Moderate: 0.8, Hard: Infinity,
};
function exceedsPlanCeiling(systemicCost: number, plan: PlanEnvelope): boolean {
    return systemicCost > PLAN_TIER_SYSTEMIC_COST_CEILING[plan.maxAllowableTier];
}

export function adjustSessionRecommendation(
    baseRec: Recommendation,
    direction: 'easier' | 'harder',
    readiness: DailyReadiness,
    context: UserContext,
    date: string
): Recommendation | null {
    const envelopes = evaluateEnvelopes(readiness, context);
    const { safety, plan } = envelopes;
    if (direction === 'harder' && safety.clinicalFlagActive) return null;
    const baseTemplate = baseRec.template;
    const baseTemplateEligible = evaluateTemplateEligibility(baseTemplate, context, readiness.subjective.timeAvailable, date).eligible;
    if (direction === 'harder' && !baseTemplateEligible) return null;

    if (direction === 'easier' && baseTemplateEligible && baseTemplate.easierDose) {
        return {
            ...baseRec,
            activeDose: baseTemplate.easierDose,
            adjustment: {
                direction: 'easier', tier: 1, originalTemplateId: baseTemplate.id, originalTemplateTitle: baseTemplate.title,
                adjustedDoseLabel: baseTemplate.easierDose.label,
                rationale: `Session dose adjusted to easier variant (${baseTemplate.easierDose.label}) while preserving the core training purpose.`,
            },
            envelopes,
        };
    }
    if (direction === 'harder' && baseTemplate.harderDose) {
        const projectedCost = baseTemplate.systemicCost * baseTemplate.harderDose.doseRatio;
        const availableTime = resolveMaximumSessionMinutes(context, readiness.subjective.timeAvailable, date);
        if (!exceedsPlanCeiling(projectedCost, plan) && baseTemplate.harderDose.durationMin <= availableTime) {
            return {
                ...baseRec,
                activeDose: baseTemplate.harderDose,
                adjustment: {
                    direction: 'harder', tier: 1, originalTemplateId: baseTemplate.id, originalTemplateTitle: baseTemplate.title,
                    adjustedDoseLabel: baseTemplate.harderDose.label,
                    rationale: `Session dose adjusted to harder variant (${baseTemplate.harderDose.label}) while preserving the core training purpose.`,
                },
                envelopes,
            };
        }
    }

    const allowedModalities = (['Running', 'Cycling', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'] as const)
        .filter(m => !context.preferences.avoidedModalities.map(a => a.toLowerCase()).includes(m.toLowerCase()))
        .filter(m => !safety.restrictedModalities.includes(m));
    const availableTemplates = eligibleTemplates(TEMPLATES, context, readiness.subjective.timeAvailable, date)
        .filter(t => t.id !== baseTemplate.id && allowedModalities.includes(t.modality));

    const tier2Candidates = availableTemplates.filter(t => t.modality === baseTemplate.modality && t.category === baseTemplate.category)
        .filter(t => direction === 'easier' || !exceedsPlanCeiling(t.systemicCost, plan));
    if (tier2Candidates.length > 0) {
        const picked = pickTemplate(tier2Candidates, date) || tier2Candidates[0];
        return {
            template: picked, rationale: `Adjusted to alternate prescription layout (${picked.title}) in ${picked.modality}.`, mode: baseRec.mode,
            adjustment: { direction, tier: 2, originalTemplateId: baseTemplate.id, originalTemplateTitle: baseTemplate.title, rationale: `Adjusted to alternate layout (${picked.title}) for same objective.` }, envelopes,
        };
    }

    const tier3Candidates = availableTemplates.filter(t => t.modality === baseTemplate.modality).filter(t => {
        if (direction === 'easier') return t.systemicCost < baseTemplate.systemicCost;
        return t.systemicCost > baseTemplate.systemicCost && !exceedsPlanCeiling(t.systemicCost, plan);
    });
    if (tier3Candidates.length > 0) {
        const picked = pickTemplate(tier3Candidates, date) || tier3Candidates[0];
        return {
            template: picked, rationale: `Adjusted to adjacent stimulus (${picked.title}) in ${picked.modality}.`, mode: baseRec.mode,
            adjustment: { direction, tier: 3, originalTemplateId: baseTemplate.id, originalTemplateTitle: baseTemplate.title, rationale: `Adjusted to adjacent stimulus in ${picked.modality}.` }, envelopes,
        };
    }

    if (baseTemplate.objectiveTransferable !== false) {
        const tier4Candidates = availableTemplates.filter(t => {
            if (t.modality === baseTemplate.modality) return false;
            if (direction === 'easier') return t.systemicCost < baseTemplate.systemicCost;
            return t.systemicCost > baseTemplate.systemicCost && !exceedsPlanCeiling(t.systemicCost, plan);
        });
        if (tier4Candidates.length > 0) {
            const picked = pickTemplate(tier4Candidates, date) || tier4Candidates[0];
            return {
                template: picked, rationale: `Cross-modal adjustment to ${picked.title} (${picked.modality}).`, mode: baseRec.mode,
                adjustment: { direction, tier: 4, originalTemplateId: baseTemplate.id, originalTemplateTitle: baseTemplate.title, rationale: `Adjusted cross-modally to ${picked.title}.` }, envelopes,
            };
        }
    }
    return null;
}

export function buildNextDayScenarios(
    todayReadiness: DailyReadiness,
    context: UserContext,
    todayDate: string,
    todayRec: Recommendation
): NextDayScenarioSet {
    void context;
    const tomorrowDate = addDaysToLocalDateString(todayDate, 1);
    const isPainOrInjury = todayReadiness.subjective.painFlag;
    const isTodayHardSession = todayRec.template.category === 'Hard Endurance'
        || todayRec.template.category === 'Full-body Strength'
        || todayRec.template.category === 'Lower-body Strength'
        || todayRec.template.category === 'Upper-body Strength';
    const recentHardSessions = todayReadiness.objective.last_3_days_hard_sessions_count || 0;
    const isCumulativeOverload = recentHardSessions >= 2 && isTodayHardSession;
    let singlePlanReason: string | undefined;
    if (isPainOrInjury) singlePlanReason = 'Active pain/injury reported today. Tomorrow requires dedicated recovery regardless of morning metrics.';
    else if (isCumulativeOverload) singlePlanReason = 'High cumulative load (multiple hard sessions back-to-back). Tomorrow is locked to active recovery to prevent overtraining.';

    if (singlePlanReason) {
        const syntheticRecoveryReadiness: DailyReadiness = {
            subjective: { ...todayReadiness.subjective, fatigue: 7, soreness: 7, readiness: 4, alreadyTrainedToday: false },
            objective: { ...todayReadiness.objective, last_3_days_hard_sessions_count: recentHardSessions + (isTodayHardSession ? 1 : 0), today_training: null },
        };
        return {
            date: tomorrowDate, isSinglePlan: true, singlePlanReason,
            scenarios: {
                green: { tier: 'green', label: 'Mandatory Recovery Plan', condition: singlePlanReason, readiness: syntheticRecoveryReadiness },
                yellow: { tier: 'yellow', label: 'Mandatory Recovery Plan', condition: singlePlanReason, readiness: { ...syntheticRecoveryReadiness, subjective: { ...syntheticRecoveryReadiness.subjective }, objective: { ...syntheticRecoveryReadiness.objective } } },
                red: { tier: 'red', label: 'Mandatory Recovery Plan', condition: singlePlanReason, readiness: { ...syntheticRecoveryReadiness, subjective: { ...syntheticRecoveryReadiness.subjective }, objective: { ...syntheticRecoveryReadiness.objective } } },
            },
        };
    }

    const updatedHardCount = recentHardSessions + (isTodayHardSession ? 1 : 0);
    const greenReadiness: DailyReadiness = {
        subjective: { readiness: 9, sleepQuality: 9, fatigue: 2, soreness: 2, stress: 2, motivation: 9, timeAvailable: todayReadiness.subjective.timeAvailable, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null },
        objective: { ...todayReadiness.objective, sleep_score: 88, sleep_duration_min: 480, rhr_delta: 0, hrv_delta: 2, rhr_delta_28d: 0, hrv_delta_28d: 2, sleep_score_delta_7d: 6, sleep_score_delta_28d: 6, body_battery_wake: 88, last_3_days_hard_sessions_count: updatedHardCount, today_training: null },
    };
    const yellowReadiness: DailyReadiness = {
        subjective: { readiness: 5, sleepQuality: 5, fatigue: 6, soreness: 6, stress: 5, motivation: 5, timeAvailable: todayReadiness.subjective.timeAvailable, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null },
        objective: { ...todayReadiness.objective, sleep_score: 68, sleep_duration_min: 420, rhr_delta: 3, hrv_delta: -4, rhr_delta_28d: 3, hrv_delta_28d: -4, sleep_score_delta_7d: -14, sleep_score_delta_28d: -14, body_battery_wake: 62, last_3_days_hard_sessions_count: updatedHardCount, today_training: null },
    };
    const redReadiness: DailyReadiness = {
        subjective: { readiness: 2, sleepQuality: 3, fatigue: 9, soreness: 8, stress: 7, motivation: 3, timeAvailable: todayReadiness.subjective.timeAvailable, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null },
        objective: { ...todayReadiness.objective, sleep_score: 50, sleep_duration_min: 360, rhr_delta: 6, hrv_delta: -8, rhr_delta_28d: 6, hrv_delta_28d: -8, sleep_score_delta_7d: -20, sleep_score_delta_28d: -20, body_battery_wake: 42, last_3_days_hard_sessions_count: updatedHardCount, today_training: null },
    };
    return {
        date: tomorrowDate, isSinglePlan: false,
        scenarios: {
            green: { tier: 'green', label: 'Optimal Readiness', condition: 'If tomorrow morning HRV is baseline/elevated, sleep score > 80, and fatigue is low.', readiness: greenReadiness },
            yellow: { tier: 'yellow', label: 'Moderate Readiness', condition: 'If tomorrow sleep quality is average (60-75), HRV shows mild dip, or moderate soreness is present.', readiness: yellowReadiness },
            red: { tier: 'red', label: 'Low Readiness / High Fatigue', condition: 'If tomorrow sleep score drops (< 60), HRV drops significantly, or elevated fatigue/soreness is reported.', readiness: redReadiness },
        },
    };
}

function evaluatedBranch(scenario: NextDayScenario, recommendation: Recommendation): NextDayPlanBranch {
    return { tier: scenario.tier, label: scenario.label, condition: scenario.condition, recommendation };
}

export function evaluateNextDayPlan(
    todayReadiness: DailyReadiness,
    context: UserContext,
    todayDate: string,
    todayRec: Recommendation,
): NextDayPotentialPlan {
    const scenarios = buildNextDayScenarios(todayReadiness, context, todayDate, todayRec);
    const evaluate = (scenario: NextDayScenario) => evaluatedBranch(scenario, evaluateTraining(scenario.readiness, context, scenarios.date, todayRec.mode));
    return {
        date: scenarios.date, isSinglePlan: scenarios.isSinglePlan,
        ...(scenarios.singlePlanReason ? { singlePlanReason: scenarios.singlePlanReason } : {}),
        branches: { green: evaluate(scenarios.scenarios.green), yellow: evaluate(scenarios.scenarios.yellow), red: evaluate(scenarios.scenarios.red) },
    };
}

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
const ZERO_STIMULUS: WorkoutStimulusProfile = { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0 };

function recommendationProjection(date: string, rec: Recommendation): CompletedExposure {
    const workoutId = workoutForTemplate(rec.template.id)?.id;
    return {
        occurrenceKey: `recommendation:${date}`,
        date,
        costProfile: rec.template.costProfile ?? ZERO_COST,
        stimulusProfile: rec.template.stimulusProfile,
        stimulusConfidence: 'exact',
        templateId: rec.template.id,
        ...(workoutId ? { workoutId } : {}),
        modality: rec.template.modality,
        category: rec.template.category,
        trainingRecordLike: { type: `${rec.template.modality} ${rec.template.category}`, duration_min: rec.template.durationMin, training_effect: 0, intensity_tag: '' },
    };
}

function fixedActivityProjection(activity: FixedActivity): CompletedExposure | null {
    if (activity.isCompleted || (!activity.expectedCost && !activity.expectedStimulus)) return null;
    return {
        date: activity.date,
        costProfile: { ...ZERO_COST, ...(activity.expectedCost ?? {}) },
        ...(activity.expectedStimulus ? { stimulusProfile: { ...ZERO_STIMULUS, ...activity.expectedStimulus }, stimulusConfidence: 'exact' as const } : {}),
        trainingRecordLike: { type: activity.title, duration_min: activity.durationMin, training_effect: 0, intensity_tag: '' },
    };
}

async function projectedProviderForTomorrow(
    userId: string,
    tomorrowDate: string,
    todayDate: string,
    todayRec: Recommendation,
    fixedActivities: FixedActivity[],
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
): Promise<TrainingHistoryProvider> {
    const windowStart = addDaysToLocalDateString(tomorrowDate, -7);
    let prior: CompletedExposure[];
    if (preparedHistorySnapshot) {
        prior = preparedHistorySnapshot.exposures;
    } else {
        const baseProvider = historyProvider ?? (await import('./firestoreTrainingHistory')).firestoreTrainingHistoryProvider;
        prior = await baseProvider.reconstruct(userId, tomorrowDate, 7);
    }
    const projected = [
        ...prior.filter(exposure => exposure.date >= windowStart && exposure.date < tomorrowDate),
        recommendationProjection(todayDate, todayRec),
        ...fixedActivities.filter(activity => activity.date === todayDate && !activity.isCompleted).flatMap(activity => {
            const exposure = fixedActivityProjection(activity);
            return exposure ? [exposure] : [];
        }),
    ].sort((a, b) => a.date.localeCompare(b.date));

    return {
        reconstruct: async (_requestUserId, throughDateExclusive, windowDays) => {
            const start = addDaysToLocalDateString(throughDateExclusive, -windowDays);
            return projected.filter(exposure => exposure.date >= start && exposure.date < throughDateExclusive);
        },
    };
}

export async function evaluateNextDayPlanWithIntent(
    userId: string,
    events: UserEvent[],
    todayReadiness: DailyReadiness,
    context: UserContext,
    todayDate: string,
    todayRec: Recommendation,
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
    fixedActivities: FixedActivity[] = [],
): Promise<NextDayPotentialPlan> {
    const scenarios = buildNextDayScenarios(todayReadiness, context, todayDate, todayRec);
    const projectedProvider = await projectedProviderForTomorrow(
        userId, scenarios.date, todayDate, todayRec, fixedActivities, historyProvider, preparedHistorySnapshot,
    );
    const evaluate = async (scenario: NextDayScenario) => evaluatedBranch(
        scenario,
        await evaluateTrainingWithIntent(userId, scenario.readiness, context, events, scenarios.date, todayRec.mode, projectedProvider, null, fixedActivities),
    );
    const [green, yellow, red] = await Promise.all([
        evaluate(scenarios.scenarios.green), evaluate(scenarios.scenarios.yellow), evaluate(scenarios.scenarios.red),
    ]);
    return {
        date: scenarios.date, isSinglePlan: scenarios.isSinglePlan,
        ...(scenarios.singlePlanReason ? { singlePlanReason: scenarios.singlePlanReason } : {}),
        branches: { green, yellow, red },
    };
}
