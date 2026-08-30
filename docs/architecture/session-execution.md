# Session execution and saved-template lifecycle

This is the living reference for source-neutral session execution. Design rationale lives in
[ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md); this document
describes the current application behavior.

## Content and persistence boundary

`SessionDefinition` is executable content only. A custom definition revision is stored at
`users/{userId}/session_definitions/{definitionId}/revisions/{revision}` as a flat document
whose envelope adds `userId`, `definitionId`, `contentHash`, and `createdAt`.

`parseSessionDefinitionRevisionDocument` validates that envelope against the requested path,
selects the closed `SESSION_DEFINITION_KEYS` content set, and then runs
`validateSessionDefinition`. `SessionDefinitionService.getDefinitionRevision` recomputes the
canonical `hashSessionDefinition` before returning the definition. Invalid identity, envelope,
schema, or hash data returns `INVALID`; executable content is never silently repaired.

This one verified service read is used by preview, starting a saved template, manual-source
resolution, and active-session restoration. Existing correctly written revisions need no
migration: their storage shape is decoded as an envelope rather than mistaken for domain
content.

## Custom-template lifecycle

The collection document is a mutable `SessionDefinitionHeader`; definition revisions are
write-once. `saveDefinitionRevision` validates and hashes the definition, then batch-writes the
new revision and latest-revision header atomically.

* **Save** creates a new definition at revision 1 and refreshes the session picker.
* **Edit** loads the verified latest revision and saves the same definition ID at revision N+1.
* **Duplicate** loads the verified latest revision, assigns a new definition ID, and saves
  revision 1.
* **Archive** marks the header `archived`; it does not delete revisions or historical
  references. Archived templates can be previewed and restored, but cannot start until
  restored.

Headers written before lifecycle support omit `status`; readers treat them as `active`.
New headers always write `active` or `archived`, with `archivedAt` only for archived headers.

## Reusable content versus one-time execution choices

The runner retains a raw working definition and may expose a choice-resolved effective
definition for the current execution. Saving a custom template derives from the raw working
definition: deliberate exercise substitutions are retained, but a one-time selected choice is
not baked into the template while leaving the same option set available for a later execution.

## Rules and tests

Firestore rules enforce user ownership, immutable revision creation, valid header lifecycle,
and the full allowed definition field set including `companionSessions`. The parser and service
tests cover writer-shaped documents, strict envelope validation, hash mismatch, batched writes,
and archive/restore. Visual coverage exercises custom-template preview and the archived library
at desktop and 390px mobile widths.
