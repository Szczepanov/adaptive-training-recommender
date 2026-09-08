import {
    COVERAGE_SETS,
    EVERGREEN_GENERAL_COVERAGE_SET,
    EVERGREEN_RECOVERY_WORKOUT_IDS,
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

/**
 * Public ADR-0038 identity set. The Evergreen recovery descriptor owns the baseline
 * product-policy mapping; this alias keeps consumers/tests on the same source of truth.
 */
export const CANONICAL_RECOVERY_WORKOUT_IDS = EVERGREEN_RECOVERY_WORKOUT_IDS;

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
 * Resolves whether exact recovery identity comes from an active authored recovery
 * requirement or falls back to baseline product policy (Evergreen general). Merely
 * carrying a descriptor that contains `recovery_or_rest` is not enough: the role must be
 * active in the current phase and represented by the current authored requirements.
 * Does NOT manufacture fake plan or block IDs when no authored recovery authority exists.
 */
export function resolveRecoveryAuthority(coverageState?: CoverageState | null): RecoveryAuthorityResolution {
    const coverageSetId = coverageState?.coverageSetId ?? null;
    const descriptor = coverageState?.descriptor ?? null;
    const phase = coverageState?.phase ?? null;
    const hasActiveRecoveryRequirement = coverageState?.requirements.some(
        requirement => requirement.key === 'recovery_or_rest',
    ) ?? false;
    const recoveryRoleActiveInPhase = Boolean(
        phase && descriptor?.coverage.some(
            item => item.key === 'recovery_or_rest' && item.phases.includes(phase),
        ),
    );

    if (coverageSetId && descriptor && phase && hasActiveRecoveryRequirement && recoveryRoleActiveInPhase) {
        return {
            authority: 'authored_coverage',
            coverageSetId,
            phase,
            descriptor,
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
 * under the resolved authority. Refuses category-only or unmapped fallback. Product policy
 * is descriptor-driven through `EVERGREEN_GENERAL_COVERAGE_SET`, so the descriptor cannot
 * silently drift away from the exported canonical identity set.
 */
export function isQualifyingRecoveryIdentity(
    identifier: { templateId?: string; workoutId?: string; id?: string } | string,
    authority: RecoveryAuthorityResolution = resolveRecoveryAuthority(null),
): boolean {
    const recoveryRole = authority.descriptor.coverage.find(item => item.key === 'recovery_or_rest');
    if (!recoveryRole || !recoveryRole.phases.includes(authority.phase)) {
        return false;
    }

    let candidateWorkoutId: string | undefined;

    if (typeof identifier === 'string') {
        // Prefer an exact canonical workout id before interpreting the string as an engine
        // template id. This avoids a future template alias shadowing an exact workout id.
        candidateWorkoutId = recoveryRole.workoutIds.includes(identifier)
            ? identifier
            : workoutForTemplate(identifier)?.id ?? identifier;
    } else {
        candidateWorkoutId =
            identifier.workoutId ??
            (identifier.templateId ? workoutForTemplate(identifier.templateId)?.id : undefined) ??
            (identifier.id
                ? recoveryRole.workoutIds.includes(identifier.id)
                    ? identifier.id
                    : workoutForTemplate(identifier.id)?.id ?? identifier.id
                : undefined);
    }

    return Boolean(candidateWorkoutId && recoveryRole.workoutIds.includes(candidateWorkoutId));
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
    const isDueToday = daysUntilDue === 0;
    const isOverdue = daysUntilDue < 0;

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
 * - Qualifying recovery candidate with an authoritative deadline and slack -> tier 2
 * - Any non-recovery candidate, or any candidate before history/bootstrap authority exists -> tier 3
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

    if (!qualifies || state.dueByDate === null) {
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
 * Excludes dates through bootstrapDate (if provided). The input is normalized to unique
 * local dates because ADR-0038's credit/counting unit is a calendar date, not an exposure.
 * Missing calendar dates remain unknown; they neither count as recovery nor extend a
 * known non-recovery streak. BootstrapDate is a deadline reference only and is never
 * credited as recovery.
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
    const sortedDates = [...new Set(dates)].sort();
    const evaluatedDates = bootstrapDate
        ? sortedDates.filter(date => date > bootstrapDate)
        : sortedDates;

    let maxConsecutive = 0;
    let currentConsecutive = 0;
    let previousDate: string | null = null;
    const violations: Array<{ windowStart: string; windowEnd: string; nonRecoveryCount: number }> = [];

    for (let i = 0; i < evaluatedDates.length; i++) {
        const date = evaluatedDates[i];
        if (previousDate && getDayDiff(date, previousDate) !== 1) {
            // Unknown/missing dates break an authoritative non-recovery streak; do not
            // manufacture non-recovery evidence across a hole in the evaluated calendar.
            currentConsecutive = 0;
        }

        if (qualifyingRecoveryDates.has(date)) {
            currentConsecutive = 0;
        } else {
            currentConsecutive++;
            if (currentConsecutive > maxConsecutive) {
                maxConsecutive = currentConsecutive;
            }
        }
        previousDate = date;

        // Check each complete 7-date window ending at date.
        if (i >= RECOVERY_INTERVAL_DAYS - 1) {
            const windowStart = evaluatedDates[i - (RECOVERY_INTERVAL_DAYS - 1)];
            const windowEnd = date;
            // Seven unique evaluated dates spanning seven calendar days are necessarily
            // contiguous. A wider span contains an unknown date and is not enforceable.
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
