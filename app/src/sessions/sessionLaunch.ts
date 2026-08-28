import type { SessionDefinition, SessionReferenceBinding } from './models';

/** A fully persisted definition plus the immutable execution snapshot that will run it. */
export interface PreparedSessionLaunch {
    definition: SessionDefinition;
    binding: SessionReferenceBinding;
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
