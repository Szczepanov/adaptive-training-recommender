import type { DailyReadiness, UserContext, Recommendation, SessionTemplate, NextDayPotentialPlan, NextDayPlanBranch, NextDayScenario, NextDayScenarioSet, DecisionScoreTelemetry, SafetyEnvelope, PlanEnvelope, UserEvent } from './models';
import { TEMPLATES } from './templates';
import { eligibleTemplates, evaluateTemplateEligibility, resolveMaximumSessionMinutes } from './eligibility';
import { ENRICHED_TEMPLATES } from './templates';
import { rankCandidates, rankCandidatesByUtility } from './optimizer';
import { resolveAvailability } from './schedule';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { resolveTrainingIntent } from './trainingIntent';
import { POLICY_VERSION } from './policy';
import { resolveExecutionDose } from './dose';
import { isTemplatePhaseEligible } from './periodization';

/**
 * Deterministically pick one template from a filtered set of same-category options,
 * varying by date so users don't see the identical session every time a mode repeats,
 * while still being idempotent for a given day (reloading today doesn't reshuffle it).
 */
function pickTemplate(options: SessionTemplate[], seedDate: string): SessionTemplate | undefined {
    if (options.length === 0) return undefined;
    if (options.length === 1) return options[0];

    let hash = 0;
    for (let i = 0; i < seedDate.length; i++) {
        hash = (hash * 31 + seedDate.charCodeAt(i)) >>> 0;
    }
    return options[hash % options.length];
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function modalityMatches(templateModality: string, wanted: string): boolean {
    return templateModality.toLowerCase() === wanted.trim().toLowerCase();
}

/**
 * Ranks a candidate pool by long-term modality preference before the per-day hash pick
 * runs: preferred-modality options first, then neutral options, then deprioritized
 * options only if nothing else survives. Never excludes anything outright (that's what
 * avoidedModalities -- a hard filter -- is for); this only reorders which tier
 * pickTemplate draws from.
 */
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
    if (neutral.length > 0) return neutral;

    return options; // everything left is deprioritized -- still better than nothing
}

/**
 * Applies today's explicit modality ask (from the check-in, distinct from the
 * longer-term preferences above) against `searchPool`, falling back to `fallbackPool`
 * (the mode's normal candidate set) with an explanatory note when it can't be honored --
 * silently ignoring an explicit ask would look like the engine didn't listen.
 *
 * `searchPool` and `fallbackPool` are deliberately separate: on a 'train' day there's no
 * safety reason to refuse an explicit ask for something gentler than what train mode
 * would normally offer (e.g. "just do mobility today even though I'm fresh"), so train's
 * search pool is every constraint-eligible template, not just its usual hard/moderate/
 * strength categories. On 'recover'/'modify' days the mode's systemic-cost ceiling *is*
 * safety-motivated, so search and fallback pool are the same restricted set there --
 * see call sites below.
 */
function applyModalityPreference(
    searchPool: SessionTemplate[],
    fallbackPool: SessionTemplate[],
    preferredModalityToday: string | null
): { options: SessionTemplate[]; note: string | null } {
    if (!preferredModalityToday || !preferredModalityToday.trim()) {
        return { options: fallbackPool, note: null };
    }

    const matchingToday = searchPool.filter(t => modalityMatches(t.modality, preferredModalityToday));
    if (matchingToday.length > 0) {
        return { options: matchingToday, note: null };
    }

    const existsAnywhereInCatalog = TEMPLATES.some(t => modalityMatches(t.modality, preferredModalityToday));
    const note = existsAnywhereInCatalog
        ? `You asked for ${preferredModalityToday} today, but today's readiness/constraints don't support it -- sticking with a safer option instead.`
        : `You asked for ${preferredModalityToday} today, but we don't have a matching session type in the catalog yet.`;
    return { options: fallbackPool, note };
}

// --- Objective "strain" scoring ---
// Replaces an earlier binary penalty ladder (fixed +1 point for crossing a hardcoded
// absolute threshold, e.g. "-5ms HRV") with a continuous, this-person's-own-stdev
// normalized score. A fixed absolute threshold doesn't generalize: -5ms is deep in the
// noise floor for someone with high night-to-night HRV variability, and a real signal
// for someone whose readings are normally very stable. Two components are combined per
// metric:
//   - "acute" z: today vs the person's own trailing 7-day baseline (one rough night)
//   - "chronic" z: the 7-day baseline's drift away from the 28-day baseline -- an
//     accumulating multi-day trend, which is what actually predicts overreaching, not
//     a single noisy reading. Weighted higher than acute for that reason.
// Metric weights approximate each signal's reliability as a recovery marker: HRV is the
// most direct autonomic-recovery read, sleep score is the noisiest (a proprietary
// composite), RHR in between.
const HRV_STRAIN_WEIGHT = 0.5;
const RHR_STRAIN_WEIGHT = 0.3;
const SLEEP_STRAIN_WEIGHT = 0.2;

// Floors: if a metric has been unusually flat over its own trailing 28 days (or has no
// computed stdev yet, e.g. early in a user's history), its z-score shouldn't blow up on
// a routine day-to-day move. Values approximate realistic night-to-night noise.
const HRV_STDEV_FLOOR_MS = 3;
const RHR_STDEV_FLOOR_BPM = 1.5;
const SLEEP_STDEV_FLOOR_PTS = 4;

