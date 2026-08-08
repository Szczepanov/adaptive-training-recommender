import type {
    DeliveredDose,
    FixedActivity,
    MicrocycleState,
    ObjectiveQualification,
    SessionTemplate,
    TrainingRecord,
    UserEvent,
    WeeklyObjective,
    WorkoutStimulusProfile,
} from './models';
import type { CompletedExposure } from './microcycleHistory';
import type { PlanDefinition } from './planSchedule';
import { modalitiesForEventCategory, type PhaseWeights } from './periodization';

/**
 * Phase 5.7: taper as an explicit contract, not an emergent side effect.
 *
 * Before this, a taper day either silently dropped the race_specific_endurance objective
 * entirely (the generic path's `!phaseWeights.taperActive` guard) or -- if reached via the
 * full-volume qualification below -- demanded a bar (`aerobicEndurance >= 0.6`) that a
 * genuine taper session structurally cannot and should not clear. Either way, "preserve
 * useful intensity and event-specific freshness" during taper was never itself
 * represented; it only ever emerged from `volumeScale`/`phaseEligibility.requiresTaper`
 * interactions with whatever survived. These two constants give it a name and a real,
 * reachable target -- calibrated against `end_taper_sharpen_01`'s own (deliberately
 * lower) stimulus profile in templates.ts, matching event-plan.ts's `taper_sharpening`
 * coverage role, rather than the peak-block `end_race_sim_01`/`end_event_specific_01`
 * bar `race_specific_endurance` uses everywhere else.
 */
const TAPER_SHARPENING_TARGET_STIMULUS: WeeklyObjective['targetStimulus'] = { thresholdPower: 0.5, repeatedSurges: 0.4 };
const TAPER_SHARPENING_QUALIFICATION: ObjectiveQualification = {
    minimumStimulus: { thresholdPower: 0.3 },
    allowedModalities: ['Cycling'],
    allowedCategories: ['Race-Specific Endurance'],
};

/** Same rationale as TAPER_SHARPENING_TARGET_STIMULUS above, for event-plan.ts's
 *  `race_week_strength` role: a taper day's strength_maintenance objective should pull
 *  toward a short, low-volume primer (strength_race_week_primer_01's own intent) rather
 *  than the same full-volume target every other phase uses. */
const TAPER_STRENGTH_TARGET_STIMULUS: WeeklyObjective['targetStimulus'] = { maxStrength: 0.3, hypertrophy: 0.2 };

