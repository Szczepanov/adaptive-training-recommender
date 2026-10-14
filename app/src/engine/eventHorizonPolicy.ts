/**
 * Issue #928: Policy-owned event-build and specificity horizons.
 *
 * Decouples event-relative periodization and structured plan boundaries from
 * hard-coded magic constants (D-84 / D-35) into an explicit, versioned policy
 * owner.
 *
 * D-84 is the first boundary of the currently authored structured cycling plan,
 * not a physiological cut-point or an assertion that goal-directed training
 * only begins at D-84. Prior dates remain goal-directed while evergreen programming
 * owns executable prescription (evergreen_fallback).
 */

import type { UserEvent, AuthoredPlanBlock, EventPhaseHorizonsSpec } from './models';
import { resolveEventTaper, type ResolvedTaper } from './taperPolicy';

export const EVENT_HORIZON_POLICY_VERSION = '2026-10-event-horizon-policy-v1';

/** Current cycling plan policy defaults. These are named policy defaults with
 * documented semantics and provenance, not architectural constants. */
export const DEFAULT_CYCLING_FINAL_BUILD_DAYS = 84;
export const DEFAULT_CYCLING_SPECIFICITY_DAYS = 35;
export const DEFAULT_POST_EVENT_RECOVERY_DAYS = 7;
export const DEFAULT_LONG_HORIZON_AUTHORITY = 'evergreen_fallback' as const;

export type EventPhaseHorizonSource =
    | 'cycling_default'
    | 'event_authored'
    | 'plan_override'
    | 'generic_default';

export interface EventPhaseHorizonPolicy {
    policyVersion: string;
    source: EventPhaseHorizonSource;
    finalBuildStartDaysBefore: number;
    specificityStartDaysBefore: number;
    recoveryDaysAfter: number;
    longHorizonAuthority: 'evergreen_fallback';
    taper: ResolvedTaper | null;
    provenanceNote: string;
}

export interface ResolveEventPhaseHorizonOptions {
    authoredHorizons?: EventPhaseHorizonsSpec;
    authoredBlocks?: readonly AuthoredPlanBlock[];
    finalBuildStartDaysBefore?: number;
    specificityStartDaysBefore?: number;
    recoveryDaysAfter?: number;
    source?: EventPhaseHorizonSource;
}

/**
 * Resolves the phase horizon policy for an event.
 * Both evaluatePeriodizationPhase() and buildCyclingEventPlan() consume this
 * same authority to ensure phase boundaries cannot silently drift apart.
 */
export function resolveEventPhaseHorizonPolicy(
    event: UserEvent | null,
    options?: ResolveEventPhaseHorizonOptions,
): EventPhaseHorizonPolicy {
    const taper = event ? resolveEventTaper(event) : null;
    const authored = options?.authoredHorizons ?? event?.phaseHorizons;

    const explicitFinalBuild = options?.finalBuildStartDaysBefore ?? authored?.finalBuildStartDaysBefore;
    const explicitSpecificity = options?.specificityStartDaysBefore ?? authored?.specificityStartDaysBefore;
    const explicitRecovery = options?.recoveryDaysAfter ?? authored?.recoveryDaysAfter;

    if (
        explicitFinalBuild !== undefined
        || explicitSpecificity !== undefined
        || explicitRecovery !== undefined
        || options?.source
    ) {
        const finalBuild = explicitFinalBuild ?? DEFAULT_CYCLING_FINAL_BUILD_DAYS;
        const requestedSpecificity = explicitSpecificity ?? DEFAULT_CYCLING_SPECIFICITY_DAYS;
        // Specificity must strictly precede final build start so block_build (which ends at specificity + 1)
        // never produces an inverted date range.
        const specificity = Math.min(requestedSpecificity, Math.max(0, finalBuild - 1));
        const recovery = explicitRecovery ?? DEFAULT_POST_EVENT_RECOVERY_DAYS;
        const source = options?.source ?? 'event_authored';
        return {
            policyVersion: EVENT_HORIZON_POLICY_VERSION,
            source,
            finalBuildStartDaysBefore: finalBuild,
            specificityStartDaysBefore: specificity,
            recoveryDaysAfter: recovery,
            longHorizonAuthority: DEFAULT_LONG_HORIZON_AUTHORITY,
            taper,
            provenanceNote: `${source === 'plan_override' ? 'Plan override' : 'Authored horizon override'}: final build starts D-${finalBuild}, specificity starts D-${specificity}, recovery extends D+${recovery}.`,
        };
    }

    if (event && event.category === 'cycling_event') {
        return {
            policyVersion: EVENT_HORIZON_POLICY_VERSION,
            source: 'cycling_default',
            finalBuildStartDaysBefore: DEFAULT_CYCLING_FINAL_BUILD_DAYS,
            specificityStartDaysBefore: DEFAULT_CYCLING_SPECIFICITY_DAYS,
            recoveryDaysAfter: DEFAULT_POST_EVENT_RECOVERY_DAYS,
            longHorizonAuthority: DEFAULT_LONG_HORIZON_AUTHORITY,
            taper,
            provenanceNote: `Current generated cycling policy starts final build at D-${DEFAULT_CYCLING_FINAL_BUILD_DAYS} and specificity at D-${DEFAULT_CYCLING_SPECIFICITY_DAYS}. Prior dates retain event context while evergreen owns executable programming.`,
        };
    }

    return {
        policyVersion: EVENT_HORIZON_POLICY_VERSION,
        source: 'generic_default',
        finalBuildStartDaysBefore: DEFAULT_CYCLING_FINAL_BUILD_DAYS,
        specificityStartDaysBefore: DEFAULT_CYCLING_SPECIFICITY_DAYS,
        recoveryDaysAfter: DEFAULT_POST_EVENT_RECOVERY_DAYS,
        longHorizonAuthority: DEFAULT_LONG_HORIZON_AUTHORITY,
        taper,
        provenanceNote: 'Generic periodization phase horizons default.',
    };
}
