import {
    COVERAGE_SETS,
    EVERGREEN_GENERAL_COVERAGE_SET,
    type CoverageSetDescriptor,
    type CoverageSetId,
    type PlanPhase,
} from '../workouts/event-plan';
import { workoutForTemplate } from '../workouts/prescription';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import type { CoverageState } from './coverage';
import type { SessionTemplate } from './models';

export const RECOVERY_POLICY_ID = 'policy.load_recovery.weekly_recovery_placement_v1';
export const RECOVERY_INTERVAL_DAYS = 7;
export const MAX_CONSECUTIVE_NON_RECOVERY_DAYS = 6;

export const CANONICAL_RECOVERY_WORKOUT_IDS = [
    'recovery_mobility_tissue_01',
    'recovery_breathwork_01',
    'cycling_recovery_spin_01',
    'rest_complete_01',
] as const;

export type RecoveryPlacementAuthority = 'product_policy' | 'authored_coverage';
export type RecoveryHistoricalState = 'known' | 'unknown';
export type RecoveryDeadlineReferenceKind = 'qualifying_recovery' | 'bootstrap';

export type RecoveryPlacementReason =
    | 'recovery_not_due'
    | 'recovery_due_today'
    | 'recovery_overdue'
    | 'recovery_bootstrap_reference'
    | 'recovery_satisfied_in_window'
    | 'no_authoritative_history';

export interface RecoveryPlacementState {
    policyId: string;
    asOfDate: string;
    authority: RecoveryPlacementAuthority;
    coverageSetId: CoverageSetId;
    phase: PlanPhase;
    historicalState: RecoveryHistoricalState;
    latestQualifyingRecoveryDate: string | null;
    bootstrapDate: string | null;
    referenceKind: RecoveryDeadlineReferenceKind | null;
    referenceDate: string | null;
    dueByDate: string | null;
    isOverdue: boolean;
    isDueToday: boolean;
    daysUntilDue: number | null;
    reason: RecoveryPlacementReason;
}

export interface ResolveRecoveryPlacementInput {
    asOfDate: string;
    coverageState?: CoverageState | null;
    latestQualifyingRecoveryDate?: string | null;
    bootstrapDate?: string | null;
}

export interface RecoveryAuthorityResolution {
    authority: RecoveryPlacementAuthority;
    coverageSetId: CoverageSetId;
    phase: PlanPhase;
    descriptor: CoverageSetDescriptor;
}

/**
 * Resolves whether exact recovery identity comes from active authored coverage or
 * falls back to baseline product policy (Evergreen general). Does NOT manufacture
 * fake plan or block IDs when no authored plan exists.
 */
export function resolveRecoveryAuthority(coverageState?: CoverageState | null): RecoveryAuthorityResolution {
    const hasAuthoredRecovery =
        Boolean(coverageState?.coverageSetId) &&
        Boolean(coverageState?.descriptor?.coverage.some(item => item.key === 'recovery_or_rest'));

    if (hasAuthoredRecovery && coverageState?.coverageSetId && coverageState.descriptor) {
        return {
            authority: 'authored_coverage',
            coverageSetId: coverageState.coverageSetId,
            phase: coverageState.phase ?? 'general',
            descriptor: coverageState.descriptor,
        };
    }

    return {
        authority: 'product_policy',
        coverageSetId: EVERGREEN_GENERAL_COVERAGE_SET.id,
        phase: 'general',
        descriptor: EVERGREEN_GENERAL_COVERAGE_SET,
    };
}

/**
 * Checks whether an exposure or candidate matches an exact qualifying recovery identity
 * under the resolved authority. Refuses category-only or unmapped fallback.
 * Under product_policy, uses CANONICAL_RECOVERY_WORKOUT_IDS decided by ADR-0038.
 */
