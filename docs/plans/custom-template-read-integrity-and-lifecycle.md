# Custom-template read integrity and lifecycle

* **Status:** `Implemented`
* **Blocked by:** none. The Firestore suite is intentionally run with one worker locally because
  parallel files contend for a single emulator.
* **Unlocks:** reliable preview/start/resume for existing custom templates; a bounded,
  revision-safe template library.
* **Source analysis:**
  [`2026-08-28-custom-template-preview-and-library.md`](../analysis/2026-08-28-custom-template-preview-and-library.md)
* **Governing decisions:** [ADR-0023](../adr/0023-multidomain-session-authoring-execution-and-evidence.md)
  D-MSESSION, D-MRECORDS, D-MSNAP, and D-MCHOICE.

---

## Goal

Make every valid custom `SessionDefinition` revision written by the app readable and
hash-verifiable by Preview, Start, authored-occurrence resolution, and resume/replay without
migrating existing documents. Then add the smallest template-management lifecycle consistent
with immutable revisions: refresh, edit, duplicate, archive, and restore.

## Preconditions and fixed decisions

* Existing documents remain at
  `users/{userId}/session_definitions/{definitionId}/revisions/{revision}`.
* `SessionDefinition` remains the strict executable-content contract. Persistence metadata is
  decoded outside `validateSessionDefinition`; it is never added to
  `SESSION_DEFINITION_KEYS` merely to make Firestore reads pass.
* Existing definition revisions remain write-once. Editing creates `revision + 1`; it never
  mutates revision `N`.
* Built-in templates remain repository-owned fixtures/catalog content. Custom templates
  remain user-owned Firestore definitions.
* Archive is a reversible header state. No immutable revision, occurrence, execution,
  prescription, recommendation, or audit is deleted.
* This plan changes authoring/storage/UI behavior only. It does not change recommendation
  selection, fatigue, eligibility, or policy version.

## Task board

| Item | Status | Depends on | Outcome |
|---|:---:|---|---|
| CT0 | `[x]` | — | Persisted custom definitions round-trip through one verified read boundary |
| CT1 | `[x]` | CT0 | Custom-template save/list/start behavior is coherent and regression-covered |
| CT2 | `[x]` | CT0, CT1 | Edit, duplicate, archive, and restore use immutable revision semantics |
| CT3 | `[x]` | CT0–CT2 | Full validation, emulator, build, and docs verification is complete |

---

## CT0 `[x]` — Resolved persisted definition codec and integrity boundary

**Historical finding (resolved).** `sessionDefinitionService.ts` `saveDefinitionRevision` writes a flat
domain-plus-metadata document. `sessionDefinition.ts` `parseSessionDefinitionDocument`
validates the whole object as a `SessionDefinition`, so strict unknown-field validation
rejects the writer's `userId`, `definitionId`, `contentHash`, and `createdAt` fields.

**Delivered implementation.**

1. In `app/src/persistence/parsers/sessionDefinition.ts`, replace the direct whole-document
   cast with an explicit persisted-revision decoder. Validate the persistence envelope and
   path identity separately:
   `userId`, `definitionId`, `id`, `revision`, `contentHash`, and `createdAt` must have the
   expected types and must agree with the requested user, document ID, and revision.
2. Construct the candidate `SessionDefinition` by selecting only the canonical definition
   fields, then call `validateSessionDefinition` on that candidate. Unknown executable fields
   must still fail closed; transport fields must never appear in the returned domain object.
3. In `app/src/services/sessionDefinitionService.ts` `getDefinitionRevision`, recompute
   `hashSessionDefinition` over the decoded definition and compare it with the stored
   `contentHash` before returning `AVAILABLE`. Return a specific `DataIssue` for envelope,
   identity, schema, and hash failures.
4. Keep `SessionRunner.tsx`, `sessionDefinitionResolver.ts`, and `useSessionRunner.ts` on this
   single service boundary. Do not add a preview-only fallback or strip fields in UI code.
5. Add `companionSessions` to `firestore.rules`
   `hasValidSessionDefinitionRevision` and require it to be a list when present. Extend the
   emulator fixture to exercise a revision containing every currently supported optional
   top-level field so domain/rules drift is visible.

**Files.** `app/src/persistence/parsers/sessionDefinition.ts`, a new adjacent parser test,
`app/src/services/sessionDefinitionService.ts`, `app/src/sessions/validation.ts` only if a
shared canonical field-name export is required, `app/firestore.rules`, and
`app/src/emulator/firestoreRules.emulator.test.ts`.

**Verification added.**

* A document shaped exactly like `saveDefinitionRevision` output parses to `AVAILABLE` and
  returns a metadata-free `SessionDefinition`.
