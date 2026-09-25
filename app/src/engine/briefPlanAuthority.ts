/**
 * Issue #810: one resolved planning-authority statement for the context-brief export.
 *
 * This module does NOT adjudicate anything. The canonical adjudicator for an imported
 * session is `externalSession.ts` `adjudicateExternalSession`, invoked by `rules.ts`
 * (ADR-0019 D-CANDIDATE / D-EVENT), whose exact verdict is persisted on the daily
 * recommendation as `engineVerdict` together with the replay provenance
 * `recommendationAudit.externalPlan` (ADR-0019 D-IMMUT). Planning mode and fallback are
 * resolved once by `planningMode.ts` `resolvePlanningContext` (ADR-0017 / D-EXT).
 *
 * What this module does is reconcile those already-made decisions against the imported
 * occurrence the brief is about to export for the same date, so the receiving agent is
 * handed one authority relationship instead of two independently-actionable sessions. When
 * the persisted decision cannot be tied to that exact occurrence it fails closed to an
 * explicit unresolved outcome rather than guessing which instruction wins.
 *
 * Pure: no IO, no clock. Rendering-only; it cannot change a recommendation.
 */
import type {
    DailyRecommendation,
    DailySubjectiveCheckin,
    FixedActivity,
    PlanningMode,
    ShadowVerdict,
} from './models';
import { resolveEngineShadowVerdict } from './shadowAgreement';

/** The subset of an exported imported-session row this resolver needs. */
export interface BriefAuthoredSession {
    date: string;
    planId: string;
    revision: number;
    sessionId: string;
    title: string;
    modality: string;
    intensity: string;
    durationMin: number;
    durationMax: number;
    flexibility: 'fixed' | 'preferred' | 'any_day';
    priority: 'key' | 'supporting' | 'optional';
    isEvent: boolean;
}

export type BriefPlanAuthorityOutcome =
    /** The app adjudicated today's imported session and cleared it at the authored dose. */
    | 'MATCH'
    /** The app adjudicated today's imported session and scaled it: same session, reduced dose. */
    | 'DOSE_MODIFIED'
    /** A readiness / safety / feasibility gate deferred or skipped today's imported session. */
    | 'SESSION_REPLACED_BY_GATE'
    /** Today's imported session is a target event: a commitment, adjudicated for advice only. */
    | 'EVENT_DAY'
    /** Today's imported plan places a protected rest directive. */
    | 'AUTHORED_REST'
    /** Externally-planned mode, confirmed: no imported session is placed today. */
    | 'EXTERNAL_PLAN_FALLBACK'
    /** No imported plan governs today; the app's own planning mode owns the day. */
    | 'NO_AUTHORED_SESSION'
    /** Today's imported plan could not be read; absence is unknown, not confirmed. */
    | 'EXTERNAL_PLAN_UNREADABLE'
    /** An imported session is placed today but no app decision has adjudicated it yet. */
    | 'AUTHORED_UNADJUDICATED'
    /** The facts disagree and no ADR-defined rule reconciles them. */
    | 'CONFLICT_UNRESOLVED';

export type BriefPlanConflictReason =
    | 'recommendation_not_bound_to_placed_session'
    | 'recommendation_bound_to_other_revision'
    | 'imported_session_outside_externally_planned_mode'
    | 'fallback_with_placed_session';

export interface BriefPlanAuthority {
    outcome: BriefPlanAuthorityOutcome;
    /** The single session the athlete should treat as today's plan, or null when there is
     * none (rest / unresolved / unreadable / no decision yet without an authored session). */
    authoritative:
        | { kind: 'imported_session'; session: BriefAuthoredSession }
        | { kind: 'app_recommendation'; recommendation: DailyRecommendation }
        | { kind: 'authored_rest' }
        | null;
    /** The exact persisted engine verdict the outcome was derived from, when one applies. */
    verdict: ShadowVerdict | null;
    /** Present for SESSION_REPLACED_BY_GATE / DOSE_MODIFIED: the persisted engine rationale
     * that names the gate or readiness reason, and its source. */
    override: { source: 'engine_adjudication'; reason: string } | null;
    conflictReason: BriefPlanConflictReason | null;
    /** Imported sessions placed today other than the authoritative one (double days). They
     * keep their authored authority; today's decision did not adjudicate them. */
    otherAuthoredSessionsToday: readonly BriefAuthoredSession[];
    /** Fixed activities dated today: availability / load constraints, never a prescription. */
    fixedConstraintsToday: readonly FixedActivity[];
    /** Current-day check-in symptom flags. These outrank every authored or app session. */
    currentSymptomFlags: readonly string[];
    /** True when the app decision was saved before today's check-in was submitted, so it
     * may not reflect the symptoms above. */
    recommendationPredatesCheckin: boolean;
}

