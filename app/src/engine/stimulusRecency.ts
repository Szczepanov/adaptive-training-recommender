/**
 * Performed stimulus-domain recency policy (Issue #931).
 *
 * Derives and consumes canonical performed stimulus-domain recency in sequencing decisions:
 * - Quality families ('tempo', 'threshold', 'vo2', 'race'): when confident quality was performed
 *   on D-1, candidate templates of the same quality family receive a 0.2 preference multiplier
 *   (STIMULUS_REPETITION_PENALTY) unless an explicit nominated anchor requires it
 *   (fulfilsNominatedAnchor === true).
 * - Zone 2 aerobic endurance ('endurance') is exempt from repetition penalties, admitting
 *   consecutive endurance sessions without degradation.
 * - When both exact template repetition (usedYesterday) and stimulus-family repetition apply,
 *   min(templateMultiplier, stimulusMultiplier) is applied so penalties never compound to 0.04.
 * - Exact weekly-role coverage remains strictly exact-identity under ADR-0016.
 */
import type { ActivityStimulusDomain, SessionTemplate } from './models';
import type { PerformedExposureFact } from './performedTrainingFacts';
import type { StrengthExposureLike } from './strengthSpacingPolicy';
import { addDaysToLocalDateString } from '../utils/localDate';

export type StimulusRecencyFamily =
    | 'endurance'
    | 'tempo'
    | 'threshold'
    | 'vo2'
    | 'race'
    | 'strength';

export const STIMULUS_REPETITION_PENALTY = 0.2;
export const STIMULUS_REPETITION_LOOKBACK_DAYS = 1;
export const QUALITY_RECENCY_FAMILIES = ['tempo', 'threshold', 'vo2', 'race'] as const;
export type QualityRecencyFamily = typeof QUALITY_RECENCY_FAMILIES[number];

export function isQualityFamily(family: string | null | undefined): family is QualityRecencyFamily {
    return family !== null && family !== undefined && (QUALITY_RECENCY_FAMILIES as readonly string[]).includes(family);
}

/**
 * Maps an ActivityStimulusDomain to a high-level StimulusRecencyFamily or recovery.
 * Provider-specific domains (mixed, anaerobic, race) are consolidated under 'race'.
 * Unknown or unclassified domains return null.
 */
export function stimulusFamilyFromDomain(
    domain: ActivityStimulusDomain | undefined | null,
): StimulusRecencyFamily | 'recovery' | null {
    if (!domain || domain === 'unknown') return null;
    switch (domain) {
        case 'endurance':
            return 'endurance';
        case 'tempo':
            return 'tempo';
        case 'threshold':
            return 'threshold';
        case 'vo2':
            return 'vo2';
        case 'anaerobic':
        case 'mixed':
        case 'race':
            return 'race';
        case 'strength':
            return 'strength';
        case 'recovery':
            return 'recovery';
        default:
            return null;
    }
}

/**
 * Authored stimulus family mapping for catalog workouts.
 * Sprint, plyometric, and technical-skill workouts map to explicit null because their
 * spacing is governed by mechanical/strength/power policies rather than quality recency.
 */
