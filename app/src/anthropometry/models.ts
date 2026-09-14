/**
 * Models and types for athlete-authored home anthropometry and longitudinal body composition.
 *
 * Owned by ADR-0039. Kept strictly isolated from `app/src/engine/` decision authority.
 */

export const ANTHROPOMETRY_PROTOCOL_V1 = 'home_anthropometry@1' as const;
export type AnthropometryProtocol = typeof ANTHROPOMETRY_PROTOCOL_V1;

export const ANTHROPOMETRY_METRIC_IDS = [
    'body_mass_kg',
    'waist_minimum_cm',
    'abdomen_umbilicus_cm',
    'hips_max_cm',
    'chest_nipple_line_cm',
    'upper_arm_relaxed_mid_cm',
    'forearm_max_cm',
    'thigh_mid_cm',
    'calf_max_cm',
] as const;

export type AnthropometryMetricId = (typeof ANTHROPOMETRY_METRIC_IDS)[number];

export const LIMB_METRIC_IDS: readonly AnthropometryMetricId[] = [
    'upper_arm_relaxed_mid_cm',
    'forearm_max_cm',
    'thigh_mid_cm',
    'calf_max_cm',
];

export const CORE_WEEKLY_METRIC_IDS: readonly AnthropometryMetricId[] = [
    'waist_minimum_cm',
    'abdomen_umbilicus_cm',
    'hips_max_cm',
];

export const SECONDARY_METRIC_IDS: readonly AnthropometryMetricId[] = [
    'thigh_mid_cm',
];

export const OPTIONAL_EXPANDABLE_METRIC_IDS: readonly AnthropometryMetricId[] = [
    'chest_nipple_line_cm',
    'upper_arm_relaxed_mid_cm',
    'forearm_max_cm',
    'calf_max_cm',
];

export const LATERALITY_OPTIONS = ['left', 'right', 'unspecified'] as const;
export type Laterality = (typeof LATERALITY_OPTIONS)[number];

export interface AnthropometryMeasurementItem {
    metricId: AnthropometryMetricId;
    /** Supported only on limb measurements. Left/right measurements are never merged. */
    laterality?: Laterality;
    unit: 'cm' | 'kg';
    /** Raw readings taken during the session (1 for body mass, 2-3 for circumferences). */
    readings: number[];
    /** Deterministic median summary retained for trends and review. */
    value: number;
    /** True if pair discrepancy exceeded protocol repeatability tolerance and prompted a 3rd reading. */
    repeatabilityWarning?: boolean;
}

export interface AnthropometryMeasurementContext {
    morningPostVoidPreIntake: boolean;
    trainingBeforeMeasurement: boolean;
    respiratoryState?: 'relaxed_normal_expiration' | 'other';
    posture?: 'standing_relaxed' | 'other';
    clothing?: 'minimal_or_bare_skin' | 'light_clothing' | 'other';
}

export interface AnthropometryEntry {
    id: string; // entryId
    userId: string;
    /** Europe/Warsaw logical calendar date (YYYY-MM-DD). */
    date: string;
    /** ISO 8601 UTC timestamp of observation. */
    observedAt: string;
    protocol: AnthropometryProtocol;
    context: AnthropometryMeasurementContext;
    measurements: AnthropometryMeasurementItem[];
    schemaVersion: 1;
    /** Monotonic current-record revision starting at 1, protecting from stale concurrent edits. */
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export const METRIC_DISPLAY_LABELS: Record<AnthropometryMetricId, string> = {
    body_mass_kg: 'Body mass (manual fallback)',
    waist_minimum_cm: 'Waist minimum',
    abdomen_umbilicus_cm: 'Abdomen at navel',
    hips_max_cm: 'Hips (maximum)',
    chest_nipple_line_cm: 'Chest (nipple line)',
    upper_arm_relaxed_mid_cm: 'Relaxed upper arm',
    forearm_max_cm: 'Forearm (maximum)',
    thigh_mid_cm: 'Thigh (midpoint)',
    calf_max_cm: 'Calf (maximum)',
};

export const METRIC_LANDMARK_HELP: Record<AnthropometryMetricId, string> = {
    body_mass_kg: 'Barefoot on a hard flat surface after voiding, before food or drink.',
    waist_minimum_cm: 'Narrowest point of the torso between lower rib margin and iliac crest, after a normal relaxed exhalation.',
    abdomen_umbilicus_cm: 'Directly across the midpoint of the navel (belly button), horizontal tape, relaxed exhalation.',
    hips_max_cm: 'Widest circumference around the buttocks/hips with feet together, horizontal snug tape.',
    chest_nipple_line_cm: 'Horizontal across the chest at the nipple line, relaxed posture and normal expiration.',
    upper_arm_relaxed_mid_cm: 'Midpoint between the acromion and olecranon with arm hanging relaxed at the side.',
    forearm_max_cm: 'Maximum circumference of the forearm below the elbow, arm relaxed.',
    thigh_mid_cm: 'Midpoint between the inguinal crease and superior border of the patella, weight evenly distributed.',
    calf_max_cm: 'Maximum circumference of the calf while standing with weight distributed evenly.',
};