export interface BriefPlanAuthorityInput {
    asOfDate: string;
    effectivePlanningMode: PlanningMode;
    externalFallback: boolean;
    externalFallbackUncertain: boolean;
    importedSessionsToday: readonly BriefAuthoredSession[];
    recommendationToday: DailyRecommendation | null;
    checkinToday: DailySubjectiveCheckin | null;
    fixedActivitiesToday: readonly FixedActivity[];
}

type PersistedWithVerdict = DailyRecommendation & { engineVerdict?: ShadowVerdict };

function persistedVerdict(recommendation: DailyRecommendation): ShadowVerdict {
    // Same rule as shadowLog.ts: exact persisted verdict first, legacy mode mapping second.
    return (recommendation as PersistedWithVerdict).engineVerdict
        ?? resolveEngineShadowVerdict(recommendation.mode);
}

function symptomFlags(checkin: DailySubjectiveCheckin | null): string[] {
    if (!checkin) return [];
    const flags: string[] = [];
    if (checkin.illnessSymptoms) flags.push('illness symptoms');
    if (checkin.painOrInjury) flags.push('pain/injury');
    return flags;
}

function sameOccurrence(session: BriefAuthoredSession, recommendation: DailyRecommendation): 'same' | 'other_revision' | 'none' {
    const bound = recommendation.recommendationAudit?.externalPlan;
    if (!bound || bound.planId !== session.planId || bound.sessionId !== session.sessionId) return 'none';
    return bound.revision === session.revision ? 'same' : 'other_revision';
}

function base(input: BriefPlanAuthorityInput): Omit<BriefPlanAuthority, 'outcome' | 'authoritative' | 'verdict' | 'override' | 'conflictReason' | 'otherAuthoredSessionsToday'> {
    const checkin = input.checkinToday;
    const recommendation = input.recommendationToday;
    return {
        fixedConstraintsToday: input.fixedActivitiesToday.filter(item => item.date === input.asOfDate && !item.isCompleted),
        currentSymptomFlags: symptomFlags(checkin),
        recommendationPredatesCheckin: Boolean(checkin && recommendation && recommendation.updatedAt < checkin.submittedAt),
    };
}

function unresolved(input: BriefPlanAuthorityInput, reason: BriefPlanConflictReason, others: readonly BriefAuthoredSession[]): BriefPlanAuthority {
    return {
        ...base(input), outcome: 'CONFLICT_UNRESOLVED', authoritative: null, verdict: null,
        override: null, conflictReason: reason, otherAuthoredSessionsToday: others,
    };
}

function adjudicatedOutcome(
    input: BriefPlanAuthorityInput,
    session: BriefAuthoredSession,
    recommendation: DailyRecommendation,
    others: readonly BriefAuthoredSession[],
): BriefPlanAuthority {
    const verdict = persistedVerdict(recommendation);
    const shared = { ...base(input), verdict, conflictReason: null, otherAuthoredSessionsToday: others };
    const imported = { kind: 'imported_session' as const, session };
    if (session.isEvent) {
        // ADR-0019 D-EVENT: adjudicated for advice, never for permission.
        return { ...shared, outcome: 'EVENT_DAY', authoritative: imported, override: null };
    }
    switch (verdict) {
        case 'proceed':
            return { ...shared, outcome: 'MATCH', authoritative: imported, override: null };
        case 'scale':
            return {
                ...shared, outcome: 'DOSE_MODIFIED', authoritative: imported,
                override: { source: 'engine_adjudication', reason: recommendation.rationale },
            };
        case 'defer':
        case 'skip':
            return {
                ...shared, outcome: 'SESSION_REPLACED_BY_GATE',
                authoritative: { kind: 'app_recommendation', recommendation },
                override: { source: 'engine_adjudication', reason: recommendation.rationale },
            };
        default:
            // `advisory` is reserved for events (D-EVENT); on a non-event session it is a
            // fact the rules do not reconcile, so it must not be presented as clearance.
            return unresolved(input, 'recommendation_not_bound_to_placed_session', others);
    }
}

