import type { SessionDefinition, SessionReferenceBinding } from './models';

/** A fully persisted definition plus the immutable execution snapshot that will run it. */
export interface PreparedSessionLaunch {
    definition: SessionDefinition;
    binding: SessionReferenceBinding;
}
