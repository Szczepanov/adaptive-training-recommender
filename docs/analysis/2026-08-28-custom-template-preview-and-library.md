# Custom-template preview failure and saved-template lifecycle analysis (2026-08-28)

**Question.** Why can the structured-session picker preview reviewed built-in workouts but
show `The saved session cannot be read safely.` for a custom template such as
Upper-Body Strength Maintenance, and should template management change with the fix?

**Verdict.** The preview renderer is not the failing component. Saved definition revisions
are written as a flat Firestore document containing the canonical `SessionDefinition` plus
four persistence fields: `userId`, `definitionId`, `contentHash`, and `createdAt`.
`parseSessionDefinitionDocument` passes that whole document to the deliberately strict
`validateSessionDefinition`, which rejects all four persistence fields as unrecognized
executable content. Every normally written custom revision therefore parses as `INVALID`.
Reviewed built-ins preview because they are imported JSON fixtures and never cross this
broken persistence boundary.

The smallest safe repair is to decode and validate the persistence envelope separately,
extract only canonical definition fields, validate the resulting `SessionDefinition`, and
verify its stored SHA-256 hash before returning it. Do not add persistence metadata to the
domain validator's accepted field list: ADR-0023 D-MSESSION and D-MSNAP explicitly keep
source/transport metadata outside executable content and outside its canonical hash.

This defect predates the structured-preview feature. The feature made it visible by adding
another caller of `SessionDefinitionService.getDefinitionRevision`; it did not introduce the
bad document shape or parser.

---

## Evidence and failure trace

### The write and read contracts cannot round-trip

`sessionDefinitionService.ts` `saveDefinitionRevision` writes this flat shape:

```text
SessionDefinition fields
+ userId
+ definitionId
+ contentHash
+ createdAt
```

`sessionDefinition.ts` `parseSessionDefinitionDocument` then calls
`validateSessionDefinition(raw)` on the complete Firestore document.
`validation.ts` `SESSION_DEFINITION_KEYS` intentionally contains only executable definition
fields. Its unknown-top-level-field check therefore reports:

```text
Unrecognized session definition field(s): userId, definitionId, contentHash, createdAt
```

`SessionRunner.tsx` `previewSavedDefinition` collapses every `INVALID` or `UNAVAILABLE`
result into `The saved session cannot be read safely.`, which is the observed message.

### Built-ins take a different route

`SessionRunner.tsx` `AVAILABLE_FIXTURES` contains reviewed JSON definitions already shaped as
`SessionDefinition`. Previewing one puts that object directly into `previewDefinition`.
There is no Firestore read, no persistence metadata, and therefore no parser failure.

### The blast radius is wider than Preview

The same `getDefinitionRevision` boundary is used by:

* `SessionRunner.tsx` `startSavedDefinition`;
* `SessionRunner.tsx` `startCompanion` for a saved manual companion;
* `sessionDefinitionResolver.ts` `resolveSessionDefinition` for manual source references;
* authored-occurrence composition and replay callers that use that resolver; and
* active manual-session restoration through `useSessionRunner`.

Consequently this is a stored-manual-definition read defect, not a preview-only defect.
Patching `SessionDefinitionPreview` or special-casing `previewSavedDefinition` would leave the
other paths broken and create two definitions of "safe to read."

### Current tests miss the actual boundary

`SessionRunner.test.tsx` renders static markup with the definition service mocked and asserts
that the word `Preview` exists. It never loads a saved revision.
`sessionDefinitionResolver.test.ts` mocks `getDefinitionRevision` as already `AVAILABLE`.
The Firestore rules test proves that a persistence-shaped document may be written and that a
revision is immutable, but never feeds those retrieved bytes through the application parser.
There is no writer-to-parser round-trip test for a session definition revision.

---

## Adjacent contract drift found during the trace

### `companionSessions` is valid domain content but not writable under current rules

`SessionDefinition`, `validateSessionDefinition`, and reviewed fixture 03 support
`companionSessions`. `hasValidSessionDefinitionRevision` in `firestore.rules` omits it from
the revision document's `hasOnly` list. Saving a custom copy of a definition that retains a
companion can therefore fail even after the read parser is repaired. The rules and emulator
corpus need to cover every supported optional top-level definition field.

### A save is not atomic across revision and header

`saveDefinitionRevision` writes the immutable revision first and advances the mutable header
in a second request. If the first succeeds and the second fails, the revision is orphaned and
a retry attempts to overwrite a write-once path. A batched write is the smallest correction;
the existing rules still provide the create-only revision guard.

### "Save as Custom Template" snapshots the effective execution view

`useSessionRunner` exposes `definition` as the choice-resolved view from
`resolveEffectiveSession`. `saveAsNewTemplate` copies that view. If the athlete answered an
authored choice, its dose/load/option effects may already be folded into the copied steps
while the original option set remains present. Selecting that option in a later execution can
apply the effect again. Exercise substitutions mutate the raw working definition and are
reasonable to preserve; recorded one-off choice outcomes should not be silently baked in on
top of reusable choices. The save path needs an explicit reusable-definition source.

### The library is a list, not yet a lifecycle

The current saved-session library loads once when `SessionRunner` mounts. A newly saved custom
template does not appear until the screen remounts. There is no way to edit a template into a
new immutable revision, duplicate it intentionally, or retire it without deleting historical
identity. The user-facing vocabulary also alternates among "saved session," "custom
template," and "structured session" even though ADR-0023 distinguishes reusable definitions
from occurrences and executions.

---

## Recommended product and architecture boundary

Use **template** for reusable selectable content in the UI, while retaining
`SessionDefinition` as the domain name. Use **session** for a scheduled occurrence or an
execution. Present two template sources in one picker:

```text
Built-in templates (reviewed, repository-owned)
Custom templates (user-owned immutable revisions)
```

For custom templates, keep a deliberately small lifecycle:

* **Preview** and **Start** load the same verified latest revision;
* **Edit** creates revision `N + 1` under the same definition ID;
* **Duplicate** creates a new definition ID at revision 1;
* **Archive** hides the header from the default picker but preserves every revision and every
  occurrence/execution reference;
* **Restore** reverses archive; and
* saving a workout-derived custom template refreshes the picker immediately and previews the
  exact reusable bytes that were saved.

Do not add hard deletion to the first management increment. Historical occurrences,
executions, prescriptions, and audits can refer to an immutable definition revision, so
archive is the safer product operation. Do not merge built-in templates into user Firestore
storage; their ownership and versioning are different.

The executable plan is
[`custom-template-read-integrity-and-lifecycle.md`](../plans/custom-template-read-integrity-and-lifecycle.md).

---

## Priority and scope recommendation

1. **P0 — repair and prove the persisted read boundary.** This restores Preview, Start,
   manual resolution, and resume/replay for existing saved revisions without migration.
2. **P1 — make saving and listing coherent.** Use an atomic write, refresh immediately, share
   one verified loader, and ensure reusable saves do not double-apply recorded choices.
3. **P2 — add bounded management.** Edit-as-new-revision, duplicate, archive, and restore;
   no deletion, tagging, sharing, or AI authoring.

No recommendation-engine selection rule changes. `POLICY_VERSION`, scenario baselines, and
physiological calibration are unaffected.