/**
 * Resolves the single authority statement for `asOfDate`. Precedence (ADR-0012 / ADR-0019):
 * current symptoms > engine safety/readiness adjudication > authored imported session >
 * app-generated recommendation. Fixed activities constrain availability; they are never
 * the prescription.
 */
export function resolveBriefPlanAuthority(input: BriefPlanAuthorityInput): BriefPlanAuthority {
    const recommendation = input.recommendationToday;
    const sessions = input.importedSessionsToday.filter(item => item.date === input.asOfDate);
    const noConflict = { verdict: null, override: null, conflictReason: null } as const;

    if (input.externalFallbackUncertain && sessions.length === 0) {
        return { ...base(input), ...noConflict, outcome: 'EXTERNAL_PLAN_UNREADABLE', authoritative: null, otherAuthoredSessionsToday: [] };
    }

    if (recommendation?.recommendationAudit?.externalRest && sessions.length === 0) {
        return { ...base(input), ...noConflict, outcome: 'AUTHORED_REST', authoritative: { kind: 'authored_rest' }, otherAuthoredSessionsToday: [] };
    }

    if (sessions.length === 0) {
        const authoritative = recommendation ? { kind: 'app_recommendation' as const, recommendation } : null;
        return {
            ...base(input), ...noConflict,
            outcome: input.externalFallback ? 'EXTERNAL_PLAN_FALLBACK' : 'NO_AUTHORED_SESSION',
            authoritative, otherAuthoredSessionsToday: [],
        };
    }

    if (input.externalFallback) return unresolved(input, 'fallback_with_placed_session', sessions);
    if (input.effectivePlanningMode !== 'externally_planned') {
        return unresolved(input, 'imported_session_outside_externally_planned_mode', sessions);
    }

    if (!recommendation) {
        const [first, ...others] = sessions;
        return {
            ...base(input), ...noConflict, outcome: 'AUTHORED_UNADJUDICATED',
            authoritative: { kind: 'imported_session', session: first }, otherAuthoredSessionsToday: others,
        };
    }

    const matches = sessions.map(session => ({ session, binding: sameOccurrence(session, recommendation) }));
    const bound = matches.find(item => item.binding === 'same');
    if (bound) {
        const others = sessions.filter(item => item !== bound.session);
        return adjudicatedOutcome(input, bound.session, recommendation, others);
    }
    const otherRevision = matches.some(item => item.binding === 'other_revision');
    return unresolved(
        input,
        otherRevision ? 'recommendation_bound_to_other_revision' : 'recommendation_not_bound_to_placed_session',
        sessions,
    );
}

const OUTCOME_HEADLINE: Record<BriefPlanAuthorityOutcome, string> = {
    MATCH: 'MATCH — the app adjudicated today\'s imported session and cleared it as authored',
    DOSE_MODIFIED: 'DOSE_MODIFIED — today\'s imported session stands, at a reduced dose set by the app\'s readiness adjudication',
    SESSION_REPLACED_BY_GATE: 'SESSION_REPLACED_BY_GATE — a readiness/safety/feasibility gate displaced today\'s imported session',
    EVENT_DAY: 'EVENT_DAY — today\'s imported session is a target event (a commitment; advice only, the decision stays with the athlete)',
    AUTHORED_REST: 'AUTHORED_REST — the imported plan protects today as a rest day',
    EXTERNAL_PLAN_FALLBACK: 'EXTERNAL_PLAN_FALLBACK — no imported session is placed today; the app\'s own recommendation stands in, labelled as fallback',
    NO_AUTHORED_SESSION: 'NO_AUTHORED_SESSION — no imported plan governs today; the app recommendation is the planning input',
    EXTERNAL_PLAN_UNREADABLE: 'EXTERNAL_PLAN_UNREADABLE — today\'s imported plan could not be read; whether a session is placed today is UNKNOWN',
    AUTHORED_UNADJUDICATED: 'AUTHORED_UNADJUDICATED — an imported session is placed today but the app has not adjudicated it yet',
    CONFLICT_UNRESOLVED: 'CONFLICT_UNRESOLVED — the app recommendation and today\'s imported plan disagree and no rule reconciles them',
};

const CONFLICT_DETAIL: Record<BriefPlanConflictReason, string> = {
    recommendation_not_bound_to_placed_session: 'today\'s app recommendation was not made by adjudicating the imported session placed today',
    recommendation_bound_to_other_revision: 'today\'s app recommendation adjudicated a different revision of the imported plan than the one placed now',
    imported_session_outside_externally_planned_mode: 'an imported session is placed today but the athlete\'s planning mode is not externally planned, so the app did not adjudicate it',
    fallback_with_placed_session: 'the app ran in external-plan fallback, yet an imported session is visible on today\'s date',
};

