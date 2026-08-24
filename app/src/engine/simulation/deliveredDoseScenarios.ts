import type { CompletedExposure } from '../trainingHistory';
import type { WorkoutCostProfile, WorkoutStimulusProfile } from '../models';

export const THRESHOLD_3X17_COST_EXACT: WorkoutCostProfile = {
    systemic: 0.75,
    cardiovascular: 0.85,
    lowerBody: 0.75,
    upperBody: 0.05,
    impactTissue: 0.1,
    neuromuscular: 0.6,
};

export const THRESHOLD_3X17_STIMULUS_EXACT: WorkoutStimulusProfile = {
    aerobicEndurance: 0.7,
    thresholdPower: 0.95,
    vo2MaxPower: 0.3,
    repeatedSurges: 0.2,
    sprintPower: 0.05,
    fatigueResistance: 0.85,
    maxStrength: 0.0,
    hypertrophy: 0.0,
};

export const THRESHOLD_3X17_COST_SURGED: WorkoutCostProfile = {
    systemic: 0.90,
    cardiovascular: 0.95,
    lowerBody: 0.85,
    upperBody: 0.05,
    impactTissue: 0.15,
    neuromuscular: 0.85,
};

export const THRESHOLD_3X17_STIMULUS_SURGED: WorkoutStimulusProfile = {
    aerobicEndurance: 0.55,
    thresholdPower: 0.75,
    vo2MaxPower: 0.6,
    repeatedSurges: 0.5,
    sprintPower: 0.15,
    fatigueResistance: 0.7,
    maxStrength: 0.0,
    hypertrophy: 0.0,
};

export const THRESHOLD_3X17_COST_CURTAILED: WorkoutCostProfile = {
    systemic: 0.50,
    cardiovascular: 0.60,
    lowerBody: 0.50,
    upperBody: 0.05,
    impactTissue: 0.08,
    neuromuscular: 0.40,
};

export const THRESHOLD_3X17_STIMULUS_CURTAILED: WorkoutStimulusProfile = {
    aerobicEndurance: 0.50,
    thresholdPower: 0.65,
    vo2MaxPower: 0.2,
    repeatedSurges: 0.1,
    sprintPower: 0.0,
    fatigueResistance: 0.55,
    maxStrength: 0.0,
    hypertrophy: 0.0,
};

/**
 * Constructs synthetic delivered-dose CompletedExposure fixtures for threshold 3x17m workouts.
 */
export function makeThreshold3x17Exposure(
    date: string,
    variant: 'exact' | 'surged' | 'curtailed'
): CompletedExposure {
    switch (variant) {
        case 'exact':
            return {
                occurrenceKey: `delivered:3x17:exact:${date}`,
                date,
                templateId: 'end_threshold_01',
                category: 'Hard Endurance',
                modality: 'Cycling',
                costProfile: THRESHOLD_3X17_COST_EXACT,
                stimulusProfile: THRESHOLD_3X17_STIMULUS_EXACT,
                stimulusConfidence: 'exact',
                deliveredDose: {
                    plannedDurationMin: 75,
                    completedDurationMin: 75,
                    completionRatio: 1.0,
                },
                trainingRecordLike: {
                    type: 'Cycling Hard Endurance',
                    duration_min: 75,
                    training_effect: 4.2,
                    intensity_tag: 'Threshold',
                },
            };
        case 'surged':
            return {
                occurrenceKey: `delivered:3x17:surged:${date}`,
                date,
                templateId: 'end_threshold_01',
                category: 'Hard Endurance',
                modality: 'Cycling',
                costProfile: THRESHOLD_3X17_COST_SURGED,
                stimulusProfile: THRESHOLD_3X17_STIMULUS_SURGED,
                stimulusConfidence: 'exact',
                deliveredDose: {
                    plannedDurationMin: 75,
                    completedDurationMin: 68,
                    completionRatio: 0.9,
                },
                trainingRecordLike: {
                    type: 'Cycling Hard Endurance',
                    duration_min: 68,
                    training_effect: 4.8,
                    intensity_tag: 'Anaerobic / Surged Threshold',
                },
            };
        case 'curtailed':
            return {
                occurrenceKey: `delivered:3x17:curtailed:${date}`,
                date,
                templateId: 'end_threshold_01',
                category: 'Hard Endurance',
                modality: 'Cycling',
                costProfile: THRESHOLD_3X17_COST_CURTAILED,
                stimulusProfile: THRESHOLD_3X17_STIMULUS_CURTAILED,
                stimulusConfidence: 'exact',
                deliveredDose: {
                    plannedDurationMin: 75,
                    completedDurationMin: 50,
                    completionRatio: 0.67,
                },
                trainingRecordLike: {
                    type: 'Cycling Hard Endurance',
                    duration_min: 50,
                    training_effect: 3.2,
                    intensity_tag: 'Partial Threshold (2 of 3)',
                },
            };
    }
}
