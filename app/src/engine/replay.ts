import type { DailyRecommendation, ExternalDecisionProvenance, ExternalRestDirective, ExternalRestProvenance, ExternalTrainingPlan } from './models';
import type { SessionReferenceBinding } from '../sessions/models';
import { computeContentHash } from './externalPlanHash';
import { resolveRestDate } from './externalPlacement';
import { externalTemplateId, isExternalTemplateId } from './externalSessionProfiles';
import { isExternalRestOverride } from './externalRestProvenance';
import { getCanonicalRestTemplate } from './rules';
import { isHistoricalPolicyVersion, POLICY_VERSION } from './policy';
import { subjectiveDriftAuditReplayErrors } from './subjectiveDriftAudit';
import { identityDecisionProvenanceReplayErrors } from './identityProvenance';
import { compareKnowledgeLineage, type KnowledgeLineageDrift, type KnowledgeLineageStatus } from './knowledgeLineage';

export interface RecommendationReplayResult {
    reproducible: boolean;
    policyMatchesCurrent: boolean;
    errors: string[];
    knowledgeStatus?: KnowledgeLineageStatus;
    knowledgeDrift?: KnowledgeLineageDrift[];
}

/**
 * The stored revision an external decision claims to have been made from, plus the hash
 * recomputed from it. The hash is supplied by the caller because `computeContentHash` is
 * async (WebCrypto) and this function stays synchronous for every existing caller — use
 * `replayRecommendationAuditAgainstRevision` to have it computed for you.
 */
export interface ExternalRevisionEvidence {
    plan: ExternalTrainingPlan;
    /** SHA-256 recomputed from `plan`. Never read from the audit — that would make the
     * comparison below compare a value with itself. */
    contentHash: string;
}

/**
 * M3.2/D-MSNAP: which `execution_prescriptions/{hash}` bindings the audit references could
 * actually be resolved and content-verified. Unlike `ExternalRevisionEvidence` — where the
 * *external plan's own content* can legitimately change under the same revision number —
 * `execution_prescriptions` are write-once and content-addressed by the hash itself, so
 * there is no drift case to detect, only existence/corruption. `getPrescription` already
 * reverifies hash-of-stored-bytes-equals-its-own-id internally. Evidence is keyed by the
 * complete binding so one valid snapshot cannot accidentally bless a different source.
 */
export interface SessionPrescriptionEvidence {
    /** Canonical source/occurrence/prescription tuples that resolved as one binding. A
     * hash-only set is insufficient: a valid snapshot for session A must not make a
     * mis-bound session B replay successfully merely because both cite the same hash. */
    resolvedBindings: ReadonlySet<string>;
}

export function sessionBindingEvidenceKey(binding: SessionReferenceBinding): string {
    const source = binding.sessionSource;
    const sourceKey = source.kind === 'catalog'
        ? [source.kind, source.workoutId, source.catalogVersion]
        : source.kind === 'external_plan'
            ? [source.kind, source.planId, source.revision, source.sessionId, source.contentHash]
            : source.kind === 'manual'
                ? [source.kind, source.definitionId, source.revision, source.contentHash]
                : [source.kind, source.fixtureId];
    return JSON.stringify([sourceKey, binding.occurrenceId ?? null, binding.prescriptionHash]);
}

function sessionBindingErrors(
    audit: { primarySession?: SessionReferenceBinding; additionalSessions?: SessionReferenceBinding[] },
    evidence: SessionPrescriptionEvidence | null,
): string[] {
    const bindings = [audit.primarySession, ...(audit.additionalSessions ?? [])]
        .filter((binding): binding is SessionReferenceBinding => Boolean(binding));
    if (bindings.length === 0) return [];
    if (!evidence) {
        return [`Decision references ${bindings.length} session prescription binding(s), which were not supplied; it cannot be replayed without them.`];
    }
    const errors: string[] = [];
    for (const binding of bindings) {
        if (!evidence.resolvedBindings.has(sessionBindingEvidenceKey(binding))) {
            errors.push(`Session prescription ${binding.prescriptionHash} referenced by the audit could not be resolved or failed content verification.`);
        }
    }
    return errors;
}

