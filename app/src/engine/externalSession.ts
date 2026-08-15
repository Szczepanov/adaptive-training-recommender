import { resolveExecutionDose } from './dose';
import { evaluateTemplateEligibility, type EligibilityReason } from './eligibility';
import { toGateableSession } from './externalSessionProfiles';
import type { evaluateReadinessAndSafetyEnvelope } from './rules';
import type { DailyReadiness, ExternalPlanSession, PlannedDose, UserContext } from './models';

/** Mirrors `rules.ts`'s own `modify` ceiling. Imported here as a literal rather than
 * exported from `rules.ts` so this module stays free of the selection path; the
 * `externalSessionCeiling.test.ts` guard asserts the two never drift. */
export const EXTERNAL_MODIFY_MAX_SYSTEMIC_COST = 0.5;

export type ExternalSessionDecision = 'proceed' | 'scale' | 'defer' | 'skip' | 'advisory';

export interface ExternalSessionVerdict {
    decision: ExternalSessionDecision;
    /** Present when the session is actionable (`proceed` / `scale`). */
    executionDose?: PlannedDose;
    /** The author's own reduced form, used instead of a blunt duration multiplier. */
    scaledSummary?: string;
    /**
     * The author's free-text `scaling.fallback`, echoed for context when a feasibility
     * gate excluded the session. Never an executable substitute (D-CANDIDATE) — an
     * actionable alternative comes from the normal ranked path, gated and labelled.
     */
    fallbackSuggestion?: string;
    gateFailures: EligibilityReason[];
    rationale: string;
}

type EnvelopeState = ReturnType<typeof evaluateReadinessAndSafetyEnvelope>;

function isReducible(session: ExternalPlanSession): boolean {
    return session.scaling?.reducible !== false;
}

/**
 * Decides what to do with one imported session on one day.
 *
 * Pure and synchronous: no Firestore, no history provider, no clock. It reuses
 * `evaluateReadinessAndSafetyEnvelope`'s already-computed state and `resolveExecutionDose`
 * unchanged, so an imported session is adjudicated by exactly the pipeline that adjudicates
 * a catalog one (ADR-0019 D-CANDIDATE). It selects nothing and ranks nothing.
 *
 * The ladder follows `architecture/recommendation-engine.md`'s authority ordering and adds
 * no step to it:
 *
 *   clinical/safety → feasibility → readiness ceiling → dose
 *
 * Two short-circuits sit on top, both from ADR-0019:
 *   - `isEvent` returns `advisory` and can never skip, defer or scale (D-EVENT).
 *   - `reducible: false` escalates straight to `defer` rather than prescribing a
 *     compromise the author explicitly said has no value (D-IRREDUCIBLE).
 */
