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
    AuthoredPlanBlock,
    TrainingIntentProfile,
    UserPreferences,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
    FatigueState,
} from './models';
import { TEMPLATES, ENRICHED_TEMPLATES } from './templates';
import { eligibleTemplates, evaluateTemplateEligibility, resolveMaximumSessionMinutes } from './eligibility';
import { buildOptimizationContext, rankCandidates, resolveRecoveryStyle, resolveTimeCapDoseAdjustment } from './optimizer';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { resolvePlannedDoseForDate, resolveTrainingIntent } from './trainingIntent';
import { POLICY_VERSION } from './policy';
import { resolveExecutionDose } from './dose';
import { isTemplatePhaseEligible } from './periodization';
import { resolveMinimumDaysAfterHardLowerBody, resolveRecoveryHoursForTemplate } from './planningCandidate';
import { adjudicateExternalSession } from './externalSession';
import { externalEventAsFixedActivity, toSyntheticTemplate, externalSessionDisplayPrescription } from './externalSessionProfiles';
// M3.6: this module only ever reads gating/isEvent/id/title, identical on v1 and v2
// sessions -- widened to accept either rather than kept v1-only.
import type { AnyExternalPlanSession as ExternalPlanSession } from '../sessions/externalPlanV2';
import { applyFixedActivityStimulusCredit } from './planner';
import { getUnresolvedObjectives } from './microcycle';
import { applyCompletedSessionLoad, type FatigueFusionPolicy } from './fatigue';
import { SUBJECTIVE_BASELINE_METRICS, type SubjectiveBaseline, type SubjectiveBaselineMetric } from './subjectiveBaseline';
import { resolveAvailability } from './schedule';
import { workoutForTemplate } from '../workouts/prescription';
import { resolveEvergreenPlan } from './evergreenPlanning';
import { buildCoverageState } from './coverage';
import { applyPlanningOverlays } from './planningOverlays';
import { mergeKnowledgeRefs, readinessKnowledgeRefs, trainingIntentKnowledgeRefs } from './knowledgeLineage';

function pickTemplate(options: SessionTemplate[], seedDate: string): SessionTemplate | undefined {
    if (options.length === 0) return undefined;
    if (options.length === 1) return options[0];
    let hash = 0;
    for (let i = 0; i < seedDate.length; i++) hash = (hash * 31 + seedDate.charCodeAt(i)) >>> 0;
    return options[hash % options.length];
}