function sessionBindingConsistencyErrors(recommendation: DailyRecommendation): string[] {
    const audit = recommendation.recommendationAudit!;
    const persistedPrimary = recommendation.primarySession
        ? sessionBindingEvidenceKey(recommendation.primarySession)
        : null;
    const auditedPrimary = audit.primarySession ? sessionBindingEvidenceKey(audit.primarySession) : null;
    const persistedAdditional = (recommendation.additionalSessions ?? []).map(sessionBindingEvidenceKey);
    const auditedAdditional = (audit.additionalSessions ?? []).map(sessionBindingEvidenceKey);
    const errors: string[] = [];
    if (persistedPrimary !== auditedPrimary) {
        errors.push('Persisted primarySession does not match the binding recorded in the recommendation audit.');
    }
    if (JSON.stringify(persistedAdditional) !== JSON.stringify(auditedAdditional)) {
        errors.push('Persisted additionalSessions do not match the ordered bindings recorded in the recommendation audit.');
    }
    return errors;
}

function rankedDecisionErrors(recommendation: DailyRecommendation): string[] {
    const scores = recommendation.recommendationAudit!.candidateScores;
    const selected = scores.find(candidate => candidate.templateId === recommendation.templateId);
    if (!selected) return ['Persisted template is absent from the audited candidates.'];
    if (scores.some(candidate => candidate.utilityScore > selected.utilityScore)) {
        return ['Persisted template was not the highest-utility audited candidate.'];
    }
    return [];
}

function authoredOccurrenceDecisionErrors(recommendation: DailyRecommendation): string[] {
    const audit = recommendation.recommendationAudit!;
    const provenance = audit.authoredOccurrence;
    if (!provenance) return rankedDecisionErrors(recommendation);

    const errors: string[] = [];
    if (audit.candidateScores.length > 0) {
        errors.push('An authored replacement audited catalog candidates even though the occurrence owns selection.');
    }
    if (!recommendation.primarySession || !audit.primarySession) {
        errors.push('An authored replacement audit is missing its primary session binding.');
    } else if (
        recommendation.primarySession.occurrenceId !== provenance.occurrenceId
        || audit.primarySession.occurrenceId !== provenance.occurrenceId
    ) {
        errors.push('Authored occurrence provenance does not match the primary session binding.');
    }
    if (provenance.decision === 'scale' && recommendation.mode !== 'modify') {
        errors.push('A scaled authored occurrence must persist modify mode.');
    }
    return errors;
}

/**
 * Verifies that a v3 record is internally reproducible from its compact persisted
 * audit. It intentionally validates normalized decision facts only; raw recovery
 * payloads, raw subjective history, and free-text notes are neither required nor accepted
 * as replay inputs. Optional subjective-drift evidence is checked against only the
 * normalized invariants that are reproducible from the compact audit.
 *
 * Historical policy versions remain auditable but are not executable in the current
 * bundle. Replaying one is rejected explicitly rather than silently interpreting its
 * facts under the current policy implementation.
 *
 * ADR-0019 now has two external-provenance shapes:
 * - an externally selected training session ranks nothing and persists either its `ext:`
 *   template or a non-actionable recovery template;
 * - an `isEvent` session is a FixedActivity-style commitment, so the engine still ranks
 *   any additional recommendation while retaining the event revision/hash as an input to
 *   that decision.
 * ADR-0035 adds authored-rest provenance, which is mutually exclusive with external-session
 * provenance. Replay rejects a malformed audit that claims both authorities rather than
 * silently choosing one branch.
 */
