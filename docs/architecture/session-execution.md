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

## Catalog warm-ups and execution logging

Catalog strength prescriptions begin with an explicit `warmup` block. The catalog adapter preserves
that role, step dose/rest, and any bounded structured load into the content-addressed execution
prescription. The runner shows the load instruction as stored; it does not derive a kilogram target
from a percentage or profile during rendering.

For a repetition step, `SessionRunner` passes the active block role into `RepetitionInputCard`.
Entries from a prescribed `warmup` block default to `isWarmup: true`; other blocks default to false.
The athlete can correct the checkbox before logging, and the recorded value remains the historical
fact used by downstream strength-volume and estimated-1RM exclusion filters. Stored execution
prescriptions carry their blocks and display metadata, so a later catalog warm-up revision cannot
rewrite an already-started or historical session.

Repetition submission is single-flight at the input surface: while one set is being persisted, a
second Enter/click is ignored and the log button is disabled. This prevents rapid duplicate submits
from deriving the same ordinal `setIndex` from one rendered entry snapshot. Rest timing is deliberately
separate from persistence timing: the countdown starts when the set is optimistically accepted into
the execution UI, before the asynchronous write. A delayed write completion therefore cannot restart
a timer that the athlete has already skipped or adjusted. The timer remains advisory and does not lock
the set form.

Rest omission is block-aware. Authored rest is always preserved. Outside warm-up blocks, a step with
no authored rest retains the runner's legacy 60-second advisory fallback. Inside a structured warm-up,
omission means no countdown is invented: simple preparation drills flow directly into the next drill,
while lift-specific rehearsal that needs recovery must carry an explicit authored rest value.

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