export function generateWeeklyObjectives(
    phaseWeights: PhaseWeights,
    windowStartDate: string,
    focusEvent: UserEvent | null,
    planDefinition?: PlanDefinition | null,
    /** Reference date used to select which PlanBlock is "current" for the plan-derived
     *  branch below -- defaults to windowStartDate so existing callers that only pass 4
     *  args keep working, but a caller building a forward-looking microcycle (e.g.
     *  trainingIntent.ts, where windowStartDate is a lookback boundary rather than
     *  today) should pass today's date explicitly. */
    asOfDate: string = windowStartDate
): MicrocycleState {
    if (planDefinition && planDefinition.objectives.length > 0) {
        const objectives: WeeklyObjective[] = [];
        const blockMap = new Map(planDefinition.blocks.map((b) => [b.id, b]));
        const activeBlockIds = new Set(
            planDefinition.blocks
                .filter((b) => b.startDate <= asOfDate && asOfDate <= b.endDate)
                .map((b) => b.id)
        );

        planDefinition.objectives
            .filter((objDef) => activeBlockIds.has(objDef.blockId))
            .forEach((objDef, idx) => {
            const block = blockMap.get(objDef.blockId);
            const windowStart = block?.startDate;
            const windowEnd = block?.endDate;

            let title = 'Plan Objective';
            let targetStimulus: WeeklyObjective['targetStimulus'] = { aerobicEndurance: 0.5 };
            let qualification: WeeklyObjective['qualification'] = undefined;
            const allowedModalities = focusEvent ? modalitiesForEventCategory(focusEvent.category) : [];
            // Phase 5.7: a block's own declared phase -- not just its objective key --
            // decides whether race_specific_endurance/strength_maintenance mean the
            // full-volume peak-block target or the taper_sharpening/race_week_strength
            // primer-level one. See TAPER_SHARPENING_TARGET_STIMULUS above.
            const isTaperBlock = block?.phase === 'taper';

            switch (objDef.key) {
                case 'zone2_aerobic':
                    title = 'Aerobic Base (Zone 2)';
                    targetStimulus = { aerobicEndurance: 0.8 };
                    break;
                case 'threshold_quality':
                    title = 'Threshold Development';
                    targetStimulus = { thresholdPower: 0.9 };
                    qualification = {
                        minimumStimulus: { thresholdPower: 0.6 },
                        ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
                    };
                    break;
                case 'surge_repeatability':
                    title = 'Surge & High-Intensity Repeatability';
                    targetStimulus = { repeatedSurges: 0.9, aerobicEndurance: 0.5 };
                    qualification = {
                        minimumStimulus: { repeatedSurges: 0.6 },
                        ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
                    };
                    break;
                case 'strength_maintenance':
                    title = isTaperBlock ? 'Race-Week Strength Primer' : 'Strength & Neuromuscular Maintenance';
                    targetStimulus = isTaperBlock ? TAPER_STRENGTH_TARGET_STIMULUS : { maxStrength: 0.7, hypertrophy: 0.5 };
                    break;
                case 'race_specific_endurance':
                    if (isTaperBlock) {
                        title = 'Taper Sharpening (event-specific freshness)';
                        targetStimulus = TAPER_SHARPENING_TARGET_STIMULUS;
                        qualification = TAPER_SHARPENING_QUALIFICATION;
                    } else {
                        title = 'Cycling Race-Specific Endurance';
                        targetStimulus = { aerobicEndurance: 0.6, repeatedSurges: 0.6 };
                        qualification = {
                            minimumStimulus: { aerobicEndurance: 0.6 },
                            allowedModalities: ['Cycling'],
                            allowedCategories: ['Race-Specific Endurance'],
                        };
                    }
                    break;
                case 'vo2_max':
                    title = 'VO2 Max Intervals';
                    targetStimulus = { vo2MaxPower: 0.9, aerobicEndurance: 0.5 };
                    break;
                default: {
                    const _exhaustive: never = objDef.key;
                    void _exhaustive;
                }
            }

            objectives.push({
                id: `obj_plan_${objDef.key}_${idx}`,
                key: objDef.key,
                title,
                requiredCredit: objDef.requiredCredit,
                targetExposures: objDef.requiredCredit || 1,
                completedExposures: 0,
                targetStimulus,
                priority: objDef.priority,
                qualification,
                windowStart,
                windowEnd,
            });
        });

        return { windowStartDate, objectives };
    }

    const demand = phaseWeights.targetDemandVector;
    const objectives: WeeklyObjective[] = [];

    if (demand.aerobicEndurance >= 0.4) {
        objectives.push({
            id: 'obj_z2_aerobic', key: 'zone2_aerobic', title: 'Aerobic Base (Zone 2)',
            targetExposures: demand.aerobicEndurance >= 0.7 ? 2 : 1,
            completedExposures: 0,
            targetStimulus: { aerobicEndurance: 0.8 },
        });
    }

    if (demand.thresholdPower >= 0.5 && !phaseWeights.taperActive) {
        const allowedModalities = focusEvent ? modalitiesForEventCategory(focusEvent.category) : [];
        objectives.push({
            id: 'obj_threshold', key: 'threshold_quality', title: 'Threshold Development',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { thresholdPower: 0.9 },
            qualification: {
                minimumStimulus: { thresholdPower: 0.6 },
                ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
            },
        });
    }

    if ((demand.vo2MaxPower >= 0.6 || demand.repeatedSurges >= 0.6) && phaseWeights.phaseName !== 'Post-Event Recovery') {
        const allowedModalities = focusEvent ? modalitiesForEventCategory(focusEvent.category) : [];
        objectives.push({
            id: 'obj_surges', key: 'surge_repeatability', title: 'Surge & High-Intensity Repeatability',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { repeatedSurges: 0.9, aerobicEndurance: 0.5 },
            qualification: {
                minimumStimulus: { repeatedSurges: 0.6 },
                ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
            },
        });
    }

    objectives.push({
        id: 'obj_strength', key: 'strength_maintenance',
        title: phaseWeights.taperActive ? 'Race-Week Strength Primer' : 'Strength & Neuromuscular Maintenance',
        targetExposures: 1, completedExposures: 0,
        // Phase 5.7: event-plan.ts's race_week_strength role -- a taper day still
        // maintains strength, just at primer volume, not full-volume as if nothing changed.
        targetStimulus: phaseWeights.taperActive ? TAPER_STRENGTH_TARGET_STIMULUS : { maxStrength: 0.7, hypertrophy: 0.5 },
    });

    if (focusEvent?.category === 'cycling_event' && phaseWeights.phaseName !== 'Post-Event Recovery') {
        if (!phaseWeights.taperActive && (demand.fatigueResistance >= 0.7 || demand.repeatedSurges >= 0.6)) {
            objectives.push({
                id: 'obj_cycling_race_specific', key: 'race_specific_endurance', title: 'Cycling Race-Specific Endurance',
                targetExposures: 1, completedExposures: 0,
                targetStimulus: { aerobicEndurance: 0.6, repeatedSurges: 0.6 },
                qualification: {
                    minimumStimulus: { aerobicEndurance: 0.6 },
                    allowedModalities: ['Cycling'],
                    allowedCategories: ['Race-Specific Endurance'],
                },
            });
        } else if (phaseWeights.taperActive) {
            // Phase 5.7: previously this branch was silently skipped for the entire
            // taper window -- see TAPER_SHARPENING_TARGET_STIMULUS above for why.
            objectives.push({
                id: 'obj_taper_sharpening', key: 'race_specific_endurance', title: 'Taper Sharpening (event-specific freshness)',
                targetExposures: 1, completedExposures: 0,
                targetStimulus: TAPER_SHARPENING_TARGET_STIMULUS,
                qualification: TAPER_SHARPENING_QUALIFICATION,
            });
        }
    }

    return { windowStartDate, objectives };
}