// Caps one metric's z-score contribution so a single outlier reading can't dominate the
// whole strain score by itself.
const STRAIN_Z_CAP = 2.0;
// Chronic (multi-day) drift counts for more than a single day's acute reading.
const CHRONIC_STRAIN_MULTIPLIER = 1.5;

// A genuinely poor night matters even for someone whose baseline runs low (the z-score
// above is baseline-relative and would otherwise under-react) -- a small flat floor
// rather than the old hard "< 60" cutoff, which fired on essentially no real nights.
const SLEEP_SCORE_ABSOLUTE_FLOOR = 50;
const SLEEP_SCORE_ABSOLUTE_FLOOR_STRAIN = 0.5;

// Body Battery: ramps smoothly from 0 strain at 50 up to full strain by 25, rather than
// a step function at a single cutoff.
const BODY_BATTERY_LOW_ANCHOR = 50;
const BODY_BATTERY_LOW_FULL_STRAIN_AT = 25;
const BODY_BATTERY_MAX_STRAIN = 0.3;
// An extremely low wake value is a direct readiness stop signal, not merely a small
// contributor to a composite score that an event optimizer could outweigh.
const BODY_BATTERY_RECOVER_THRESHOLD = 20;

const RECENT_HARD_SESSIONS_STRAIN = 1.0;

// A user who's told us (via UserPreferences.conservativeBias) that they want a more
// cautious coach gets a flat strain offset -- shifts the modify/recover boundaries in
// their favor without restructuring the thresholds themselves.
const CONSERVATIVE_BIAS_STRAIN_OFFSET = 0.4;

// Calibrated against ~2 months of real HRV/RHR/sleep data so 'modify'/'recover' trigger
// at roughly the frequency the old binary ladder did overall, but driven by genuine
// multi-day fatigue patterns instead of single-night noise below the noise floor.
const STRAIN_MODIFY_THRESHOLD = 1.0;
const STRAIN_RECOVER_THRESHOLD = 2.2;

/**
 * One metric's contribution to the overall objective strain score.
 * `sign` is +1 when a *negative* delta is the bad direction (HRV, sleep score), -1 when
 * a *positive* delta is bad (RHR).
 */
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
        // avg7d - avg28d, reconstructed algebraically as (deltaVs28d - deltaVs7d) so we
        // don't need the raw 7d/28d averages themselves in the engine.
        const zChronic = (sign * (deltaVs28d - deltaVs7d)) / sd;
        chronicStrain = clamp(-zChronic, 0, STRAIN_Z_CAP);
    }

    const acuteDeviation = weight * acuteStrain;
    const multiDayDrift = weight * CHRONIC_STRAIN_MULTIPLIER * chronicStrain;

    return {
        acuteDeviation,
        multiDayDrift,
        total: acuteDeviation + multiDayDrift
    };
}

/**
 * A 'modify' (moderate-readiness) day caps template selection by systemic cost rather
 * than by a fixed category allow-list. 0.5 admits Easy Endurance, Mobility/Recovery,
 * and -- unlike the old allow-list -- Upper-body Strength (cost 0.3): a low-cost,
 * muscle-local stimulus that softer HRV/RHR readings don't actually contraindicate.
 * Moderate Endurance, Lower-body/Full-body Strength, and Hard Endurance (cost >= 0.55)
 * stay excluded, same as before.
 */
