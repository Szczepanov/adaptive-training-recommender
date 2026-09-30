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