export const WORKOUT_STIMULUS_FAMILY: Readonly<Record<string, StimulusRecencyFamily | 'recovery' | null>> = {
    cycling_recovery_spin_01: 'recovery',
    cycling_zone2_standard_01: 'endurance',
    cycling_controlled_threshold_4x8_01: 'threshold',
    cycling_over_under_3x12_01: 'threshold',
    cycling_short_surges_10x20_01: 'race',
    cycling_criterium_surges_01: 'race',
    cycling_race_simulation_50_01: 'race',
    cycling_event_specific_endurance_01: 'race',
    cycling_gap_closing_01: 'vo2',
    running_walk_run_01: 'endurance',
    running_easy_continuous_01: 'endurance',
    walking_brisk_continuous_01: 'endurance',
    strength_full_body_maintenance_01: 'strength',
    strength_compact_power_01: null,
    strength_reactive_power_01: null,
    strength_low_load_trunk_01: 'strength',
    strength_full_body_reentry_01: 'strength',
    strength_bodyweight_full_body_01: 'strength',
    strength_lower_body_01: 'strength',
    strength_upper_body_trunk_01: null,
    strength_cable_upper_01: null,
    cross_training_bodyweight_circuit_01: 'endurance',
    travel_aerobic_maintenance_01: 'endurance',
    travel_strength_maintenance_01: 'strength',
    field_controlled_maintenance_01: null,
    field_sprint_mechanics_foundation_01: null,
    field_acceleration_braking_01: null,
    cycling_pedalling_economy_01: null,
    cycling_cornering_braking_skill_01: null,
    running_tempo_01: 'tempo',
    running_vo2_4x4_01: 'vo2',
    running_hill_repeats_01: 'vo2',
    cycling_tempo_surges_01: 'tempo',
    cycling_vo2_6x3_01: 'vo2',
    cycling_vo2_variable_01: 'vo2',
    cycling_vo2_short_30_15_01: 'vo2',
    swimming_technique_01: null,
    swimming_easy_aerobic_01: 'endurance',
    swimming_threshold_intervals_01: 'threshold',
    running_long_run_01: 'endurance',
    running_race_pace_01: 'threshold',
    running_taper_sharpening_01: 'race',
    strength_conventional_deadlift_practice_01: 'strength',
    cycling_sprint_power_5s_01: null,
    recovery_mobility_tissue_01: 'recovery',
    recovery_breathwork_01: 'recovery',
    cycling_taper_sharpening_01: 'race',
    cycling_pre_race_openers_01: 'race',
    strength_race_week_primer_01: null,
    cycling_race_day_01: 'race',
    rest_complete_01: 'recovery',
};

/**
 * Authored stimulus family mapping for engine session templates.
 */
export const TEMPLATE_STIMULUS_FAMILY: Readonly<Record<string, StimulusRecencyFamily | 'recovery' | null>> = {
    cycling_technical_01: null,
    field_technical_01: null,
    field_technical_02: null,
    rest_01: 'recovery',
    mob_01: 'recovery',
    mob_02: 'recovery',
    mob_travel_flow_01: 'recovery',
    end_easy_01: 'endurance',
    end_easy_04: 'endurance',
    end_easy_02: 'endurance',
    end_walk_01: 'endurance',
    end_easy_03: 'endurance',
    end_mod_01: 'tempo',
    end_mod_02: 'tempo',
    str_upper_01: 'strength',
    str_upper_pull_01: 'strength',
    str_upper_02: 'strength',
    str_lower_01: 'strength',
    str_power_01: null,
    field_maint_01: null,
    str_full_01: 'strength',
    str_full_03: 'strength',
    str_low_load_maint_01: 'strength',
    str_full_02: 'strength',
    end_hard_01: 'vo2',
    end_hard_02: 'threshold',
    end_hard_03: 'vo2',
    swim_technique_01: null,
    swim_easy_01: 'endurance',
    swim_threshold_01: 'threshold',
    run_long_01: 'endurance',
    run_race_pace_01: 'threshold',
    run_taper_sharpen_01: 'race',
    end_race_specific_01: 'race',
    end_crit_surges_01: 'race',
    end_race_sim_01: 'race',
    end_taper_sharpen_01: 'race',
    end_pre_race_openers_01: 'race',
    end_easy_05: 'endurance',
};

/**
 * Classify a candidate SessionTemplate into its authored stimulus family.
 */
export function classifyCandidateStimulusFamily(
    template: SessionTemplate,
): StimulusRecencyFamily | 'recovery' | null {
    if (template.id in TEMPLATE_STIMULUS_FAMILY) {
        return TEMPLATE_STIMULUS_FAMILY[template.id];
    }
    return null;
}

/**
 * Classify a catalog workoutId into its authored stimulus family.
 */
export function classifyWorkoutStimulusFamily(
    workoutId: string,
): StimulusRecencyFamily | 'recovery' | null {
    if (workoutId in WORKOUT_STIMULUS_FAMILY) {
        return WORKOUT_STIMULUS_FAMILY[workoutId];
    }
    return null;
}

/**
 * Single authority determining whether a performed exposure is confident for stimulus recency:
 * - Structured execution -> confident (true)
 * - Provider activity -> confident ONLY IF intensityClassificationVersion >= 2 AND stimulusDomain is known
 *   (and not suppressed by athlete override)
 * - Legacy / unversioned / fallback -> not confident (false)
 */