* The existing shape with no `companionSessions` remains readable without migration.
* A complete shape with `companionSessions`, targets, warnings, modalities, and prohibited
  additions is accepted by both the decoder and Firestore rules.
* Wrong `userId`, path/document `definitionId`, `id`, or revision returns `INVALID`.
* A changed executable field with the old `contentHash` returns `INVALID`.
* An invented executable top-level field still returns `INVALID`.
* Missing data is `MISSING`; permission denial is still thrown; transport failure remains
  retryable `UNAVAILABLE`.

**Delivered result.** A revision written before this fix can be previewed, started, resolved as a
manual source, and used to restore an execution with no data rewrite; corrupted identity or
content still fails closed.

---

## CT1 `[x]` — Delivered coherent save, list, preview, and start workflow

**Historical finding (resolved).** Revision and header writes were sequential; the picker loaded headers
only on mount; Preview and Start duplicate their loading/error logic; and
`useSessionRunner.ts` `saveAsNewTemplate` copies the choice-resolved execution view, which can
bake an already-applied choice effect into a definition that still contains the same choice.

**Delivered implementation.**

1. In `sessionDefinitionService.ts` `saveDefinitionRevision`, validate the definition,
   compute or independently verify its hash at the service boundary, and commit the immutable
   revision plus header pointer in one Firestore batch. Return a typed save result containing
   the stored header/hash instead of making callers reconstruct it.
2. Add one `loadLatestDefinition(header)` service or hook boundary used by both Preview and
   Start. Map `MISSING`, `INVALID`, and `UNAVAILABLE` to distinct actionable UI messages while
   retaining structured `DataIssue` details for diagnostics.
3. Extract custom-template library loading/refresh state from `SessionRunner.tsx` so every
   successful save updates the current picker immediately. A save must not require a route
   remount to become visible.
4. In `useSessionRunner.ts`, make the reusable save source explicit. Preserve deliberate
   exercise substitutions made to the working definition, but do not silently persist
   choice outcomes already folded by `resolveEffectiveSession` while retaining the original
   option actions. Add a pure helper that creates the new-template definition with a stable
   new ID, revision 1, requested title, and validated reusable content.
5. Use collision-resistant IDs (`crypto.randomUUID` or an equivalent repository helper)
   rather than millisecond timestamps for new custom definitions.
6. Standardize UI language in `SessionRunner.tsx`: built-in templates, custom templates,
   and active/scheduled sessions are different concepts.

**Files.** `app/src/services/sessionDefinitionService.ts`,
`app/src/hooks/useSessionRunner.ts`, `app/src/components/session/SessionRunner.tsx`, a small
custom-template library hook/service if extraction keeps the runner bounded, and focused
unit/component tests.

**Verification added.**

* Revision and header writes succeed or fail atomically; a failed header update cannot leave
  an unretryable visible save.
* Preview and Start receive the same verified definition for a custom header.
* A newly saved template appears in the picker immediately and can be previewed.
* Saving after an exercise substitution preserves the substitution.
* Saving after answering a reduce-load/reduce-sets/select-alternative choice does not create a
  template that applies the same choice effect twice on its next execution.
* Concurrent loading indicators disable only the affected template action, not every card.

**Delivered result.** Save → visible card → Preview → Start works in one mounted screen, and the
definition started is byte-equivalent to the verified reusable definition the preview showed.

---

## CT2 `[x]` — Delivered bounded custom-template management

**Historical finding (resolved).** The custom-template list could preview and start only. The manual builder
always creates a new identity, and the header has no reversible retirement state.

**Delivered implementation.**

1. Extend `SessionDefinitionHeader` and Firestore rules with a closed lifecycle such as
   `status: 'active' | 'archived'` plus `archivedAt` when archived. Treat missing `status` on
   existing headers as `active` for backward compatibility; new writes always set it.
2. Add **Edit**, **Duplicate**, and **Archive** actions to custom-template cards, plus an
   archived view with **Restore**. Do not expose hard deletion.
3. Update `ManualSessionBuilder.tsx` to accept an optional verified initial definition and
   save mode:
   * edit preserves `definitionId` and stable nested IDs, then writes `latestRevision + 1`;
   * duplicate assigns a new definition ID and revision 1;
   * a brand-new build keeps the existing new-definition behavior.
4. Before saving an edit, re-read the header. If another writer advanced the revision, stop
   with a conflict message and offer reload or duplicate; never overwrite or silently fork
   the same revision number.
5. Preview identifies the current revision and, when opened from archived history, makes the
   archived state visible. Starting an archived template is disabled until restored.

**Files.** `app/src/services/sessionDefinitionService.ts`,
`app/src/components/session/SessionRunner.tsx`,
`app/src/components/session/ManualSessionBuilder.tsx`, `app/src/App.tsx` for authoring-route
state, `app/firestore.rules`, emulator tests, and component/visual scenarios.

