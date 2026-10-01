import type { SessionDefinition, SessionReferenceBinding } from './models';
import type { AnyExternalPlanSession } from './externalPlanV2';
import { isDefinitionBearingExternalSession, type DefinitionBearingExternalSession } from './externalPlanV2';
import type { ExternalSessionVerdict } from '../engine/externalSession';

/** A fully persisted definition plus the immutable execution snapshot that will run it. */
export interface PreparedSessionLaunch {
    definition: SessionDefinition;
    binding: SessionReferenceBinding;
    allowDuplicateCompleted?: boolean;
}

/** Shared lifecycle guard for every path that starts a saved definition by its header --
 * a direct pick from the saved-session library, or a companion resolved from `definitionRef`
 * against that same list. An archived header must never reach an active execution regardless
 * of which of those paths found it. */
export function archivedSavedDefinitionError(header: { status?: 'active' | 'archived' }, label: string): string | null {
    return header.status === 'archived'
        ? `${label} is archived -- restore it before starting.`
        : null;
}

/** Adjudication and display inputs that decide whether an external session may launch. */
export interface ExternalSessionLaunchEligibility {
    /** Only `proceed` and `scale` are executable; `skip`/`defer`/`advisory` never launch. */
    verdictDecision: ExternalSessionVerdict['decision'] | undefined;
    /** Advisory target events are fixed-activity inputs, never primary sessions. */
    isEvent?: boolean;
    /** Authored rest never exposes a Start path. */
    templateId?: string;
}

/**
 * Composition-time eligibility for the canonical external launch path (PR-B, #893 WP3.1):
 * a definition-bearing external session (v2+ by capability, never a v1 flat
 * prescription) under an executable verdict, excluding advisory events and authored
 * rest. A type predicate so callers passing it keep the narrowed session for
 * `prepareExternalPlanSessionLaunch` without re-checking the shape.
 */
export function canLaunchExternalPlanSession(
    session: AnyExternalPlanSession | null | undefined,
    eligibility: ExternalSessionLaunchEligibility,
): session is DefinitionBearingExternalSession {
    if (!session || !isDefinitionBearingExternalSession(session)) return false;
    if (eligibility.verdictDecision !== 'proceed' && eligibility.verdictDecision !== 'scale') return false;
    if (eligibility.isEvent === true) return false;
    if (eligibility.templateId === 'rest_01') return false;
    return true;
}

/** The display-side immutable source identity of today's imported session. */
export interface ExternalPrescriptionIdentity {
    planId: string;
    revision: number;
    sessionId: string;
    scaling?: {
        reducible?: boolean;
        reducedDefinition?: SessionDefinition;
    };
}

/** Runtime evidence created after the source-neutral authoring adapter has frozen an
 * executable external snapshot. Full and reduced forms intentionally share source identity,
 * so the prescription hash is the discriminator that proves which exact bytes will run. */
export interface PreparedExternalLaunchEvidence {
    variant: 'full' | 'reduced';
    prescriptionHash: string;
}

/**
 * #949: whether Home may start `binding` under today's `scale` verdict.
 *
 * ADR-0023 D-MSNAP separates immutable source identity from the content-addressed execution
 * prescription. A full and reduced v6 launch therefore have the same external-plan source
 * but different prescription hashes. Start is available only when Home records that the
 * reduced variant was prepared and that proof names the exact
 * `primarySession.prescriptionHash`; matching plan/revision/session alone is insufficient.
 */
export function isPreparedReducedExternalBinding(
    prescription: ExternalPrescriptionIdentity | null | undefined,
    binding: SessionReferenceBinding | null | undefined,
    prepared: PreparedExternalLaunchEvidence | null | undefined,
): boolean {
    if (!prescription || !binding || !prepared) return false;
    if (prescription.scaling?.reducible !== true || !prescription.scaling.reducedDefinition) return false;
    if (!binding.prescriptionHash || !prepared.prescriptionHash) return false;
    if (prepared.variant !== 'reduced' || prepared.prescriptionHash !== binding.prescriptionHash) return false;
    const source = binding.sessionSource;
    return source.kind === 'external_plan'
        && source.planId === prescription.planId
        && source.revision === prescription.revision
        && source.sessionId === prescription.sessionId;
}