export function replayRecommendationAudit(
    recommendation: DailyRecommendation,
    externalRevision: ExternalRevisionEvidence | null = null,
    sessionEvidence: SessionPrescriptionEvidence | null = null,
): RecommendationReplayResult {
    const errors: string[] = [];
    const audit = recommendation.recommendationAudit;
    if (![3, 4].includes(recommendation.schemaVersion) || !audit) {
        return { reproducible: false, policyMatchesCurrent: false, errors: ['Recommendation does not contain a replayable v3/v4 audit.'] };
    }
    const knowledgeComparison = compareKnowledgeLineage(audit.knowledgeLineage);
    const includeKnowledgeDiagnostics = recommendation.schemaVersion === 4 || audit.knowledgeLineage !== undefined;
    if (recommendation.schemaVersion === 4 && knowledgeComparison.status === 'lineage_unavailable') {
        errors.push('Schema version 4 recommendation is missing knowledge lineage.');
    }
    const policyMatchesCurrent = audit.policyVersion === POLICY_VERSION;
    if (!policyMatchesCurrent) {
        errors.push(isHistoricalPolicyVersion(audit.policyVersion)
            ? `Historical policy version ${audit.policyVersion} is intentionally audit-only and cannot be replayed by this build.`
            : `Policy version ${audit.policyVersion} is not available in this build.`);
    }
    if (audit.safetyStatus !== 'complete') errors.push('Audit safety status is not complete.');
    if (!audit.decisionContextRevision.startsWith('history-v1:')) errors.push('Decision context revision is invalid.');
    if (audit.history.unmatchedEventCount > audit.history.completedEventCount) errors.push('Unmatched event count exceeds completed event count.');

    const subjectiveDrift = (audit as typeof audit & { subjectiveDrift?: unknown }).subjectiveDrift;
    errors.push(...subjectiveDriftAuditReplayErrors(subjectiveDrift, recommendation.date));
    errors.push(...identityDecisionProvenanceReplayErrors(audit.identityDecision));

    errors.push(...sessionBindingConsistencyErrors(recommendation));
    errors.push(...sessionBindingErrors(audit, sessionEvidence));

    if (audit.externalPlan && audit.externalRest) {
        errors.push('Recommendation audit cannot contain both externalPlan and externalRest provenance for the same decision.');
    } else if (audit.externalPlan) {
        errors.push(...externalDecisionErrors(recommendation, audit.externalPlan, externalRevision));
    } else if (audit.externalRest) {
        errors.push(...externalRestErrors(recommendation, audit.externalRest, externalRevision));
    } else {
        if (externalRevision) {
            errors.push('A plan revision was supplied for a decision that did not come from an external plan.');
        }
        errors.push(...authoredOccurrenceDecisionErrors(recommendation));
    }

    return {
        reproducible: errors.length === 0,
        policyMatchesCurrent,
        errors,
        ...(includeKnowledgeDiagnostics ? {
            knowledgeStatus: knowledgeComparison.status,
            knowledgeDrift: knowledgeComparison.drift,
        } : {}),
    };
}

function externalDecisionErrors(
    recommendation: DailyRecommendation,
    provenance: ExternalDecisionProvenance,
    externalRevision: ExternalRevisionEvidence | null,
): string[] {
    const errors: string[] = [];

    if (!externalRevision) {
        errors.push(`External decision references plan ${provenance.planId} revision ${provenance.revision}, which was not supplied; it cannot be replayed without it.`);
        return errors;
    }

    if (externalRevision.plan.planId !== provenance.planId || externalRevision.plan.revision !== provenance.revision) {
        errors.push(`Supplied revision is ${externalRevision.plan.planId}@${externalRevision.plan.revision}, but the audit references ${provenance.planId}@${provenance.revision}.`);
        return errors;
    }

    // The load-bearing check. A plan re-imported under the same revision number reads back
    // with the same identity and different content; only the hash catches that, and a
    // decision replayed against changed content is not the decision that was made.
    if (externalRevision.contentHash !== provenance.contentHash) {
        errors.push(`Plan content hash mismatch: the audit recorded ${provenance.contentHash} but the supplied revision hashes to ${externalRevision.contentHash}. The stored revision has changed since this decision was made.`);
        return errors;
    }

    const session = externalRevision.plan.sessions.find(item => item.id === provenance.sessionId);
    if (!session) {
        errors.push(`Session ${provenance.sessionId} is not present in plan ${provenance.planId} revision ${provenance.revision}.`);
        return errors;
    }

    if (session.isEvent) {
        // D-EVENT: the event itself is never the selected template. Its provenance remains
        // load-bearing because it changed availability/fatigue/stimulus before the normal
        // ranking path chose the persisted catalog recommendation.
        if (isExternalTemplateId(recommendation.templateId)) {
            errors.push('An external event was persisted as the recommended template instead of as a fixed commitment.');
            return errors;
        }
        if (recommendation.recommendationAudit!.candidateScores.length > 0) {
            errors.push(...rankedDecisionErrors(recommendation));
        }
        return errors;
    }

    // Ordinary external sessions own selection, so ranking candidates here would mean a
    // second selection path ran and went unrecorded.
    if (recommendation.recommendationAudit!.candidateScores.length > 0) {
        errors.push('An externally selected session audited ranked candidates, which that decision path must not produce.');
    }

    // A non-actionable verdict persists the rest template rather than the synthetic one,
    // so an external decision legitimately carries either id -- but never another `ext:` id.
    const expectedTemplateId = externalTemplateId(provenance.planId, provenance.revision, provenance.sessionId);
    if (isExternalTemplateId(recommendation.templateId) && recommendation.templateId !== expectedTemplateId) {
        errors.push(`Persisted template ${recommendation.templateId} does not match the audited external session ${expectedTemplateId}.`);
    }

    return errors;
}