export function isQualifyingRecoveryIdentity(
    identifier: { templateId?: string; workoutId?: string; id?: string } | string,
    authority: RecoveryAuthorityResolution = resolveRecoveryAuthority(null),
): boolean {
    let candidateWorkoutId: string | undefined;

    if (typeof identifier === 'string') {
        candidateWorkoutId = workoutForTemplate(identifier)?.id ?? identifier;
    } else {
        candidateWorkoutId =
            identifier.workoutId ??
            (identifier.templateId ? workoutForTemplate(identifier.templateId)?.id : undefined) ??
            (identifier.id ? workoutForTemplate(identifier.id)?.id ?? identifier.id : undefined);
    }

    if (!candidateWorkoutId) {
        return false;
    }

    if (authority.authority === 'product_policy') {
        return (CANONICAL_RECOVERY_WORKOUT_IDS as readonly string[]).includes(candidateWorkoutId);
    }

    const recoveryRole = authority.descriptor.coverage.find(item => item.key === 'recovery_or_rest');
    if (!recoveryRole) {
        return false;
    }

    // Role must be active in the current phase and include the exact canonical workout ID
    const phaseMatches = recoveryRole.phases.includes(authority.phase);
    const workoutMatches = recoveryRole.workoutIds.includes(candidateWorkoutId);

    return phaseMatches && workoutMatches;
}

/**
 * Pure ADR-0038 recovery placement state resolver. Computes local-date deadline arithmetic
 * and explicit reference semantics:
 * - Latest recovery R -> dueByDate = R + 7
 * - No known recovery + stable bootstrap B -> dueByDate = B + 7 (B is deadline reference only, never credit)
 */
export function resolveRecoveryPlacementState(input: ResolveRecoveryPlacementInput): RecoveryPlacementState {
    const { asOfDate, coverageState, latestQualifyingRecoveryDate, bootstrapDate } = input;
    const authorityRes = resolveRecoveryAuthority(coverageState);

    let historicalState: RecoveryHistoricalState = 'unknown';
    let referenceKind: RecoveryDeadlineReferenceKind | null = null;
    let referenceDate: string | null = null;
    let dueByDate: string | null = null;

    if (latestQualifyingRecoveryDate) {
        historicalState = 'known';
        referenceKind = 'qualifying_recovery';
        referenceDate = latestQualifyingRecoveryDate;
        dueByDate = addDaysToLocalDateString(referenceDate, RECOVERY_INTERVAL_DAYS);
    } else if (bootstrapDate) {
        historicalState = 'unknown';
        referenceKind = 'bootstrap';
        referenceDate = bootstrapDate;
        dueByDate = addDaysToLocalDateString(referenceDate, RECOVERY_INTERVAL_DAYS);
    }

    if (!dueByDate) {
        return {
            policyId: RECOVERY_POLICY_ID,
            asOfDate,
            authority: authorityRes.authority,
            coverageSetId: authorityRes.coverageSetId,
            phase: authorityRes.phase,
            historicalState,
            latestQualifyingRecoveryDate: latestQualifyingRecoveryDate ?? null,
            bootstrapDate: bootstrapDate ?? null,
            referenceKind: null,
            referenceDate: null,
            dueByDate: null,
            isOverdue: false,
            isDueToday: false,
            daysUntilDue: null,
            reason: 'no_authoritative_history',
        };
    }

    const daysUntilDue = getDayDiff(dueByDate, asOfDate);
    const isDueToday = asOfDate === dueByDate;
    const isOverdue = asOfDate > dueByDate;

    let reason: RecoveryPlacementReason;
    if (isOverdue) {
        reason = 'recovery_overdue';
    } else if (isDueToday) {
        reason = 'recovery_due_today';
    } else if (referenceKind === 'bootstrap') {
        reason = 'recovery_bootstrap_reference';
    } else {
        reason = 'recovery_not_due';
    }

    return {
        policyId: RECOVERY_POLICY_ID,
        asOfDate,
        authority: authorityRes.authority,
        coverageSetId: authorityRes.coverageSetId,
        phase: authorityRes.phase,
        historicalState,
        latestQualifyingRecoveryDate: latestQualifyingRecoveryDate ?? null,
        bootstrapDate: bootstrapDate ?? null,
        referenceKind,
        referenceDate,
        dueByDate,
        isOverdue,
        isDueToday,
        daysUntilDue,
        reason,
    };
}

