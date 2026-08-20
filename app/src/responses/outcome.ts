/**
 * M5.3: outcome/override evidence report (ADR-0023 D-MRESP / D-MPOLICY).
 *
 * `deriveSessionOutcome` is a pure, versioned SUMMARY over already-recorded M5.1/M5.2 facts
 * -- never a new inference and never a new tissue authority. It reads:
 *
 *  - `SessionResponse[]` (M5.1/M5.2): linkage + non-tissue facts, never a tissue value;
 *  - `RegionTissueResponse[]` (the canonical check-in, D-MRESP's sole tissue authority),
 *    already filtered by the caller to the ones whose `sourceSessionRef` matches this source
 *    session -- this module never queries a check-in itself;
 *  - an optional `PerformedSessionComparison` (M2.6, `sessions/performedComparison.ts`) for
 *    the planned-vs-performed delta that already exists at session completion.
 *
 * The severity mapping (`normal` < `mild`/monitor < `moderate`/limit < `severe`/exclude)
 * reuses `engine/injuryPolicy.ts`'s existing `deriveTissueSeverity` rather than restating a
 * second threshold table for the same four-level scale -- consistent with the tighten-only
 * discipline that function already documents.
 *
 * Per D-MPOLICY this label is evidence-only: it must never feed automatic option selection,
 * progression or eligibility. The M0.3 architecture boundary (`sessions/architecture.test.ts`)
 * keeps any selection/optimizer module from importing this file. `SESSION_OUTCOME_POLICY_VERSION`
 * is bumped whenever the derivation rule changes, so an exported report row can always be read
 * back against the exact rule that produced it (the same replay discipline ADR-0010 applies to
 * a decision, applied here to a summary).
 *
 * **Scoping note (2026-08-20).** The plan asks this module to "record athlete override
 * reason." No current UI captures a structured reason for *any* session type -- `athleteReason`
 * on the legacy `SessionAdjustment` (`engine/models.ts`) has no writer anywhere in this
 * repository today, catalog-scaling included. Rather than inventing a second unused field to
 * match it, `SessionOutcomeInput.overrideReason` is threaded through as a plain optional
 * parameter: the type is reused (per the plan's own instruction) and something can supply it
 * the moment a real capture point exists, but this module never fabricates a value for it.
 * `override.note` is populated automatically because that data already exists (M5.1's
 * `SessionResponse.note`/`techniqueNote`, captured today by `LaterDayFollowupCard`/the
 * next-morning check-in prompt).
 */
import type { RegionTissueResponse, SessionAdjustment } from '../engine/models';
import { deriveTissueSeverity } from '../engine/injuryPolicy';
import type { PerformedSessionComparison } from '../sessions/performedComparison';
import type { SessionResponse, SessionResponseSourceRef } from './models';

export const SESSION_OUTCOME_POLICY_VERSION = 'm5.3-outcome-v1';

export type SessionOutcomeStatus = 'passed' | 'caution' | 'reactive' | 'unknown';

/** Reused from `SessionAdjustment.athleteReason` (`engine/models.ts`), not reinvented: the
 * same taxonomy for why an athlete's scaled recommendation diverged from plan is the right
 * taxonomy for why *any* session's outcome diverged, not only a catalog-scaled one. */
export type AthleteOverrideReason = NonNullable<SessionAdjustment['athleteReason']>;

/** Source-neutral override record (plan D-MSESSION/D-MRECORDS framing applied to override
 * evidence): a reason plus the planned-vs-performed delta, never tied to `SessionAdjustment`'s
 * strength-specific shape. */
export interface SessionOverride {
    reason?: AthleteOverrideReason;
    /** Free-text elaboration, sourced from already-recorded M5.1 facts -- never a new
     * persisted field. */
    note?: string;
    /** From `sessions/performedComparison.ts`'s existing M2.6 output. `undefined` when no
     * comparison could be resolved (e.g. an abandoned session with no verifiable
     * prescription binding). */
    missingRequiredStepsCount?: number;
    completedStepsCount?: number;
    totalPlannedSteps?: number;
}

