# Issue #895 WP2 + WP3 — lifecycle and exact-resume architecture analysis

| | |
|---|---|
| **Type** | Point-in-time analysis (`docs/analysis`: what is true today) |
| **Issue** | [#895 — structured execution as the canonical lossless training record](https://github.com/Szczepanov/adaptive-training-recommender/issues/895) |
| **Scope** | WP2 lifecycle hardening + WP3 exact resume |
| **Baseline** | `origin/main` `007602f8e5be5901509e9aba1803dd2b21620988` (2026-10-05) |
| **Prior delivery** | [PR #993](https://github.com/Szczepanov/adaptive-training-recommender/pull/993) — WP0/WP1 durable diary; [PR #995](https://github.com/Szczepanov/adaptive-training-recommender/pull/995) — append-only choice replay |
| **Policy effect** | None. Persistence, lifecycle and replay correctness only; `POLICY_VERSION` must not change. |

## 1. Executive conclusion

WP2 and WP3 should remain one implementation PR.

They share the same authority boundary: a `SessionExecution` is the stable identity of the workout in progress, its terminal state must change exactly once, and a reload must re-enter that same execution using the exact prescription snapshot that execution started with. Splitting lifecycle and resume would temporarily leave one of those invariants dependent on stale React state, a live catalog/fixture definition, or Firestore rule rejection.

The current code is materially stronger than the September #895 baseline because WP0/WP1 and append-only choice semantics have landed. The remaining gaps are narrower and more concrete:

1. **Terminal transitions are server-protected but not yet application-idempotent.** `SessionExecutionService.transitionExecution` blindly merges a terminal patch. The hook's `execution.state === 'in_progress'` guard is only local React state; another tab/client can race it. Firestore rules prevent mutation out of a terminal state, but the loser receives a generic write failure rather than an explicit already-completed/already-abandoned result.
2. **Completion/abandonment orchestration has no persisted transition result.** The hook cannot distinguish "this caller performed the terminal transition" from "another client already did". That matters because completion has downstream fan-out: 1RM derivation, immediate response persistence, occurrence transition and structured-occurrence reconciliation.
3. **Redo is already the right model and should not be redesigned.** `allowDuplicateCompleted` deliberately advances the deterministic execution lock to a new execution while preserving the old completed document. The existing start single-flight guard plus lock transaction already prevents ordinary double-starts.
4. **Reload still contains a fixture escape hatch.** `useSessionRunner` resolves `unplanned_fixture` directly from the live fixture array and only calls `resolveSessionDefinition` for non-fixtures. Yet `resolveSessionDefinition` already supports fixtures plus a stored `prescriptionHash`. The special case therefore bypasses the exact-snapshot boundary.
5. **Fixture launch is the remaining unpinned start path.** `startFixtureSession` calls `startSession` without preparing or saving an `ExecutionPrescription`, so the resulting execution has no `prescriptionHash`.
6. **Resume has no explicit degraded contract.** If the prescription hash is missing, unavailable or invalid, the hook sets `syncStatus = 'unavailable'`, but it does not expose a typed reason separating "execution and diary are intact, definition cannot be reconstructed" from ordinary sync failure.
7. **WP1 local durability needs to be represented during resume, not reimplemented.** Firebase persistent cache remains the only replay queue. Owner-scoped diary receipts retain locally accepted intent and rejected values across reload. WP3 should consume that state for read/recovery status; it must not introduce a second replay/outbox implementation.
8. **The no-rest-reconstruction invariant is already correct.** Reload clears `activeRestRef`, the manual rest deadline, remainder and running state before asynchronous restore. This must remain unchanged and gain focused regression coverage.

## 2. Current architecture verified on `main`

### 2.1 Execution creation and redo

`SessionExecutionService.startExecution` first searches for an existing matching execution and then arbitrates creation through a deterministic `session_execution_locks` document.

For a matching slot:

- `in_progress` returns the existing execution;
- `completed` fails unless `allowDuplicateCompleted` is explicitly true;
- `completed + allowDuplicateCompleted` creates a new execution and moves the lock pointer;
- `abandoned` may also be replaced by a new execution;
- the old execution document remains immutable history.

The online authority is the Firestore transaction in `claimExecutionSlot`. Offline start uses an atomic SDK write batch so persistent cache can queue the claim and server rules arbitrate it later. This is already the correct shape for "explicit legitimate redo" and should be preserved.

### 2.2 Terminal writes

`SessionExecutionService.transitionExecution` currently builds a patch and either:

- appends it to a caller-owned `WriteBatch`, or
- calls `setDoc(..., { merge: true })` directly.

It does not read the persisted execution state, return a transition outcome, or translate a race-loser rule rejection into an already-terminal result.

The Firestore rules are therefore the final concurrency backstop, but the application surface is not yet idempotent. The distinction matters: "rejected because another client already completed this execution" is an expected lifecycle outcome, not the same class of failure as connectivity, malformed writes, preference-write failure, or permission problems.

### 2.3 Completion orchestration

`useSessionRunner.completeSession` currently:

1. returns early only when the local React execution is not `in_progress`;
2. closes an active rest before terminal transition;
3. writes tissue feedback to the daily check-in when present;
4. rereads persisted entries;
5. creates a Firestore batch;
6. adds deterministic 1RM derivations when applicable;
7. adds the execution `completed` transition to the same batch;
8. commits the batch;
9. sets local execution state to completed;
10. writes the immediate `SessionResponse`;
11. transitions the linked occurrence to completed;
12. fires structured-occurrence reconciliation.

The 1RM/terminal batch is an important existing guarantee: derived strength state cannot land while the execution remains in progress. WP2 should preserve this atomicity.

The missing guarantee is winner awareness. A stale second client can run pre-transition work and then have the batch rejected by rules because another client already completed the execution. Today that surfaces as a generic error. The implementation needs a persisted-state reconciliation step after a rejected terminal write and must prevent winner-only fan-out from running twice.

### 2.4 Abandon orchestration

`abandonSession` has the same local-only state guard, closes active rest, batches the `abandoned` transition, commits, then updates the linked occurrence. Already logged entries are not deleted, which is correct and must remain explicit in tests.

### 2.5 Durable diary state from WP1

PR #993 established the correct ownership model:

- `SessionExecutionService` is the sole diary write authority;
- Firebase persistent cache is the replay queue;
- entry/rest target + immutable `diaryMutations` marker + execution touch are queued atomically;
- correction history is auditable;
- deletion uses tombstones;
- undo is durable;
- owner/execution/mutation-scoped receipts survive reload and retain failed intent;
- `watchDiarySync` distinguishes queued versus synced and retains failed receipts.

PR #995 additionally made choice events append-only and gave performed entries explicit governing-choice provenance. Any resume cursor/progress derivation must therefore replay the same effective choice chain rather than infer branch state from arrival order.

WP3 must consume these two contracts; it must not create a new local queue or a second choice-resolution algorithm.

## 3. WP2 gap analysis — terminal lifecycle

### 3.1 Same-tab double tap

The runner has `startInFlightRef` for launch but no equivalent terminal single-flight ref. React state updates are asynchronous, so two completion/abandon events can enter the handler before the first commit updates `execution.state`.

A local `terminalTransitionInFlightRef` is warranted as a UX/process guard, but it is not sufficient by itself. Cross-tab and stale-client correctness still belongs in the service/rules layer.

### 3.2 Cross-client race

The correct model is **idempotent classification, not silent overwrite**.

A terminal operation needs to distinguish at least:

- `transitioned` — this caller moved `in_progress` to the requested terminal state;
- `already_completed` — persisted execution is already completed;
- `already_abandoned` — persisted execution is already abandoned.

For `complete`:

- `already_completed` is an idempotent success/no-op;
- `already_abandoned` is a conflicting terminal outcome and must not be rewritten.

For `abandon`:

- `already_abandoned` is an idempotent success/no-op;
- `already_completed` is a conflicting terminal outcome and must not be rewritten.

Unknown/unavailable/invalid execution state remains a real failure, not an idempotent success.

### 3.3 Preserve completion-batch atomicity

Moving completion entirely to a separate transaction would break the existing atomic 1RM + terminal write guarantee. The lifecycle service should instead own or coordinate the terminal commit while allowing deterministic derived writes to participate in the same batch.

A suitable service API is a dedicated terminal operation rather than making the hook reason about rule errors directly. One viable shape is:

```ts
type TerminalTransitionOutcome =
    | { kind: 'transitioned'; execution: SessionExecution }
    | { kind: 'already_completed'; execution: SessionExecution }
    | { kind: 'already_abandoned'; execution: SessionExecution };
```

with a completion method that:

1. reads/classifies persisted state;
2. returns an already-terminal result before queuing writes when possible;
3. creates the caller-shared batch / invokes a callback that queues deterministic derived writes;
4. adds the execution transition;
5. commits once;
6. if commit is rejected by the terminal-state rule race, rereads the execution and translates the now-terminal state into the typed outcome;
7. rethrows when the execution is still in progress or the failure is unrelated.

The exact API name is implementation detail; the architectural requirement is that the service returns the persisted lifecycle outcome and the hook does not parse Firestore error strings/codes as business state.

### 3.4 Winner-only fan-out

Only `transitioned` may perform side effects that represent "completion happened now" for this caller:

- immediate session-response write;
- occurrence transition;
- structured-occurrence reconciliation.

The already-completed path should update/align local UI from the persisted execution and exit without duplicating fan-out.

Derived writes in the atomic completion batch are naturally winner-only because a race-loser batch is rejected as a whole.

Tissue feedback currently occurs before the terminal batch. This analysis does **not** silently redefine #896/#724 completion evidence semantics. The implementation should either:

- retain the existing ordering and prove the upsert is idempotent for the same execution source, or
- move it only if the #896 missingness/evidence contract is reviewed in the same change.

Do not broaden WP2 into a subjective-evidence redesign.

### 3.5 Explicit redo remains separate from idempotent retry

A retry of `complete` must never create a new execution. A legitimate redo is only the existing start path with `allowDuplicateCompleted: true`.

Tests should prove:

- repeated redo launch attempts while the new redo execution is already `in_progress` return that same execution;
- the original completed execution remains unchanged;
- the lock points at the new execution;
- normal start without the explicit flag still reports already-completed.

## 4. WP3 gap analysis — exact resume

### 4.1 Execution identity

`findInProgressExecution` returns the most recently started active execution. That is sufficient for the current single-active-runner product model, but the resume result should preserve the exact returned `executionId` and never synthesize a fresh execution because definition resolution failed.

Future resume discoverability belongs to #723; WP3 is the integrity substrate, not the navigation redesign.

### 4.2 Prescription snapshot

For manual, catalog and external-plan launches, authoring already saves an immutable, content-addressed `ExecutionPrescription` and passes its hash in the binding. The resolver verifies source identity and definition hash and reconstructs catalog history from stored display metadata rather than silently taking the live catalog.

The resolver also supports `unplanned_fixture + prescriptionHash`, but the runner currently bypasses that capability on reload.

The integrity rule should become uniform:

> Every newly started execution has a `prescriptionHash`, and every resume resolves through `resolveSessionDefinition(userId, execution.sessionSource, execution.prescriptionHash)`.

Legacy historical executions with no hash remain readable, but a new in-progress execution should not be created without one after WP3.

### 4.3 Fixture pinning

`startFixtureSession` is the remaining start path that does not freeze a prescription.

Recommended correction: add an authoring-boundary helper that validates the fixture, computes its definition hash, constructs the standard `ExecutionPrescription` with fixture source + exact blocks + display metadata, saves it through `executionPrescriptionService`, and starts the execution with that hash.

Do not special-case fixture replay in the hook. The fixture source remains useful provenance; the prescription is the immutable executed content.

### 4.4 Degraded resume must be explicit

When an execution exists but the definition cannot be resolved, the app must preserve the execution and diary instead of pretending no session exists or falling back to live content.

A focused resume state should distinguish, for example:

```ts
type SessionResumeState =
    | { status: 'ready'; execution; definition; entries; diarySync }
    | { status: 'degraded'; execution; entries; diarySync; reason: ResumeDegradedReason }
    | { status: 'none' };
```

Reason categories should be stable enough for tests/diagnostics, while retaining underlying `DataState` detail where useful:

- missing prescription hash (legacy/incomplete binding);
- stored prescription missing;
- prescription invalid/hash mismatch/source mismatch;
- prescription temporarily unavailable;
- source definition/revision missing or invalid.

A degraded result must **not** substitute the latest catalog/template/fixture definition. That would corrupt planned-vs-performed comparison and violate #895 invariant 4.

### 4.5 Locally queued diary state

Resume must show all locally acknowledged diary work, including writes still waiting for the backend.

The important distinction from the old plan wording is that WP1 has **no custom outbox to drain**. Firebase persistent cache is the replay queue. Receipts are read-side durability/failure evidence and must never resend mutations.

Recommended read model:

1. read the execution;
2. read entries from Firestore's local/default view so latency-compensated queued writes remain visible;
3. read owner-scoped diary receipts for the execution;
4. derive resume sync state:
   - failed receipt => `unavailable`/degraded sync;
   - queued receipt or pending Firestore writes => `queued`;
   - otherwise `synced` when server-confirmed by the existing watch;
5. if a receipt's locally accepted mutation is not yet visible in the initial collection snapshot, apply it as a **read-only overlay** to the resume view using the immutable mutation's `after` state. Do not write or replay it from the resume path.

This makes reload honest even when the SDK query snapshot lags the receipt that recorded local acceptance. Failed receipts remain visible as failed intent rather than being presented as canonical server state.

### 4.6 Current step and remaining work

Cursor/progress restoration must derive from the pinned definition + restored entries, using the same semantics as live progression:

- append-only effective choice resolution;
- choice-governed performed entries;
- required versus optional steps;
- block `rounds` authority;
- rotating/sequential behavior;
- per-side duration holds;
- tombstone exclusion;
- completed/remaining prescribed work.

Do not add a second bespoke "resume progression" algorithm in the hook. Extract or reuse a pure progression projection consumed by both live advancement and restore.

### 4.7 Rest/timing invariant

The current behavior is correct and should be locked down:

- clear `activeRestRef` before restore;
- clear manual rest deadline;
- set remaining rest to 0;
- set `isRestRunning = false`;
- preserve already closed durable rest events as history;
- never infer a running/performed rest from set timestamps.

Session elapsed time may continue to derive from `execution.startedAt` and wall clock while the execution is in progress; that is separate from performed rest reconstruction.

## 5. Dependency interactions

### #724 — safe completion/abandonment UX

WP2 supplies the lifecycle semantics #724 should call. #724 may change confirmation/review surfaces but must not create another terminal-write authority.

### #896 — completion missingness

WP2 should preserve optional evidence exactly as supplied. Do not use lifecycle hardening as a reason to default missing sRPE/completion/fatigue values. If #896 lands first, WP2 consumes the new payload shape; if WP2 lands first, its terminal API must remain agnostic to optional response fields.

### #952 — intraday secondary launch exactly once

#952 exercises the same high-level property: lifecycle replay must not turn a completed primary into duplicate starts or erase the remaining same-day member. WP2 must keep execution locks and occurrence identity unchanged. Fixing #952's placement/recommendation replay is separate unless implementation exposes a direct shared bug.

### #723 — resume discoverability

WP3 provides the typed exact-resume substrate. #723 can later decide where/how Resume is exposed without owning reconstruction correctness.

## 6. Architecture decisions for the implementation plan

1. **Service owns lifecycle idempotence.** Hook refs prevent duplicate UI actions; Firestore rules remain the final concurrency backstop; business classification belongs in `SessionExecutionService`.
2. **No new replay queue.** Firebase persistent cache stays the only writer replay mechanism. Diary receipts are read/diagnostic evidence only.
3. **All new executions are prescription-pinned.** Fixture launches join the same write-once prescription model.
4. **No live-definition fallback on resume.** Resolution failure yields degraded resume with intact execution/diary identity.
5. **One progress projection.** Live advancement and reload derive required/completed/remaining work through shared pure logic.
6. **Rest is never reconstructed after reload.** Closed rest history is durable; an in-flight rest is intentionally lost.
7. **Redo is explicit start semantics, not a terminal retry behavior.** Preserve `allowDuplicateCompleted` and lock-pointer advancement.
8. **No policy-authority change.** No `POLICY_VERSION` bump, recommendation rule, load-cost rule or Garmin authority change.

## 7. Acceptance evidence required before implementation PR merge

The implementation PR should not claim WP2/WP3 complete without evidence for all of the following:

- double completion from one client is single-flight and idempotent;
- two-client completion race yields one `transitioned` and one `already_completed`, not two fan-outs;
- complete versus abandon race preserves whichever terminal state committed first and never rewrites it;
- repeated abandon returns already-abandoned and keeps prior sets;
- explicit redo creates exactly one new in-progress execution, moves the lock and preserves the completed predecessor;
- reload restores exact execution id and pinned definition after the live source changes;
- fixture launches now carry a prescription hash and fixture reload resolves through that stored prescription;
- locally queued entries/choices/corrections survive reload in the resume view and remain marked queued until acknowledged;
- failed receipt remains visible as failure/degraded sync, not `synced`;
- missing/invalid/unavailable prescription produces degraded resume without substituting current source content;
- effective append-only choice replay determines branch state after reload;
- per-side/round/required-optional progress restores consistently with live progression;
- reload never reconstructs an in-flight rest;
- closed rest events remain durable history;
- no second execution write authority or second replay queue is introduced.

## 8. Recommended next document

Implementation details, file map, test order and merge gates are specified in:

[`docs/plans/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md`](../plans/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md).
