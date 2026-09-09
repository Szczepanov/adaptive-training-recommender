# Session execution architecture

This document describes the persisted structured-session execution model and its key UI/service contracts.

## Stored definitions and executions

A `SessionDefinition` is the reusable prescription. A `SessionExecution` is one performed or in-progress instance of that prescription. Executions carry the prescription hash and source provenance so an in-progress session can restore the exact snapshot that was launched rather than resolving a potentially newer template revision.

An execution is user-scoped. Its performed evidence is stored as `SessionEntry` records tied to the execution and authored step IDs. Choice entries record athlete decisions separately from work entries, so branch selection remains auditable and does not silently mutate the authored prescription.

## Launch authority

Structured sessions can come from reviewed fixtures, saved custom templates, imported JSON, manual authoring, or a recommendation/plan occurrence that already resolved a stored prescription. The runner does not grant recommendation-selection authority to an unplanned launch: template/fixture/manual/import launches use the unplanned session source contract, while recommendation/plan launches keep their bound occurrence and prescription hash.

A stored execution whose exact prescription cannot be restored fails closed. The runner does not let the athlete start a second session over ambiguous in-progress state.

## Progression and performed evidence

The runner treats the authored definition as the prescription and entries as performed evidence. Sequential multi-set work remains on the current step until its required entries are complete. Rotating groups use persisted group progress rather than authored list order alone. Choice points can alter effective execution flow, but the selected choice is itself recorded as evidence.

The step-navigation and completion displays derive from the same target-entry rules used by group progression, preventing display logic from claiming a grouped step is complete while execution logic still expects more work.

## Rest behavior

Rest timers are advisory rather than locks. Logging controls remain available while rest counts down. The preview shown during rest resolves the next actually due work from persisted progress, so sequential multi-set work previews the current exercise until its sets are complete and rotating groups preview the next group member.

Rest omission is block-aware. Authored rest is always preserved. Outside warm-up blocks, a step with
no authored rest retains the runner's legacy 60-second advisory fallback. Inside a structured warm-up,
omission means no countdown is invented: simple preparation drills flow directly into the next drill,
while lift-specific rehearsal that needs recovery must carry an explicit authored rest value.

## Custom-template lifecycle

The collection document is a mutable `SessionDefinitionHeader`; definition revisions are
write-once. `saveDefinitionRevision` validates and hashes the definition, then batch-writes the
new revision and latest-revision header atomically.

* **Save** creates a new definition at revision 1 and refreshes the session picker.
  Save is a secondary action inside the completion dialog rather than the active-run top bar,
  so it cannot fire accidentally mid-set. Opening its title editor hands off from the completion
  dialog rather than stacking modal layers, then returns to completion after save/cancel. The
  saved template still derives from the raw working definition.
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