export interface SessionOutcomeInput {
    sourceSession: SessionResponseSourceRef;
    /** Every recorded `SessionResponse` for this source session, any window. */
    responses: readonly SessionResponse[];
    /** Every canonical check-in `RegionTissueResponse` whose `sourceSessionRef` matches this
     * source session, already resolved by the caller. */
    tissueResponses: readonly RegionTissueResponse[];
    /** M2.6's existing planned-vs-performed comparison, when resolvable. */
    comparison?: PerformedSessionComparison;
    /** An athlete-supplied reason for the divergence, when one has actually been captured
     * (see the module doc's scoping note). Never inferred by this function. */
    overrideReason?: AthleteOverrideReason;
}

export interface SessionOutcome {
    policyVersion: string;
    sourceSession: SessionResponseSourceRef;
    status: SessionOutcomeStatus;
    /** True once at least one later_day/next_morning signal (a response or a tissue
     * observation) exists. `false` means the status reflects immediate-only or zero data, so
     * a report must never present it as a confirmed 'passed'. */
    hasFollowUpData: boolean;
    /** Which recorded facts the status was derived from, so a report can show its work
     * rather than assert a bare conclusion. */
    sourceFacts: {
        responseIds: string[];
        tissueRegions: RegionTissueResponse['region'][];
    };
    override: SessionOverride;
}

type TissueSeverity = NonNullable<ReturnType<typeof deriveTissueSeverity>>;
const REACTIVE_SEVERITIES: ReadonlySet<TissueSeverity> = new Set<TissueSeverity>(['limit', 'exclude']);

function worstTissueSeverity(tissueResponses: readonly RegionTissueResponse[]): TissueSeverity | null {
    let worst: TissueSeverity | null = null;
    const rank: Record<TissueSeverity, number> = { monitor: 0, limit: 1, exclude: 2 };
    for (const response of tissueResponses) {
        const severity = deriveTissueSeverity(response);
        if (severity === null) continue;
        if (worst === null || rank[severity] > rank[worst]) worst = severity;
    }
    return worst;
}

/** Prefers a later_day/next_morning note over an immediate one (today's `SessionResponse`
 * production callers never write `immediate` anyway -- see `responses/models.ts`), and the
 * most recently recorded note when more than one window carries one. */
function mostRelevantNote(responses: readonly SessionResponse[]): string | undefined {
    const withNotes = responses.filter(response => response.note || response.techniqueNote);
    if (withNotes.length === 0) return undefined;
    const sorted = [...withNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted[0]?.note ?? sorted[0]?.techniqueNote;
}

export function deriveSessionOutcome(input: SessionOutcomeInput): SessionOutcome {
    const { sourceSession, responses, tissueResponses, comparison, overrideReason } = input;

    const worstSeverity = worstTissueSeverity(tissueResponses);
    const anyUnexpectedFatigue = responses.some(response => response.unexpectedFatigue === true);
    const hasFollowUpData = responses.some(response => response.window !== 'immediate') || tissueResponses.length > 0;
    const hasAnyData = responses.length > 0 || tissueResponses.length > 0;

    let status: SessionOutcomeStatus;
    if (!hasAnyData) {
        status = 'unknown';
    } else if (worstSeverity !== null && REACTIVE_SEVERITIES.has(worstSeverity)) {
        status = 'reactive';
    } else if (worstSeverity === 'monitor' || anyUnexpectedFatigue) {
        status = 'caution';
    } else if (!hasFollowUpData) {
        // Only immediate-level (or zero) signal: a real 'passed' claim needs the delayed
        // windows to have actually been asked and answered (D-MRESP: missing follow-up is
        // `unknown`, never a fabricated 'passed').
        status = 'unknown';
    } else {
        status = 'passed';
    }

    const note = mostRelevantNote(responses);

    return {
        policyVersion: SESSION_OUTCOME_POLICY_VERSION,
        sourceSession,
        status,
        hasFollowUpData,
        sourceFacts: {
            responseIds: responses.map(response => response.responseId),
            tissueRegions: tissueResponses.map(response => response.region),
        },
        override: {
            ...(overrideReason !== undefined ? { reason: overrideReason } : {}),
            ...(note !== undefined ? { note } : {}),
            ...(comparison ? {
                missingRequiredStepsCount: comparison.missingRequiredStepsCount,
                completedStepsCount: comparison.completedStepsCount,
                totalPlannedSteps: comparison.totalPlannedSteps,
            } : {}),
        },
    };
}