import { deriveObjectiveCreditFromProfile, readStimulusProfile, type StimulusConfidence } from './stimulus';

/** Keyword-only evidence is deliberately worth less than a structured measured exposure.
 * It remains useful for old/external records, but cannot resolve a one-credit objective by
 * itself. Most importantly, it updates the SAME authoritative ledger as V2 structured
 * evidence, making structured->legacy and legacy->structured replay order-independent. */
export const LEGACY_KEYWORD_COMPATIBILITY_CREDIT = 0.5;
export const COMPATIBILITY_CREDIT_PER_EXPOSURE = LEGACY_KEYWORD_COMPATIBILITY_CREDIT;

/** One compatibility projection for both completed and forecast ledgers. Fractional V2
 * credit remains authoritative; this only preserves the legacy exposure display shape. */
export function projectCompatibilityExposures(credit: number, targetExposures: number): number {
    if (!Number.isFinite(credit) || credit <= 0 || targetExposures <= 0) return 0;
    return Math.min(targetExposures, Math.floor(credit / COMPATIBILITY_CREDIT_PER_EXPOSURE));
}

/**
 * DEPRECATED: Keyword matching on free text descriptions.
 * Retained strictly as a documented last-resort fallback for legacy/external training records.
 */
export function updateMicrocycleProgress(
    currentMicrocycle: MicrocycleState,
    activity: TrainingRecord | FixedActivity
): MicrocycleState {
    const updatedObjectives = currentMicrocycle.objectives.map(obj => {
        let matched = false;
        const actType = ('type' in activity ? activity.type : activity.title).toLowerCase();

        if (obj.key === 'threshold_quality' && (actType.includes('threshold') || actType.includes('hard') || actType.includes('tempo'))) {
            matched = true;
        } else if (obj.key === 'surge_repeatability' && (actType.includes('surge') || actType.includes('vo2') || actType.includes('football') || actType.includes('field') || actType.includes('hiit') || actType.includes('race-specific') || actType.includes('race sim'))) {
            matched = true;
        } else if (obj.key === 'zone2_aerobic' && (actType.includes('easy') || actType.includes('endurance') || actType.includes('zone 2') || actType.includes('running') || actType.includes('cycling'))) {
            matched = true;
        } else if (obj.key === 'strength_maintenance' && (actType.includes('strength') || actType.includes('weight') || actType.includes('lifting'))) {
            matched = true;
        }

        if (matched) {
            const requiredCredit = obj.requiredCredit ?? obj.targetExposures;
            const completedCredit = obj.completedCredit ?? obj.completedExposures;
            const nextCredit = Math.min(requiredCredit, completedCredit + LEGACY_KEYWORD_COMPATIBILITY_CREDIT);
            return {
                ...obj,
                completedCredit: nextCredit,
                completedExposures: projectCompatibilityExposures(nextCredit, obj.targetExposures),
            };
        }
        return obj;
    });

    return { ...currentMicrocycle, objectives: updatedObjectives };
}

export function getUnresolvedObjectives(
    microcycle: MicrocycleState,
    includeProjectedCredit: boolean = false,
): WeeklyObjective[] {
    if (!microcycle || !microcycle.objectives) return [];
    return microcycle.objectives.filter(objective => {
        const requiredCredit = objective.requiredCredit ?? objective.targetExposures;
        const completedCredit = objective.completedCredit ?? objective.completedExposures;
        const projectedCredit = includeProjectedCredit ? (objective.projectedCredit ?? 0) : 0;
        return completedCredit + projectedCredit < requiredCredit;
    });
}

/** Fraction (0-1) of an objective's target stimulus vector a workout's own stimulus
 *  profile actually satisfies, weighted by how strongly the objective demands each axis. */
