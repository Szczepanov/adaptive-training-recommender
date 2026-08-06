import type { DailyReadiness, UserContext, Recommendation, SessionTemplate, NextDayPotentialPlan, NextDayPlanBranch } from './models';
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

export function evaluateTraining(readiness: DailyReadiness, context: UserContext, date: string): Recommendation {
    const { subjective, objective } = readiness;

    // 1. Subjective fatigue scoring (10 = worst fatigue)
    const invertedMotivation = 10 - subjective.motivation;
    const invertedSleepQual = 10 - subjective.sleepQuality;
    const invertedReadiness = 10 - subjective.readiness;

    // Core subjective penalty calculation
    const overallFatigueScore = (subjective.fatigue + subjective.soreness + invertedReadiness + invertedSleepQual + invertedMotivation) / 5;

    // 2. Objective penalty logic (analyzing deltas vs baselines)
    let objectivePenalty = 0;

    // RHR Delta: Higher RHR is bad
    if (objective.rhr_delta !== null && objective.rhr_delta > 3) {
        objectivePenalty += 1; // +3 bpm over 7d is yellow flag
    }
    if (objective.rhr_delta !== null && objective.rhr_delta > 6) {
        objectivePenalty += 1; // +6 bpm over 7d is red flag
    }

    // HRV Delta: Lower HRV is bad
    if (objective.hrv_delta !== null && objective.hrv_delta < -5) {
        objectivePenalty += 1; // Significant drop vs weekly average
    }

    // Body Battery & Sleep Thresholds
    if (objective.body_battery_wake !== null && objective.body_battery_wake < 50) {
        objectivePenalty += 1; // Poor recovery overnight
    }
    if (objective.sleep_score !== null && objective.sleep_score < 60) {
        objectivePenalty += 1;
    }

    const extremeFatigue = subjective.fatigue > 8 || subjective.soreness > 8 || subjective.painFlag;

    // 3. Determine Core Mode Hierarchy (Train vs Modify vs Recover)
    let mode: 'train' | 'modify' | 'recover' = 'train';

    // Prevent overtraining if you've done too many hard sessions recently
    const recentHardSessions = objective.last_3_days_hard_sessions_count || 0;
    if (recentHardSessions >= 2) {
        objectivePenalty += 1; // 2+ hard sessions in 3 days warrants caution
    }

    const fatigueTriggeredRecover = overallFatigueScore > 7 || extremeFatigue || objectivePenalty >= 3;
    if (fatigueTriggeredRecover) {
        mode = 'recover';
    } else if (overallFatigueScore > 5 || subjective.soreness > 6 || objectivePenalty >= 1) {
        mode = 'modify'; // Demote to Zone 2 / easier sessions
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
        return true;
    });

    // 6. Select Template Based on Mode & Constraints
    let selectedTemplate = availableTemplates.find(t => t.category === 'Rest') || TEMPLATES[1]; // fallback
    let rationale = "";

    if (mode === 'recover') {
        const recoverOptions = availableTemplates.filter(t => t.category === 'Rest' || t.category === 'Mobility/Recovery');
        // pickTemplate only returns undefined for an empty array, already excluded by the guard.
        if (recoverOptions.length > 0) selectedTemplate = pickTemplate(recoverOptions, date)!;

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
        const modifyOptions = availableTemplates.filter(t => t.category === 'Easy Endurance' || t.category === 'Mobility/Recovery');
        if (modifyOptions.length > 0) selectedTemplate = pickTemplate(modifyOptions, date)!;
        else selectedTemplate = TEMPLATES[0]; // Rest fallback

        rationale = "You're showing moderate soreness or slight downward trends in Garmin baselines. We are capping intensity today to build base capacity without taxing the CNS.";

    } else {
        // 'Moderate Endurance' (Zone-3 tempo) belongs here, not in 'modify' -- it's
        // explicitly a comfortably-hard, full-intensity option, which would contradict
        // modify mode's "capping intensity" rationale above.
        const trainOptions = availableTemplates.filter(t => t.category === 'Hard Endurance' || t.category === 'Moderate Endurance' || t.category === 'Full-body Strength' || t.category === 'Upper-body Strength' || t.category === 'Lower-body Strength');
        if (trainOptions.length > 0) selectedTemplate = pickTemplate(trainOptions, date)!;

        rationale = "Readiness is solid across both subjective feelings and Garmin baselines. Great day for a hard session aligned with your primary goals!";
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

    return {
        template: selectedTemplate,
        rationale
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

        const singleRec = evaluateTraining(syntheticRecoveryReadiness, context, tomorrowDate);
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
            alreadyTrainedToday: false
        },
        objective: {
            ...todayReadiness.objective,
            sleep_score: 88,
            sleep_duration_min: 480,
            rhr_delta: 0,
            hrv_delta: 2,
            body_battery_wake: 88,
            last_3_days_hard_sessions_count: updatedHardCount,
            today_training: null
        }
    };

    // Yellow Scenario: Moderate recovery or mild soreness
    const yellowReadiness: DailyReadiness = {
        subjective: {
            readiness: 6,
            sleepQuality: 6,
            fatigue: 5,
            soreness: 5,
            stress: 5,
            motivation: 6,
            timeAvailable: todayReadiness.subjective.timeAvailable,
            painFlag: false,
            alreadyTrainedToday: false
        },
        objective: {
            ...todayReadiness.objective,
            sleep_score: 68,
            sleep_duration_min: 420,
            rhr_delta: 3,
            hrv_delta: -4,
            body_battery_wake: 62,
            last_3_days_hard_sessions_count: updatedHardCount,
            today_training: null
        }
    };

    // Red Scenario: Low recovery, high fatigue, or HRV drop
    const redReadiness: DailyReadiness = {
        subjective: {
            readiness: 3,
            sleepQuality: 4,
            fatigue: 8,
            soreness: 7,
            stress: 7,
            motivation: 4,
            timeAvailable: todayReadiness.subjective.timeAvailable,
            painFlag: false,
            alreadyTrainedToday: false
        },
        objective: {
            ...todayReadiness.objective,
            sleep_score: 50,
            sleep_duration_min: 360,
            rhr_delta: 6,
            hrv_delta: -8,
            body_battery_wake: 42,
            last_3_days_hard_sessions_count: updatedHardCount,
            today_training: null
        }
    };

    const greenRec = evaluateTraining(greenReadiness, context, tomorrowDate);
    const yellowRec = evaluateTraining(yellowReadiness, context, tomorrowDate);
    const redRec = evaluateTraining(redReadiness, context, tomorrowDate);

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

