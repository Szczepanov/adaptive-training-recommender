import {
    getHrUseAuthority,
    type HrUseAuthority,
    type HrUseCase,
} from './activityHrFidelity';
import type { NormalizedGarminActivity } from './models';

export type GarminHrDependentField =
    | 'activityTrainingLoad'
    | 'trainingEffectAerobic'
    | 'trainingEffectAnaerobic';

/**
 * Shadow-only classification for Garmin/Firstbeat vendor metrics that depend on HR/EPOC.
 *
 * These fields are deliberately kept separate from `completedTraining.ts`: HRF6 records
 * what future authority would permit without altering the current evidence tier,
 * intensity inference, or completion path. Power/pace may contribute to some vendor
 * metrics (notably anaerobic Training Effect), but that does not make them independent
 * corroboration of the activity HR lineage.
 */
export interface GarminHrDependentAuthority {
    field: GarminHrDependentField;
    lineage: 'vendor_hr_dependent';
    independentCorroboration: false;
    authority: HrUseAuthority;
}

export type GarminTrainingLoadAuthority = GarminHrDependentAuthority & {
    field: 'activityTrainingLoad';
};

const USE_CASE_BY_FIELD: Record<GarminHrDependentField, HrUseCase> = {
    activityTrainingLoad: 'TRAINING_LOAD',
    trainingEffectAerobic: 'TRAINING_EFFECT',
    trainingEffectAnaerobic: 'TRAINING_EFFECT',
};

export function getGarminHrDependentAuthority(
    activity: NormalizedGarminActivity,
    field: GarminHrDependentField,
): GarminHrDependentAuthority {
    return {
        field,
        lineage: 'vendor_hr_dependent',
        independentCorroboration: false,
        authority: getHrUseAuthority(activity, USE_CASE_BY_FIELD[field], {
            // The app has not reconciled these separately supplied Garmin summaries to
            // the exact HR trace assessed by HRF0-HRF5, so fail closed even for a clean
            // high-confidence trace.
            inputLineageVerified: false,
        }),
    };
}

export function getGarminTrainingLoadAuthority(
    activity: NormalizedGarminActivity,
): GarminTrainingLoadAuthority {
    return getGarminHrDependentAuthority(activity, 'activityTrainingLoad') as GarminTrainingLoadAuthority;
}

export function getGarminTrainingEffectAuthority(
    activity: NormalizedGarminActivity,
    field: 'trainingEffectAerobic' | 'trainingEffectAnaerobic',
): GarminHrDependentAuthority {
    return getGarminHrDependentAuthority(activity, field);
}