export function isConfidentStimulusExposure(
    exposure: PerformedExposureFact | StrengthExposureLike,
): boolean {
    if (!('sourceKinds' in exposure) || !Array.isArray(exposure.sourceKinds)) {
        return false;
    }
    if (exposure.sourceKinds.includes('structured_execution')) {
        // sourceKinds records attached canonical refs, not whether the structured source
        // actually hydrated. Do not let an unavailable structured execution promote a
        // weaker provider fallback to "structured" confidence.
        return exposure.evidenceTier === 'completedStructuredWorkout'
            && exposure.stimulusDomain !== undefined
            && exposure.stimulusDomain !== 'unknown';
    }
    if (exposure.sourceKinds.includes('provider_activity')) {
        const version = exposure.intensityClassificationVersion ?? 0;
        const domain = exposure.stimulusDomain;
        return version >= 2 && domain !== undefined && domain !== 'unknown';
    }
    return false;
}

export interface PerformedStimulusRecency {
    targetDate: string;
    yesterdayDate: string;
    evaluatedExposuresCount: number;
    yesterdayQualityFamilies: Set<QualityRecencyFamily>;
    hasConfidentEnduranceYesterday: boolean;
    exposures: StimulusRecencyExposureTrace[];
}

export type StimulusRecencyExposureTrace = Pick<PerformedExposureFact,
    'performedOccurrenceId' | 'localDate' | 'stimulusDomain' | 'confidence' | 'sourceKinds'
    | 'evidenceTier' | 'intensityEvidence' | 'intensityClassificationVersion'> & {
    confident: boolean;
    structuredOverridesProvider: boolean;
};

export interface StimulusRecencyDecisionTrace {
    targetDate: string;
    yesterdayDate: string;
    evaluatedExposuresCount: number;
    yesterdayQualityFamilies: QualityRecencyFamily[];
    hasConfidentEnduranceYesterday: boolean;
    exposures: StimulusRecencyExposureTrace[];
    overridesDegraded?: boolean;
}

export interface CandidateStimulusRecencyTrace {
    candidateFamily: StimulusRecencyFamily | 'recovery' | null;
    isQualityRepetition: boolean;
    penaltyApplied: boolean;
    anchorWaived: boolean;
    enduranceExemptionApplied: boolean;
}

export interface CandidateStimulusRecencyEvaluation {
    stimulusMultiplier: number;
    trace: CandidateStimulusRecencyTrace;
    rationaleNote?: string;
}

const TRACE_DECISION_FAMILY_ORDER = ['endurance', ...QUALITY_RECENCY_FAMILIES] as const;
const MAX_STIMULUS_RECENCY_TRACE_EXPOSURES = 16;

function boundedStimulusRecencyEvidence(
    evidence: readonly StimulusRecencyExposureTrace[],
): StimulusRecencyExposureTrace[] {
    const sorted = [...evidence].sort((a, b) => a.performedOccurrenceId.localeCompare(b.performedOccurrenceId));
    const representatives: StimulusRecencyExposureTrace[] = [];
    const representedOccurrenceIds = new Set<string>();

    // Preserve the evidence that can actually change recency decisions before filling the
    // bounded diagnostic with unrelated D-1 rows. Otherwise 16 lexicographically earlier
    // low-confidence occurrences could hide the tempo/VO2/endurance fact that changed rank.
    for (const family of TRACE_DECISION_FAMILY_ORDER) {
        const representative = sorted.find(row =>
            row.confident && stimulusFamilyFromDomain(row.stimulusDomain) === family,
        );
        if (!representative) continue;
        representatives.push(representative);
        representedOccurrenceIds.add(representative.performedOccurrenceId);
    }

    const remaining = sorted.filter(row => !representedOccurrenceIds.has(row.performedOccurrenceId));
    return [...representatives, ...remaining].slice(0, MAX_STIMULUS_RECENCY_TRACE_EXPOSURES);
}

/**
 * Builds the stimulus recency state for the planning date from canonical performed exposures.
 */
