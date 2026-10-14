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

import type { UserEvent, EventPhaseHorizonsSpec } from './models';
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
    eventId?: string;
    finalBuildStartDaysBefore: number;
    specificityStartDaysBefore: number;
    recoveryDaysAfter: number;
    longHorizonAuthority: typeof DEFAULT_LONG_HORIZON_AUTHORITY;
    taper: ResolvedTaper | null;
    provenanceNote: string;
}

export interface ResolveEventPhaseHorizonOptions {
    authoredHorizons?: EventPhaseHorizonsSpec;
    finalBuildStartDaysBefore?: number;
    specificityStartDaysBefore?: number;
    recoveryDaysAfter?: number;
    source?: EventPhaseHorizonSource;
}

function isValidHorizonInt(val: number | undefined): val is number {
    return val !== undefined && Number.isInteger(val) && Number.isFinite(val);
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

    const hasExplicitOverride = explicitFinalBuild !== undefined
        || explicitSpecificity !== undefined
        || explicitRecovery !== undefined;

    if (hasExplicitOverride || options?.source) {
        const taperDuration = taper?.durationDays ?? 0;

        // Specificity must be at least taper duration, default 35
        const rawSpecificity = isValidHorizonInt(explicitSpecificity)
            ? explicitSpecificity
            : DEFAULT_CYCLING_SPECIFICITY_DAYS;
        const specificity = Math.max(taperDuration, rawSpecificity);

        // Final build must be a positive integer, default 84, and strictly exceed specificity
        let finalBuild = isValidHorizonInt(explicitFinalBuild) && explicitFinalBuild > 0
            ? explicitFinalBuild
            : DEFAULT_CYCLING_FINAL_BUILD_DAYS;

        if (finalBuild <= specificity) {
            if (explicitSpecificity !== undefined && explicitFinalBuild === undefined) {
                // When only specificity was increased beyond default build
                finalBuild = specificity + 1;
            } else if (explicitFinalBuild !== undefined && explicitFinalBuild <= taperDuration) {
                // When finalBuild is too small even for taper duration
                finalBuild = specificity + 1;
            } else {
                // Clamping specificity to stay below finalBuild
                // (handled below)
            }
        }

        const clampedSpecificity = Math.max(taperDuration, Math.min(specificity, finalBuild - 1));
        const resolvedFinalBuild = Math.max(finalBuild, clampedSpecificity + 1);

        // Recovery days must be at least 1, default 7
        const recovery = isValidHorizonInt(explicitRecovery) && explicitRecovery >= 1
            ? explicitRecovery
            : DEFAULT_POST_EVENT_RECOVERY_DAYS;

        const source = options?.source ?? (hasExplicitOverride ? 'event_authored' : 'cycling_default');

        const provenanceNote = hasExplicitOverride
            ? `${source === 'plan_override' ? 'Plan override' : 'Authored horizon override'}: final build starts D-${resolvedFinalBuild}, specificity starts D-${clampedSpecificity}, recovery extends D+${recovery}.`
            : `Policy source ${source}: final build starts D-${resolvedFinalBuild}, specificity starts D-${clampedSpecificity}.`;

        return {
            policyVersion: EVENT_HORIZON_POLICY_VERSION,
            source,
            ...(event ? { eventId: event.id } : {}),
            finalBuildStartDaysBefore: resolvedFinalBuild,
            specificityStartDaysBefore: clampedSpecificity,
            recoveryDaysAfter: recovery,
            longHorizonAuthority: DEFAULT_LONG_HORIZON_AUTHORITY,
            taper,
            provenanceNote,
        };
    }

    if (event && event.category === 'cycling_event') {
        return {
            policyVersion: EVENT_HORIZON_POLICY_VERSION,
            source: 'cycling_default',
            eventId: event.id,
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
        ...(event ? { eventId: event.id } : {}),
        finalBuildStartDaysBefore: DEFAULT_CYCLING_FINAL_BUILD_DAYS,
        specificityStartDaysBefore: DEFAULT_CYCLING_SPECIFICITY_DAYS,
        recoveryDaysAfter: DEFAULT_POST_EVENT_RECOVERY_DAYS,
        longHorizonAuthority: DEFAULT_LONG_HORIZON_AUTHORITY,
        taper,
        provenanceNote: 'Generic periodization phase horizons default.',
    };
}
