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
import {
    modalitiesForEventCategory,
    objectivesFromDemand,
    TAPER_SHARPENING_QUALIFICATION,
    TAPER_SHARPENING_TARGET_STIMULUS,
    TAPER_SHARPENING_TITLE,
    TAPER_STRENGTH_PRIMER_TITLE,
    TAPER_STRENGTH_TARGET_STIMULUS,
    type PhaseWeights,
} from './periodization';

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
        // An authored travel overlay intentionally overlaps the derived block beneath it.
        // `buildCyclingEventPlan` puts overlays first, so selecting only the first active
        // block makes the explicit user contract authoritative for both dose *and* weekly
        // objectives. Keeping every overlapping block here would quietly retain peak work
        // during travel even though resolvePlannedDoseForDate correctly used travel dose.
        const activeBlock = planDefinition.blocks
            .find((block) => block.startDate <= asOfDate && asOfDate <= block.endDate);
        const activeBlockIds = new Set(activeBlock ? [activeBlock.id] : []);

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
                    title = isTaperBlock ? TAPER_STRENGTH_PRIMER_TITLE : 'Strength & Neuromuscular Maintenance';
                    targetStimulus = isTaperBlock ? TAPER_STRENGTH_TARGET_STIMULUS : { maxStrength: 0.7, hypertrophy: 0.5 };
                    break;
                case 'strength_development':
                    title = 'Strength Development';
                    targetStimulus = { maxStrength: 0.7, hypertrophy: 0.7 };
                    break;
                case 'race_specific_endurance':
                    if (isTaperBlock) {
                        title = TAPER_SHARPENING_TITLE;
                        targetStimulus = TAPER_SHARPENING_TARGET_STIMULUS;
                        qualification = TAPER_SHARPENING_QUALIFICATION;
                    } else {
                        const demand = focusEvent?.demandProfile;
                        if (demand && demand.fatigueResistance >= 0.8 && demand.aerobicEndurance >= 0.8 && (demand.repeatedSurges ?? 0) < 0.6) {
                            title = 'Cycling Aerobic Durability & Tempo';
                            targetStimulus = { aerobicEndurance: 0.9, fatigueResistance: 0.85, thresholdPower: 0.6 };
                            qualification = {
                                minimumStimulus: { aerobicEndurance: 0.6 },
                                allowedModalities: ['Cycling'],
                                allowedCategories: ['Race-Specific Endurance'],
                            };
                        } else {
                            title = 'Cycling Race-Specific Endurance';
                            targetStimulus = { aerobicEndurance: 0.6, repeatedSurges: 0.6 };
                            qualification = {
                                minimumStimulus: { aerobicEndurance: 0.6 },
                                allowedModalities: ['Cycling'],
                                allowedCategories: ['Race-Specific Endurance'],
                            };
                        }
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

    // Phase 5.6: this translation (demand vector + category + taper state -> objective
    // set) is now shared with resolveMultiEventObjectives (periodization.ts), which
    // reuses it unchanged for each contributor event's OWN demand vector -- never a
    // blended one. This call is the taper authority's own objectives, identical
    // behavior to before the extraction.
    const allowedModalities = focusEvent ? modalitiesForEventCategory(focusEvent.category) : [];
    const objectives = objectivesFromDemand(
        phaseWeights.targetDemandVector,
        focusEvent?.category,
        phaseWeights.taperActive,
        phaseWeights.phaseName === 'Post-Event Recovery',
        allowedModalities
    );

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
        } else if ((obj.key === 'strength_maintenance' || obj.key === 'strength_development') && (actType.includes('strength') || actType.includes('weight') || actType.includes('lifting'))) {
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