export function buildPerformedStimulusRecency(
    exposures: readonly (PerformedExposureFact | StrengthExposureLike)[],
    targetDate: string,
): PerformedStimulusRecency {
    const yesterdayDate = addDaysToLocalDateString(targetDate, -STIMULUS_REPETITION_LOOKBACK_DAYS);
    const yesterdayQualityFamilies = new Set<QualityRecencyFamily>();
    let hasConfidentEnduranceYesterday = false;
    let evaluatedExposuresCount = 0;
    const evidence: StimulusRecencyExposureTrace[] = [];

    for (const exp of exposures) {
        const expDate = 'localDate' in exp && exp.localDate ? exp.localDate : ('date' in exp ? exp.date : undefined);
        if (expDate !== yesterdayDate) continue;

        evaluatedExposuresCount++;
        const confident = isConfidentStimulusExposure(exp);
        if ('sourceKinds' in exp) {
            evidence.push({
                performedOccurrenceId: exp.performedOccurrenceId,
                localDate: exp.localDate,
                confidence: exp.confidence,
                sourceKinds: [...exp.sourceKinds],
                evidenceTier: exp.evidenceTier,
                ...(exp.stimulusDomain !== undefined ? { stimulusDomain: exp.stimulusDomain } : {}),
                ...(exp.intensityEvidence !== undefined ? { intensityEvidence: exp.intensityEvidence } : {}),
                ...(exp.intensityClassificationVersion !== undefined ? { intensityClassificationVersion: exp.intensityClassificationVersion } : {}),
                confident,
                structuredOverridesProvider: exp.evidenceTier === 'completedStructuredWorkout'
                    && exp.sourceKinds.includes('structured_execution')
                    && exp.sourceKinds.includes('provider_activity'),
            });
        }
        if (!confident) continue;

        const domain = 'stimulusDomain' in exp ? exp.stimulusDomain : undefined;
        const family = stimulusFamilyFromDomain(domain);

        if (family === 'endurance') {
            hasConfidentEnduranceYesterday = true;
        } else if (isQualityFamily(family)) {
            yesterdayQualityFamilies.add(family);
        }
    }

    return {
        targetDate,
        yesterdayDate,
        evaluatedExposuresCount,
        yesterdayQualityFamilies,
        hasConfidentEnduranceYesterday,
        exposures: boundedStimulusRecencyEvidence(evidence),
    };
}

/**
 * Evaluates candidate template against stimulus recency state.
 */
export function evaluateCandidateStimulusRecency(
    template: SessionTemplate,
    recency: PerformedStimulusRecency,
    fulfilsNominatedAnchor: boolean,
): CandidateStimulusRecencyEvaluation {
    const candidateFamily = classifyCandidateStimulusFamily(template);

    // 1. Quality repetition check
    if (isQualityFamily(candidateFamily) && recency.yesterdayQualityFamilies.has(candidateFamily)) {
        if (fulfilsNominatedAnchor) {
            return {
                stimulusMultiplier: 1.0,
                trace: {
                    candidateFamily,
                    isQualityRepetition: true,
                    penaltyApplied: false,
                    anchorWaived: true,
                    enduranceExemptionApplied: false,
                },
                rationaleNote: `[Stimulus recency] Quality family '${candidateFamily}' repetition waived: candidate fulfils nominated anchor.`,
            };
        }
        return {
            stimulusMultiplier: STIMULUS_REPETITION_PENALTY,
            trace: {
                candidateFamily,
                isQualityRepetition: true,
                penaltyApplied: true,
                anchorWaived: false,
                enduranceExemptionApplied: false,
            },
            rationaleNote: `[Stimulus recency] Quality family '${candidateFamily}' repetition from D-1 (penalty ${STIMULUS_REPETITION_PENALTY}x).`,
        };
    }

    // 2. Zone 2 aerobic endurance exemption
    if (candidateFamily === 'endurance' && recency.hasConfidentEnduranceYesterday) {
        return {
            stimulusMultiplier: 1.0,
            trace: {
                candidateFamily,
                isQualityRepetition: false,
                penaltyApplied: false,
                anchorWaived: false,
                enduranceExemptionApplied: true,
            },
            rationaleNote: `[Stimulus recency] Consecutive Zone 2 endurance admitted without repetition penalty.`,
        };
    }

    // 3. Normal / unpenalized candidate
    return {
        stimulusMultiplier: 1.0,
        trace: {
            candidateFamily,
            isQualityRepetition: false,
            penaltyApplied: false,
            anchorWaived: false,
            enduranceExemptionApplied: false,
        },
    };
}