export function getCanonicalRestTemplate(): SessionTemplate {
    return ENRICHED_TEMPLATES.find(template => template.category === 'Rest')
        ?? TEMPLATES.find(template => template.category === 'Rest')
        ?? {
            id: 'rest_01',
            category: 'Rest',
            modality: 'None',
            durationMin: 0,
            durationMax: 0,
            title: 'Total Rest',
            description: 'Focus on sleep, hydration, and completely shutting off physical stress.',
            requiredEquipment: [],
            environment: 'either',
            safetyTags: [],
            systemicCost: 0.0,
            objectiveTransferable: true,
        };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function calibrationTrace(
    intent: Awaited<ReturnType<typeof resolveTrainingIntent>>,
    rankingFatigue: FatigueState,
    fixedActivities: FixedActivity[],
    date: string,
) {
    const todayActivities = fixedActivities.filter(activity => activity.date === date && !activity.isCompleted);
    const cost: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
    const stimulus: WorkoutStimulusProfile = { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0 };
    todayActivities.forEach(activity => {
        (Object.keys(cost) as (keyof WorkoutCostProfile)[]).forEach(key => { cost[key] += activity.expectedCost?.[key] ?? 0; });
        (Object.keys(stimulus) as (keyof WorkoutStimulusProfile)[]).forEach(key => { stimulus[key] += activity.expectedStimulus?.[key] ?? 0; });
    });
    return {
        fatigue: {
            rawExternalLoad: rankingFatigue.rawExternalLoadFatigue ?? rankingFatigue.externalLoadFatigue,
            clampedExternalLoad: rankingFatigue.externalLoadFatigue,
            internalResponse: rankingFatigue.internalResponseStrain,
            combined: rankingFatigue.combinedFatigue,
        },
        activeObjectives: intent.microcycle.objectives.map(objective => ({
            key: objective.key,
            completedCredit: objective.completedCredit ?? objective.completedExposures,
            projectedCredit: objective.projectedCredit ?? 0,
            requiredCredit: objective.requiredCredit ?? objective.targetExposures,
        })),
        fixedActivity: { count: todayActivities.length, cost, stimulus },
    };
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
// A sustained nocturnal/resting respiration-rate rise can precede respiratory infection,
// including in athlete wearable cohorts, and can also reflect other physiological stress.
// It is intentionally treated as contextual rather than diagnostic: intense exercise,
// poor sleep, emotional stress, alcohol, altitude/environment and measurement conditions
// can also shift the signal. The 0.3 weight remains product calibration, not an
// evidence-derived illness or readiness coefficient.
const RESPIRATION_STRAIN_WEIGHT = 0.3;
const HRV_STDEV_FLOOR_MS = 3;
const RHR_STDEV_FLOOR_BPM = 1.5;
const SLEEP_STDEV_FLOOR_PTS = 4;
// 1 br/min is a product variability floor chosen to avoid overreacting to small wearable
// fluctuations; it is not an evidence-derived illness or training-action threshold.
const RESPIRATION_MAD_FLOOR_BR = 1.0;
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

// --- Phase 9.3: subjective drift, behind a default-off selector ---------------------------

/**
 * `'off'` (the default at every production call site) is bit-identical to pre-Phase-9
 * behaviour. The other member of this union is unreachable from production callers -- see
 * `rules.test.ts`'s architecture guard -- and exists only for the 9.6 simulation
 * comparison harness to measure. Mirrors `FatigueFusionPolicy`'s plumbing pattern: a
 * selector threaded through the real evaluator, not a second implementation.
 */
export type SubjectiveDriftPolicy = 'off' | 'drift';

/** Experimental per-metric weights (D-SUBJCAL: "fatigue, soreness, sleepQuality,
 *  readiness, motivation, and stress need not share weights or even all participate").
 *  Equal weighting is the reference starting point for 9.6 to challenge, not a considered
 *  choice -- a weight of 0 excludes a metric from the aggregate entirely. */
export type SubjectiveDriftWeights = Record<SubjectiveBaselineMetric, number>;

export const REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS: SubjectiveDriftWeights = {
    readiness: 1, sleepQuality: 1, fatigue: 1, soreness: 1, mentalStress: 1, motivation: 1,
};

/** Phase 9.7/D-SUBJAUDIT: identifies the *scoring* policy (weights + cap-source convention)
 *  that turns a `SubjectiveBaseline` into a strain contribution, independent of a baseline's
 *  own `estimatorId` (which identifies the baseline estimator's windows/floor/coverage --
 *  see the 9.6 sensitivity configs, which mint a new `estimatorId` per baseline variant).
 *  Bump this when the drift-scoring arithmetic, cap source, or reference weights change, so
 *  a persisted audit can distinguish a scoring-policy change from a baseline-estimator
 *  change. */
export const SUBJECTIVE_DRIFT_ESTIMATOR_POLICY_VERSION = 'subjective-drift-score-v1-equal-weights-strain-z-cap';

/** Adverse movement is signed positive for every metric regardless of scale direction --
 *  duplicated from `contextBrief.ts`'s equivalent `higherIsBetter` table rather than
 *  imported, the same reasoning `subjectiveBaseline.ts`'s own header comment gives for
 *  keeping this module free of a dependency on the brief renderer. */
const SUBJECTIVE_DRIFT_HIGHER_IS_BETTER: Record<SubjectiveBaselineMetric, boolean> = {
    readiness: true, sleepQuality: true, motivation: true,
    fatigue: false, soreness: false, mentalStress: false,
};

/**
 * The 9.1 reference estimator's drift term (D-SUBJDRIFT / D-SUBJEST): recent-vs-long
 * prior history only -- today never enters this comparison, `computeSubjectiveBaseline`
 * already enforces that (D-SUBJHIST). Every per-metric contribution is floored at zero
 * before weighting and summed -- there is structurally **no subtraction path** (D-SUBJADD):
 * a `Math.max(weight, 0) * clamp(z, 0, cap)` term can only ever add to the total, for any
 * baseline and any weight, including a hypothetical negative weight. `'off'` or a missing
 * baseline (D-SUBJCOV: below-floor coverage already resolves to `null` in
 * `computeSubjectiveBaseline`) both return exactly `0` -- no relative subjective signal is
 * the same as today's behaviour, never a fabricated neutral value.
 *
 * The cap reuses `STRAIN_Z_CAP` -- matching `SubjectiveBaselinePolicy.contributionCap`'s
 * reference value by convention (9.1's own comment), not by runtime reference: the
 * baseline this function receives carries `estimatorId` for provenance, not the policy
 * object that produced it. If 9.6 needs the cap to vary independently of `STRAIN_Z_CAP`,
 * thread it explicitly rather than assuming this coupling.
 */
export function subjectiveDriftStrain(
    baseline: SubjectiveBaseline | null | undefined,
    policy: SubjectiveDriftPolicy,
    weights: SubjectiveDriftWeights = REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
): number {
    if (policy === 'off' || !baseline) return 0;
    let total = 0;
    for (const metric of SUBJECTIVE_BASELINE_METRICS) {
        const { recentAvg, longAvg, variability } = baseline.metrics[metric];
        const higherIsBetter = SUBJECTIVE_DRIFT_HIGHER_IS_BETTER[metric];
        const adverseMovement = higherIsBetter ? (longAvg - recentAvg) : (recentAvg - longAvg);
        const z = adverseMovement / variability;
        const contribution = clamp(z, 0, STRAIN_Z_CAP);
        total += Math.max(weights[metric], 0) * contribution;
    }
    return total;
}

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
    previousMode?: 'train' | 'modify' | 'recover',
    /** Phase 9.3: defaults to `'off'` at every call site -- see `SubjectiveDriftPolicy`'s
     *  doc comment. Only a future 9.6 comparison harness passes the other member of that union. */
    subjectiveDriftPolicy: SubjectiveDriftPolicy = 'off',
    /** Phase 9.3/D-SUBJCAL: experimental, not yet tuned. Only reachable by explicitly
     *  passing a non-default value -- no production call site does. */
    subjectiveDriftWeights: SubjectiveDriftWeights = REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS
): {
    mode: 'train' | 'modify' | 'recover';
    envelopes: { safety: SafetyEnvelope; plan: PlanEnvelope };
    telemetry: DecisionScoreTelemetry;
    alreadyTrainedOverride: boolean;
    fatigueTriggeredRecover: boolean;
    multiDayDriftIsDecisionRelevant: boolean;
    subjectiveDriftIsDecisionRelevant: boolean;
    postRecoverBufferApplied: boolean;
    knowledgeRefs: string[];
} {
    const { subjective, objective } = readiness;
    const knowledgeRefs = readinessKnowledgeRefs(readiness, context);
    const invertedSleepQual = 10 - subjective.sleepQuality;
    const invertedReadiness = 10 - subjective.readiness;

    // SEP-C2: Motivation is excluded from the physical fatigue composite.
    // When answeredDimensions is provided (e.g. from check-in), average only the answered physical dimensions.
    // When omitted/undefined (e.g. in legacy fixtures), average all 4 physical dimensions.
    let overallFatigueScore: number;
    if (subjective.answeredDimensions && subjective.answeredDimensions.length > 0) {
        const physicalEntries: number[] = [];
        if (subjective.answeredDimensions.includes('fatigue')) physicalEntries.push(subjective.fatigue);
        if (subjective.answeredDimensions.includes('soreness')) physicalEntries.push(subjective.soreness);
        if (subjective.answeredDimensions.includes('readiness')) physicalEntries.push(invertedReadiness);
        if (subjective.answeredDimensions.includes('sleepQuality')) physicalEntries.push(invertedSleepQual);
        overallFatigueScore = physicalEntries.length > 0
            ? physicalEntries.reduce((sum, val) => sum + val, 0) / physicalEntries.length
            : (subjective.fatigue + subjective.soreness + invertedReadiness + invertedSleepQual) / 4;
    } else {
        overallFatigueScore = (subjective.fatigue + subjective.soreness + invertedReadiness + invertedSleepQual) / 4;
    }

    const hrvStrain = metricStrain(objective.hrv_delta, objective.hrv_delta_28d, objective.hrv_stdev_28d, HRV_STDEV_FLOOR_MS, HRV_STRAIN_WEIGHT, 1);
    const rhrStrain = metricStrain(objective.rhr_delta, objective.rhr_delta_28d, objective.rhr_stdev_28d, RHR_STDEV_FLOOR_BPM, RHR_STRAIN_WEIGHT, -1);
    const sleepStrain = metricStrain(objective.sleep_score_delta_7d, objective.sleep_score_delta_28d, objective.sleep_score_stdev_28d, SLEEP_STDEV_FLOOR_PTS, SLEEP_STRAIN_WEIGHT, 1);
    // Elevated respiration is worse (sign -1, same convention as RHR); the MAD arg is a
    // robust spread estimator, not the population stdev metricStrain's name suggests --
    // see RESPIRATION_MAD_FLOOR_BR above. ?? null covers documents predating this field.
    const respirationStrain = metricStrain(objective.respiration_delta ?? null, objective.respiration_delta_28d ?? null, objective.respiration_mad_28d ?? null, RESPIRATION_MAD_FLOOR_BR, RESPIRATION_STRAIN_WEIGHT, -1);
    const totalAcuteDeviation = hrvStrain.acuteDeviation + rhrStrain.acuteDeviation + sleepStrain.acuteDeviation + respirationStrain.acuteDeviation;
    const totalMultiDayDrift = hrvStrain.multiDayDrift + rhrStrain.multiDayDrift + sleepStrain.multiDayDrift + respirationStrain.multiDayDrift;
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
    const clinicalRecoverOverride = subjective.painFlag;
    const severeFatigue = subjective.fatigue > 8 || subjective.soreness > 8;
    const extremeFatigue = severeFatigue || clinicalRecoverOverride;
    const severeSubjectiveDistress = (subjective.fatigue >= 8 && subjective.readiness <= 4) ||
        (subjective.readiness <= 3 && subjective.stress >= 8) ||
        (subjective.fatigue >= 8 && subjective.stress >= 8);
    const acuteBiometricStrainFloor = (rhrStrain.acuteDeviation >= 0.6 && objective.rhr_delta !== null && objective.rhr_delta >= 6) ||
        (hrvStrain.acuteDeviation >= 1.0 && objective.hrv_delta !== null && objective.hrv_delta <= -15);
    const acuteSubjectiveModify = subjective.fatigue >= 8 || subjective.readiness <= 3 || subjective.stress >= 9 || (subjective.readiness <= 4 && subjective.fatigue >= 6);

    const recentHardSessionsCount = objective.last_3_days_hard_sessions_count || 0;
    const recentHardSessionsPenalty = recentHardSessionsCount >= 2 ? RECENT_HARD_SESSIONS_STRAIN : 0;
    const objectiveStrain = totalMetricStrain + sleepFloorPenalty + bodyBatteryDeficit + conservativeBias + recentHardSessionsPenalty;

    // Phase 9.3 (D-SUBJADD): a separate, structurally non-negative contribution -- see
    // subjectiveDriftStrain's own doc comment for why no baseline/weight can subtract from
    // it. Under 'off' (every production call site today) this is always exactly 0, so
    // strainForThresholds below is byte-identical to objectiveStrain and every absolute
    // subjective trigger (overallFatigueScore/soreness, checked separately below) stays
    // untouched either way (D-SUBJFLOOR).
    const subjectiveDrift = subjectiveDriftStrain(readiness.subjectiveBaseline, subjectiveDriftPolicy, subjectiveDriftWeights);
    const strainForThresholds = objectiveStrain + subjectiveDrift;

    const lowBodyBatteryRecovery = objective.body_battery_wake !== null && objective.body_battery_wake <= BODY_BATTERY_RECOVER_THRESHOLD;
    const combinedAcuteBiometricRecover =
        objective.hrv_delta !== null && objective.hrv_delta <= -10 &&
        objective.rhr_delta !== null && objective.rhr_delta >= 5 &&
        objective.body_battery_wake !== null && objective.body_battery_wake <= 35;
    const fatigueTriggeredRecover = overallFatigueScore > 7 || extremeFatigue || severeSubjectiveDistress || lowBodyBatteryRecovery || combinedAcuteBiometricRecover || strainForThresholds >= STRAIN_RECOVER_THRESHOLD;
    let mode: 'train' | 'modify' | 'recover' = fatigueTriggeredRecover
        ? 'recover'
        : (overallFatigueScore > 5 || subjective.soreness > 6 || acuteSubjectiveModify || acuteBiometricStrainFloor || strainForThresholds >= STRAIN_MODIFY_THRESHOLD) ? 'modify' : 'train';

    const strainWithoutDrift = objectiveStrain - totalMultiDayDrift;
    const counterfactualRecover = overallFatigueScore > 7 || extremeFatigue || severeSubjectiveDistress || lowBodyBatteryRecovery || combinedAcuteBiometricRecover || strainWithoutDrift >= STRAIN_RECOVER_THRESHOLD;
    const counterfactualModify = counterfactualRecover || overallFatigueScore > 5 || subjective.soreness > 6 || acuteSubjectiveModify || acuteBiometricStrainFloor || strainWithoutDrift >= STRAIN_MODIFY_THRESHOLD;
    const counterfactualModeWithoutDrift = counterfactualRecover ? 'recover' : (counterfactualModify ? 'modify' : 'train');
    const multiDayDriftIsDecisionRelevant = (mode !== 'train') && (mode !== counterfactualModeWithoutDrift);

    // Phase 9.7: the analogous counterfactual for the *subjective* term above -- computed
    // from objectiveStrain alone (not strainWithoutDrift, which subtracts the unrelated
    // objective multi-day-drift axis) through the same threshold logic, so a caller can tell
    // whether subjective drift specifically changed the mode. Inert under 'off' (subjectiveDrift
    // is always 0 there, so modeWithoutSubjectiveDrift always equals mode).
    const recoverWithoutSubjectiveDrift = overallFatigueScore > 7 || extremeFatigue || severeSubjectiveDistress || lowBodyBatteryRecovery || combinedAcuteBiometricRecover || objectiveStrain >= STRAIN_RECOVER_THRESHOLD;
    const modifyWithoutSubjectiveDrift = recoverWithoutSubjectiveDrift || overallFatigueScore > 5 || subjective.soreness > 6 || acuteSubjectiveModify || acuteBiometricStrainFloor || objectiveStrain >= STRAIN_MODIFY_THRESHOLD;
    const modeWithoutSubjectiveDrift = recoverWithoutSubjectiveDrift ? 'recover' : (modifyWithoutSubjectiveDrift ? 'modify' : 'train');
    const subjectiveDriftIsDecisionRelevant = (mode !== 'train') && (mode !== modeWithoutSubjectiveDrift);

    const postRecoverBufferApplied = mode === 'train' && previousMode === 'recover';
    if (postRecoverBufferApplied) mode = 'modify';
    const alreadyTrainedOverride = subjective.alreadyTrainedToday === true || objective.today_training !== null;
    const redFlagOverride = (subjective.redFlagFindings?.length ?? 0) > 0;
    if (alreadyTrainedOverride || redFlagOverride) mode = 'recover';

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
        // Phase 9.7: reconciles metricStrain.totalMetricStrain + contextPenalties.* +
        // subjectiveDrift === totalDecisionScore. subjectiveDrift is always 0 under the
        // production 'off' default, so this stays byte-identical to pre-Phase-9.7 output.
        subjectiveDrift: round2(subjectiveDrift),
        totalDecisionScore: round2(objectiveStrain + subjectiveDrift),
    };

    return {
        mode,
        envelopes: evaluateEnvelopes(readiness, context),
        telemetry,
        alreadyTrainedOverride,
        fatigueTriggeredRecover,
        multiDayDriftIsDecisionRelevant,
        subjectiveDriftIsDecisionRelevant,
        postRecoverBufferApplied,
        knowledgeRefs,
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
    const { mode, envelopes, telemetry, alreadyTrainedOverride, fatigueTriggeredRecover, multiDayDriftIsDecisionRelevant, subjectiveDriftIsDecisionRelevant, postRecoverBufferApplied } = state;

    const availableTemplates = eligibleTemplates(TEMPLATES, context, subjective.timeAvailable, date).filter(t => {
        if (context.preferences.avoidedModalities.some(m => modalityMatches(t.modality, m))) return false;
        if (t.phaseEligibility) return false;
        return true;
    });

    let selectedTemplate = availableTemplates.find(t => t.category === 'Rest') || getCanonicalRestTemplate();
    let rationale = '';
    let modalityNote: string | null = null;

    if (mode === 'recover') {
        const recoverOptions = availableTemplates.filter(t => t.category === 'Rest' || t.category === 'Mobility/Recovery');
        const preferenceResult = applyModalityPreference(recoverOptions, recoverOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        let rankedRecoverOptions = rankByModalityPreference(preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities);
        const recoveryStyle = resolveRecoveryStyle(context);
        rankedRecoverOptions = [...rankedRecoverOptions].sort((a, b) => {
            const preferredCategory = recoveryStyle === 'active' ? 'Mobility/Recovery' : 'Rest';
            return Number(b.category === preferredCategory) - Number(a.category === preferredCategory);
        });
        if (rankedRecoverOptions.length > 0) selectedTemplate = pickTemplate(rankedRecoverOptions, date)!;
        if (envelopes.safety.redFlagActive) {
            selectedTemplate = availableTemplates.find(t => t.category === 'Rest') || getCanonicalRestTemplate();
            rationale = `${envelopes.safety.clinicalReason ?? 'Clinical evaluation recommended: red-flag findings reported.'} All training prescriptions are paused.`;
        } else if (alreadyTrainedOverride) {
            const loggedSession = objective.today_training;
            const sessionDescription = loggedSession
                ? `Garmin shows you already completed a ${loggedSession.type} session today (~${loggedSession.duration_min} min).`
                : "You've already logged a training session today.";
            const hasCurrentPainOrInjury = subjective.clinicalEnvelopeSources?.includes('pain_or_injury') ?? subjective.painFlag;
            const hasCurrentIllness = subjective.clinicalEnvelopeSources?.includes('non_allergy_illness') ?? false;
            const cautionNote = hasCurrentPainOrInjury
                ? "You're also flagging pain or injury today, so prioritize recovery and get it checked out if it persists."
                : hasCurrentIllness
                    ? "You're also flagging illness symptoms today, so prioritize recovery and return to training progressively as symptoms resolve."
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
        selectedTemplate = rankedModifyOptions.length > 0 ? pickTemplate(rankedModifyOptions, date)! : (availableTemplates.find(t => t.category === 'Rest') ?? getCanonicalRestTemplate());
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
    if (subjectiveDriftIsDecisionRelevant) rationale += " Your recent daily check-ins have been trending adverse relative to your own baseline, which contributed to today's more conservative call.";
    if (postRecoverBufferApplied) rationale += " Yesterday was a mandated recovery day, so easing back in today (rather than going straight to a hard session) even though this morning's numbers look fully green.";
    if (objective.yesterday_training && objective.yesterday_training.duration_min && mode === 'modify') rationale += ` Giving your body a break after yesterday's ${objective.yesterday_training.type} session.`;
    if (!selectedTemplate) {
        selectedTemplate = getCanonicalRestTemplate();
        rationale += ' (Defaulted to Rest/Mobility due to severe time/equipment constraints).';
    }
    return { template: selectedTemplate, rationale, mode, envelopes, telemetry, knowledgeRefs: state.knowledgeRefs };
}

/** Identifies which imported session is placed on the evaluation date. */
export interface ExternalPlanContext {
    planId: string;
    revision: number;
    session: ExternalPlanSession;
    /** SHA-256 of the stored revision this session was read from (ADR-0019 D-IMMUT).
     * Recorded on the decision audit so replay verifies against the same bytes. */
    contentHash: string;
}

function eventCategoryMatchesSession(event: UserEvent, session: ExternalPlanSession): boolean {
    switch (session.gating.modality) {
        case 'cycling': return event.category === 'cycling_event' || event.category === 'triathlon';
        case 'running': return event.category === 'running_race' || event.category === 'triathlon';
        case 'swimming': return event.category === 'triathlon';
        case 'strength': return event.category === 'strength_meet';
        case 'field':
        case 'mobility':
        case 'cross_training': return event.category === 'general_target';
    }
}

function hasMatchingUserEvent(events: UserEvent[], session: ExternalPlanSession, date: string): boolean {
    return events.some(event =>
        event.date === date
        && event.lifecycle !== 'cancelled'
        && eventCategoryMatchesSession(event, session),
    );
}

function externalPrescriptionFor(externalPlan: ExternalPlanContext): NonNullable<Recommendation['externalPrescription']> {
    const { session, planId, revision } = externalPlan;
    return {
        planId, revision, sessionId: session.id, title: session.title,
        prescription: externalSessionDisplayPrescription(session),
        ...(session.scaling ? { scaling: session.scaling } : {}),
        ...(session.isEvent ? { isEvent: true } : {}),
    };
}

/**
 * Builds the recommendation for an imported prescribed session. Events deliberately do
 * not use this path: D-EVENT reconciles them onto FixedActivity and keeps their verdict as
 * advice alongside the normal recommendation rather than recommending the event itself.
 */
function adjudicatedExternalRecommendation(
    externalPlan: ExternalPlanContext,
    readiness: DailyReadiness,
    context: UserContext,
    envelopeState: ReturnType<typeof evaluateReadinessAndSafetyEnvelope>,
    intent: Awaited<ReturnType<typeof resolveTrainingIntent>>,
    date: string,
    fixedActivities: FixedActivity[],
): Recommendation {
    const { session, planId, revision, contentHash } = externalPlan;
    const availability = resolveAvailability(date, readiness.subjective, fixedActivities, context);
    const verdict = adjudicateExternalSession(session, readiness, context, envelopeState, intent.plannedDose, date, availability);
    const actionable = verdict.decision === 'proceed' || verdict.decision === 'scale';

    const restTemplate = getCanonicalRestTemplate();

    return {
        template: actionable ? toSyntheticTemplate(session, planId, revision) : restTemplate,
        plannedDose: intent.plannedDose,
        ...(verdict.executionDose ? { executionDose: verdict.executionDose } : {}),
        rationale: verdict.rationale,
        mode: actionable ? envelopeState.mode : 'recover',
        envelopes: envelopeState.envelopes,
        telemetry: envelopeState.telemetry,
        knowledgeRefs: mergeKnowledgeRefs(
            envelopeState.knowledgeRefs,
            trainingIntentKnowledgeRefs(intent),
        ),
        externalPrescription: externalPrescriptionFor(externalPlan),
        externalVerdict: verdict,
        decisionTrace: {
            policyVersion: POLICY_VERSION,
            candidateScores: [],
            droppedContributorObjectives: intent.droppedContributorObjectives,
            externalPlan: { planId, revision, sessionId: session.id, contentHash },
        },
    };
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
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
    trainingIntentProfile: TrainingIntentProfile | null = null,
    preferences: UserPreferences | null = null,
    fatigueFusionPolicy: FatigueFusionPolicy = 'max',
    externalPlan: ExternalPlanContext | null = null,
    /** Phase 9.6: only the simulation comparison harness overrides this. Every production
     *  entry point uses the default 'off', mirroring `fatigueFusionPolicy` above. */
    subjectiveDriftPolicy: SubjectiveDriftPolicy = 'off',
    subjectiveDriftWeights: SubjectiveDriftWeights = REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
): Promise<Recommendation> {
    const envelopeState = evaluateReadinessAndSafetyEnvelope(readiness, context, date, previousMode, subjectiveDriftPolicy, subjectiveDriftWeights);
    const { mode, envelopes, telemetry } = envelopeState;
    let intent = await resolveTrainingIntent(userId, events, date, readiness, 7, historyProvider, preparedHistorySnapshot, authoredPlanBlocks, trainingIntentProfile, fatigueFusionPolicy);

    let externalEventAdvisory: {
        prescription: NonNullable<Recommendation['externalPrescription']>;
        verdict: NonNullable<Recommendation['externalVerdict']>;
        provenance: { planId: string; revision: number; sessionId: string; contentHash: string };
    } | null = null;

    if (externalPlan && intent.planningContext.externalFallback) {
        if (!externalPlan.session.isEvent) {
            return adjudicatedExternalRecommendation(externalPlan, readiness, context, envelopeState, intent, date, fixedActivities);
        }

        const eventAvailability = resolveAvailability(date, readiness.subjective, fixedActivities, context);
        let eventVerdict = adjudicateExternalSession(
            externalPlan.session, readiness, context, envelopeState, intent.plannedDose, date, eventAvailability,
        );
        if (!hasMatchingUserEvent(events, externalPlan.session, date)) {
            eventVerdict = {
                ...eventVerdict,
                rationale: `${eventVerdict.rationale} This imported event is not linked to a matching target event in Goals. Add or link it there so periodization and taper use the same commitment; the import will not create that calendar event for you.`,
            };
        }

        const eventFixedActivity = externalEventAsFixedActivity(
            externalPlan.session, externalPlan.planId, externalPlan.revision, userId, date,
        );
        if (eventFixedActivity && !fixedActivities.some(activity => activity.id === eventFixedActivity.id)) {
            fixedActivities = [...fixedActivities, eventFixedActivity];
        }
        externalEventAdvisory = {
            prescription: externalPrescriptionFor(externalPlan),
            verdict: eventVerdict,
            provenance: {
                planId: externalPlan.planId,
                revision: externalPlan.revision,
                sessionId: externalPlan.session.id,
                contentHash: externalPlan.contentHash,
            },
        };
    }

    const evergreen = resolveEvergreenPlan(
        intent.planningContext, intent.periodization.phase, intent.history, intent.historySnapshot,
        preferences, context, date, fixedActivities,
    );
    if (evergreen) {
        const unresolvedObjectives = getUnresolvedObjectives(evergreen.microcycle);
        intent = {
            ...intent,
            microcycle: evergreen.microcycle,
            unresolvedObjectives,
            plannedDose: applyPlanningOverlays(
                resolvePlannedDoseForDate(intent.periodization.phase, evergreen.microcycle.objectives, unresolvedObjectives, evergreen.planDefinition, date),
                date,
                authoredPlanBlocks,
                evergreen.planDefinition,
            ),
        };
    }

    const todaysFixedActivities = fixedActivities.filter(a => a.date === date && !a.isCompleted);
    if (todaysFixedActivities.length > 0) {
        const stimulusResult = applyFixedActivityStimulusCredit(intent.microcycle, fixedActivities, date);
        intent = {
            ...intent,
            microcycle: stimulusResult.microcycle,
            unresolvedObjectives: getUnresolvedObjectives(stimulusResult.microcycle, true),
        };
    }

    const decisionKnowledgeRefs = mergeKnowledgeRefs(
        envelopeState.knowledgeRefs,
        trainingIntentKnowledgeRefs(intent),
        evergreen?.knowledgeRefs,
    );

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

    const rankingFatigue = applyCompletedSessionLoad(intent.fatigue, date, availability.reservedCapacityCostProfile, fatigueFusionPolicy);
    const optContext = buildOptimizationContext(
        { ...intent, fatigue: rankingFatigue },
        context,
        preferences ?? context.preferences,
        date,
        {
            resolveMinimumDaysAfterHardLowerBody, resolveRecoveryHours: resolveRecoveryHoursForTemplate, resolvedAvailability: availability, fatigueTier: mode, authoredPlanBlocks,
            ...(evergreen ? { coverageState: buildCoverageState(evergreen.planDefinition, date) } : {}),
        },
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
    const calibration = calibrationTrace(intent, rankingFatigue, fixedActivities, date);
    const phaseContext = intent.periodization.focusEvent
        ? `${intent.periodization.daysToEvent} days out from ${intent.periodization.focusEvent.title}, ${intent.periodization.phase.phaseName} phase.`
        : `${intent.periodization.phase.phaseName} phase.`;
    const externalFallbackPrefix = !externalPlan && intent.planningContext.externalFallback
        ? 'External plan fallback: no imported session is placed today, so the built-in planner is choosing this session. '
        : '';
    const pick = rankingResult.accepted[0];
    // A 'modify' mode whose top-ranked candidate is already low-cost enough to survive
    // the modify ceiling unchanged (a bad subjective checkin on an already-easy day, most
    // commonly) previously fell through as a same-template, same-duration recommendation
    // -- 'modify' meant nothing an athlete could see. Auto-applying the template's own
    // easier dose (the same mechanism `adjustSessionRecommendation('easier', ...)` uses
    // for an explicit athlete request) keeps 'modify' visibly distinct from 'train'
    // whenever the template offers a lighter variant, without inventing a second
    // eligibility/ranking path. It also covers the time-cap case: see
    // resolveTimeCapDoseAdjustment for why eligibility alone cannot guarantee the
    // recommended duration respects a hard cap. This same helper is used for forecast days
    // in planner.ts -- keep the two call sites in sync.
    const doseAdjustment = pick
        ? resolveTimeCapDoseAdjustment(pick.template, availability.maxTimeMinutes, mode === 'modify')
        : null;
    if (!pick) {
        const safeRecovery = candidates.find(template => template.category === 'Rest' || template.category === 'Mobility/Recovery')
            ?? getCanonicalRestTemplate();
        const fallbackRationale = envelopes.safety.redFlagActive
            ? `${envelopes.safety.clinicalReason ?? 'Clinical evaluation recommended: red-flag findings reported.'} All training prescriptions are paused.`
            : `${externalFallbackPrefix}${phaseContext} No candidate survived the active hard constraints; defaulting to recovery rather than bypassing those constraints.`;
        return {
            template: safeRecovery,
            rationale: fallbackRationale,
            mode: 'recover', envelopes, telemetry,
            knowledgeRefs: decisionKnowledgeRefs,
            ...(externalEventAdvisory ? {
                externalPrescription: externalEventAdvisory.prescription,
                externalVerdict: externalEventAdvisory.verdict,
            } : {}),
            decisionTrace: {
                policyVersion: POLICY_VERSION,
                candidateScores: rankingResult.all.map(candidate => ({ templateId: candidate.template.id, utilityScore: candidate.utilityScore, benefitScore: candidate.benefitScore, costPenalty: candidate.costPenalty, excludedReasons: candidate.excludedReasons })),
                droppedContributorObjectives: intent.droppedContributorObjectives,
                calibration,
                ...(externalEventAdvisory ? { externalPlan: externalEventAdvisory.provenance } : {}),
            },
        };
    }
    const finalRationale = envelopes.safety.redFlagActive
        ? `${envelopes.safety.clinicalReason ?? 'Clinical evaluation recommended: red-flag findings reported.'} All training prescriptions are paused.`
        : doseAdjustment ? `${externalFallbackPrefix}${phaseContext} ${pick.rationale} ${doseAdjustment.adjustment.rationale}` : `${externalFallbackPrefix}${phaseContext} ${pick.rationale}`;
    return {
        template: pick.template,
        plannedDose: intent.plannedDose,
        executionDose: resolveExecutionDose(intent.plannedDose, envelopes.plan, null),
        rationale: finalRationale,
        mode, envelopes, telemetry,
        knowledgeRefs: decisionKnowledgeRefs,
        ...(doseAdjustment ?? {}),
        ...(externalEventAdvisory ? {
            externalPrescription: externalEventAdvisory.prescription,
            externalVerdict: externalEventAdvisory.verdict,
        } : {}),
        decisionTrace: {
            policyVersion: POLICY_VERSION,
            candidateScores: rankingResult.all.map(candidate => ({ templateId: candidate.template.id, utilityScore: candidate.utilityScore, benefitScore: candidate.benefitScore, costPenalty: candidate.costPenalty, excludedReasons: candidate.excludedReasons })),
            droppedContributorObjectives: intent.droppedContributorObjectives,
            calibration,
            ...(externalEventAdvisory ? { externalPlan: externalEventAdvisory.provenance } : {}),
        },
    };
}

export function evaluateEnvelopes(readiness: DailyReadiness, context: UserContext): { safety: SafetyEnvelope; plan: PlanEnvelope } {
    const legacyClinicalFlag = readiness.subjective.painFlag;
    const restrictedModalities = [...(context.constraints.restrictedModalities ?? [])];
    const hasActiveInjury = restrictedModalities.length > 0 || (context.constraints.impliedGuardrails ?? []).length > 0 || (context.constraints.restrictedCategories ?? []).length > 0;

    // `painFlag` is retained as a backward-compatible aggregate. New inputs name their
    // clinical origin explicitly; a legacy true flag with no source fails closed as pain/injury.
    const sources: NonNullable<typeof readiness.subjective.clinicalEnvelopeSources> =
        readiness.subjective.clinicalEnvelopeSources ?? (legacyClinicalFlag ? ['pain_or_injury'] : []);
    const hasPainOrInjury = sources.includes('pain_or_injury');
    const hasNonAllergyIllness = sources.includes('non_allergy_illness');
    const redFlagFindings = readiness.subjective.redFlagFindings ?? [];
    const redFlagActive = redFlagFindings.length > 0 || sources.includes('red_flag');
    const clinicalEscalationRequired = redFlagActive;
    const redFlagCategories = redFlagFindings.map(f => f.category);
    const hasCurrentClinicalSymptoms = legacyClinicalFlag || sources.length > 0 || redFlagActive;

    // The generic Running restriction belongs to the pain/injury branch only. Current
    // structured tissue-response regions may contextualize that fallback; standing injury
    // trace facts are intentionally NOT consulted because provenance must not become policy
    // authority and an unrelated old shoulder/hip/back constraint cannot locate today's pain.
    const currentPainFamilies = readiness.subjective.painOrInjuryRegionFamilies ?? [];
    const hasStructuredCurrentPainLocation = currentPainFamilies.length > 0;
    const hasLowerLimbImpactPain = currentPainFamilies.includes('lower_limb_impact');
    if (
        hasPainOrInjury
        && !restrictedModalities.includes('Running')
        && (!hasStructuredCurrentPainLocation || hasLowerLimbImpactPain)
    ) {
        restrictedModalities.push('Running');
    }

    const clinicalFlagActive = hasCurrentClinicalSymptoms || hasActiveInjury;
    let maxAllowableTier: 'Rest' | 'Mobility' | 'Easy' | 'Moderate' | 'Hard' = 'Hard';
    if (readiness.subjective.alreadyTrainedToday || redFlagActive) maxAllowableTier = 'Rest';
    else if (hasCurrentClinicalSymptoms) maxAllowableTier = 'Mobility';
    else if (
        (readiness.objective.body_battery_wake !== null && readiness.objective.body_battery_wake < 30) ||
        (readiness.objective.sleep_score !== null && readiness.objective.sleep_score < 55)
    ) {
        maxAllowableTier = 'Easy';
    }

    let clinicalReason: string | null = null;
    if (redFlagActive) {
        const categoriesText = redFlagCategories.length > 0
            ? ` (${Array.from(new Set(redFlagCategories)).map(c => c.replace(/_/g, ' ')).join(', ')})`
            : '';
        clinicalReason = `Clinical evaluation recommended: red-flag finding reported${categoriesText}. Training recommendations are paused until medical evaluation.`;
    }
    else if (hasPainOrInjury && hasNonAllergyIllness) clinicalReason = 'Pain/injury and non-allergy illness symptoms reported.';
    else if (hasPainOrInjury) clinicalReason = 'Pain or injury reported.';
    else if (hasNonAllergyIllness) clinicalReason = 'Non-allergy illness symptoms reported.';
    else if (legacyClinicalFlag) clinicalReason = 'Active legacy clinical symptom flag reported.';
    else if (hasActiveInjury) clinicalReason = 'Active injury restriction is in effect.';

    return {
        safety: {
            clinicalFlagActive,
            clinicalReason,
            restrictedModalities,
            redFlagActive,
            clinicalEscalationRequired,
            redFlagCategories: redFlagActive ? redFlagCategories : undefined,
        },
        plan: {
            maxAllowableTier,
            taperActive: false,
            reason: redFlagActive ? 'Red-flag clinical escalation protocol active.' : null,
        },
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
    if (safety.clinicalEscalationRequired) return null;
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

    const allowedModalities = (['Running', 'Cycling', 'Swimming', 'Walking', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'] as const)
        .filter(m => !context.preferences.avoidedModalities.map(a => a.toLowerCase()).includes(m.toLowerCase()))
        .filter(m => !safety.restrictedModalities.includes(m));
    const availableTemplates = eligibleTemplates(TEMPLATES, context, readiness.subjective.timeAvailable, date)
        .filter(t => t.id !== baseTemplate.id && allowedModalities.includes(t.modality));

    const tier2Candidates = availableTemplates.filter(t => t.modality === baseTemplate.modality && t.category === baseTemplate.category)
        .filter(t => {
            if (direction === 'easier') return t.systemicCost < baseTemplate.systemicCost;
            return t.systemicCost > baseTemplate.systemicCost && !exceedsPlanCeiling(t.systemicCost, plan);
        });
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
    const hasClinicalSymptoms = todayReadiness.subjective.painFlag
        || (todayReadiness.subjective.clinicalEnvelopeSources?.length ?? 0) > 0;
    const isTodayHardSession = todayRec.template.category === 'Hard Endurance'
        || todayRec.template.category === 'Full-body Strength'
        || todayRec.template.category === 'Lower-body Strength'
        || todayRec.template.category === 'Upper-body Strength';
    const recentHardSessions = todayReadiness.objective.last_3_days_hard_sessions_count || 0;
    const isCumulativeOverload = recentHardSessions >= 2 && isTodayHardSession;

    const obj = todayReadiness.objective;
    let adverseSignalCount = 0;
    if (obj.hrv_delta !== null && obj.hrv_delta <= -10) adverseSignalCount++;
    if (obj.rhr_delta !== null && obj.rhr_delta >= 5) adverseSignalCount++;
    if (obj.body_battery_wake !== null && obj.body_battery_wake <= 35) adverseSignalCount++;
    if (obj.sleep_score !== null && obj.sleep_score <= 55) adverseSignalCount++;
    const isSevereAdverseRecovery = todayRec.mode === 'recover' && adverseSignalCount >= 2;

    let singlePlanReason: string | undefined;
    if (hasClinicalSymptoms) singlePlanReason = 'Active clinical symptoms reported today. Tomorrow requires dedicated recovery regardless of morning metrics.';
    else if (isCumulativeOverload) singlePlanReason = 'High cumulative load (multiple hard sessions back-to-back). Tomorrow is locked to active recovery to prevent overtraining.';
    else if (isSevereAdverseRecovery) singlePlanReason = 'Severe physiological strain detected today (depleted recovery markers). Tomorrow requires sustained recovery to prevent overtraining.';

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

/**
 * `evaluateTrainingWithIntent` may synthesize an in-memory FixedActivity for an imported
 * target event. That object deliberately is not persisted and therefore is not in the
 * caller's `fixedActivities` array when Home asks for tomorrow's forecast. The decision
 * trace already records the aggregate fixed-activity profiles that today's ranking saw.
 * Project only the positive delta between that trace and the caller-owned activities, so
 * the event load survives into tomorrow without double-counting ordinary commitments.
 */
function unrepresentedFixedActivityProjection(
    date: string,
    rec: Recommendation,
    fixedActivities: FixedActivity[],
): CompletedExposure | null {
    const trace = rec.decisionTrace?.calibration?.fixedActivity;
    if (!trace) return null;
    const represented = fixedActivities.filter(activity => activity.date === date && !activity.isCompleted);
    if (trace.count <= represented.length) return null;

    const representedCost = represented.reduce<WorkoutCostProfile>((sum, activity) => ({
        systemic: sum.systemic + (activity.expectedCost?.systemic ?? 0),
        cardiovascular: sum.cardiovascular + (activity.expectedCost?.cardiovascular ?? 0),
        lowerBody: sum.lowerBody + (activity.expectedCost?.lowerBody ?? 0),
        upperBody: sum.upperBody + (activity.expectedCost?.upperBody ?? 0),
        impactTissue: sum.impactTissue + (activity.expectedCost?.impactTissue ?? 0),
        neuromuscular: sum.neuromuscular + (activity.expectedCost?.neuromuscular ?? 0),
    }), ZERO_COST);
    const representedStimulus = represented.reduce<WorkoutStimulusProfile>((sum, activity) => ({
        aerobicEndurance: sum.aerobicEndurance + (activity.expectedStimulus?.aerobicEndurance ?? 0),
        thresholdPower: sum.thresholdPower + (activity.expectedStimulus?.thresholdPower ?? 0),
        vo2MaxPower: sum.vo2MaxPower + (activity.expectedStimulus?.vo2MaxPower ?? 0),
        repeatedSurges: sum.repeatedSurges + (activity.expectedStimulus?.repeatedSurges ?? 0),
        sprintPower: sum.sprintPower + (activity.expectedStimulus?.sprintPower ?? 0),
        fatigueResistance: sum.fatigueResistance + (activity.expectedStimulus?.fatigueResistance ?? 0),
        maxStrength: sum.maxStrength + (activity.expectedStimulus?.maxStrength ?? 0),
        hypertrophy: sum.hypertrophy + (activity.expectedStimulus?.hypertrophy ?? 0),
    }), ZERO_STIMULUS);

    const costProfile = Object.fromEntries(
        (Object.keys(ZERO_COST) as (keyof WorkoutCostProfile)[])
            .map(key => [key, Math.max(0, trace.cost[key] - representedCost[key])]),
    ) as unknown as WorkoutCostProfile;
    const stimulusProfile = Object.fromEntries(
        (Object.keys(ZERO_STIMULUS) as (keyof WorkoutStimulusProfile)[])
            .map(key => [key, Math.max(0, trace.stimulus[key] - representedStimulus[key])]),
    ) as unknown as WorkoutStimulusProfile;
    const hasCost = Object.values(costProfile).some(value => value > 0);
    const hasStimulus = Object.values(stimulusProfile).some(value => value > 0);
    if (!hasCost && !hasStimulus) return null;

    return {
        occurrenceKey: `decision-only-fixed:${date}`,
        date,
        costProfile,
        ...(hasStimulus ? { stimulusProfile, stimulusConfidence: 'inferred' as const } : {}),
        trainingRecordLike: {
            type: rec.externalPrescription?.isEvent ? rec.externalPrescription.title : 'Decision-only fixed commitment',
            duration_min: 0,
            training_effect: 0,
            intensity_tag: '',
        },
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
    const unrepresentedFixed = unrepresentedFixedActivityProjection(todayDate, todayRec, fixedActivities);
    const projected = [
        ...prior.filter(exposure => exposure.date >= windowStart && exposure.date < tomorrowDate),
        recommendationProjection(todayDate, todayRec),
        ...fixedActivities.filter(activity => activity.date === todayDate && !activity.isCompleted).flatMap(activity => {
            const exposure = fixedActivityProjection(activity);
            return exposure ? [exposure] : [];
        }),
        ...(unrepresentedFixed ? [unrepresentedFixed] : []),
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
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
    trainingIntentProfile: TrainingIntentProfile | null = null,
    preferences: UserPreferences | null = null,
    fatigueFusionPolicy: FatigueFusionPolicy = 'max',
    /** Phase 9.6: only the simulation comparison harness overrides this. */
    subjectiveDriftPolicy: SubjectiveDriftPolicy = 'off',
    subjectiveDriftWeights: SubjectiveDriftWeights = REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS,
): Promise<NextDayPotentialPlan> {
    const scenarios = buildNextDayScenarios(todayReadiness, context, todayDate, todayRec);
    const projectedProvider = await projectedProviderForTomorrow(
        userId, scenarios.date, todayDate, todayRec, fixedActivities, historyProvider, preparedHistorySnapshot,
    );
    const evaluate = async (scenario: NextDayScenario) => evaluatedBranch(
        scenario,
        await evaluateTrainingWithIntent(
            userId, scenario.readiness, context, events, scenarios.date, todayRec.mode, projectedProvider, null,
            fixedActivities, authoredPlanBlocks, trainingIntentProfile, preferences, fatigueFusionPolicy, null,
            subjectiveDriftPolicy, subjectiveDriftWeights,
        ),
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
