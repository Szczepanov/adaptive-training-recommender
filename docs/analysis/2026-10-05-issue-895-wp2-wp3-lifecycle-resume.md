# Issue #895 WP2 + WP3 — lifecycle and exact-resume architecture analysis

| | |
|---|---|
| **Type** | Point-in-time analysis (`docs/analysis`: what is true today) |
| **Issue** | [#895 — structured execution as the canonical lossless training record](https://github.com/Szczepanov/adaptive-training-recommender/issues/895) |
| **Scope** | WP2 lifecycle hardening + WP3 exact resume |
| **Baseline** | `origin/main` `007602f8e5be5901509e9aba1803dd2b21620988` (2026-10-05) |
| **Prior delivery** | [PR #993](https://github.com/Szczepanov/adaptive-training-recommender/pull/993) — WP0/WP1 durable diary; [PR #995](https://github.com/Szczepanov/adaptive-training-recommender/pull/995) — append-only choice replay |
| **Architecture sources** | ADR-0023 D-MRECORDS / D-MENTRY / D-MSNAP; `docs/architecture/session-execution.md`; #895 master plan |
| **Policy effect** | None. Persistence, lifecycle and replay correctness only; `POLICY_VERSION` must not change. |

## 1. Executive conclusion

WP2 and WP3 should remain one implementation PR.

They share the same integrity boundary: a `SessionExecution` is the stable identity of the workout in progress; its terminal state may change once; the exact executable content must remain pinned; and reload must reconstruct only what durable evidence proves. Splitting lifecycle and resume would leave one of those guarantees dependent on stale React state, live fixture bytes, or an unclassified Firestore rules rejection.

The current code is materially stronger than the September #895 baseline because WP0/WP1, execution locks, immutable prescriptions, wall-clock timing and append-only choice semantics have already landed. The remaining work is narrow, but the first draft of this WP2/WP3 plan needed three corrections found during this review:

1. **Post-terminal work must be convergent, not merely winner-only.** The first draft allowed response/occurrence/reconciliation fan-out only for the client whose terminal write returned `transitioned`. That avoids duplicate calls but opens a crash window: the execution can become `completed` while the winning client dies before downstream state converges. Same-state occurrence transitions and training-occurrence reconciliation are already retry-safe. Immediate response facts require a durable canonical input before retry because `recordOrUpdateResponse` can update an existing response and a race loser may hold different local payload bytes.
2. **Pinning a fixture hash is not sufficient for exact fixture replay with the current prescription schema/resolver.** `resolveSessionDefinition` first loads the current fixture and requires its definition hash to match the stored prescription. Reviewed fixtures contain hash-covered fields such as `modalities`, `sessionTargets` and `prohibitedAdditions`, while `ExecutionPrescription` currently stores blocks plus a smaller `displayMetadata` set. If fixture bytes later change or disappear, the current resolver cannot reconstruct the historical definition from the prescription alone. WP3 therefore needs a snapshot-completeness change, not only a fixture-start helper.
3. **Receipt overlays must distinguish queued canonical intent from rejected intent and must replay same-target mutations causally.** A `failed` receipt is evidence that a locally accepted write was rejected; it must never be folded into canonical `entries` or progress. Multiple queued mutations for one entry (log → correct → delete → restore) cannot rely on `localStorage` enumeration order. The resume projection needs deterministic mutation-chain application or an equivalent verified ordering.

With those corrections, the WP2/WP3 architecture is compliant with ADR-0023 and the #895 invariants and can be implemented without changing recommendation authority.

## 2. Current architecture verified on `main`

### 2.1 Execution creation and explicit redo

`SessionExecutionService.startExecution` already arbitrates execution creation through deterministic `session_execution_locks`.

For one logical slot:

- an `in_progress` execution is returned;
- a `completed` execution blocks ordinary start;
- `completed + allowDuplicateCompleted` deliberately creates one successor and moves the lock pointer;
- an `abandoned` execution may be replaced;
- predecessor documents remain immutable history.

Online arbitration is a Firestore transaction. Offline start uses an atomic SDK batch and lets rules arbitrate once connectivity returns. This is the correct model for explicit legitimate redo and should not be redesigned in WP2.

### 2.2 Terminal writes are rules-protected but application-blind

`SessionExecutionService.transitionExecution` currently constructs a partial patch and either appends it to a caller-owned `WriteBatch` or commits it directly. It does not read persisted lifecycle state and returns no outcome.

The hook therefore knows only its local React state. Two tabs may both enter completion while each still sees `in_progress`; Firestore rules protect the terminal document from being rewritten, but the losing client receives a generic write failure instead of a business result such as `already_completed` or `already_abandoned`.

WP2 must move that classification into the service. The hook must not parse Firestore error messages/codes as lifecycle truth.

### 2.3 Completion has two different atomicity classes

Current completion does:

1. close active rest while the execution is still in progress;
2. write tissue feedback when supplied;
3. reread persisted entries;
4. build deterministic 1RM derivations;
5. batch 1RM derivations with the execution transition to `completed`;
6. commit that batch;
7. persist the immediate `SessionResponse`;
8. transition the linked occurrence;
9. trigger structured-occurrence reconciliation.

The **1RM + terminal transition** atomicity is valuable and must remain. A failed completion batch cannot leave derived strength state committed against an execution that is still `in_progress`.

The later three operations are different: they are post-terminal projections/integrations. They are not in the terminal batch and therefore need an explicit convergence contract.

### 2.4 Why strict winner-only fan-out is insufficient

Suppose client A successfully commits the terminal batch and then closes/crashes before steps 7–9. Client B retries completion after reload and sees persisted `completed`.

If the implementation says “`already_completed` means exit without fan-out”, then:

- the occurrence may remain `active`;
- the immediate response may remain missing;
- structured reconciliation may be delayed indefinitely until some unrelated sweep repairs it.

That is not end-to-end idempotence; it is merely duplicate suppression.

The downstream services have different retry properties:

- `SessionOccurrenceService.transitionOccurrenceState` is same-state idempotent;
- `reconcileStructuredCompletion` is documented and implemented as repeat/concurrency safe through source-key claims;
- `SessionResponseService.recordOrUpdateResponse` uses a deterministic `(sourceSession, window)` id and transactional create/update, so it does not duplicate documents, **but repeated calls may overwrite facts**.

Therefore the correct rule is:

> The terminal state transition has one winner. Post-terminal convergence may run more than once, but every effect must use canonical persisted input and be idempotent or compare-and-set safe.

Occurrence transition and reconciliation can be repaired directly. Immediate-response repair may not replay a race loser's local payload. WP2 must first durably capture the canonical completion evidence (or atomically write the response) before a later retry is allowed to converge it.

This does **not** require a second diary outbox. It requires one durable terminal/completion-evidence contract for facts that otherwise exist only in the winning component's memory.

### 2.5 Abandonment

`abandonSession` has the same local-only state guard and closes active rest before terminal transition. Already logged diary entries are not deleted, which correctly satisfies #895's “abandoned with partial evidence retained” invariant.

Occurrence abandonment is same-state retry-safe and can be converged from persisted terminal state.

### 2.6 Durable diary state from WP1

PR #993 established the correct ownership model:

- `SessionExecutionService` is the sole diary write authority;
- Firebase persistent cache is the only writer replay queue;
- entry/rest target + immutable `diaryMutations` marker + execution touch are queued atomically;
- correction history is auditable;
- deletion uses tombstones;
- undo is durable;
- owner/execution/mutation-scoped receipts survive reload and retain failed intent;
- `watchDiarySync` distinguishes queued from synced and retains failed receipts.

PR #995 additionally made choice events append-only and gives performed entries explicit governing-choice provenance.

WP3 must consume those contracts; it must not create another mutation writer or resend receipt payloads.

## 3. WP2 architecture

### 3.1 Local single-flight is necessary but not authoritative

`startInFlightRef` already protects launch. Completion/abandonment need an equivalent shared `terminalTransitionInFlightRef` so same-tab double taps cannot enter terminal orchestration twice before React state updates.

That guard is a UX/process optimization only. Persisted-state classification remains the cross-tab/stale-client authority.

### 3.2 Typed terminal result

A narrow service contract should distinguish at least:

```ts
type TerminalTransitionOutcome =
    | { kind: 'transitioned'; execution: SessionExecution }
    | { kind: 'already_completed'; execution: SessionExecution }
    | { kind: 'already_abandoned'; execution: SessionExecution };
```

For requested `completed`:

- persisted `completed` → idempotent lifecycle result;
- persisted `abandoned` → conflicting terminal result, never rewrite;
- persisted `in_progress` → eligible transition.

For requested `abandoned`, mirror the same rules.

Missing/invalid/unavailable execution state remains a real error.

### 3.3 Preserve the terminal + deterministic-derivation atomic unit

Completion must continue to commit deterministic 1RM derivations in the same atomic unit as the execution transition.

A suitable service shape is a terminal commit helper that:

1. reads/classifies the exact execution;
2. returns an already-terminal result before writing when possible;
3. lets the completion path contribute deterministic derived writes;
4. adds the terminal transition;
5. commits once;
6. when a racing commit is rejected, rereads the execution and translates an observed terminal state to the typed outcome;
7. rethrows when the execution remains `in_progress` or the failure cannot be explained by a competing terminal commit.

The service/rules boundary, not the hook, owns this logic.

### 3.4 Convergent post-terminal effects

Do **not** define response/occurrence/reconciliation as “winner-only” in the sense of “never retried”. Instead split effects into two categories.

**Terminal-atomic/winner-only writes**

- execution terminal state;
- deterministic 1RM derivations that participate in the same batch;
- any canonical completion-evidence record chosen as the recovery source.

**Retryable convergence**

- linked occurrence state;
- structured-occurrence reconciliation;
- immediate response projection **only from the canonical durable completion evidence**, not from a stale caller-local payload.

An `already_completed` caller may therefore repair missing post-terminal projections safely. It must not rerun 1RM derivation and must not overwrite response facts from a different local submission.

### 3.5 Completion evidence and #896 boundary

Current `SessionExecution` persists `sessionRpe` and `notes`, but not all completion-sheet facts (`completedFraction`, `unexpectedFatigue`). If those values are needed for reliable post-crash response convergence, they need one durable source of truth.

WP2 should choose one of these implementation shapes without changing #896's missingness semantics:

- atomically create/update the deterministic immediate-response document with the terminal commit; or
- atomically persist a small immutable/idempotent terminal-evidence record/marker containing exactly the submitted fields, then project it to `SessionResponse` after commit.

Either shape must preserve “missing means missing”; no default/normal values may be fabricated. The implementation should coordinate with #896 only on storage shape if necessary, not absorb #896's UI/missingness redesign.

Tissue feedback remains separately owned by the daily check-in. If it stays before terminal commit, tests must prove repeating the same execution-linked upsert is non-destructive and conflicting source attribution remains rejected.

### 3.6 Redo remains start semantics

A retry of completion must never create a new execution. A legitimate redo remains the existing `startExecution(... allowDuplicateCompleted: true)` path.

Tests must prove the completed predecessor remains unchanged, the lock moves to one successor, and repeated/concurrent redo launch returns that same in-progress successor.

## 4. WP3 architecture

### 4.1 Stable execution identity

`findInProgressExecution` returns the newest active execution and is sufficient for the current single-active-runner product model. Resume must preserve that exact `executionId`; definition failure must never cause a fresh execution to be synthesized.

Navigation/discoverability belongs to #723.

### 4.2 Every new start must be prescription-pinned

Manual, catalog and external-plan prepared launches already carry `prescriptionHash`. `startFixtureSession` is the remaining raw start path and currently creates an execution without one.

After WP3, every newly created runner execution must carry a prescription hash. Legacy historical hash-less executions remain readable/degraded rather than rewritten.

### 4.3 Fixture replay exposes a snapshot-completeness gap

The first draft treated fixture pinning as “create a prescription with blocks + standard display metadata, then use the existing resolver”. That is insufficient.

Current behavior for `unplanned_fixture` is:

1. load the **current** fixture from `FIXTURES_BY_ID`;
2. hash that current fixture;
3. load the stored prescription;
4. accept replay only if a candidate current definition hash equals `prescription.definitionHash`;
5. replace its blocks with stored prescription blocks.

If the fixture changes or is removed, replay fails before the stored prescription can reconstruct the original definition.

This matters because reviewed fixtures contain executable/hash-covered top-level fields beyond blocks, including `modalities`, `sessionTargets` and `prohibitedAdditions`. `hashSessionDefinition` also covers `importWarnings` and `movementComposition`. `SessionDisplayMetadata` currently covers only title/summary/intent/dominantModality/duration/movementComposition, and the common `displayMetadataFor` helper does not currently include even `movementComposition`.

ADR-0023 D-MSNAP says the immutable execution prescription owns the exact normalized executable content and replay must not fall back to current definition bytes. Therefore WP3 must first close this completeness gap.

### 4.4 Required snapshot-completeness decision

Prefer one explicit representation instead of source-specific exceptions:

**Recommended:** extend the immutable execution-prescription snapshot so it contains every top-level `SessionDefinition` field included by `hashSessionDefinition` that is required to rebuild executable content, plus blocks. This may be a versioned `definitionSnapshot`/metadata shape rather than growing the presentation-oriented `displayMetadata` name indefinitely.

At minimum the snapshot must be sufficient to reconstruct and re-hash:

- `schemaVersion`;
- title/summary/intent;
- `modalities` / `dominantModality`;
- duration;
- `sessionTargets`;
- `prohibitedAdditions`;
- `importWarnings`;
- `movementComposition`;
- blocks.

Identity/placement fields intentionally excluded from `hashSessionDefinition` (`id`, `revision`, `defaultScheduledDate`, companion placement) remain provenance/source concerns.

The prescription schema/parser/rules/hash must remain backward-compatible with old snapshots. New snapshots become self-verifying and source-independent for executable replay. Old snapshots keep their existing source-assisted resolver path and degrade honestly if that source can no longer be verified.

### 4.5 Fixture preparation after snapshot completeness

`prepareFixtureSessionLaunch` should:

1. validate the fixture;
2. create `{ kind: 'unplanned_fixture', fixtureId }` provenance;
3. compute its definition hash;
4. build the complete immutable execution snapshot;
5. compute the content-addressed prescription hash;
6. save it write-once;
7. return `PreparedSessionLaunch` carrying that hash.

`startFixtureSession` then starts the prepared binding.

For a **new-format** fixture prescription, resume must reconstruct from the stored snapshot even if the current fixture bytes changed or the fixture was removed. The current fixture may be used only as optional provenance validation/diagnostic context, never as required executable content.

### 4.6 Degraded resume is explicit

When an active execution exists but exact definition resolution is impossible, preserve execution and diary identity and expose a typed degraded state.

For example:

```ts
type SessionResumeState =
    | { status: 'none' }
    | { status: 'ready'; execution; definition; entries; diarySync; progress }
    | { status: 'degraded'; execution; entries; diarySync; reason; failedIntents };
```

Stable reason families should include:

- legacy/missing prescription hash;
- prescription missing;
- prescription invalid/hash mismatch;
- prescription temporarily unavailable;
- legacy source unavailable/unresolvable when the old prescription is not self-contained;
- diary failure/unavailable state.

A degraded result must never substitute current catalog/template/fixture content.

### 4.7 Queued diary overlay versus failed intent

Resume must show writes that the app acknowledged locally and that are still queued in Firebase persistent cache. Receipts help disambiguate queue/failure state; they are not a second replay mechanism.

The read model should keep two concepts separate:

- **effective diary state**: server/cache entries plus **queued** locally accepted mutations that are not yet visible in the initial collection snapshot;
- **failed intents**: retained rejected mutations for diagnostics/recovery UI only.

A failed receipt must force `diarySync = 'unavailable'`, but its `after` bytes must **not** be projected as a successful `SessionEntry`, used for progress, or passed into planned-vs-performed semantics.

For multiple queued receipts targeting the same entry, do not trust storage enumeration or timestamp sorting. Apply only a valid causal mutation chain, using the immutable mutation's `before`/`after` identity (`diaryMutationId`) or an equivalent deterministic chain check. Conflicting/unorderable receipts should fail degraded rather than guess.

This must be tested with at least:

- log → correct;
- log → delete;
- delete → restore;
- log → correct → delete → restore;
- choice append/supersession events;
- a failed correction after a server-accepted earlier state.

### 4.8 One progression projection

Cursor/progress restoration must derive from pinned definition + effective restored entries using the same semantics as live progression:

- append-only effective choice resolution;
- governing-choice provenance;
- required versus optional work;
- block `rounds` authority;
- rotating/sequential behavior;
- per-side duration holds;
- tombstone exclusion;
- completed/remaining prescribed work.

Do not promise an exact cursor when no durable evidence identifies the athlete's last manually selected but unlogged optional step. #895 requires “current step where known”. The shared projection should return the next/current required step when derivable and otherwise a safe deterministic default/unknown state.

### 4.9 Rest/timing invariant

The current reload behavior is correct and should be regression-locked:

- clear `activeRestRef`;
- clear manual rest deadline;
- set remaining rest to 0;
- set `isRestRunning = false`;
- preserve already closed durable rest events as history;
- never infer a performed/running rest from set timestamps.

Session elapsed time may continue to derive from `execution.startedAt` and wall clock while execution is in progress; that is separate from performed-rest reconstruction.

## 5. Dependency interactions

### #724 — completion/abandonment UX

WP2 supplies lifecycle semantics. #724 may change confirmation/review surfaces but must not create another terminal-write authority.

### #896 — completion evidence missingness

WP2 must preserve optional evidence exactly as submitted. If a durable terminal-evidence shape is added for crash recovery, absent fields stay absent. #896 still owns any broader UX/missingness decisions.

### #952 — intraday secondary launch exactly once

Keep execution locks and occurrence identity unchanged. WP2/WP3 should not absorb placement/recommendation replay unless implementation exposes a direct shared lifecycle defect.

### #723 — resume discoverability

WP3 provides exact/degraded resume state. #723 can later decide where and how Resume is exposed.

## 6. Architecture decisions for the implementation plan

1. **Service owns lifecycle idempotence.** Hook refs prevent duplicate UI actions; rules remain the final terminal immutability backstop.
2. **Terminal transition is single-winner; post-terminal projections are convergent.** Retrying an already-completed execution may repair idempotent downstream state from canonical durable evidence.
3. **Preserve 1RM + completion atomicity.** A race loser never re-runs derived writes.
4. **Completion facts needed after a crash must have a durable canonical source.** Never replay a stale race-loser payload into `SessionResponse`.
5. **No new diary replay queue.** Firebase persistent cache remains the only diary writer queue; receipts are evidence/read-model inputs.
6. **Every new execution is prescription-pinned.** Fixture launch joins the prepared-launch model.
7. **New prescription snapshots must be self-sufficient for executable replay.** Fixture replay cannot depend on current fixture bytes.
8. **No live-definition fallback.** Legacy/source resolution failure yields degraded resume with execution/diary intact.
9. **Failed receipt != performed entry.** Failed intents remain diagnostic evidence and never drive progress.
10. **Queued receipt application is causal, not storage-order based.**
11. **Live and resumed progression share pure logic.**
12. **In-flight rest is never reconstructed.**
13. **Redo is explicit start semantics, not a terminal retry.**
14. **No policy-authority change.** No `POLICY_VERSION` bump, recommendation rule, load-cost rule or Garmin authority change.

## 7. Acceptance evidence required before implementation PR merge

### Lifecycle

- same-tab double complete/abandon is single-flight;
- two-client complete produces one terminal transition and converges all post-terminal effects exactly once in state, even if called repeatedly;
- injected crash after terminal commit but before response/occurrence/reconciliation is repairable on retry/reload;
- complete versus abandon preserves whichever terminal state committed first;
- repeated abandon remains abandoned and keeps all prior sets;
- explicit redo creates exactly one successor and preserves its completed predecessor;
- a race loser never re-runs 1RM derivation;
- immediate-response convergence never overwrites canonical winner evidence with different loser-local facts.

### Resume/snapshot

- every new start path carries `prescriptionHash`;
- new fixture execution is snapshot-pinned;
- changing/removing the live fixture after start does not change or block replay of a new-format pinned fixture;
- snapshot re-hash verifies every executable top-level field covered by `hashSessionDefinition`;
- legacy incomplete snapshots remain backward-compatible and degrade honestly when source reconstruction is impossible;
- missing/invalid/unavailable prescription never falls back to current source content;
- reload preserves exact execution id and entries.

### Diary/progress

- queued log/correct/delete/restore chains survive reload and produce the same effective state as live execution;
- same-target queued receipts are applied by a validated causal chain;
- failed receipts remain visible as failed intent but never become canonical entries/progress;
- append-only choice lineage restores the same branch state as live execution;
- required/optional, rounds and per-side progress restore consistently;
- reload never reconstructs an in-flight rest;
- closed rest events remain durable history.

## 8. Recommended implementation document

The revised implementation details, file map, ordering and merge gates are in:

[`docs/plans/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md`](../plans/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md).