const MODIFY_MAX_SYSTEMIC_COST = 0.5;

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

    // 1. Subjective fatigue scoring (10 = worst fatigue)
    const invertedMotivation = 10 - subjective.motivation;
    const invertedSleepQual = 10 - subjective.sleepQuality;
    const invertedReadiness = 10 - subjective.readiness;

    const overallFatigueScore = (subjective.fatigue + subjective.soreness + invertedReadiness + invertedSleepQual + invertedMotivation) / 5;

    // 2. Objective strain scoring & telemetry decomposition (baseline-relative)
    const hrvStrain = metricStrain(
        objective.hrv_delta, objective.hrv_delta_28d, objective.hrv_stdev_28d,
        HRV_STDEV_FLOOR_MS, HRV_STRAIN_WEIGHT, 1
    );
    const rhrStrain = metricStrain(
        objective.rhr_delta, objective.rhr_delta_28d, objective.rhr_stdev_28d,
        RHR_STDEV_FLOOR_BPM, RHR_STRAIN_WEIGHT, -1
    );
    const sleepStrain = metricStrain(
        objective.sleep_score_delta_7d, objective.sleep_score_delta_28d, objective.sleep_score_stdev_28d,
        SLEEP_STDEV_FLOOR_PTS, SLEEP_STRAIN_WEIGHT, 1
    );

    const totalAcuteDeviation = hrvStrain.acuteDeviation + rhrStrain.acuteDeviation + sleepStrain.acuteDeviation;
    const totalMultiDayDrift = hrvStrain.multiDayDrift + rhrStrain.multiDayDrift + sleepStrain.multiDayDrift;
    const totalMetricStrain = totalAcuteDeviation + totalMultiDayDrift;

    let sleepFloorPenalty = 0;
    if (objective.sleep_score !== null && objective.sleep_score < SLEEP_SCORE_ABSOLUTE_FLOOR) {
        sleepFloorPenalty = SLEEP_SCORE_ABSOLUTE_FLOOR_STRAIN;
    }

    let bodyBatteryDeficit = 0;
    if (objective.body_battery_wake !== null) {
        const deficit = BODY_BATTERY_LOW_ANCHOR - objective.body_battery_wake;
        const range = BODY_BATTERY_LOW_ANCHOR - BODY_BATTERY_LOW_FULL_STRAIN_AT;
        bodyBatteryDeficit = clamp(deficit / range, 0, 1) * BODY_BATTERY_MAX_STRAIN;
    }

    let conservativeBias = 0;
    if (context.preferences.conservativeBias) {
        conservativeBias = CONSERVATIVE_BIAS_STRAIN_OFFSET;
    }

    const extremeFatigue = subjective.fatigue > 8 || subjective.soreness > 8 || subjective.painFlag;

    const recentHardSessionsCount = objective.last_3_days_hard_sessions_count || 0;
    let recentHardSessionsPenalty = 0;
    if (recentHardSessionsCount >= 2) {
        recentHardSessionsPenalty = RECENT_HARD_SESSIONS_STRAIN;
    }

    const objectiveStrain = totalMetricStrain + sleepFloorPenalty + bodyBatteryDeficit + conservativeBias + recentHardSessionsPenalty;

    let mode: 'train' | 'modify' | 'recover' = 'train';

    const lowBodyBatteryRecovery = objective.body_battery_wake !== null
        && objective.body_battery_wake <= BODY_BATTERY_RECOVER_THRESHOLD;
    const fatigueTriggeredRecover = overallFatigueScore > 7 || extremeFatigue || lowBodyBatteryRecovery || objectiveStrain >= STRAIN_RECOVER_THRESHOLD;
    if (fatigueTriggeredRecover) {
        mode = 'recover';
    } else if (overallFatigueScore > 5 || subjective.soreness > 6 || objectiveStrain >= STRAIN_MODIFY_THRESHOLD) {
        mode = 'modify';
    }

    const strainWithoutDrift = objectiveStrain - totalMultiDayDrift;
    const counterfactualRecover = overallFatigueScore > 7 || extremeFatigue || strainWithoutDrift >= STRAIN_RECOVER_THRESHOLD;
    const counterfactualModify = counterfactualRecover || overallFatigueScore > 5 || subjective.soreness > 6 || strainWithoutDrift >= STRAIN_MODIFY_THRESHOLD;
    const counterfactualModeWithoutDrift = counterfactualRecover ? 'recover' : (counterfactualModify ? 'modify' : 'train');
    const multiDayDriftIsDecisionRelevant = (mode !== 'train') && (mode !== counterfactualModeWithoutDrift);

    const postRecoverBufferApplied = mode === 'train' && previousMode === 'recover';
    if (postRecoverBufferApplied) {
        mode = 'modify';
    }

    const alreadyTrainedOverride = subjective.alreadyTrainedToday === true || objective.today_training !== null;
    if (alreadyTrainedOverride) {
        mode = 'recover';
    }

    const round2 = (val: number) => Math.round(val * 100) / 100;
    const telemetry: DecisionScoreTelemetry = {
        metricStrain: {
            acuteDeviation: round2(totalAcuteDeviation),
            multiDayDrift: round2(totalMultiDayDrift),
            totalMetricStrain: round2(totalMetricStrain)
        },
        contextPenalties: {
            recentHardSessions: round2(recentHardSessionsPenalty),
            bodyBatteryDeficit: round2(bodyBatteryDeficit),
            sleepFloorPenalty: round2(sleepFloorPenalty),
            conservativeBias: round2(conservativeBias)
        },
        totalDecisionScore: round2(objectiveStrain)
    };

    const envelopes = evaluateEnvelopes({ subjective, objective }, context);

    return {
        mode,
        envelopes,
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
    /** Lets a caller that already ran evaluateReadinessAndSafetyEnvelope (e.g.
     *  evaluateTrainingWithIntent's empty-candidates fallback) reuse that result instead
     *  of paying for the same readiness/envelope computation twice. Omit for the normal
     *  standalone-call case. */
    precomputedEnvelopeState?: ReturnType<typeof evaluateReadinessAndSafetyEnvelope>
): Recommendation {
    const { subjective, objective } = readiness;
    const state = precomputedEnvelopeState ?? evaluateReadinessAndSafetyEnvelope(readiness, context, date, previousMode);
    const { mode } = state;
    const { envelopes, telemetry, alreadyTrainedOverride, fatigueTriggeredRecover, multiDayDriftIsDecisionRelevant, postRecoverBufferApplied } = state;

    // 4. Filter templates through the single hard-gate resolver. Preferences rank
    // the remaining feasible options; they never bypass a safety or access rule.
    const availableTemplates = eligibleTemplates(TEMPLATES, context, subjective.timeAvailable, date).filter(t => {
        if (context.preferences.avoidedModalities.some(m => modalityMatches(t.modality, m))) return false;
        if (t.phaseEligibility) return false;
        return true;
    });

    // 5. Select Template Based on Mode & Constraints
    let selectedTemplate = availableTemplates.find(t => t.category === 'Rest') || TEMPLATES[1]; // fallback
    let rationale = "";

    let modalityNote: string | null = null;

    if (mode === 'recover') {
        const recoverOptions = availableTemplates.filter(t => t.category === 'Rest' || t.category === 'Mobility/Recovery');
        const preferenceResult = applyModalityPreference(recoverOptions, recoverOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        let rankedRecoverOptions = rankByModalityPreference(
            preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities
        );
        if (context.trainingSettings?.preferences.preferActiveRecovery) {
            rankedRecoverOptions = [...rankedRecoverOptions].sort((a, b) =>
                Number(b.category === 'Mobility/Recovery') - Number(a.category === 'Mobility/Recovery')
            );
        }
        if (rankedRecoverOptions.length > 0) selectedTemplate = pickTemplate(rankedRecoverOptions, date)!;

        if (alreadyTrainedOverride) {
            const loggedSession = objective.today_training;
            const sessionDescription = loggedSession
                ? `Garmin shows you already completed a ${loggedSession.type} session today (~${loggedSession.duration_min} min).`
                : "You've already logged a training session today.";

            if (fatigueTriggeredRecover) {
                const cautionNote = subjective.painFlag
                    ? "You're also flagging pain or injury today, so prioritize recovery and get it checked out if it persists."
                    : "Your fatigue markers are also elevated today, so prioritize recovery (hydration, nutrition, sleep) rather than adding anything further.";
                rationale = `${sessionDescription} ${cautionNote}`;
            } else {
                rationale = `${sessionDescription} Nice work -- no further training is needed. Focus on recovery (hydration, nutrition, sleep) for the rest of the day.`;
            }
        } else {
            rationale = "Your overall fatigue markers are high today (combining subjective feel with drops in objective baselines). Pushing hard could be counter-productive; focus on active or passive recovery.";
        }

    } else if (mode === 'modify') {
        const modifyOptions = availableTemplates.filter(t => t.category !== 'Rest' && t.systemicCost <= MODIFY_MAX_SYSTEMIC_COST);
        const preferenceResult = applyModalityPreference(modifyOptions, modifyOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        const rankedModifyOptions = rankByModalityPreference(
            preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities
        );
        if (rankedModifyOptions.length > 0) selectedTemplate = pickTemplate(rankedModifyOptions, date)!;
        else selectedTemplate = TEMPLATES[0]; // Rest fallback

        rationale = "You're showing moderate soreness or slight downward trends in Garmin baselines. We're capping today's systemic/autonomic load rather than ruling out a whole modality.";
        if (selectedTemplate.category === 'Upper-body Strength') {
            rationale += " Upper-body strength is included: it's a low-systemic-load, muscle-local stimulus, so softer HRV/RHR readings are a better reason to skip legs or intervals than to skip push/pull work.";
        }

    } else {
        const trainOptions = availableTemplates.filter(t => t.category === 'Hard Endurance' || t.category === 'Moderate Endurance' || t.category === 'Full-body Strength' || t.category === 'Upper-body Strength' || t.category === 'Lower-body Strength' || t.category === 'Power Maintenance');
        const preferenceResult = applyModalityPreference(availableTemplates, trainOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        const rankedTrainOptions = rankByModalityPreference(
            preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities
        );
        if (rankedTrainOptions.length > 0) selectedTemplate = pickTemplate(rankedTrainOptions, date)!;

        if (!trainOptions.some(t => t.id === selectedTemplate!.id)) {
            rationale = `Readiness is solid -- you'd be fine pushing harder -- but you asked for ${selectedTemplate.modality.toLowerCase()} today, so going with that instead.`;
        } else {
            rationale = "Readiness is solid across both subjective feelings and Garmin baselines. Great day for a hard session aligned with your primary goals!";
        }
    }

    if (modalityNote) {
        rationale += ` ${modalityNote}`;
    }

    if (multiDayDriftIsDecisionRelevant) {
        rationale += " Your recovery metrics have been trending away from baseline over several days, capping today's training load.";
    }

    if (postRecoverBufferApplied) {
        rationale += " Yesterday was a mandated recovery day, so easing back in today (rather than going straight to a hard session) even though this morning's numbers look fully green.";
    }

    if (objective.yesterday_training && objective.yesterday_training.duration_min && mode === 'modify') {
        rationale += ` Giving your body a break after yesterday's ${objective.yesterday_training.type} session.`;
    }

    if (!selectedTemplate) {
        selectedTemplate = TEMPLATES[0];
        rationale += " (Defaulted to Rest/Mobility due to severe time/equipment constraints).";
    }

    return {
        template: selectedTemplate,
        rationale,
        mode,
        envelopes,
        telemetry
    };
}

/** Intent-aware day-0 selection. Readiness still decides the clinical envelope and
 * train/modify/recover mode; only the safe candidate ranking is replaced with the same
 * objective/fatigue optimizer used by the projected planner. */
export async function evaluateTrainingWithIntent(
    userId: string,
    readiness: DailyReadiness,
    context: UserContext,
    events: UserEvent[],
    date: string,
    previousMode?: 'train' | 'modify' | 'recover',
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
): Promise<Recommendation> {
    const envelopeState = evaluateReadinessAndSafetyEnvelope(readiness, context, date, previousMode);
    const { mode, envelopes, telemetry } = envelopeState;

    const intent = await resolveTrainingIntent(userId, events, date, readiness, 7, historyProvider, preparedHistorySnapshot);
    const maxCost = PLAN_TIER_SYSTEMIC_COST_CEILING[envelopes.plan.maxAllowableTier];
    const candidates = eligibleTemplates(ENRICHED_TEMPLATES, context, readiness.subjective.timeAvailable, date)
        .filter(template => !envelopes.safety.restrictedModalities.includes(template.modality))
        .filter(template => !(context.constraints.restrictedCategories ?? []).includes(template.category))
        .filter(template => template.systemicCost <= maxCost)
        .filter(template => mode !== 'recover' || template.category === 'Rest' || template.category === 'Mobility/Recovery')
        .filter(template => mode !== 'modify' || template.systemicCost <= MODIFY_MAX_SYSTEMIC_COST)
        .filter(template => isTemplatePhaseEligible(template, intent.periodization));
    const rankingResult = rankCandidates(
        candidates,
        intent.unresolvedObjectives,
        intent.fatigue,
        resolveAvailability(date, readiness.subjective, [], context),
        context.constraints.restrictedModalities ?? [],
        {
            userId, preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 45, defaultWeekendTimeMin: 60,
            preferredTimeOfDay: 'flexible', preferredModalities: context.preferences.preferredModalities,
            deprioritizedModalities: context.preferences.deprioritizedModalities, avoidedModalities: context.preferences.avoidedModalities,
            explanationVerbosity: 'detailed', conservativeBias: context.preferences.conservativeBias,
            preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '',
        },
        {
            date,
            focusEvent: intent.periodization.focusEvent,
            recentHistory: intent.history.map(item => ({
                date: item.date,
                modality: item.modality ?? item.trainingRecordLike.type,
                type: item.trainingRecordLike.type,
                category: item.category,
                systemicCost: item.costProfile?.systemic ?? 0,
                lowerBodyCost: item.costProfile?.lowerBody ?? 0,
            }))
        }
    );
    const pick = rankingResult.accepted[0];
    if (!pick) return evaluateTraining(readiness, context, date, previousMode, envelopeState);
    const phaseContext = intent.periodization.focusEvent
        ? `${intent.periodization.daysToEvent} days out from ${intent.periodization.focusEvent.title}, ${intent.periodization.phase.phaseName} phase.`
        : `${intent.periodization.phase.phaseName} phase.`;
    return {
        template: pick.template,
        plannedDose: intent.plannedDose,
        executionDose: resolveExecutionDose(intent.plannedDose, envelopes.plan, null),
        rationale: `${phaseContext} ${pick.rationale}`,
        mode,
        envelopes,
        telemetry,
        decisionTrace: {
            policyVersion: POLICY_VERSION,
            candidateScores: rankingResult.all.map(candidate => ({
                templateId: candidate.template.id,
                utilityScore: candidate.utilityScore,
                excludedReasons: candidate.excludedReasons,
            })),
        },
    };
}

/** Evaluates only clinical/readiness/constraint limits. Event periodization is a
 * training-intent concern and must not be inferred from goal-title keywords here. */
export function evaluateEnvelopes(
    readiness: DailyReadiness,
    context: UserContext
): { safety: SafetyEnvelope; plan: PlanEnvelope } {
    const isPain = readiness.subjective.painFlag;
    const restrictedModalities = [...(context.constraints.restrictedModalities ?? [])];
    const hasActiveInjury =
        restrictedModalities.length > 0 ||
        (context.constraints.impliedGuardrails ?? []).length > 0 ||
        (context.constraints.restrictedCategories ?? []).length > 0;

    if (isPain && !restrictedModalities.includes('Running')) {
        restrictedModalities.push('Running');
    }

    const clinicalFlagActive = isPain || hasActiveInjury;
    const clinicalReason = clinicalFlagActive ? "Active pain or injury flag reported." : null;

    let maxAllowableTier: 'Rest' | 'Mobility' | 'Easy' | 'Moderate' | 'Hard' = 'Hard';
    if (readiness.subjective.alreadyTrainedToday) {
        maxAllowableTier = 'Rest';
    } else if (isPain) {
        maxAllowableTier = 'Mobility';
    } else if (readiness.objective.body_battery_wake !== null && readiness.objective.body_battery_wake < 25) {
        maxAllowableTier = 'Easy';
    }

    return {
        safety: {
            clinicalFlagActive,
            clinicalReason,
            restrictedModalities
        },
        plan: {
            maxAllowableTier,
            // Retained for persisted-recommendation compatibility. Real taper state
            // now comes from periodization/training intent, never from goal text.
            taperActive: false,
            reason: null
        }
    };
}

/**
 * Systemic-cost ceiling admitted by each plan-envelope tier, mirroring the same
 * systemicCost idiom MODIFY_MAX_SYSTEMIC_COST already uses for mode-based capping above.
 * Only consulted for 'harder' adjustments -- 'easier' always moves away from the ceiling,
 * so it never needs gating here.
 */
const PLAN_TIER_SYSTEMIC_COST_CEILING: Record<PlanEnvelope['maxAllowableTier'], number> = {
    Rest: 0,
    Mobility: 0.15,
    Easy: MODIFY_MAX_SYSTEMIC_COST,
    Moderate: 0.8,
    Hard: Infinity
};

function exceedsPlanCeiling(systemicCost: number, plan: PlanEnvelope): boolean {
    return systemicCost > PLAN_TIER_SYSTEMIC_COST_CEILING[plan.maxAllowableTier];
}

/**
 * Adjusts a recommended session based on an explicit user request ('easier' or 'harder'),
 * following the 5-tier adaptation hierarchy and preserving envelopes & transferability bounds.
 */
export function adjustSessionRecommendation(
    baseRec: Recommendation,
    direction: 'easier' | 'harder',
    readiness: DailyReadiness,
    context: UserContext,
    date: string
): Recommendation | null {
    const envelopes = evaluateEnvelopes(readiness, context);
    const { safety, plan } = envelopes;

    // Hard Clinical Flag check: Upward adjustments blocked by clinical floor
    if (direction === 'harder' && safety.clinicalFlagActive) {
        return null;
    }

    const baseTemplate = baseRec.template;
    // Settings can change after the initial recommendation. Do not let a stale base
    // session receive a higher dose once a newly selected hard gate excludes it.
    const baseTemplateEligible = evaluateTemplateEligibility(baseTemplate, context, readiness.subjective.timeAvailable, date).eligible;
    if (direction === 'harder' && !baseTemplateEligible) {
        return null;
    }

    // Tier 1: Same Workout + Dose Modification
    if (direction === 'easier' && baseTemplateEligible && baseTemplate.easierDose) {
        return {
            ...baseRec,
            activeDose: baseTemplate.easierDose,
            adjustment: {
                direction: 'easier',
                tier: 1,
                originalTemplateId: baseTemplate.id,
                originalTemplateTitle: baseTemplate.title,
                adjustedDoseLabel: baseTemplate.easierDose.label,
                rationale: `Session dose adjusted to easier variant (${baseTemplate.easierDose.label}) while preserving the core training purpose.`
            },
            envelopes
        };
    }

    if (direction === 'harder' && baseTemplate.harderDose) {
        // Gate on the actual projected load, not just "isn't Rest/Mobility" -- a taper
        // (maxAllowableTier: 'Moderate') must still block a harder dose whose systemic
        // cost would push it past what's allowed, even though 'Moderate' alone would
        // pass a looser Rest/Mobility-only check.
        const projectedCost = baseTemplate.systemicCost * baseTemplate.harderDose.doseRatio;
        const availableTime = resolveMaximumSessionMinutes(context, readiness.subjective.timeAvailable, date);
        if (!exceedsPlanCeiling(projectedCost, plan) && baseTemplate.harderDose.durationMin <= availableTime) {
            return {
                ...baseRec,
                activeDose: baseTemplate.harderDose,
                adjustment: {
                    direction: 'harder',
                    tier: 1,
                    originalTemplateId: baseTemplate.id,
                    originalTemplateTitle: baseTemplate.title,
                    adjustedDoseLabel: baseTemplate.harderDose.label,
                    rationale: `Session dose adjusted to harder variant (${baseTemplate.harderDose.label}) while preserving the core training purpose.`
                },
                envelopes
            };
        }
    }

    // Filter available candidate templates
    const allowedModalities = (['Running', 'Cycling', 'Strength', 'Field', 'Mobility', 'Cross Training', 'None'] as const)
        .filter(m => !context.preferences.avoidedModalities.map(a => a.toLowerCase()).includes(m.toLowerCase()))
        .filter(m => !safety.restrictedModalities.includes(m));

    const availableTemplates = eligibleTemplates(TEMPLATES, context, readiness.subjective.timeAvailable, date)
        .filter(t => t.id !== baseTemplate.id && allowedModalities.includes(t.modality));

    // Tier 2: Same Training Objective, Alternate Prescription Layout (Same modality, same category)
    const tier2Candidates = availableTemplates.filter(t =>
        t.modality === baseTemplate.modality && t.category === baseTemplate.category
    ).filter(t => direction === 'easier' || !exceedsPlanCeiling(t.systemicCost, plan));
    if (tier2Candidates.length > 0) {
        const picked = pickTemplate(tier2Candidates, date) || tier2Candidates[0];
        return {
            template: picked,
            rationale: `Adjusted to alternate prescription layout (${picked.title}) in ${picked.modality}.`,
            mode: baseRec.mode,
            adjustment: {
                direction,
                tier: 2,
                originalTemplateId: baseTemplate.id,
                originalTemplateTitle: baseTemplate.title,
                rationale: `Adjusted to alternate layout (${picked.title}) for same objective.`
            },
            envelopes
        };
    }

    // Tier 3: Adjacent Compatible Stimulus (Same modality, adjacent intensity category)
    const tier3Candidates = availableTemplates.filter(t => t.modality === baseTemplate.modality).filter(t => {
        if (direction === 'easier') return t.systemicCost < baseTemplate.systemicCost;
        return t.systemicCost > baseTemplate.systemicCost && !exceedsPlanCeiling(t.systemicCost, plan);
    });
    if (tier3Candidates.length > 0) {
        const picked = pickTemplate(tier3Candidates, date) || tier3Candidates[0];
        return {
            template: picked,
            rationale: `Adjusted to adjacent stimulus (${picked.title}) in ${picked.modality}.`,
            mode: baseRec.mode,
            adjustment: {
                direction,
                tier: 3,
                originalTemplateId: baseTemplate.id,
                originalTemplateTitle: baseTemplate.title,
                rationale: `Adjusted to adjacent stimulus in ${picked.modality}.`
            },
            envelopes
        };
    }

    // Tier 4: Transferable Cross-Modal Equivalent (Only if baseTemplate.objectiveTransferable !== false)
    if (baseTemplate.objectiveTransferable !== false) {
        const tier4Candidates = availableTemplates.filter(t => {
            if (t.modality === baseTemplate.modality) return false;
            if (direction === 'easier') return t.systemicCost < baseTemplate.systemicCost;
            return t.systemicCost > baseTemplate.systemicCost && !exceedsPlanCeiling(t.systemicCost, plan);
        });
        if (tier4Candidates.length > 0) {
            const picked = pickTemplate(tier4Candidates, date) || tier4Candidates[0];
            return {
                template: picked,
                rationale: `Cross-modal adjustment to ${picked.title} (${picked.modality}).`,
                mode: baseRec.mode,
                adjustment: {
                    direction,
                    tier: 4,
                    originalTemplateId: baseTemplate.id,
                    originalTemplateTitle: baseTemplate.title,
                    rationale: `Adjusted cross-modally to ${picked.title}.`
                },
                envelopes
            };
        }
    }

    // Fallback: No suitable alternative available today
    return null;
}

/** Builds the one authoritative green/yellow/red (or mandatory recovery) scenario
 * set. Evaluation is intentionally separate so sync and intent-aware callers cannot
 * drift into independently maintained decision branches. */
export function buildNextDayScenarios(
    todayReadiness: DailyReadiness,
    context: UserContext,
    todayDate: string,
    todayRec: Recommendation
): NextDayScenarioSet {
    // Context is deliberately part of the stable scenario-builder contract even
    // though the synthetic inputs themselves only inherit today's available time.
    void context;
    const tomorrowDate = addDaysToLocalDateString(todayDate, 1);

    // 1. Single Plan Override Check
    const isPainOrInjury = todayReadiness.subjective.painFlag;
    const isTodayHardSession = todayRec.template.category === 'Hard Endurance' || 
        todayRec.template.category === 'Full-body Strength' || 
        todayRec.template.category === 'Lower-body Strength' || 
        todayRec.template.category === 'Upper-body Strength';

    const recentHardSessions = todayReadiness.objective.last_3_days_hard_sessions_count || 0;
    const isCumulativeOverload = recentHardSessions >= 2 && isTodayHardSession;

    let singlePlanReason: string | undefined = undefined;
    if (isPainOrInjury) {
        singlePlanReason = "Active pain/injury reported today. Tomorrow requires dedicated recovery regardless of morning metrics.";
    } else if (isCumulativeOverload) {
        singlePlanReason = "High cumulative load (multiple hard sessions back-to-back). Tomorrow is locked to active recovery to prevent overtraining.";
    }

    if (singlePlanReason) {
        // Generate a single recovery/primer synthetic input.
        const syntheticRecoveryReadiness: DailyReadiness = {
            subjective: {
                ...todayReadiness.subjective,
                fatigue: 7,
                soreness: 7,
                readiness: 4,
                alreadyTrainedToday: false
            },
            objective: {
                ...todayReadiness.objective,
                last_3_days_hard_sessions_count: recentHardSessions + (isTodayHardSession ? 1 : 0),
                today_training: null
            }
        };

        return {
            date: tomorrowDate,
            isSinglePlan: true,
            singlePlanReason,
            scenarios: {
                green: { tier: 'green', label: 'Mandatory Recovery Plan', condition: singlePlanReason, readiness: syntheticRecoveryReadiness },
                yellow: { tier: 'yellow', label: 'Mandatory Recovery Plan', condition: singlePlanReason, readiness: { ...syntheticRecoveryReadiness, subjective: { ...syntheticRecoveryReadiness.subjective }, objective: { ...syntheticRecoveryReadiness.objective } } },
                red: { tier: 'red', label: 'Mandatory Recovery Plan', condition: singlePlanReason, readiness: { ...syntheticRecoveryReadiness, subjective: { ...syntheticRecoveryReadiness.subjective }, objective: { ...syntheticRecoveryReadiness.objective } } }
            }
        };
    }

    // 2. Multi-Branch Evaluation (Green / Yellow / Red Options)
    const updatedHardCount = recentHardSessions + (isTodayHardSession ? 1 : 0);

    // Green Scenario: Strong overnight recovery & feel
    const greenReadiness: DailyReadiness = {
        subjective: {
            readiness: 9,
            sleepQuality: 9,
            fatigue: 2,
            soreness: 2,
            stress: 2,
            motivation: 9,
            timeAvailable: todayReadiness.subjective.timeAvailable,
            painFlag: false,
            alreadyTrainedToday: false,
            // These are hypothetical "what if tomorrow looks like X" previews -- no
            // specific modality ask is assumed for any of the three branches.
            preferredModalityToday: null
        },
        objective: {
            ...todayReadiness.objective,
            sleep_score: 88,
            sleep_duration_min: 480,
            rhr_delta: 0,
            hrv_delta: 2,
            // No chronic drift assumed for a hypothetical single-day preview -- 28d
            // delta set equal to the 7d delta so the chronic strain term is neutral and
            // only the acute (today-vs-7d) reading drives the branch.
            rhr_delta_28d: 0,
            hrv_delta_28d: 2,
            sleep_score_delta_7d: 6,
            sleep_score_delta_28d: 6,
            body_battery_wake: 88,
            last_3_days_hard_sessions_count: updatedHardCount,
            today_training: null
        }
    };

    // Yellow Scenario: Moderate recovery or mild soreness
    const yellowReadiness: DailyReadiness = {
        subjective: {
            readiness: 5,
            sleepQuality: 5,
            fatigue: 6,
            soreness: 6,
            stress: 5,
            motivation: 5,
            timeAvailable: todayReadiness.subjective.timeAvailable,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null
        },
        objective: {
            ...todayReadiness.objective,
            sleep_score: 68,
            sleep_duration_min: 420,
            rhr_delta: 3,
            hrv_delta: -4,
            rhr_delta_28d: 3,
            hrv_delta_28d: -4,
            sleep_score_delta_7d: -14,
            sleep_score_delta_28d: -14,
            body_battery_wake: 62,
            last_3_days_hard_sessions_count: updatedHardCount,
            today_training: null
        }
    };

    // Red Scenario: Low recovery, high fatigue, or HRV drop
    const redReadiness: DailyReadiness = {
        subjective: {
            readiness: 2,
            sleepQuality: 3,
            fatigue: 9,
            soreness: 8,
            stress: 7,
            motivation: 3,
            timeAvailable: todayReadiness.subjective.timeAvailable,
            painFlag: false,
            alreadyTrainedToday: false,
            preferredModalityToday: null
        },
        objective: {
            ...todayReadiness.objective,
            sleep_score: 50,
            sleep_duration_min: 360,
            rhr_delta: 6,
            hrv_delta: -8,
            rhr_delta_28d: 6,
            hrv_delta_28d: -8,
            sleep_score_delta_7d: -20,
            sleep_score_delta_28d: -20,
            body_battery_wake: 42,
            last_3_days_hard_sessions_count: updatedHardCount,
            today_training: null
        }
    };

    return {
        date: tomorrowDate,
        isSinglePlan: false,
        scenarios: {
            green: {
                tier: 'green',
                label: 'Optimal Readiness',
                condition: 'If tomorrow morning HRV is baseline/elevated, sleep score > 80, and fatigue is low.',
                readiness: greenReadiness
            },
            yellow: {
                tier: 'yellow',
                label: 'Moderate Readiness',
                condition: 'If tomorrow sleep quality is average (60-75), HRV shows mild dip, or moderate soreness is present.',
                readiness: yellowReadiness
            },
            red: {
                tier: 'red',
                label: 'Low Readiness / High Fatigue',
                condition: 'If tomorrow sleep score drops (< 60), HRV drops significantly, or elevated fatigue/soreness is reported.',
                readiness: redReadiness
            }
        }
    };
}

function evaluatedBranch(scenario: NextDayScenario, recommendation: Recommendation): NextDayPlanBranch {
    return {
        tier: scenario.tier,
        label: scenario.label,
        condition: scenario.condition,
        recommendation,
    };
}

/** Synchronous compatibility API over the shared scenario set. */
export function evaluateNextDayPlan(
    todayReadiness: DailyReadiness,
    context: UserContext,
    todayDate: string,
    todayRec: Recommendation,
): NextDayPotentialPlan {
    const scenarios = buildNextDayScenarios(todayReadiness, context, todayDate, todayRec);
    const evaluate = (scenario: NextDayScenario) => evaluatedBranch(
        scenario,
        evaluateTraining(scenario.readiness, context, scenarios.date, todayRec.mode),
    );
    return {
        date: scenarios.date,
        isSinglePlan: scenarios.isSinglePlan,
        ...(scenarios.singlePlanReason ? { singlePlanReason: scenarios.singlePlanReason } : {}),
        branches: {
            green: evaluate(scenarios.scenarios.green),
            yellow: evaluate(scenarios.scenarios.yellow),
            red: evaluate(scenarios.scenarios.red),
        },
    };
}

/** Intent-aware next-day API. It evaluates each retained scenario separately so the
 * preview remains a true three-outcome contingency rather than one recommendation
 * copied into green/yellow/red. */
export async function evaluateNextDayPlanWithIntent(
    userId: string,
    events: UserEvent[],
    todayReadiness: DailyReadiness,
    context: UserContext,
    todayDate: string,
    todayRec: Recommendation,
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
): Promise<NextDayPotentialPlan> {
    const scenarios = buildNextDayScenarios(todayReadiness, context, todayDate, todayRec);
    const evaluate = async (scenario: NextDayScenario) => evaluatedBranch(
        scenario,
        await evaluateTrainingWithIntent(userId, scenario.readiness, context, events, scenarios.date, todayRec.mode, historyProvider, preparedHistorySnapshot),
    );
    const [green, yellow, red] = await Promise.all([
        evaluate(scenarios.scenarios.green),
        evaluate(scenarios.scenarios.yellow),
        evaluate(scenarios.scenarios.red),
    ]);
    return {
        date: scenarios.date,
        isSinglePlan: scenarios.isSinglePlan,
        ...(scenarios.singlePlanReason ? { singlePlanReason: scenarios.singlePlanReason } : {}),
        branches: { green, yellow, red },
    };
}