/**
 * ADR-0035: mirrors `externalDecisionErrors` for an authored-rest decision. Replay fails
 * closed if *any* of the persisted source-identity fields (`planId`, revision, content
 * hash, rest directive id, or the resolved plan-local date) does not match the loaded
 * immutable plan -- it must not infer rest from session absence or substitute a different
 * directive/date from the same plan (see the ADR's persistence/audit/replay section).
 */
function externalRestErrors(
    recommendation: DailyRecommendation,
    provenance: ExternalRestProvenance,
    externalRevision: ExternalRevisionEvidence | null,
): string[] {
    const errors: string[] = [];

    if (!externalRevision) {
        errors.push(`Authored-rest decision references plan ${provenance.planId} revision ${provenance.revision}, which was not supplied; it cannot be replayed without it.`);
        return errors;
    }

    if (externalRevision.plan.planId !== provenance.planId || externalRevision.plan.revision !== provenance.revision) {
        errors.push(`Supplied revision is ${externalRevision.plan.planId}@${externalRevision.plan.revision}, but the audit references ${provenance.planId}@${provenance.revision}.`);
        return errors;
    }

    if (externalRevision.contentHash !== provenance.contentHash) {
        errors.push(`Plan content hash mismatch: the audit recorded ${provenance.contentHash} but the supplied revision hashes to ${externalRevision.contentHash}. The stored revision has changed since this decision was made.`);
        return errors;
    }

    const restDays = (externalRevision.plan as { restDays?: ExternalRestDirective[] }).restDays ?? [];
    const directive = restDays.find(item => item.id === provenance.restDirectiveId);
    if (!directive) {
        errors.push(`Rest directive ${provenance.restDirectiveId} is not present in plan ${provenance.planId} revision ${provenance.revision}.`);
        return errors;
    }

    const resolvedDate = resolveRestDate(externalRevision.plan, directive);
    if (resolvedDate !== provenance.date) {
        errors.push(`Rest directive ${provenance.restDirectiveId} resolves to ${resolvedDate} against the supplied plan, but the audit recorded ${provenance.date}. Replay fails closed rather than trusting the persisted date.`);
        return errors;
    }

    // An explicit athlete override keeps the authored rest directive as load-bearing input
    // provenance, but selection itself is the ordinary ranked planner path. Reuse that path's
    // replay checks rather than pretending the canonical Rest template still owned selection.
    if (isExternalRestOverride(provenance)) {
        errors.push(...authoredOccurrenceDecisionErrors(recommendation));
        return errors;
    }

    if (recommendation.templateId !== getCanonicalRestTemplate().id) {
        errors.push(`Persisted template ${recommendation.templateId} does not match the canonical Rest template expected for an authored-rest decision.`);
    }

    // Default authored rest bypasses ranking entirely (rules.ts's authoredRestRecommendation
    // never calls rankCandidates), mirroring the ordinary external-session rejection above.
    if (recommendation.recommendationAudit!.candidateScores.length > 0) {
        errors.push('An authored-rest decision audited ranked candidates, which that decision path must not produce.');
    }

    return errors;
}

