import type { DailyReadiness, UserContext, Recommendation, SessionTemplate, NextDayPotentialPlan, NextDayPlanBranch, DecisionScoreTelemetry } from './models';
import { TEMPLATES } from './templates';

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

export function evaluateTraining(
    readiness: DailyReadiness,
    context: UserContext,
    date: string,
    /** Yesterday's *final* mode (post-hysteresis), if known -- e.g. from the previous
     *  day's persisted DailyRecommendation.mode. Optional and stateless by default: a
     *  caller with no history (or evaluating a hypothetical scenario, see
     *  evaluateNextDayPlan's single-plan-override branch) simply omits it and gets the
     *  same behavior as before hysteresis existed. See POST_RECOVER_BUFFER below for
     *  the one rule that uses it. */
    previousMode?: 'train' | 'modify' | 'recover'
): Recommendation {
    const { subjective, objective } = readiness;

    // 1. Subjective fatigue scoring (10 = worst fatigue)
    const invertedMotivation = 10 - subjective.motivation;
    const invertedSleepQual = 10 - subjective.sleepQuality;
    const invertedReadiness = 10 - subjective.readiness;

    // Core subjective penalty calculation
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

    // Absolute safety net: a genuinely wrecked night still matters even if it doesn't
    // read as unusual relative to this person's own (possibly already-low) baseline.
    let sleepFloorPenalty = 0;
    if (objective.sleep_score !== null && objective.sleep_score < SLEEP_SCORE_ABSOLUTE_FLOOR) {
        sleepFloorPenalty = SLEEP_SCORE_ABSOLUTE_FLOOR_STRAIN;
    }

    // Body Battery: smooth ramp rather than a step function at 50.
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

    // Prevent overtraining if you've done too many hard sessions recently
    const recentHardSessionsCount = objective.last_3_days_hard_sessions_count || 0;
    let recentHardSessionsPenalty = 0;
    if (recentHardSessionsCount >= 2) {
        recentHardSessionsPenalty = RECENT_HARD_SESSIONS_STRAIN; // 2+ hard sessions in 3 days warrants caution
    }

    const objectiveStrain = totalMetricStrain + sleepFloorPenalty + bodyBatteryDeficit + conservativeBias + recentHardSessionsPenalty;

    // 3. Determine Core Mode Hierarchy (Train vs Modify vs Recover)
    let mode: 'train' | 'modify' | 'recover' = 'train';

    const fatigueTriggeredRecover = overallFatigueScore > 7 || extremeFatigue || objectiveStrain >= STRAIN_RECOVER_THRESHOLD;
    if (fatigueTriggeredRecover) {
        mode = 'recover';
    } else if (overallFatigueScore > 5 || subjective.soreness > 6 || objectiveStrain >= STRAIN_MODIFY_THRESHOLD) {
        mode = 'modify'; // Cap systemic load -- see MODIFY_MAX_SYSTEMIC_COST, not a flat demotion to endurance-only
    }

    // Causal decision-relevance check: did multiDayDrift alter the final mode outcome?
    const strainWithoutDrift = objectiveStrain - totalMultiDayDrift;
    const counterfactualRecover = overallFatigueScore > 7 || extremeFatigue || strainWithoutDrift >= STRAIN_RECOVER_THRESHOLD;
    const counterfactualModify = counterfactualRecover || overallFatigueScore > 5 || subjective.soreness > 6 || strainWithoutDrift >= STRAIN_MODIFY_THRESHOLD;
    const counterfactualModeWithoutDrift = counterfactualRecover ? 'recover' : (counterfactualModify ? 'modify' : 'train');
    const multiDayDriftIsDecisionRelevant = (mode !== 'train') && (mode !== counterfactualModeWithoutDrift);

    // 3a-hysteresis. Post-recover buffer: a single morning's numbers looking fully
    // green the day right after a mandated recovery day doesn't mean tissues are fully
    // back -- standard coaching practice eases back in rather than jumping straight
    // from rest to a hard day. Only softens a fresh 'train' read down one notch to
    // 'modify'; never overrides today's own fatigue/pain signal (fatigueTriggeredRecover
    // already stands on its own above) and never applies without real history (an
    // omitted previousMode -- e.g. a stateless hypothetical preview -- leaves this
    // inert, matching pre-hysteresis behavior).
    const postRecoverBufferApplied = mode === 'train' && previousMode === 'recover';
    if (postRecoverBufferApplied) {
        mode = 'modify';
    }

    // 3b. Already-trained-today override: takes precedence over everything above.
    // A user-reported or Garmin-synced same-day session means no further training should
    // be prescribed today, regardless of how fresh the readiness numbers otherwise look.
    const alreadyTrainedOverride = subjective.alreadyTrainedToday === true || objective.today_training !== null;
    if (alreadyTrainedOverride) {
        mode = 'recover';
    }

    // 4. Time available override
    const availableTime = Math.min(context.constraints.maxTimeMinutes, subjective.timeAvailable);

    // 5. Filter templates by constraints
    const availableTemplates = TEMPLATES.filter(t => {
        if (t.durationMin > availableTime) return false;

        for (const req of t.requiredEquipment) {
            if (req === 'treadmill' && !context.constraints.hasTreadmill) return false;
            if (req === 'indoor_bike' && !context.constraints.hasIndoorBike) return false;
            if (req === 'free_weights' && !context.constraints.hasFreeWeights) return false;
            if (req === 'cable_machine' && !context.constraints.hasCableMachine) return false;
        }
        // Avoided modalities are a hard exclude, same standing as an equipment gate --
        // unlike deprioritized (soft) or preferred (soft), see rankByModalityPreference.
        if (context.preferences.avoidedModalities.some(m => modalityMatches(t.modality, m))) return false;
        return true;
    });

    // 6. Select Template Based on Mode & Constraints
    let selectedTemplate = availableTemplates.find(t => t.category === 'Rest') || TEMPLATES[1]; // fallback
    let rationale = "";

    let modalityNote: string | null = null;

    if (mode === 'recover') {
        const recoverOptions = availableTemplates.filter(t => t.category === 'Rest' || t.category === 'Mobility/Recovery');
        // Recover's ceiling is safety-motivated -- search and fallback pool are the same
        // restricted set, so an explicit ask can't push above it.
        const preferenceResult = applyModalityPreference(recoverOptions, recoverOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        const rankedRecoverOptions = rankByModalityPreference(
            preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities
        );
        // pickTemplate only returns undefined for an empty array, already excluded by the guard.
        if (rankedRecoverOptions.length > 0) selectedTemplate = pickTemplate(rankedRecoverOptions, date)!;

        if (alreadyTrainedOverride) {
            const loggedSession = objective.today_training;
            const sessionDescription = loggedSession
                ? `Garmin shows you already completed a ${loggedSession.type} session today (~${loggedSession.duration_min} min).`
                : "You've already logged a training session today.";

            if (fatigueTriggeredRecover) {
                // Fatigue/pain independently pushed mode to 'recover' -- don't let the
                // already-trained message crowd out that safety-relevant context.
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
        // Cap by systemic cost, not by category -- a low-cost, muscle-local session
        // (upper-body strength) is a legitimate option here even though the broader
        // category was excluded before. See MODIFY_MAX_SYSTEMIC_COST.
        const modifyOptions = availableTemplates.filter(t => t.category !== 'Rest' && t.systemicCost <= MODIFY_MAX_SYSTEMIC_COST);
        // Modify's cost ceiling is safety-motivated too -- same restricted set for both
        // search and fallback (an ask for something above the ceiling isn't honored).
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
        // 'Moderate Endurance' (Zone-3 tempo) belongs here, not in 'modify' -- it's
        // explicitly a comfortably-hard, full-intensity option, which would contradict
        // modify mode's "capping intensity" rationale above.
        const trainOptions = availableTemplates.filter(t => t.category === 'Hard Endurance' || t.category === 'Moderate Endurance' || t.category === 'Full-body Strength' || t.category === 'Upper-body Strength' || t.category === 'Lower-body Strength');
        // No ceiling to protect on a 'train' day -- an explicit ask for something gentler
        // (e.g. mobility) than train mode would normally offer is fine to honor, so the
        // search pool is every constraint-eligible template, not just trainOptions.
        const preferenceResult = applyModalityPreference(availableTemplates, trainOptions, subjective.preferredModalityToday);
        modalityNote = preferenceResult.note;
        const rankedTrainOptions = rankByModalityPreference(
            preferenceResult.options, context.preferences.preferredModalities, context.preferences.deprioritizedModalities
        );
        if (rankedTrainOptions.length > 0) selectedTemplate = pickTemplate(rankedTrainOptions, date)!;

        // An honored preference can land outside train mode's usual categories (e.g. an
        // explicit ask for mobility on an otherwise green-light day) -- say so rather
        // than claiming a "hard session" rationale for what's actually an easy one.
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

    // Add previous day context if available and relevant
    if (objective.yesterday_training && objective.yesterday_training.duration_min && mode === 'modify') {
        rationale += ` Giving your body a break after yesterday's ${objective.yesterday_training.type} session.`;
    }

    // Fallback safety
    if (!selectedTemplate) {
        selectedTemplate = TEMPLATES[0];
        rationale += " (Defaulted to Rest/Mobility due to severe time/equipment constraints).";
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

    return {
        template: selectedTemplate,
        rationale,
        mode,
        telemetry
    };
}

/**
 * Calculates tomorrow's YYYY-MM-DD date string based on a given date.
 */
function getTomorrowDateString(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Evaluates next-day potential training plans (Green / Yellow / Red contingencies or a Single Plan override).
 */
export function evaluateNextDayPlan(
    todayReadiness: DailyReadiness,
    context: UserContext,
    todayDate: string,
    todayRec: Recommendation
): NextDayPotentialPlan {
    const tomorrowDate = getTomorrowDateString(todayDate);

    // 1. Single Plan Override Check
    const isPainOrInjury = todayReadiness.subjective.painFlag;
    const isTodayHardSession = todayRec.template.category === 'Hard Endurance' || 
        todayRec.template.category === 'Full-body Strength' || 
        todayRec.template.category === 'Lower-body Strength' || 
        todayRec.template.category === 'Upper-body Strength';

    const recentHardSessions = todayReadiness.objective.last_3_days_hard_sessions_count || 0;
    const isCumulativeOverload = recentHardSessions >= 2 && isTodayHardSession;

    // Check goals for explicit taper / pre-big-day preparation
    const goalText = (context.goals.shortTerm + ' ' + context.goals.midTerm + ' ' + context.goals.longTerm).toLowerCase();
    const isPreKeyDayTaper = goalText.includes('taper') || goalText.includes('pre-race') || goalText.includes('recovery prior to big');

    let singlePlanReason: string | undefined = undefined;
    if (isPainOrInjury) {
        singlePlanReason = "Active pain/injury reported today. Tomorrow requires dedicated recovery regardless of morning metrics.";
    } else if (isCumulativeOverload) {
        singlePlanReason = "High cumulative load (multiple hard sessions back-to-back). Tomorrow is locked to active recovery to prevent overtraining.";
    } else if (isPreKeyDayTaper) {
        singlePlanReason = "Pre-key event taper protocol: mandatory recovery day to preserve fresh legs for your upcoming big event/workout.";
    }

    if (singlePlanReason) {
        // Generate a single recovery/primer recommendation
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

        const singleRec = evaluateTraining(syntheticRecoveryReadiness, context, tomorrowDate, todayRec.mode);
        const singleBranch: NextDayPlanBranch = {
            tier: 'green',
            label: 'Mandatory Plan',
            condition: singlePlanReason,
            recommendation: singleRec
        };

        return {
            date: tomorrowDate,
            isSinglePlan: true,
            singlePlanReason,
            branches: {
                green: { ...singleBranch, tier: 'green', label: 'Mandatory Recovery Plan' },
                yellow: { ...singleBranch, tier: 'yellow', label: 'Mandatory Recovery Plan' },
                red: { ...singleBranch, tier: 'red', label: 'Mandatory Recovery Plan' }
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

    // Tomorrow's hysteresis reference point is today's actual (post-hysteresis) mode --
    // e.g. if today was itself a mandated recovery day, even the "Green/Optimal" preview
    // for tomorrow correctly eases in rather than promising a hard session outright.
    const greenRec = evaluateTraining(greenReadiness, context, tomorrowDate, todayRec.mode);
    const yellowRec = evaluateTraining(yellowReadiness, context, tomorrowDate, todayRec.mode);
    const redRec = evaluateTraining(redReadiness, context, tomorrowDate, todayRec.mode);

    return {
        date: tomorrowDate,
        isSinglePlan: false,
        branches: {
            green: {
                tier: 'green',
                label: 'Optimal Readiness',
                condition: 'If tomorrow morning HRV is baseline/elevated, sleep score > 80, and fatigue is low.',
                recommendation: greenRec
            },
            yellow: {
                tier: 'yellow',
                label: 'Moderate Readiness',
                condition: 'If tomorrow sleep quality is average (60-75), HRV shows mild dip, or moderate soreness is present.',
                recommendation: yellowRec
            },
            red: {
                tier: 'red',
                label: 'Low Readiness / High Fatigue',
                condition: 'If tomorrow sleep score drops (< 60), HRV drops significantly, or elevated fatigue/soreness is reported.',
                recommendation: redRec
            }
        }
    };
}