**Verification added.**

* Editing revision 1 creates revision 2, advances the header, and leaves revision 1 readable.
* An occurrence pinned to revision 1 still resolves revision 1 after revision 2 is current.
* Duplicate creates an independent ID at revision 1 with the same executable content.
* Archive hides a template from the default picker, preserves all revisions, and Restore
  returns it without changing the latest revision.
* A stale edit cannot overwrite a concurrently created revision.
* Another user cannot list, preview, edit, archive, or restore the owner's templates.

**Delivered result.** A custom template can evolve or be retired without mutating/deleting history,
and every management transition is reversible except creation of an immutable revision.

---

## CT3 `[x]` — Completed verification, visual coverage, and documentation

**Completed verification.**

1. Add desktop and 390 px visual-review fixtures for built-in/custom sections, a custom
   preview, an invalid custom template, edit conflict, and archived templates.
2. Add an integration scenario using the Firestore emulator that writes a real custom
   definition through the production codec/service and reads it through the production
   decoder before preview/start assertions.
3. Run the frontend validation, build, and Firestore rules suites.
4. Update living documentation to describe the now-implemented persisted codec and template
   lifecycle. Update this plan's task board and headings together as items land.

**Verification evidence.**

* `cd app && npm run check`
* `cd app && npm run build`
* `cd app && firebase --project demo-adaptive-training emulators:exec --only firestore "npx vitest run src/emulator/firestoreRules.emulator.test.ts --maxWorkers=1"` — 88 passed
* `cd app && npm run visual:refresh`

No simulation diff or `POLICY_VERSION` increment is required unless implementation escapes
this plan and changes recommendation decisions.

**Delivered result.** All named tests pass, visual artifacts show no mobile regression, and the
living docs match the shipped behavior.

---

## Acceptance criteria

* [x] The previously saved Upper-Body Strength Maintenance custom template previews without
      migration.
* [x] Preview and Start use the same hash-verified latest revision.
* [x] Manual-source resolution and active-session restore work for existing custom revisions.
* [x] Persistence metadata never enters returned `SessionDefinition` content or its hash.
* [x] Unknown executable fields, path-identity mismatch, and hash mismatch fail closed.
* [x] `companionSessions` can be saved under Firestore rules and round-tripped.
* [x] Save is atomic across revision and header, and the picker refreshes immediately.
* [x] Reusable saves do not double-apply execution-time choice outcomes.
* [x] Edit creates a new immutable revision; duplicate creates a new identity.
* [x] Archive/restore preserves historical references and exposes no hard-delete UI.
* [x] User isolation is emulator-tested for every new management transition.
* [x] Built-in template preview/start behavior is unchanged.

## Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Metadata stripping accidentally accepts invented executable content | Select a closed canonical field set, then run the unchanged strict definition validator | Revert the codec change; existing documents are untouched |
| Existing stored bytes have a bad hash | Fail closed with a specific integrity issue; do not rewrite the immutable revision | Hide/diagnose the affected header; duplicate only after explicit user review |
| Revision/header batching changes offline behavior | Test emulator failure and reconnect paths; preserve write-once rules | Keep CT0 decoder fix and revert batching/UI changes independently |
| Editing breaks historical replay | Never mutate a revision; occurrences remain pinned to revision/hash | Disable Edit while retaining Preview/Start and immutable history |
| Archive schema makes old headers invalid | Parse missing status as active and allow additive header migration | Revert archive UI/rules; no revision data is changed |
| Management scope expands into a general content platform | Hold the out-of-scope boundary below | Ship CT0/CT1 and defer CT2 without blocking the read repair |

## Out of scope

* hard deletion or bulk migration of existing definitions;
* tags, folders, search, sharing, coach/team tenancy, or marketplace features;
* AI prose-to-template generation (ADR-0023 M9.2 remains separately triggered);
* user-confirmed custom movement metadata (M9.1 remains separately triggered);
* editing repository-owned built-in templates in the app;
* merging catalog/fixture storage with custom Firestore definitions;
* changing occurrence authority, recommendation selection, safety gates, fatigue, stimulus,
  or outcome evidence;
* changing the `SessionDefinition` schema version solely for persistence-envelope repair.

## Documentation outcomes

* The persisted definition codec and custom-template lifecycle are recorded in
  [`docs/architecture/session-execution.md`](../architecture/session-execution.md), created by
  this work.
* `docs/plans/multidomain-session-authoring-execution-and-evidence.md` was left unchanged: no
  acceptance-checklist or current-state statement there needed updating for this fix.
* ADR-0023 remains immutable; this work did not propose hard deletion, mutable revisions, or a
  different ownership/versioning model, so no new ADR was written.