/**
 * Convenience wrapper that hashes the supplied revision itself, so a caller cannot
 * accidentally pass the audit's own recorded hash back in and verify nothing.
 */
export async function replayRecommendationAuditAgainstRevision(
    recommendation: DailyRecommendation,
    plan: ExternalTrainingPlan | null,
): Promise<RecommendationReplayResult> {
    if (!plan) return replayRecommendationAudit(recommendation);
    return replayRecommendationAudit(recommendation, { plan, contentHash: await computeContentHash(plan) });
}

/**
 * Resolves every `primarySession`/`additionalSessions` prescription binding the audit
 * references via `executionPrescriptionService` (a real Firestore read, hence async and
 * kept out of the synchronous core) and replays against the result. Composes with
 * `externalRevision` since a decision can, in principle, carry both an external-plan
 * provenance and session bindings (e.g. a same-day `additional_session`).
 */
export async function replayRecommendationAuditAgainstSessions(
    userId: string,
    recommendation: DailyRecommendation,
    externalRevision: ExternalRevisionEvidence | null = null,
): Promise<RecommendationReplayResult> {
    const audit = recommendation.recommendationAudit;
    const bindings = audit
        ? [audit.primarySession, ...(audit.additionalSessions ?? [])].filter((binding): binding is SessionReferenceBinding => Boolean(binding))
        : [];
    if (bindings.length === 0) return replayRecommendationAudit(recommendation, externalRevision);

    // Lazy import: replay.ts otherwise has zero I/O dependencies, and every other export in
    // this file must stay importable without a live Firestore connection (e.g. the CLI
    // replay script only ever calls replayRecommendationAuditAgainstRevision).
    const { sessionOccurrenceService } = await import('../services/sessionOccurrenceService');
    const resolvedBindings = new Set<string>();
    const { resolveSessionDefinition } = await import('../sessions/sessionDefinitionResolver');
    for (const binding of bindings) {
        // resolveSessionDefinition resolves and verifies the prescription hash itself
        // (fetching the same execution_prescriptions/{hash} document a separate
        // getPrescription call would), so a prior read here would be redundant.
        const definition = await resolveSessionDefinition(userId, binding.sessionSource, binding.prescriptionHash);
        if (definition.status !== 'AVAILABLE') continue;

        if (binding.occurrenceId) {
            const occurrence = await sessionOccurrenceService.getOccurrence(userId, binding.occurrenceId);
            if (occurrence.status !== 'AVAILABLE' || occurrence.data.date !== recommendation.date) continue;
            if (binding.sessionSource.kind === 'manual' && (
                occurrence.data.definitionRef.definitionId !== binding.sessionSource.definitionId
                || occurrence.data.definitionRef.revision !== binding.sessionSource.revision
                || occurrence.data.definitionRef.contentHash !== binding.sessionSource.contentHash
            )) continue;

            const expectedAuthority = audit?.authoredOccurrence?.occurrenceId === binding.occurrenceId
                ? 'replace_recommendation'
                : audit?.additionalSessions?.some(item => sessionBindingEvidenceKey(item) === sessionBindingEvidenceKey(binding))
                    ? 'additional_session'
                    : null;
            if (expectedAuthority && occurrence.data.authority !== expectedAuthority) continue;
        }

        // The resolver binds the hash-covered source identity and prescription.definitionHash
        // to the exact source bytes for every source kind (M3.2 gave `catalog` the same
        // definitionHash verification manual/external/fixture already had, reconstructed
        // from the stored prescription's displayMetadata snapshot rather than the live
        // catalog -- see the resolver for the one-time fallback on pre-M3.2 prescriptions
        // that predate that snapshot).
        resolvedBindings.add(sessionBindingEvidenceKey(binding));
    }
    return replayRecommendationAudit(recommendation, externalRevision, { resolvedBindings });
}