function describeSession(session: BriefAuthoredSession): string {
    const range = session.durationMax !== session.durationMin ? `${session.durationMin}–${session.durationMax}` : `${session.durationMin}`;
    return `${session.title} (${session.modality} · ${range} min · ${session.intensity} · ${session.priority} · ${session.flexibility}; plan ${session.planId} revision ${session.revision}, session ${session.sessionId})`;
}

function describeRecommendation(recommendation: DailyRecommendation): string {
    return `${recommendation.templateTitle} (${recommendation.modality} · ${recommendation.mode})`;
}

function authoritativeLine(authority: BriefPlanAuthority): string {
    const target = authority.authoritative;
    if (!target) {
        return authority.outcome === 'AUTHORED_UNADJUDICATED' || authority.outcome === 'EXTERNAL_PLAN_UNREADABLE' || authority.outcome === 'CONFLICT_UNRESOLVED'
            ? '- Authoritative session today: **UNRESOLVED** — do not pick, merge or average the candidates below; ask the athlete which applies.'
            : '- Authoritative session today: none recorded yet.';
    }
    if (target.kind === 'authored_rest') return '- Authoritative session today: **rest** (authored rest directive).';
    if (target.kind === 'app_recommendation') return `- Authoritative session today: **${describeRecommendation(target.recommendation)}** (app recommendation).`;
    const suffix = authority.outcome === 'DOSE_MODIFIED'
        ? ' — at the app\'s reduced dose, not the authored dose'
        : authority.outcome === 'AUTHORED_UNADJUDICATED' ? ' — authored, not yet readiness-checked by the app' : '';
    return `- Authoritative session today: **${describeSession(target.session)}** (imported plan)${suffix}.`;
}

/** Renders the resolved authority block. It is placed before any descriptive telemetry. */
export function renderBriefPlanAuthority(authority: BriefPlanAuthority, asOfDate: string, recommendation: DailyRecommendation | null): string {
    const lines: string[] = [
        `### Resolved planning authority for ${asOfDate}`,
        '',
        'Authority order: current symptoms and safety > the app\'s readiness/safety adjudication > the imported (authored) plan > the app\'s own generated recommendation. Fixed activities are availability/load constraints, not workouts.',
        '',
        `- Outcome: **${OUTCOME_HEADLINE[authority.outcome]}**.`,
        authoritativeLine(authority),
    ];
    if (authority.conflictReason) lines.push(`- Why unresolved: ${CONFLICT_DETAIL[authority.conflictReason]}.`);
    if (authority.outcome === 'CONFLICT_UNRESOLVED' && recommendation) {
        lines.push(`- Unreconciled app recommendation (NOT independently actionable): ${describeRecommendation(recommendation)}.`);
    }
    if (authority.outcome === 'SESSION_REPLACED_BY_GATE' && authority.authoritative?.kind === 'app_recommendation') {
        const displaced = recommendation?.recommendationAudit?.externalPlan;
        if (displaced) lines.push(`- Displaced imported session: plan ${displaced.planId} revision ${displaced.revision}, session ${displaced.sessionId}. Its authored revision is unchanged.`);
    }
    if (authority.override) lines.push(`- Override source: app readiness/safety adjudication (verdict \`${authority.verdict}\`) — "${authority.override.reason}"`);
    for (const other of authority.otherAuthoredSessionsToday) {
        lines.push(`- Also placed today (authored authority, not covered by today's app decision): ${describeSession(other)}.`);
    }
    for (const fixed of authority.fixedConstraintsToday) {
        lines.push(`- Constraint (not a prescription): fixed activity ${fixed.title} · ${fixed.durationMin} min · ${fixed.fixed ? 'fixed' : 'movable'}.`);
    }
    if (authority.currentSymptomFlags.length > 0) {
        lines.push(`- **Current symptoms reported today: ${authority.currentSymptomFlags.join(', ')}.** These outrank every session above.`);
    }
    if (authority.recommendationPredatesCheckin) {
        lines.push('- The app decision was saved before today\'s check-in was submitted; it may not reflect today\'s check-in.');
    }
    if (authority.outcome === 'EXTERNAL_PLAN_UNREADABLE') {
        lines.push('- Treat the imported plan for today as unknown, not as "no session". Do not substitute an invented session.');
    }
    return lines.join('\n');
}