export function adjudicateExternalSession(
    session: ExternalPlanSession,
    readiness: DailyReadiness,
    context: UserContext,
    envelopeState: EnvelopeState,
    plannedDose: PlannedDose,
    date: string,
): ExternalSessionVerdict {
    const { mode, envelopes } = envelopeState;
    const gateable = toGateableSession(session);
    const eligibility = evaluateTemplateEligibility(gateable, context, readiness.subjective.timeAvailable, date);

    const safetyRestricted = envelopes.safety.restrictedModalities.includes(gateable.modality);
    const clinicalBlocked = envelopes.safety.clinicalFlagActive && safetyRestricted;
    const gateFailures: EligibilityReason[] = [...eligibility.reasons];
    if (safetyRestricted && !gateFailures.includes('restricted_modality')) gateFailures.push('restricted_modality');

    // ---- D-EVENT: an event is a commitment. Advise, never instruct. -------------------
    if (session.isEvent) {
        const concerns: string[] = [];
        if (envelopes.safety.clinicalFlagActive) concerns.push(envelopes.safety.clinicalReason ?? 'an active pain or injury flag');
        if (mode === 'recover') concerns.push('today\'s readiness would otherwise mandate recovery');
        if (gateFailures.length > 0) concerns.push(`feasibility concerns: ${gateFailures.join(', ')}`);
        return {
            decision: 'advisory',
            gateFailures,
            rationale: concerns.length > 0
                ? `This is your event, so the decision to start is yours. Worth knowing before you do: ${concerns.join('; ')}.`
                : 'This is your event. Nothing in today\'s readiness or your settings argues against starting.',
        };
    }

    // ---- 1. Clinical and safety gates ------------------------------------------------
    if (clinicalBlocked) {
        return {
            decision: 'skip',
            gateFailures,
            ...(session.scaling?.fallback ? { fallbackSuggestion: session.scaling.fallback } : {}),
            rationale: `${envelopes.safety.clinicalReason ?? 'An active clinical flag'} rules out ${gateable.modality.toLowerCase()} today. This is a safety exclusion, not a dose decision.`,
        };
    }

    // ---- 2. Feasibility --------------------------------------------------------------
    if (!eligibility.eligible) {
        return {
            decision: 'skip',
            gateFailures,
            ...(session.scaling?.fallback ? { fallbackSuggestion: session.scaling.fallback } : {}),
            rationale: `Today's constraints exclude this session (${gateFailures.join(', ')}). Your plan's note on what to do instead is shown for context; it has not been checked against today's constraints.`,
        };
    }

    // ---- 3. Readiness mode ceiling ---------------------------------------------------
    if (mode === 'recover') {
        // Uniformly `defer`, never `skip`: the verdict says "not today", and whether the
        // session moves or is abandoned is `placement.ifMissed`'s decision, not this
        // function's. Reducibility is irrelevant here -- recover means do not train, so
        // there is no reduced version to offer either.
        return {
            decision: 'defer',
            gateFailures,
            rationale: 'Readiness puts today in recovery. Move this session rather than doing a diminished version of it.',
        };
    }

    const executionDose = resolveExecutionDose(plannedDose, envelopes.plan, null);
    // resolveExecutionDose fails closed on an out-of-contract planned dose rather than
    // normalising it, because persisted audits require finite volume in 0..1. Honour that:
    // without a valid dose there is nothing safe to prescribe, and deferring would only
    // reproduce the same broken input tomorrow.
    if (!executionDose) {
        return {
            decision: 'skip',
            gateFailures,
            rationale: 'This session could not be dosed: the plan\'s volume/intensity for today is outside the supported contract. Nothing is prescribed rather than guessing a dose.',
        };
    }
    // A zeroed ceiling (Rest tier) leaves no session to do. Reached independently of the
    // `recover` branch above, which is derived separately and could diverge from the tier.
    if (executionDose.volume === 0) {
        return {
            decision: 'defer',
            gateFailures,
            rationale: 'Today\'s ceiling leaves no training volume at all. Move this session.',
        };
    }
    const exceedsModifyCeiling = mode === 'modify' && gateable.systemicCost > EXTERNAL_MODIFY_MAX_SYSTEMIC_COST;

    if (exceedsModifyCeiling) {
        // D-IRREDUCIBLE: the author said this session has no useful reduced form, so a
        // scaled prescription would be one they explicitly declined to write.
        if (!isReducible(session)) {
            return {
                decision: 'defer',
                gateFailures,
                rationale: 'Readiness caps today\'s systemic load, and this session has no useful reduced form. Move it rather than doing a compromised version.',
            };
        }
        return {
            decision: 'scale',
            executionDose,
            ...(session.scaling?.reducedSummary ? { scaledSummary: session.scaling.reducedSummary } : {}),
            gateFailures,
            rationale: session.scaling?.reducedSummary
                ? 'Readiness caps today\'s systemic load. Use your plan\'s own reduced version rather than a shortened full session.'
                : 'Readiness caps today\'s systemic load, and your plan gives no reduced form, so hold the intent and cut the volume.',
        };
    }

    // ---- 4. Dose ---------------------------------------------------------------------
    const floor = session.scaling?.minimumUsefulDurationMin;
    const scaledDurationMin = session.gating.durationMin * executionDose.volume;
    if (floor !== undefined && scaledDurationMin < floor) {
        return {
            decision: 'defer',
            gateFailures,
            rationale: `Today's ceiling would cut this below the ${floor} minutes your plan calls the minimum useful dose. A fragment is worth less than moving it.`,
        };
    }

    return {
        decision: 'proceed',
        executionDose,
        gateFailures,
        rationale: 'Readiness and today\'s constraints both clear this session as your plan wrote it.',
    };
}