export function stimulusCoverage(
    stimulus: WorkoutStimulusProfile,
    targetStimulus: WeeklyObjective['targetStimulus']
): number {
    let weightedSum = 0;
    let weightTotal = 0;
    (Object.entries(targetStimulus) as [keyof WorkoutStimulusProfile, number][]).forEach(([key, target]) => {
        if (!target) return;
        weightTotal += target;
        weightedSum += target * (stimulus[key] ?? 0);
    });
    return weightTotal === 0 ? 0 : weightedSum / weightTotal;
}

export const STIMULUS_CREDIT_COVERAGE_THRESHOLD = 0.6;

export function qualifiesForObjective(
    stimulus: WorkoutStimulusProfile,
    modality: SessionTemplate['modality'],
    qualification: ObjectiveQualification | undefined,
    category?: SessionTemplate['category'],
): boolean {
    const allowedModalities = qualification?.allowedModalities;
    if (allowedModalities && allowedModalities.length > 0 && !allowedModalities.includes(modality)) return false;
    const allowedCategories = qualification?.allowedCategories;
    if (allowedCategories && allowedCategories.length > 0 && (!category || !allowedCategories.includes(category))) return false;

    return Object.entries(qualification?.minimumStimulus ?? {}).every(([axis, minimum]) =>
        (stimulus[axis as keyof WorkoutStimulusProfile] ?? 0) >= minimum
    );
}

/**
 * Credits weekly objectives from a workout's numeric stimulus profile. The profile is
 * validated/canonicalized once at the exposure boundary, then reused for every objective;
 * this avoids duplicate migration warnings for the same persisted record.
 *
 * `modality` is now optional (Phase 5.5): a generic/unclassified exposure can still
 * carry a genuine stimulus profile (see completedTraining.ts's genericModalityFallback
 * tier) and credit a modality-agnostic objective, while deriveObjectiveCreditFromProfile
 * fails closed on any objective that actually requires a known modality.
 *
 * `confidence` (Phase 5.5) discounts earned credit for anything short of an exact match
 * -- see stimulus.ts CONFIDENCE_CREDIT_WEIGHT. Defaults to 'exact' so a caller supplying
 * only authored/hypothetical data (e.g. planner.ts scoring a candidate template) is
 * unaffected.
 */
export function creditObjectivesFromStimulus(
    microcycle: MicrocycleState,
    rawStimulus: WorkoutStimulusProfile,
    modality: SessionTemplate['modality'] | undefined,
    category?: SessionTemplate['category'],
    dose: DeliveredDose = {},
    confidence: StimulusConfidence = 'exact',
): MicrocycleState {
    if (!microcycle || !microcycle.objectives) return microcycle;
    const stimulusState = readStimulusProfile(rawStimulus);
    if (stimulusState.status !== 'AVAILABLE') return microcycle;
    const stimulus = stimulusState.data;

    return {
        ...microcycle,
        objectives: microcycle.objectives.map(obj => {
            const requiredCredit = obj.requiredCredit ?? obj.targetExposures;
            const completedCredit = obj.completedCredit ?? obj.completedExposures;
            if (completedCredit >= requiredCredit) return obj;
            const credit = deriveObjectiveCreditFromProfile(obj, stimulus, dose, { modality, category }, confidence);
            if (!credit.qualifies || credit.earnedCredit <= 0) return obj;
            const nextCredit = Math.min(requiredCredit, completedCredit + credit.earnedCredit);
            return {
                ...obj,
                completedCredit: nextCredit,
                completedExposures: projectCompatibilityExposures(nextCredit, obj.targetExposures),
            };
        }),
    };
}

/** Seeds the rolling microcycle from completed, ordered exposures before projecting
 * the next recommendation. */
export function buildMicrocycleState(
    phase: PhaseWeights,
    windowStartDate: string,
    history: CompletedExposure[],
    focusEvent: UserEvent | null,
    planDefinition?: PlanDefinition | null,
    asOfDate?: string
): MicrocycleState {
    return history.reduce((state, exposure) => {
        // Phase 5.5: a stimulus profile no longer requires a known modality to be
        // creditable -- see creditObjectivesFromStimulus's doc comment. An exposure with
        // neither (e.g. legacy free-text-only evidence) still falls back to the
        // deprecated keyword matcher below.
        if (exposure.stimulusProfile) {
            return creditObjectivesFromStimulus(
                state,
                exposure.stimulusProfile,
                exposure.modality,
                exposure.category,
                exposure.deliveredDose,
                exposure.stimulusConfidence ?? 'exact',
            );
        }
        return updateMicrocycleProgress(state, exposure.trainingRecordLike);
    }, generateWeeklyObjectives(phase, windowStartDate, focusEvent, planDefinition, asOfDate));
}
