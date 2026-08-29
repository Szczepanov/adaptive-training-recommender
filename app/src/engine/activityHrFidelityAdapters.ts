import { getHrUseAuthority, type HrUseAuthority } from './activityHrFidelity';
import type { NormalizedGarminActivity } from './models';

/**
 * Shadow-only classification for Garmin's EPOC/heart-rate-dependent Training Load.
 * It is deliberately separate from `completedTraining.ts`: HRF6 records what future
 * authority would permit without altering the current evidence tier or completion path.
 */
export interface GarminTrainingLoadAuthority {
    field: 'activityTrainingLoad';
    lineage: 'vendor_hr_dependent';
    independentCorroboration: false;
    authority: HrUseAuthority;
}

export function getGarminTrainingLoadAuthority(
    activity: NormalizedGarminActivity,
): GarminTrainingLoadAuthority {
    return {
        field: 'activityTrainingLoad',
        lineage: 'vendor_hr_dependent',
        independentCorroboration: false,
        authority: getHrUseAuthority(activity, 'TRAINING_LOAD', {
            inputLineageVerified: false,
        }),
    };
}