/**
 * Computes the ADR-0038 recovery urgency tier for a candidate session:
 * - Qualifying recovery candidate on due date or overdue -> tier 1
 * - Qualifying recovery candidate with slack -> tier 2
 * - Any non-recovery candidate -> tier 3
 * Never returns tier 0 (tier 0 is strictly reserved for programming authority).
 */
export function recoveryNeedTierForCandidate(
    candidate: { id: string } | SessionTemplate,
    state: RecoveryPlacementState,
    authority?: RecoveryAuthorityResolution,
): 1 | 2 | 3 {
    const activeAuthority = authority ?? {
        authority: state.authority,
        coverageSetId: state.coverageSetId,
        phase: state.phase,
        descriptor: COVERAGE_SETS[state.coverageSetId] ?? EVERGREEN_GENERAL_COVERAGE_SET,
    };
    const qualifies = isQualifyingRecoveryIdentity(candidate.id, activeAuthority);

    if (!qualifies) {
        return 3;
    }

    if (state.isDueToday || state.isOverdue) {
        return 1;
    }

    return 2;
}

/**
 * Composes authored coverage tier with recovery placement tier.
 * Preserves tier 0 programming authority: min(0, 1) = 0.
 */
export function composeCoverageNeedTier(
    authoredTier: 0 | 1 | 2 | 3,
    recoveryPlacementTier: 1 | 2 | 3,
): 0 | 1 | 2 | 3 {
    return Math.min(authoredTier, recoveryPlacementTier) as 0 | 1 | 2 | 3;
}

/**
 * Deterministic rolling seven-date window invariant checker.
 * Excludes dates strictly before bootstrapDate (if provided).
 * Note: bootstrapDate is a deadline reference only and is never credited as recovery.
 */
export function checkRollingRecoveryInvariant(
    dates: string[],
    qualifyingRecoveryDates: Set<string>,
    bootstrapDate?: string,
): {
    compliant: boolean;
    maxConsecutiveNonRecoveryDays: number;
    violations: Array<{ windowStart: string; windowEnd: string; nonRecoveryCount: number }>;
} {
    const sortedDates = [...dates].sort();
    const evaluatedDates = bootstrapDate
        ? sortedDates.filter(date => date > bootstrapDate)
        : sortedDates;

    let maxConsecutive = 0;
    let currentConsecutive = 0;
    const violations: Array<{ windowStart: string; windowEnd: string; nonRecoveryCount: number }> = [];

    for (let i = 0; i < evaluatedDates.length; i++) {
        const date = evaluatedDates[i];
        if (qualifyingRecoveryDates.has(date)) {
            currentConsecutive = 0;
        } else {
            currentConsecutive++;
            if (currentConsecutive > maxConsecutive) {
                maxConsecutive = currentConsecutive;
            }
        }

        // Check each complete 7-date window ending at date
        if (i >= RECOVERY_INTERVAL_DAYS - 1) {
            const windowStart = evaluatedDates[i - (RECOVERY_INTERVAL_DAYS - 1)];
            const windowEnd = date;
            // Verify window is strictly 7 consecutive calendar dates
            const spanDays = getDayDiff(windowEnd, windowStart) + 1;
            if (spanDays === RECOVERY_INTERVAL_DAYS) {
                let recoveryInWindow = 0;
                for (let j = i - (RECOVERY_INTERVAL_DAYS - 1); j <= i; j++) {
                    if (qualifyingRecoveryDates.has(evaluatedDates[j])) {
                        recoveryInWindow++;
                    }
                }
                if (recoveryInWindow === 0) {
                    violations.push({
                        windowStart,
                        windowEnd,
                        nonRecoveryCount: RECOVERY_INTERVAL_DAYS,
                    });
                }
            }
        }
    }

    return {
        compliant: violations.length === 0 && maxConsecutive <= MAX_CONSECUTIVE_NON_RECOVERY_DAYS,
        maxConsecutiveNonRecoveryDays: maxConsecutive,
        violations,
    };
}
