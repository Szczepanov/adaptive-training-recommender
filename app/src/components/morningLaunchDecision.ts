import type { SessionReferenceBinding } from '../sessions/models';
import type { WorkoutPrescription } from '../workouts';

/**
 * What the morning card's Start/Resume/Redo affordance launches (morning-decision-ux.md §4).
 *
 * - `adjusted`: an athlete adjustment is applied and the card displays a catalog prescription
 *   for it; author that displayed prescription and launch the returned binding.
 * - `primary`: no athlete adjustment; launch the stored `primarySession` binding.
 * - `withheld`: an athlete adjustment is applied but there is no displayable prescription
 *   for it, while the stored binding would otherwise be launchable. That binding is the
 *   unadjusted session (an authored `manual` definition, an imported `external_plan`
 *   session, or a catalog snapshot), so launching it would run something other than what
 *   the card shows. Fail closed: no launch, and the card explains why.
 * - `none`: nothing is launchable (no binding, no handler, clinical pause, or a binding the
 *   external verdict already excludes, which the verdict banner explains).
 */
export type MorningLaunchDecision =
    | { kind: 'adjusted'; prescription: WorkoutPrescription }
    | { kind: 'primary'; binding: SessionReferenceBinding }
    | { kind: 'withheld'; binding: SessionReferenceBinding }
    | { kind: 'none' };

export interface MorningLaunchInputs {
    canLaunch: boolean;
    hasAthleteAdjustment: boolean;
    prescription: WorkoutPrescription | undefined;
    primarySession: SessionReferenceBinding | undefined;
    /** `skip`/`defer`: nothing from the imported session, nor any catalog swap, starts today. */
    isExternalExcluded: boolean;
    /** The external verdict alone already makes the stored binding unlaunchable. */
    isExternalPrimaryBindingUnavailable: boolean;
}

export function resolveMorningLaunch(inputs: MorningLaunchInputs): MorningLaunchDecision {
    const {
        canLaunch, hasAthleteAdjustment, prescription, primarySession,
        isExternalExcluded, isExternalPrimaryBindingUnavailable,
    } = inputs;
    if (!canLaunch) return { kind: 'none' };
    if (hasAthleteAdjustment && prescription && !isExternalExcluded) {
        return { kind: 'adjusted', prescription };
    }
    if (!primarySession || isExternalPrimaryBindingUnavailable) return { kind: 'none' };
    return hasAthleteAdjustment
        ? { kind: 'withheld', binding: primarySession }
        : { kind: 'primary', binding: primarySession };
}

/** The launch affordance a `withheld` decision removed: Start, Resume, or Redo. */
export type WithheldLaunchAction = 'start' | 'resume' | 'redo';

const ACTION_LABEL: Record<WithheldLaunchAction, string> = { start: 'Start', resume: 'Resume', redo: 'Redo' };

export interface WithheldLaunchCopy {
    title: string;
    text: string;
}

/** Athlete-facing explanation for a `withheld` launch, named by the binding's source. */
export function withheldLaunchExplanation(
    binding: SessionReferenceBinding,
    action: WithheldLaunchAction,
): WithheldLaunchCopy {
    const reset = `Reset to the original session to ${action} it.`;
    // An adjusted `external_plan` binding never reaches `withheld` from the card: the
    // verdict path marks it unavailable first and ExternalVerdictBanner explains it.
    const reason = binding.sessionSource.kind === 'manual'
        ? 'Your own session can only run exactly as written, and it has no version that matches the adjustment shown here.'
        : 'This adjustment did not produce a version of today’s session that the app can run.';
    return {
        title: `${ACTION_LABEL[action]} is unavailable while this adjustment is applied`,
        text: `${reason} ${reset}`,
    };
}
